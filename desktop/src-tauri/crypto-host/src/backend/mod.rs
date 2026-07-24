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
    /// Return the implementation identifier written into persisted state and envelopes.
    fn name(&self) -> &'static str;

    /// Return the protocol profile identifier carried by encrypted envelopes.
    fn protocol_id(&self) -> &'static str {
        "whispr-none"
    }

    /// Return the backend-defined protocol profile version.
    fn protocol_version(&self) -> u16 {
        0
    }

    /// Create and persist the local device identity, or return the existing one.
    fn create_identity(&self) -> Result<DeviceIdentity>;

    /// Load the public view of the persisted local device identity.
    fn load_identity(&self) -> Result<Option<DeviceIdentity>>;

    /// Revoke this device locally and make future cryptographic operations fail closed.
    fn revoke_device(&self) -> Result<()>;

    /// Generate publishable one-time prekeys or MLS KeyPackages.
    fn publish_prekeys(&self, count: u32) -> Result<PrekeyBundle>;

    /// Establish a cryptographic session from a peer's authenticated public bundle.
    fn establish_session(&self, bundle: PrekeyBundle) -> Result<()>;

    /// Advance/heal an existing session with the named peer device.
    fn rotate_session(&self, recipient_device_id: &str) -> Result<()>;

    /// Encrypt application plaintext for a recipient and authenticate the supplied AAD.
    fn encrypt(
        &self,
        recipient_device_id: &str,
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<EncryptedEnvelope>;

    /// Authenticate and decrypt an inbound encrypted envelope.
    fn decrypt(&self, envelope: &EncryptedEnvelope) -> Result<Vec<u8>>;

    /// Produce the deterministic verification fingerprint for a peer identity key.
    fn safety_number(&self, peer_identity_public_key: &[u8]) -> Result<SafetyNumber>;
}

#[cfg(feature = "backend-stub")]
pub mod stub;

#[cfg(feature = "backend-libsignal")]
pub mod libsignal;

/// Native MLS runtime. This is the only OpenMLS implementation compiled by
/// `backend-openmls`. The earlier Slice 1/2 prototype adapter is intentionally
/// no longer compiled because it serialized OpenMLS private structs through
/// APIs that are not part of OpenMLS 0.8.1's supported wire surface. Its
/// lifecycle/security regressions have moved into `openmls_runtime` so the
/// CI gates exercise the same implementation that will carry real messages.
#[cfg(feature = "backend-openmls")]
#[allow(missing_docs, clippy::unnecessary_to_owned)]
pub mod openmls_runtime;

/// Construct the backend selected by Cargo features using the supplied secret store.
pub fn build_default_backend(
    store: std::sync::Arc<dyn crate::keychain::SecureStore>,
) -> Result<Box<dyn CryptoBackend>> {
    #[cfg(feature = "backend-openmls")]
    {
        return Ok(Box::new(openmls_runtime::OpenMlsRuntimeBackend::new(
            store,
        )?));
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

    #[allow(unreachable_code)]
    Err(crate::error::CryptoError::unsupported(
        "no backend selected",
    ))
}
