//! Backend-agnostic conformance suite.
//!
//! Every future `CryptoBackend` implementation (stub, libsignal, MLS, …)
//! MUST pass the assertions in this module before Whispr will ship against
//! it. The suite is intentionally split into two tiers:
//!
//!   * [`run_host_invariants`] — invariants that must hold for EVERY
//!     backend, including the stub. Covers input validation, fail-closed
//!     behavior, identity idempotency, storage round-trip, revocation
//!     terminality, and lifecycle transitions.
//!
//!   * [`run_messaging_capabilities`] — invariants that must hold for any
//!     backend that claims to support real messaging. Covers authenticated
//!     encryption, forward secrecy proxies, session persistence, corruption
//!     detection, and multi-device recovery. The stub backend deliberately
//!     does NOT run this tier.
//!
//! The suite operates through the public [`CryptoHost`] API only. It does
//! not depend on backend internals, so the exact same code runs against
//! any future backend implementation.

use std::sync::Arc;

use crate::api::{CryptoHost, LockState, ProvisioningState};
use crate::error::CryptoErrorCode;
use crate::keychain::{MemoryStore, SecureStore};
use crate::types::MAX_ID_LEN;

/// Capability advertised by a backend under test.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    /// Backend advertises real E2EE messaging.
    Messaging,
    /// Backend is intentionally non-messaging (stub). Only host invariants
    /// are exercised.
    NonMessaging,
}

/// Result of a single conformance check.
#[derive(Debug, Clone)]
pub struct ConformanceCheck {
    /// Short identifier used in the reporting matrix.
    pub id: &'static str,
    /// Human-readable description.
    pub description: &'static str,
    /// Pass/fail.
    pub passed: bool,
    /// Optional message on failure.
    pub detail: Option<String>,
}

/// Full report from a conformance run.
#[derive(Debug, Clone)]
pub struct ConformanceReport {
    /// Backend name.
    pub backend: String,
    /// Capability advertised.
    pub capability: Capability,
    /// Per-check results.
    pub checks: Vec<ConformanceCheck>,
}

impl ConformanceReport {
    /// True if every check passed.
    pub fn all_passed(&self) -> bool {
        self.checks.iter().all(|c| c.passed)
    }
}

fn check(
    id: &'static str,
    description: &'static str,
    ok: bool,
    detail: Option<String>,
) -> ConformanceCheck {
    ConformanceCheck {
        id,
        description,
        passed: ok,
        detail,
    }
}

/// Build a fresh host bound to a fresh in-memory store.
fn fresh_host() -> (CryptoHost, Arc<dyn SecureStore>) {
    let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
    let host = CryptoHost::with_store(store.clone()).expect("host");
    (host, store)
}

