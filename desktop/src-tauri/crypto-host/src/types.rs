//! Wire types crossing the Tauri IPC boundary.
//!
//! Everything here is `Serialize + Deserialize` and contains ONLY public
//! material: identity public keys, opaque prekey bundles, ciphertexts,
//! opaque session handles, safety-number digits. Private keys never appear
//! in any type in this module.

use serde::{Deserialize, Serialize};

/// Opaque byte string. Represented as base64 on the wire so it round-trips
/// cleanly through JSON. Callers on the TypeScript side treat this as a
/// `Bytes` (`Uint8Array`) after decoding.
pub type B64 = String;

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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    /// Envelope schema version. Bumped on protocol changes.
    pub version: u16,
    /// Backend that produced this envelope (`"stub-v0"`, `"libsignal-v1"`, …).
    pub backend: String,
    /// Sender device ID.
    pub sender_device_id: String,
    /// Recipient device ID.
    pub recipient_device_id: String,
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
