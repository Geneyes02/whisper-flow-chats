//! Native CI adversarial test harness.
//!
//! Runs against the stub backend. Assertions cover the invariants Whispr
//! depends on and that must hold for every backend:
//!
//!   * fail-closed messaging when unsupported,
//!   * identity provisioning is idempotent,
//!   * prekey bundles contain public material only,
//!   * snapshots round-trip through the secure store,
//!   * device revocation is terminal,
//!   * lifecycle transitions (lock/unlock/wipe/logout) behave correctly,
//!   * malformed IPC-shaped input is rejected with structured errors,
//!   * corrupted persisted state is surfaced, not silently trusted,
//!   * concurrent calls do not corrupt in-memory state.
//!
//! Every check here is also a member of the shared conformance suite in
//! `whispr_crypto_host::conformance`. When a real backend lands, the same
//! suite runs against it unchanged.

use std::sync::Arc;
use std::thread;

use whispr_crypto_host::{
    conformance::{run_host_invariants, Capability},
    error::CryptoErrorCode,
    keychain::{MemoryStore, Slot},
    CryptoHost, EncryptedEnvelope, EnvelopeKind, LockState, ProvisioningState,
    ENVELOPE_VERSION, MAX_ID_LEN,
};

fn host() -> CryptoHost {
    CryptoHost::with_store(Arc::new(MemoryStore::new())).expect("host")
}

// ---------------------------------------------------------------------
// Baseline invariants (kept for readability; also covered by conformance).
// ---------------------------------------------------------------------

#[test]
fn identity_is_idempotent() {
    let h = host();
    let a = h.create_identity().unwrap();
    let b = h.create_identity().unwrap();
    assert_eq!(a.device_id, b.device_id);
    assert_eq!(a.identity_public_key, b.identity_public_key);
}

#[test]
fn load_identity_returns_none_before_creation() {
    let h = host();
    assert!(h.load_identity().unwrap().is_none());
    h.create_identity().unwrap();
    assert!(h.load_identity().unwrap().is_some());
}

#[test]
fn prekey_bundle_contains_only_public_material() {
    let h = host();
    h.create_identity().unwrap();
    let bundle = h.publish_prekeys(10).unwrap();
    assert_eq!(bundle.one_time_prekeys.len(), 10);
    let json = serde_json::to_string(&bundle).unwrap();
    assert!(
        !json.to_lowercase().contains("private"),
        "prekey bundle leaked a private-looking field: {json}"
    );
}

#[test]
fn stub_backend_refuses_to_encrypt() {
    let h = host();
    h.create_identity().unwrap();
    let err = h.encrypt("peer", b"hello", b"aad").unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Unsupported);
}

#[test]
fn stub_backend_refuses_to_establish_session() {
    let h = host();
    h.create_identity().unwrap();
    let bundle = h.publish_prekeys(1).unwrap();
    let err = h.establish_session(bundle).unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Unsupported);
}

#[test]
fn snapshot_round_trip_through_shared_store() {
    let store = Arc::new(MemoryStore::new());
    let h1 = CryptoHost::with_store(store.clone()).unwrap();
    let created = h1.create_identity().unwrap();
    drop(h1);
    let h2 = CryptoHost::with_store(store).unwrap();
    let loaded = h2.load_identity().unwrap().expect("persisted identity");
    assert_eq!(loaded.device_id, created.device_id);
    assert_eq!(loaded.identity_public_key, created.identity_public_key);
}

#[test]
fn revocation_is_terminal() {
    let h = host();
    h.create_identity().unwrap();
    h.revoke_device().unwrap();
    let err = h.publish_prekeys(1).unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::DeviceRevoked);
}

#[test]
fn safety_number_is_stable_for_same_peer_key() {
    let h = host();
    h.create_identity().unwrap();
    let peer = vec![7u8; 32];
    let a = h.safety_number(&peer).unwrap();
    let b = h.safety_number(&peer).unwrap();
    assert_eq!(a.digits, b.digits);
    assert_eq!(a.fingerprint, b.fingerprint);
}

#[test]
fn missing_identity_reports_no_identity() {
    let h = host();
    let err = h.publish_prekeys(1).unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::NoIdentity);
}

// ---------------------------------------------------------------------
// Adversarial: input validation
// ---------------------------------------------------------------------

#[test]
fn encrypt_rejects_bad_recipient_charset() {
    let h = host();
    h.create_identity().unwrap();
    let err = h.encrypt("has whitespace", b"x", b"").unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Internal);
}

#[test]
fn encrypt_rejects_oversized_recipient() {
    let h = host();
    h.create_identity().unwrap();
    let big = "a".repeat(MAX_ID_LEN + 1);
    let err = h.encrypt(&big, b"x", b"").unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Internal);
}

#[test]
fn encrypt_rejects_empty_recipient() {
    let h = host();
    h.create_identity().unwrap();
    let err = h.encrypt("", b"x", b"").unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Internal);
}

#[test]
fn encrypt_rejects_oversized_plaintext() {
    let h = host();
    h.create_identity().unwrap();
    let huge = vec![0u8; 2 * 1024 * 1024]; // > MAX_PLAINTEXT_LEN
    let err = h.encrypt("peer", &huge, b"").unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Internal);
}

#[test]
fn decrypt_rejects_unknown_envelope_version() {
    let h = host();
    h.create_identity().unwrap();
    let env = EncryptedEnvelope {
        version: 999,
        backend: "stub-v0".into(),
        protocol_id: "whispr-none".into(),
        protocol_version: 0,
        sender_device_id: "sender".into(),
        recipient_device_id: "recipient".into(),
        conversation_id: "".into(),
        message_id: "".into(),
        counter: 0,
        ciphertext: "AAAA".into(),
        aad: "".into(),
        kind: EnvelopeKind::Whisper,
    };
    let err = h.decrypt(&env).unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Unsupported);
}

