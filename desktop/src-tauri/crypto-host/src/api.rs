//! Public host API — the object Tauri command handlers hold.
//!
//! `CryptoHost` is the only type Whispr's Rust command layer needs to know
//! about. Under the hood it delegates to a `CryptoBackend` chosen at build
//! time. Locking is coarse-grained: one host per process, mutex-protected,
//! so the trait itself can stay `&self` on hot paths without introducing
//! interior mutability requirements on backend implementations.

use std::sync::Arc;

use parking_lot::Mutex;

use crate::backend::{build_default_backend, CryptoBackend};
use crate::error::Result;
use crate::keychain::{OsKeychain, SecureStore};
use crate::types::{DeviceIdentity, EncryptedEnvelope, PrekeyBundle, SafetyNumber};

/// The crypto host. Construct once at app startup and share via Tauri
/// state.
pub struct CryptoHost {
    backend: Mutex<Box<dyn CryptoBackend>>,
}

impl CryptoHost {
    /// Build with the OS keychain and the default (feature-selected) backend.
    pub fn with_os_keychain() -> Result<Self> {
        Self::with_store(Arc::new(OsKeychain::new()))
    }

    /// Build with a caller-supplied secure store — used by the in-memory
    /// test harness and by CI environments that lack a system keychain.
    pub fn with_store(store: Arc<dyn SecureStore>) -> Result<Self> {
        let backend = build_default_backend(store)?;
        Ok(Self { backend: Mutex::new(backend) })
    }

    /// Backend identifier (for diagnostics, envelope tagging, snapshot audit).
    pub fn backend_name(&self) -> &'static str { self.backend.lock().name() }

    // ---- command surface ----------------------------------------------

    /// Generate a device identity or return the existing one.
    pub fn create_identity(&self) -> Result<DeviceIdentity> {
        self.backend.lock().create_identity()
    }

    /// Load the persisted identity, if any.
    pub fn load_identity(&self) -> Result<Option<DeviceIdentity>> {
        self.backend.lock().load_identity()
    }

    /// Publish `count` one-time prekeys and a signed prekey.
    pub fn publish_prekeys(&self, count: u32) -> Result<PrekeyBundle> {
        self.backend.lock().publish_prekeys(count)
    }

    /// Establish a session with a peer.
    pub fn establish_session(&self, bundle: PrekeyBundle) -> Result<()> {
        self.backend.lock().establish_session(bundle)
    }

    /// Encrypt a message for a recipient device.
    pub fn encrypt(
        &self,
        recipient_device_id: &str,
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<EncryptedEnvelope> {
        self.backend.lock().encrypt(recipient_device_id, plaintext, aad)
    }

    /// Decrypt an envelope.
    pub fn decrypt(&self, envelope: &EncryptedEnvelope) -> Result<Vec<u8>> {
        self.backend.lock().decrypt(envelope)
    }

    /// Compute a safety number against a peer's identity public key.
    pub fn safety_number(&self, peer_identity_public_key: &[u8]) -> Result<SafetyNumber> {
        self.backend.lock().safety_number(peer_identity_public_key)
    }

    /// Rotate the session with a peer.
    pub fn rotate_session(&self, recipient_device_id: &str) -> Result<()> {
        self.backend.lock().rotate_session(recipient_device_id)
    }

    /// Revoke this device.
    pub fn revoke_device(&self) -> Result<()> { self.backend.lock().revoke_device() }
}
