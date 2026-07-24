//! Native CI test harness.
//!
//! Runs against the stub backend. We only assert the invariants the
//! Whispr UI depends on and that hold for *every* backend:
//!
//!   * fail-closed messaging when unsupported,
//!   * identity provisioning is idempotent,
//!   * prekey bundles contain public material only,
//!   * snapshots round-trip through the secure store,
//!   * device revocation is terminal.
//!
//! When a real backend lands, extend `common::backends()` to include it and
//! the same assertions run against every backend.

use std::sync::Arc;

use whispr_crypto_host::{
    error::CryptoErrorCode, keychain::MemoryStore, CryptoHost,
};

fn host() -> CryptoHost {
    CryptoHost::with_store(Arc::new(MemoryStore::new())).expect("host")
}

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
    // No field should ever be named or contain "private" — the wire type
    // simply doesn't have such a field, but assert on the serialized shape
    // to guard against future accidental additions.
    let json = serde_json::to_string(&bundle).unwrap();
    assert!(!json.to_lowercase().contains("private"),
        "prekey bundle leaked a private-looking field: {json}");
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