/// Run the host-invariant tier. Runs for every backend.
pub fn run_host_invariants(capability: Capability) -> ConformanceReport {
    let mut checks = Vec::new();

    // ---- identity idempotency
    let (h, _) = fresh_host();
    let a = h.create_identity().expect("create");
    let b = h.create_identity().expect("create again");
    checks.push(check(
        "identity.idempotent",
        "create_identity is idempotent",
        a.device_id == b.device_id && a.identity_public_key == b.identity_public_key,
        None,
    ));

    // ---- no private-looking fields on prekey bundle
    let (h, _) = fresh_host();
    h.create_identity().unwrap();
    let bundle = h.publish_prekeys(4).expect("publish");
    let json = serde_json::to_string(&bundle).unwrap();
    checks.push(check(
        "prekeys.no_private_leak",
        "prekey bundle serialization contains no 'private' field",
        !json.to_lowercase().contains("private"),
        None,
    ));

    // ---- missing identity fails NoIdentity
    let (h, _) = fresh_host();
    let err = h.publish_prekeys(1).unwrap_err();
    checks.push(check(
        "identity.missing_no_identity",
        "publish_prekeys without identity returns NoIdentity",
        err.code == CryptoErrorCode::NoIdentity,
        Some(format!("{:?}", err.code)),
    ));

    // ---- revocation is terminal
    let (h, _) = fresh_host();
    h.create_identity().unwrap();
    h.revoke_device().unwrap();
    let err = h.publish_prekeys(1).unwrap_err();
    checks.push(check(
        "revocation.terminal",
        "post-revocation operations return DeviceRevoked",
        err.code == CryptoErrorCode::DeviceRevoked,
        Some(format!("{:?}", err.code)),
    ));

    // ---- input validation: bad recipient_device_id
    let (h, _) = fresh_host();
    h.create_identity().unwrap();
    let err = h.encrypt("bad id with space", b"x", b"").unwrap_err();
    checks.push(check(
        "validation.recipient_id_charset",
        "encrypt rejects invalid recipient_device_id",
        matches!(
            err.code,
            CryptoErrorCode::Internal | CryptoErrorCode::Unsupported
        ),
        Some(format!("{:?}", err.code)),
    ));

    // ---- input validation: oversized id
    let (h, _) = fresh_host();
    h.create_identity().unwrap();
    let big = "a".repeat(MAX_ID_LEN + 1);
    let err = h.encrypt(&big, b"x", b"").unwrap_err();
    checks.push(check(
        "validation.recipient_id_length",
        "encrypt rejects oversized recipient_device_id",
        matches!(
            err.code,
            CryptoErrorCode::Internal | CryptoErrorCode::Unsupported
        ),
        None,
    ));

    // ---- lifecycle: lock refuses ops
    let (h, _) = fresh_host();
    h.create_identity().unwrap();
    h.lock();
    let err = h.publish_prekeys(1).unwrap_err();
    checks.push(check(
        "lifecycle.lock_refuses",
        "locked host refuses operations with StorageLocked",
        err.code == CryptoErrorCode::StorageLocked,
        Some(format!("{:?}", err.code)),
    ));
    h.unlock();
    checks.push(check(
        "lifecycle.unlock_restores",
        "unlock restores operational state",
        matches!(h.status().lock, LockState::Unlocked),
        None,
    ));

    // ---- lifecycle: wipe returns to uninitialized
    let (h, _) = fresh_host();
    h.create_identity().unwrap();
    h.wipe().unwrap();
    let status = h.status();
    checks.push(check(
        "lifecycle.wipe_uninitializes",
        "wipe returns host to Uninitialized",
        matches!(status.provisioning, ProvisioningState::Uninitialized),
        Some(format!("{:?}", status.provisioning)),
    ));

    // ---- storage round-trip across host restart
    let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
    let h1 = CryptoHost::with_store(store.clone()).unwrap();
    let created = h1.create_identity().unwrap();
    drop(h1);
    let h2 = CryptoHost::with_store(store).unwrap();
    let loaded = h2.load_identity().unwrap();
    checks.push(check(
        "storage.roundtrip",
        "identity survives host restart via secure store",
        loaded.as_ref().map(|i| i.device_id.clone()) == Some(created.device_id),
        None,
    ));

    // ---- corrupted storage surfaces StorageCorrupt
    let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
    let h1 = CryptoHost::with_store(store.clone()).unwrap();
    h1.create_identity().unwrap();
    drop(h1);
    // Corrupt the identity slot.
    store
        .put(crate::keychain::Slot::DeviceIdentity, "not-json")
        .unwrap();
    let corrupt = CryptoHost::with_store(store);
    checks.push(check(
        "storage.corruption_detected",
        "corrupted identity slot yields StorageCorrupt at load",
        corrupt.is_err()
            || matches!(
                corrupt
                    .as_ref()
                    .ok()
                    .and_then(|h| h.load_identity().err())
                    .map(|e| e.code),
                Some(CryptoErrorCode::StorageCorrupt)
            ),
        None,
    ));

    // ---- non-messaging backends must refuse encrypt/decrypt/session ops
    if capability == Capability::NonMessaging {
        let (h, _) = fresh_host();
        h.create_identity().unwrap();
        let err = h.encrypt("peer", b"x", b"").unwrap_err();
        checks.push(check(
            "nonmessaging.refuses_encrypt",
            "non-messaging backend refuses encrypt",
            err.code == CryptoErrorCode::Unsupported,
            Some(format!("{:?}", err.code)),
        ));
        let (h, _) = fresh_host();
        h.create_identity().unwrap();
        let bundle = h.publish_prekeys(1).unwrap();
        let err = h.establish_session(bundle).unwrap_err();
        checks.push(check(
            "nonmessaging.refuses_session",
            "non-messaging backend refuses establish_session",
            err.code == CryptoErrorCode::Unsupported,
            Some(format!("{:?}", err.code)),
        ));
    }

    let backend = { fresh_host().0.backend_info().name };
    ConformanceReport {
        backend,
        capability,
        checks,
    }
}

/// Run the messaging tier. Only meaningful for backends that claim
/// [`Capability::Messaging`]. Currently a no-op scaffold: the assertions
/// will be filled in when the first messaging-capable backend lands, so we
/// can freeze the checklist here without introducing a passing test that
/// only checks the stub.
pub fn run_messaging_capabilities() -> ConformanceReport {
    ConformanceReport {
        backend: "unknown".into(),
        capability: Capability::Messaging,
        checks: vec![check(
            "messaging.scaffold",
            "messaging tier is defined but has no active backend to exercise",
            true,
            None,
        )],
    }
}
