//! Shared, backend-neutral wire types for the Whispr crypto host.
//!
//! These structs deliberately contain only public material or opaque
//! ciphertext. Secret key bytes and protocol session state must never cross
//! the host boundary in these values.

use serde::{Deserialize, Serialize};

/// Maximum identifier length accepted by the host boundary.
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
    /// Optional protocol registration identifier.
    pub registration_id: Option<u32>,
    /// Public identity/signing key encoded as URL-safe base64 without padding.
    pub identity_public_key: String,
    /// Millisecond Unix timestamp at creation.
    pub created_at_ms: i64,
}

/// One public one-time prekey / MLS KeyPackage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneTimePrekey {
    /// Backend-local public key identifier.
    pub key_id: u32,
    /// Public wire bytes encoded URL-safe base64 without padding.
    pub public_key: String,
}

/// Public peer bundle used to establish a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrekeyBundle {
    /// Device being addressed.
    pub device_id: String,
    /// Optional protocol registration identifier.
    pub registration_id: Option<u32>,
    /// Public identity key encoded URL-safe base64 without padding.
    pub identity_public_key: String,
    /// Legacy signed-prekey identifier; zero for MLS.
    pub signed_prekey_id: u32,
    /// Legacy signed-prekey public bytes; empty for MLS.
    pub signed_prekey_public: String,
    /// Legacy signed-prekey signature; empty for MLS.
    pub signed_prekey_signature: String,
    /// Public one-time prekeys / MLS KeyPackages.
    pub one_time_prekeys: Vec<OneTimePrekey>,
}

/// The kind of encrypted envelope transported by Whispr.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvelopeKind {
    /// First-contact message that includes protocol bootstrap material.
    Prekey,
    /// Established-session application message.
    Whisper,
}

/// Versioned encrypted envelope crossing the native/app boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    /// Envelope schema version.
    pub version: u16,
    /// Concrete backend identifier.
    pub backend: String,
    /// Protocol profile identifier.
    pub protocol_id: String,
    /// Protocol profile version.
    pub protocol_version: u16,
    /// Sender device identifier.
    pub sender_device_id: String,
    /// Recipient device identifier.
    pub recipient_device_id: String,
    /// Conversation identifier authenticated by the crypto layer.
    pub conversation_id: String,
    /// Message identifier authenticated by the crypto layer.
    pub message_id: String,
    /// Monotonic local send counter for diagnostics/replay heuristics.
    pub counter: u64,
    /// Opaque ciphertext/transport frame as URL-safe base64.
    pub ciphertext: String,
    /// Authenticated additional data as URL-safe base64.
    pub aad: String,
    /// Bootstrap vs established-message envelope kind.
    pub kind: EnvelopeKind,
}

/// User-verifiable identity fingerprint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyNumber {
    /// Human-readable grouped numeric representation.
    pub digits: String,
    /// Stable binary fingerprint encoded URL-safe base64.
    pub fingerprint: String,
    /// QR payload encoded URL-safe base64.
    pub qr_payload: String,
}