#[test]
fn decrypt_rejects_empty_ciphertext() {
    let h = host();
    h.create_identity().unwrap();
    let env = EncryptedEnvelope {
        version: ENVELOPE_VERSION,
        backend: "stub-v0".into(),
        protocol_id: "whispr-none".into(),
        protocol_version: 0,
        sender_device_id: "sender".into(),
        recipient_device_id: "recipient".into(),
        conversation_id: "".into(),
        message_id: "".into(),
        counter: 0,
        ciphertext: "".into(),
        aad: "".into(),
        kind: EnvelopeKind::Whisper,
    };
    let err = h.decrypt(&env).unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::BadCiphertext);
}

#[test]
fn safety_number_rejects_empty_peer_key() {
    let h = host();
    h.create_identity().unwrap();
    let err = h.safety_number(&[]).unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::Internal);
}

// ---------------------------------------------------------------------
// Adversarial: lifecycle
// ---------------------------------------------------------------------

#[test]
fn lock_refuses_operations() {
    let h = host();
    h.create_identity().unwrap();
    h.lock();
    let err = h.publish_prekeys(1).unwrap_err();
    assert_eq!(err.code, CryptoErrorCode::StorageLocked);
    assert!(matches!(h.status().lock, LockState::Locked));
}

#[test]
fn unlock_restores_operations() {
    let h = host();
    h.create_identity().unwrap();
    h.lock();
    h.unlock();
    h.publish_prekeys(1).expect("should work after unlock");
    assert!(matches!(h.status().lock, LockState::Unlocked));
}

#[test]
fn load_identity_allowed_while_locked() {
    let h = host();
    h.create_identity().unwrap();
    h.lock();
    // Reading public identity must still work; it's needed to render the UI.
    let id = h.load_identity().unwrap();
    assert!(id.is_some());
}

#[test]
fn revocation_permitted_while_locked() {
    let h = host();
    h.create_identity().unwrap();
    h.lock();
    // Revocation must always be reachable.
    h.revoke_device().expect("revoke must succeed while locked");
}

#[test]
fn wipe_returns_to_uninitialized() {
    let h = host();
    h.create_identity().unwrap();
    h.wipe().unwrap();
    assert!(matches!(h.status().provisioning, ProvisioningState::Uninitialized));
    assert!(h.load_identity().unwrap().is_none());
}

#[test]
fn logout_wipes_all_slots() {
    let store = Arc::new(MemoryStore::new());
    let h = CryptoHost::with_store(store.clone()).unwrap();
    h.create_identity().unwrap();
    h.publish_prekeys(2).unwrap();
    h.logout().unwrap();
    for slot in Slot::ALL {
        assert!(store.get(*slot).unwrap().is_none(),
            "slot {:?} was not cleared", slot);
    }
}

#[test]
fn status_reports_uninitialized_before_create() {
    let h = host();
    let s = h.status();
    assert!(matches!(s.provisioning, ProvisioningState::Uninitialized));
    assert_eq!(s.envelope_version, ENVELOPE_VERSION);
    assert!(!s.backend.is_empty());
}

#[test]
fn status_reports_revoked_after_revoke() {
    let h = host();
    h.create_identity().unwrap();
    h.revoke_device().unwrap();
    assert!(matches!(h.status().provisioning, ProvisioningState::Revoked));
}

// ---------------------------------------------------------------------
// Adversarial: storage corruption
// ---------------------------------------------------------------------

#[test]
fn corrupted_identity_slot_surfaces_storage_corrupt() {
    let store = Arc::new(MemoryStore::new());
    let h = CryptoHost::with_store(store.clone()).unwrap();
    h.create_identity().unwrap();
    drop(h);
    store.inject(Slot::DeviceIdentity, "not-a-valid-snapshot");
    // Reconstruct — should fail closed at load.
    let err = CryptoHost::with_store(store).err();
    assert!(err.is_some(), "corrupted store must not silently succeed");
    let e = err.unwrap();
    assert_eq!(e.code, CryptoErrorCode::StorageCorrupt);
}

#[test]
fn missing_slots_are_not_errors() {
    // A fresh store has no slots populated; construction and load must
    // succeed and report Uninitialized.
    let h = host();
    assert!(h.load_identity().unwrap().is_none());
    assert!(matches!(h.status().provisioning, ProvisioningState::Uninitialized));
}

// ---------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------

#[test]
fn concurrent_publish_prekeys_does_not_deadlock() {
    let h = Arc::new(host());
    h.create_identity().unwrap();
    let mut handles = Vec::new();
    for _ in 0..8 {
        let h = h.clone();
        handles.push(thread::spawn(move || {
            for _ in 0..10 {
                let _ = h.publish_prekeys(2);
                let _ = h.load_identity();
                let _ = h.status();
            }
        }));
    }
    for h in handles { h.join().unwrap(); }
    // Identity remained stable.
    let id = h.load_identity().unwrap().unwrap();
    assert!(!id.device_id.is_empty());
}

// ---------------------------------------------------------------------
// Backend conformance
// ---------------------------------------------------------------------

#[test]
fn stub_backend_passes_host_invariants() {
    let report = run_host_invariants(Capability::NonMessaging);
    if !report.all_passed() {
        for c in &report.checks {
            if !c.passed {
                eprintln!("FAIL {}: {} — {:?}", c.id, c.description, c.detail);
            }
        }
        panic!("stub backend failed host invariant conformance");
    }
    assert!(!report.backend.is_empty());
}
