//! libsignal-protocol adapter (feature-gated: `backend-libsignal`).
//!
//! This module is a STUB adapter that is compiled only when the
//! `backend-libsignal` feature is turned on. It is intentionally empty of
//! real behavior today — enabling the feature is blocked on the licensing
//! decision recorded in `docs/ADR-LIBSIGNAL-LICENSING.md`.
//!
//! When we do turn it on, the adapter implements [`CryptoBackend`] using
//! `libsignal-protocol` types (IdentityKeyStore, SignedPreKeyStore,
//! SessionStore, etc.), backed by the same [`SecureStore`] snapshot
//! machinery the stub backend uses. Whispr application code does NOT
//! change: it still calls the same eight Tauri commands.

#![cfg(feature = "backend-libsignal")]

use std::sync::Arc;

use crate::backend::CryptoBackend;
use crate::error::{CryptoError, Result};
use crate::keychain::SecureStore;
use crate::types::{DeviceIdentity, EncryptedEnvelope, PrekeyBundle, SafetyNumber};

/// libsignal-backed implementation. Not yet wired.
pub struct LibsignalBackend {
    _store: Arc<dyn SecureStore>,
}

impl LibsignalBackend {
    /// Construct — currently refuses until the licensing ADR is resolved.
    pub fn new(store: Arc<dyn SecureStore>) -> Result<Self> {
        // Fail closed. Do NOT return a half-configured backend.
        let _ = store;
        Err(CryptoError::unsupported(
            "libsignal backend is unresolved — see docs/ADR-LIBSIGNAL-LICENSING.md",
        ))
    }
}

impl CryptoBackend for LibsignalBackend {
    fn name(&self) -> &'static str { "libsignal-v1" }
    fn create_identity(&self) -> Result<DeviceIdentity> { Err(CryptoError::unsupported("libsignal: create_identity")) }
    fn load_identity(&self) -> Result<Option<DeviceIdentity>> { Err(CryptoError::unsupported("libsignal: load_identity")) }
    fn revoke_device(&self) -> Result<()> { Err(CryptoError::unsupported("libsignal: revoke_device")) }
    fn publish_prekeys(&self, _count: u32) -> Result<PrekeyBundle> { Err(CryptoError::unsupported("libsignal: publish_prekeys")) }
    fn establish_session(&self, _b: PrekeyBundle) -> Result<()> { Err(CryptoError::unsupported("libsignal: establish_session")) }
    fn rotate_session(&self, _r: &str) -> Result<()> { Err(CryptoError::unsupported("libsignal: rotate_session")) }
    fn encrypt(&self, _r: &str, _p: &[u8], _aad: &[u8]) -> Result<EncryptedEnvelope> { Err(CryptoError::unsupported("libsignal: encrypt")) }
    fn decrypt(&self, _e: &EncryptedEnvelope) -> Result<Vec<u8>> { Err(CryptoError::unsupported("libsignal: decrypt")) }
    fn safety_number(&self, _p: &[u8]) -> Result<SafetyNumber> { Err(CryptoError::unsupported("libsignal: safety_number")) }
}
