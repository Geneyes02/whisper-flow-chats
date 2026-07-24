//! Wire types crossing the Tauri IPC boundary.
//!
//! Everything here is `Serialize + Deserialize` and contains ONLY public
//! material: identity public keys, opaque prekey bundles, ciphertexts,
//! opaque session handles, safety-number digits. Private keys never appear
//! in any type in this module.
//!
//! The [`EncryptedEnvelope`] container is deliberately backend-independent
//! (see `docs/DATA_MAP.md`). The Whispr transport layer sees only these
//! fields — Signal, MLS, or any other reviewed backend can live behind the
//! same wire shape.

use serde::{Deserialize, Serialize};

use crate::error::{CryptoError, CryptoErrorCode, Result};

/// Opaque byte string. Represented as base64 on the wire so it round-trips
/// cleanly through JSON. Callers on the TypeScript side treat this as a
/// `Bytes` (`Uint8Array`) after decoding.
pub type B64 = String;

// -------------------------------------------------------------------------
// Hard limits — enforced at the host boundary before any backend sees data.
// These limits are intentionally generous but finite, so a malformed or
// hostile IPC payload cannot exhaust memory or trigger pathological backend
// behavior.
// -------------------------------------------------------------------------

/// Maximum length of any identifier field (device_id, message_id,
/// conversation_id). 128 characters is well beyond any reasonable UUID /
/// libsignal registration format and keeps validation cheap.
pub const MAX_ID_LEN: usize = 128;

/// Maximum ciphertext length accepted in an envelope, in bytes.
/// 16 MiB is enough for any single protocol frame we plan to route; large
/// media travels via encrypted-attachment storage, not through envelopes.
pub const MAX_CIPHERTEXT_LEN: usize = 16 * 1024 * 1024;

/// Maximum AAD length in bytes.
pub const MAX_AAD_LEN: usize = 64 * 1024;

/// Maximum plaintext length accepted by `encrypt`, in bytes.
pub const MAX_PLAINTEXT_LEN: usize = 1024 * 1024;

/// Current envelope schema version emitted by this host.
///
/// v1: original shape (ciphertext + aad only).
/// v2: adds `protocol_id`, `protocol_version`, `conversation_id`, `message_id`.
/// Bumps require a corresponding update to any receiving Whispr client.
pub const ENVELOPE_VERSION: u16 = 2;

/// Public-facing identity for a device. Contains only public key material.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceIdentity {
    /// Stable device ID (opaque; assigned by the host on creation).
    pub device_id: String,
    /// Registration ID, if the backend uses one (libsignal does).
    pub registration_id: Option<u32>,
    /// Long-term public identity key (X25519/Ed25519, backend-specific).
    pub identity_public_key: B64,
    /// Creation timestamp (ms since epoch).
    pub created_at_ms: i64,
}

/// A prekey bundle as published to the directory. Server sees only this.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrekeyBundle {
    /// Owning device.
    pub device_id: String,
    /// Registration ID (backend-specific; may be None for non-libsignal backends).
    pub registration_id: Option<u32>,
    /// Long-term identity public key.
    pub identity_public_key: B64,
    /// Signed prekey ID.
    pub signed_prekey_id: u32,
    /// Signed prekey public key.
    pub signed_prekey_public: B64,
    /// Signature over `signed_prekey_public` by `identity_public_key`.
    pub signed_prekey_signature: B64,
    /// One-time prekeys. Server hands these out one per new session.
    pub one_time_prekeys: Vec<OneTimePrekey>,
}

/// A single one-time prekey (public part only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneTimePrekey {
    /// Prekey ID.
    pub key_id: u32,
    /// Public key bytes.
    pub public_key: B64,
}

