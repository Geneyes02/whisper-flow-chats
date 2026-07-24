//! Public host API — the object Tauri command handlers hold.
//!
//! `CryptoHost` is the only type Whispr's Rust command layer needs to know
//! about. Under the hood it delegates to a `CryptoBackend` chosen at build
//! time. Locking is coarse-grained: one host per process, mutex-protected,
//! so the trait itself can stay `&self` on hot paths without introducing
//! interior mutability requirements on backend implementations.
//!
//! Lifecycle (see also `docs/DATA_MAP.md`):
//!
//! ```text
//!            ┌──────────────┐
//!            │  Uninitialized  ── initialize() ──┐
//!            └──────────────┘                     │
//!                                                 ▼
//!                                     ┌────────────────────┐
//!                          ┌── lock() ─│ Unlocked (default) │
//!                          │           └────────────────────┘
//!                          ▼                    ▲
//!                    ┌──────────┐    unlock()   │
//!                    │  Locked  │───────────────┘
//!                    └──────────┘
//!                                                 │
//!                              revoke_device()    │
//!                                                 ▼
//!                                            ┌─────────┐
//!                                            │ Revoked │  (terminal)
//!                                            └─────────┘
//!                                                 │
//!                              wipe() / logout()  │
//!                                                 ▼
//!                                       ┌──────────────┐
//!                                       │ Uninitialized│
//!                                       └──────────────┘
//! ```
//!
//! Every gate is checked BEFORE the underlying backend call; the backend
//! never observes a locked/revoked/uninitialized state.

use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::backend::{build_default_backend, CryptoBackend};
use crate::error::{CryptoError, CryptoErrorCode, Result};
use crate::keychain::{wipe_all, OsKeychain, SecureStore, Slot};
use crate::types::{
    validate_envelope, validate_id, DeviceIdentity, EncryptedEnvelope, PrekeyBundle,
    SafetyNumber, ENVELOPE_VERSION, MAX_AAD_LEN, MAX_PLAINTEXT_LEN,
};

/// Reported to the UI so it can render a coherent status pill without
/// probing individual operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvisioningState {
    /// No local identity yet — user has never provisioned this device.
    Uninitialized,
    /// Identity exists, host is usable (subject to lock state).
    Provisioned,
    /// Device is revoked. Terminal until wiped.
    Revoked,
}

/// In-memory lock state. Locking does NOT drop persisted material; it
/// simply refuses cryptographic operations until unlocked. Wipe/logout is
/// the destructive path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockState {
    /// Operations permitted.
    Unlocked,
    /// Operations refused with `StorageLocked`.
    Locked,
}

/// Snapshot of host status, safe to send to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostStatus {
    /// Backend name (`"stub-v0"`, `"libsignal-v1"`, …).
    pub backend: String,
    /// Protocol identifier the backend implements.
    pub protocol_id: String,
    /// Protocol version the backend implements.
    pub protocol_version: u16,
    /// Envelope schema version this host emits.
    pub envelope_version: u16,
    /// Provisioning state.
    pub provisioning: ProvisioningState,
    /// Lock state.
    pub lock: LockState,
}

/// Static backend information — useful for diagnostics endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendInfo {
    /// Backend name.
    pub name: String,
    /// Protocol identifier.
    pub protocol_id: String,
    /// Protocol version.
    pub protocol_version: u16,
    /// Envelope schema version.
    pub envelope_version: u16,
}

/// The crypto host. Construct once at app startup and share via Tauri
/// state.
pub struct CryptoHost {
    store: Arc<dyn SecureStore>,
    backend: Mutex<Box<dyn CryptoBackend>>,
    lock: Mutex<LockState>,
}

impl CryptoHost {
    /// Build with the OS keychain and the default (feature-selected) backend.
    pub fn with_os_keychain() -> Result<Self> {
        Self::with_store(Arc::new(OsKeychain::new()))
    }

    /// Build with a caller-supplied secure store — used by the in-memory
    /// test harness and by CI environments that lack a system keychain.
    pub fn with_store(store: Arc<dyn SecureStore>) -> Result<Self> {
        let backend = build_default_backend(store.clone())?;
        Ok(Self {
            store,
            backend: Mutex::new(backend),
            lock: Mutex::new(LockState::Unlocked),
        })
    }

    // ---- lifecycle -----------------------------------------------------

    /// Backend identifier (for diagnostics, envelope tagging, snapshot audit).
    pub fn backend_name(&self) -> &'static str { self.backend.lock().name() }

    /// Static backend info.
    pub fn backend_info(&self) -> BackendInfo {
        let b = self.backend.lock();
        BackendInfo {
            name: b.name().to_string(),
            protocol_id: b.protocol_id().to_string(),
            protocol_version: b.protocol_version(),
            envelope_version: ENVELOPE_VERSION,
        }
    }

    /// Combined status. Never fails — an inaccessible store surfaces as
    /// `Uninitialized`, not as an error, so the UI can always render.
    pub fn status(&self) -> HostStatus {
        let (provisioning, lock) = {
            let backend = self.backend.lock();
            let provisioning = match backend.load_identity() {
                Ok(Some(_)) => {
                    // Detect revoked-terminal by probing publish_prekeys(0)
                    // — that's the cheapest gate and returns DeviceRevoked
                    // when applicable. Any other error leaves us reporting
                    // Provisioned to avoid leaking storage state.
                    match backend.publish_prekeys(0) {
                        Err(e) if e.code == CryptoErrorCode::DeviceRevoked => {
                            ProvisioningState::Revoked
                        }
                        _ => ProvisioningState::Provisioned,
                    }
                }
                Ok(None) => ProvisioningState::Uninitialized,
                Err(_) => ProvisioningState::Uninitialized,
            };
            (provisioning, *self.lock.lock())
        };
        let backend = self.backend.lock();
        HostStatus {
            backend: backend.name().to_string(),
            protocol_id: backend.protocol_id().to_string(),
            protocol_version: backend.protocol_version(),
            envelope_version: ENVELOPE_VERSION,
            provisioning,
            lock,
        }
    }

