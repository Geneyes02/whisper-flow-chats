//! Backend trait and selector.
//!
//! The `CryptoBackend` trait is the only seam between Whispr's application
//! code and the cryptographic protocol implementation. Every concrete
//! backend lives in a sibling module and is gated behind a Cargo feature.

use crate::error::Result;
use crate::types::{DeviceIdentity, EncryptedEnvelope, PrekeyBundle, SafetyNumber};

/// The stable seam. Whispr's UI, messaging layer, and Tauri commands
/// depend only on this trait.
///
/// Implementations MUST fail closed: any error path returns
/// [`crate::CryptoError`] rather than emitting a fallback payload.
pub trait CryptoBackend: Send + Sync {
    /// Backend identifier — appears in envelopes and snapshots so we can
    /// detect cross-backend confusion at load time.
    fn name(&self) -> &'static str;

    /// Protocol identifier the backend implements. Reported in the
    /// [`EncryptedEnvelope::protocol_id`] field and in
    /// [`crate::api::BackendInfo`]. Default: `"whispr-none"` for backends
    /// that intentionally do not carry a real protocol (e.g. the stub).
    fn protocol_id(&self) -> &'static str {
        "whispr-none"
    }

    /// Protocol version the backend implements. Default: 0.
    fn protocol_version(&self) -> u16 {
        0
    }

    // ---- identity ------------------------------------------------------

    /// Generate a new device identity, persist it, and return the public
    /// portion. Idempotent: calling twice returns the same identity as long
    /// as the local store is intact.
    fn create_identity(&self) -> Result<DeviceIdentity>;

    /// Load the persisted identity if one exists.
    fn load_identity(&self) -> Result<Option<DeviceIdentity>>;

    /// Mark this device as revoked. Every subsequent call MUST fail with
    /// [`CryptoErrorCode::DeviceRevoked`](crate::error::CryptoErrorCode::DeviceRevoked).
    fn revoke_device(&self) -> Result<()>;

    // ---- prekeys -------------------------------------------------------

    /// Generate and persist `count` one-time prekeys / MLS KeyPackages and
    /// return only their public wire representation for directory publishing.
    fn publish_prekeys(&self, count: u32) -> Result<PrekeyBundle>;

    // ---- sessions ------------------------------------------------------

    /// Establish a session with a peer given their published prekey bundle.
    /// MLS backends create a two-device group and queue the Welcome for the
    /// first encrypted envelope; callers never receive private group state.
    fn establish_session(&self, bundle: PrekeyBundle) -> Result<()>;

    /// Rotate the session with a peer. MLS backends perform a self-update and
    /// queue the resulting Commit for delivery before the next application
    /// message.
    fn rotate_session(&self, recipient_device_id: &str) -> Result<()>;

    // ---- messaging -----------------------------------------------------

    /// Encrypt `plaintext` for `recipient_device_id`. `aad` is bound into
    /// the protocol message so tampering with routing metadata invalidates
    /// the ciphertext.
    fn encrypt(
        &self,
        recipient_device_id: &str,
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<EncryptedEnvelope>;

    /// Decrypt an envelope. Returns `BadCiphertext` on authentication
    /// failure; MUST NOT return partially recovered plaintext.
    fn decrypt(&self, envelope: &EncryptedEnvelope) -> Result<Vec<u8>>;

    // ---- verification --------------------------------------------------

    /// Compute the safety number for a peer's identity public key.
    fn safety_number(&self, peer_identity_public_key: &[u8]) -> Result<SafetyNumber>;
}

// ---- backend selector --------------------------------------------------

#[cfg(feature = "backend-stub")]
pub mod stub;

#[cfg(feature = "backend-libsignal")]
pub mod libsignal;

/// Historical Slice 1/2 adapter and its regression tests. Kept compiled
/// while the production runtime rolls out so the earlier KeyPackage gates
/// remain active.
#[cfg(feature = "backend-openmls")]
pub mod openmls;

/// Production-candidate native MLS runtime: real group creation/Welcome,
/// application messages, epoch rotation, replay rejection and atomic
/// provider-state persistence.
#[cfg(feature = "backend-openmls")]
pub mod openmls_runtime;

/// Build the backend selected by Cargo features.
///
/// Exactly one backend feature is active (enforced by `lib.rs`). The
/// backend uses `store` for all persistent secret material.
///
/// Precedence when more than one backend feature is compiled in (e.g. a
/// developer local build): `backend-openmls` > `backend-libsignal` >
/// `backend-stub`. Default project builds still ship only `backend-stub`
/// until the OpenMLS integration gates are explicitly promoted.
pub fn build_default_backend(
    store: std::sync::Arc<dyn crate::keychain::SecureStore>,
) -> Result<Box<dyn CryptoBackend>> {
    #[cfg(feature = "backend-openmls")]
    {
        return Ok(Box::new(openmls_runtime::OpenMlsRuntimeBackend::new(store)?));
    }

    #[cfg(all(feature = "backend-libsignal", not(feature = "backend-openmls")))]
    {
        return Ok(Box::new(libsignal::LibsignalBackend::new(store)?));
    }

    #[cfg(all(
        feature = "backend-stub",
        not(feature = "backend-libsignal"),
        not(feature = "backend-openmls")
    ))]
    {
        return Ok(Box::new(stub::StubBackend::new(store)?));
    }

    // Unreachable — lib.rs compile_error guards this, but keep an explicit
    // fail-closed path.
    #[allow(unreachable_code)]
    Err(crate::error::CryptoError::unsupported("no backend selected"))
}
