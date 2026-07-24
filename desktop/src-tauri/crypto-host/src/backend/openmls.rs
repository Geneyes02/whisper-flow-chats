//! OpenMLS backend adapter (feature-gated: `backend-openmls`).
//!
//! **Scaffold only.** This module compiles when `backend-openmls` is on,
//! but every messaging operation returns `Unsupported`. It exists so the
//! backend selector, feature-flag matrix, CI guard, and dependency
//! baseline can be exercised BEFORE any real MLS lifecycle code lands.
//!
//! Real Phase B work — credential + KeyPackage generation, group creation,
//! Welcome/Commit/Proposal handling, epoch persistence, and the
//! `run_messaging_capabilities` conformance tier — lands in follow-up PRs
//! against the pinned baseline documented in `docs/OPENMLS-BASELINE.md`.
//!
//! Whispr's public security label MUST NOT change while this backend
//! returns `Unsupported`.

#![cfg(feature = "backend-openmls")]

use std::sync::Arc;

use crate::backend::CryptoBackend;
use crate::error::{CryptoError, Result};
use crate::keychain::SecureStore;
use crate::types::{DeviceIdentity, EncryptedEnvelope, PrekeyBundle, SafetyNumber};

/// Whispr MLS profile identifier — carried in `EncryptedEnvelope::protocol_id`
/// once the backend begins emitting real ciphertext. Fixed here so the
/// wire tag is a deliberate Whispr constant rather than an OpenMLS
/// serialization detail.
pub const WHISPR_MLS_PROFILE: &str = "whispr-mls-v1";

/// Ciphersuite pinned by the baseline document. Recorded as a constant so
/// any change is a reviewable diff. Verify at runtime that the pinned
/// OpenMLS release (see `docs/OPENMLS-BASELINE.md`) still exposes this
/// suite before enabling any messaging op.
pub const WHISPR_MLS_CIPHERSUITE: &str =
    "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";

/// MLS-backed implementation. Not yet wired.
pub struct OpenMlsBackend {
    _store: Arc<dyn SecureStore>,
}

impl OpenMlsBackend {
    /// Construct — currently refuses. The real constructor will wire the
    /// `OpenMlsRustCrypto` provider against a `SecureStore`-backed
    /// key-material store.
    pub fn new(store: Arc<dyn SecureStore>) -> Result<Self> {
        let _ = store;
        Err(CryptoError::unsupported(
            "openmls backend is scaffold-only — see docs/OPENMLS-BASELINE.md",
        ))
    }
}

impl CryptoBackend for OpenMlsBackend {
    fn name(&self) -> &'static str { "openmls-v1-scaffold" }
    fn protocol_id(&self) -> &'static str { WHISPR_MLS_PROFILE }
    fn protocol_version(&self) -> u16 { 1 }

    fn create_identity(&self) -> Result<DeviceIdentity> {
        Err(CryptoError::unsupported("openmls: create_identity"))
    }
    fn load_identity(&self) -> Result<Option<DeviceIdentity>> {
        Err(CryptoError::unsupported("openmls: load_identity"))
    }
    fn revoke_device(&self) -> Result<()> {
        Err(CryptoError::unsupported("openmls: revoke_device"))
    }
    fn publish_prekeys(&self, _count: u32) -> Result<PrekeyBundle> {
        Err(CryptoError::unsupported("openmls: publish_prekeys (KeyPackages)"))
    }
    fn establish_session(&self, _b: PrekeyBundle) -> Result<()> {
        Err(CryptoError::unsupported("openmls: establish_session (group create/add)"))
    }
    fn rotate_session(&self, _r: &str) -> Result<()> {
        Err(CryptoError::unsupported("openmls: rotate_session (commit)"))
    }
    fn encrypt(&self, _r: &str, _p: &[u8], _aad: &[u8]) -> Result<EncryptedEnvelope> {
        Err(CryptoError::unsupported("openmls: encrypt (application message)"))
    }
    fn decrypt(&self, _e: &EncryptedEnvelope) -> Result<Vec<u8>> {
        Err(CryptoError::unsupported("openmls: decrypt (application message)"))
    }
    fn safety_number(&self, _p: &[u8]) -> Result<SafetyNumber> {
        Err(CryptoError::unsupported("openmls: safety_number"))
    }
}