    /// Idempotent init hook. Currently just loads any persisted identity.
    /// Reserved for future migration steps.
    pub fn initialize(&self) -> Result<HostStatus> {
        // Force a load to surface `StorageCorrupt` early.
        let _ = self.backend.lock().load_identity()?;
        Ok(self.status())
    }

    /// Move to locked state. Subsequent operations return `StorageLocked`.
    pub fn lock(&self) { *self.lock.lock() = LockState::Locked; }

    /// Return to unlocked state.
    pub fn unlock(&self) { *self.lock.lock() = LockState::Unlocked; }

    /// Sign the user out: wipe every secret slot AND drop in-memory state
    /// by rebuilding the backend from an empty store. Idempotent.
    pub fn logout(&self) -> Result<()> {
        wipe_all(&*self.store)?;
        let new_backend = build_default_backend(self.store.clone())?;
        *self.backend.lock() = new_backend;
        *self.lock.lock() = LockState::Unlocked;
        Ok(())
    }

    /// Explicit destructive wipe. Equivalent to `logout` today; kept as a
    /// distinct entry point so future backends can layer additional
    /// scrubbing (e.g. shred an encrypted session DB) without changing the
    /// UI surface.
    pub fn wipe(&self) -> Result<()> { self.logout() }

    // ---- gating --------------------------------------------------------

    fn ensure_unlocked(&self) -> Result<()> {
        match *self.lock.lock() {
            LockState::Unlocked => Ok(()),
            LockState::Locked => Err(CryptoError::new(
                CryptoErrorCode::StorageLocked,
                "crypto host is locked",
            )),
        }
    }

    // ---- command surface ----------------------------------------------

    /// Generate a device identity or return the existing one.
    pub fn create_identity(&self) -> Result<DeviceIdentity> {
        self.ensure_unlocked()?;
        self.backend.lock().create_identity()
    }

    /// Load the persisted identity, if any.
    pub fn load_identity(&self) -> Result<Option<DeviceIdentity>> {
        // Reads permitted even while locked — the UI needs to render "who
        // am I" without unlocking. This exposes only public key material.
        self.backend.lock().load_identity()
    }

    /// Publish `count` one-time prekeys and a signed prekey.
    pub fn publish_prekeys(&self, count: u32) -> Result<PrekeyBundle> {
        self.ensure_unlocked()?;
        if count > 1000 {
            return Err(CryptoError::new(
                CryptoErrorCode::Internal,
                "prekey count too large",
            ));
        }
        self.backend.lock().publish_prekeys(count)
    }

    /// Establish a session with a peer.
    pub fn establish_session(&self, bundle: PrekeyBundle) -> Result<()> {
        self.ensure_unlocked()?;
        validate_id("bundle.device_id", &bundle.device_id)?;
        if bundle.identity_public_key.is_empty() {
            return Err(CryptoError::new(
                CryptoErrorCode::InvalidBundle,
                "missing identity key",
            ));
        }
        self.backend.lock().establish_session(bundle)
    }

    /// Encrypt a message for a recipient device.
    pub fn encrypt(
        &self,
        recipient_device_id: &str,
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<EncryptedEnvelope> {
        self.ensure_unlocked()?;
        validate_id("recipient_device_id", recipient_device_id)?;
        if plaintext.len() > MAX_PLAINTEXT_LEN {
            return Err(CryptoError::new(
                CryptoErrorCode::Internal,
                "plaintext too large",
            ));
        }
        if aad.len() > MAX_AAD_LEN {
            return Err(CryptoError::new(
                CryptoErrorCode::Internal,
                "aad too large",
            ));
        }
        self.backend.lock().encrypt(recipient_device_id, plaintext, aad)
    }

    /// Decrypt an envelope.
    pub fn decrypt(&self, envelope: &EncryptedEnvelope) -> Result<Vec<u8>> {
        self.ensure_unlocked()?;
        validate_envelope(envelope)?;
        self.backend.lock().decrypt(envelope)
    }

    /// Compute a safety number against a peer's identity public key.
    pub fn safety_number(&self, peer_identity_public_key: &[u8]) -> Result<SafetyNumber> {
        if peer_identity_public_key.is_empty() || peer_identity_public_key.len() > 1024 {
            return Err(CryptoError::new(
                CryptoErrorCode::Internal,
                "peer key length",
            ));
        }
        self.backend.lock().safety_number(peer_identity_public_key)
    }

    /// Rotate the session with a peer.
    pub fn rotate_session(&self, recipient_device_id: &str) -> Result<()> {
        self.ensure_unlocked()?;
        validate_id("recipient_device_id", recipient_device_id)?;
        self.backend.lock().rotate_session(recipient_device_id)
    }

    /// Revoke this device.
    pub fn revoke_device(&self) -> Result<()> {
        // Revocation is allowed even while locked — it must always succeed.
        self.backend.lock().revoke_device()
    }

    // ---- test helpers --------------------------------------------------

    /// Access the raw secure store — test-only, gated behind `cfg(test)`
    /// downstream via `#[doc(hidden)]`. Used by adversarial harness to
    /// simulate corruption of persisted state.
    #[doc(hidden)]
    pub fn __store_for_tests(&self) -> Arc<dyn SecureStore> { self.store.clone() }

    /// Force a specific slot's raw value — test-only.
    #[doc(hidden)]
    pub fn __inject_slot(&self, slot: Slot, value: &str) -> Result<()> {
        self.store.put(slot, value)
    }
}