/// A ciphertext envelope. The server / transport layer sees only this.
///
/// Design intent: routing-critical values (`sender_device_id`,
/// `recipient_device_id`, `conversation_id`, `message_id`) MUST be bound
/// cryptographically into the AEAD by the backend when the underlying
/// protocol supports it. This wire type is the contract; enforcement is
/// the backend's responsibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    /// Envelope schema version. Bumped on protocol changes.
    pub version: u16,
    /// Backend that produced this envelope (`"stub-v0"`, `"libsignal-v1"`, …).
    pub backend: String,
    /// Protocol identifier the ciphertext conforms to
    /// (`"whispr-stub"`, `"signal-x3dh-double-ratchet"`, `"mls"`, …).
    #[serde(default)]
    pub protocol_id: String,
    /// Protocol version (backend-defined).
    #[serde(default)]
    pub protocol_version: u16,
    /// Sender device ID.
    pub sender_device_id: String,
    /// Recipient device ID.
    pub recipient_device_id: String,
    /// Conversation binding. Bound into AEAD when supported so a valid
    /// ciphertext cannot be replayed into a different conversation.
    #[serde(default)]
    pub conversation_id: String,
    /// Application-level message ID. Bound into AEAD when supported.
    #[serde(default)]
    pub message_id: String,
    /// Message counter for replay detection / debugging. Not a secret.
    pub counter: u64,
    /// Ciphertext bytes.
    pub ciphertext: B64,
    /// Additional authenticated data (routing metadata included in AEAD tag).
    pub aad: B64,
    /// Message type — `prekey` for first-contact, `whisper` otherwise.
    pub kind: EnvelopeKind,
}

/// Envelope kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvelopeKind {
    /// First-contact / prekey message.
    Prekey,
    /// Post-ratchet message.
    Whisper,
}

/// Safety-number representation for out-of-band identity verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyNumber {
    /// Grouped digit string (e.g. Signal-style 60 digits in groups of 5).
    pub digits: String,
    /// Fingerprint bytes (raw SHA-512 truncated per protocol).
    pub fingerprint: B64,
    /// QR payload, base64-encoded.
    pub qr_payload: B64,
}

// -------------------------------------------------------------------------
// Input validation
// -------------------------------------------------------------------------

/// Validate an identifier field (device_id, message_id, conversation_id).
///
/// Rules: 1..=MAX_ID_LEN characters, ASCII printable, no control bytes,
/// no whitespace-only. Fail-closed on anything else.
pub fn validate_id(field: &str, value: &str) -> Result<()> {
    if value.is_empty() {
        return Err(CryptoError::new(
            CryptoErrorCode::Internal,
            format!("{field}: empty"),
        ));
    }
    if value.len() > MAX_ID_LEN {
        return Err(CryptoError::new(
            CryptoErrorCode::Internal,
            format!("{field}: too long"),
        ));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_graphic() || c == '-' || c == '_' || c == ':')
    {
        return Err(CryptoError::new(
            CryptoErrorCode::Internal,
            format!("{field}: invalid characters"),
        ));
    }
    Ok(())
}

/// Validate an envelope structurally. Does not touch cryptographic state.
pub fn validate_envelope(env: &EncryptedEnvelope) -> Result<()> {
    if env.version == 0 || env.version > ENVELOPE_VERSION {
        return Err(CryptoError::new(
            CryptoErrorCode::Unsupported,
            "envelope version",
        ));
    }
    validate_id("sender_device_id", &env.sender_device_id)?;
    validate_id("recipient_device_id", &env.recipient_device_id)?;
    if !env.conversation_id.is_empty() {
        validate_id("conversation_id", &env.conversation_id)?;
    }
    if !env.message_id.is_empty() {
        validate_id("message_id", &env.message_id)?;
    }
    // Base64 blobs — bound the decoded size using the encoded length
    // as a proxy (4/3 factor). Reject anything absurd before decoding.
    if env.ciphertext.len() > (MAX_CIPHERTEXT_LEN * 4 / 3) + 16 {
        return Err(CryptoError::new(
            CryptoErrorCode::BadCiphertext,
            "ciphertext too large",
        ));
    }
    if env.aad.len() > (MAX_AAD_LEN * 4 / 3) + 16 {
        return Err(CryptoError::new(
            CryptoErrorCode::BadCiphertext,
            "aad too large",
        ));
    }
    if env.ciphertext.is_empty() {
        return Err(CryptoError::new(
            CryptoErrorCode::BadCiphertext,
            "empty ciphertext",
        ));
    }
    Ok(())
}
