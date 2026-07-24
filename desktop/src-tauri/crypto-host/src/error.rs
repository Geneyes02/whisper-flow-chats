//! Stable error surface that crosses the Tauri IPC boundary.
//!
//! Backend-specific errors (libsignal decode failures, keychain access
//! denied, IO errors, etc.) are collapsed into a small enum of stable
//! codes. The UI treats every unknown state as fail-closed.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Stable error codes. These map 1:1 to `CryptoError.code` in
/// `src/lib/crypto/types.ts`. Never rename a variant without also updating
/// the TypeScript side; adding a new variant is safe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CryptoErrorCode {
    /// The requested operation is not supported by this backend / runtime.
    Unsupported,
    /// No local device identity exists yet.
    NoIdentity,
    /// No session exists for the requested peer/device.
    NoSession,
    /// Prekey bundle failed validation (bad signature, wrong identity, etc.).
    InvalidBundle,
    /// Ciphertext failed authentication or is malformed.
    BadCiphertext,
    /// The peer's identity key changed since the last session.
    IdentityMismatch,
    /// The OS keychain is locked or inaccessible.
    StorageLocked,
    /// Persistent storage is corrupt or unreadable.
    StorageCorrupt,
    /// The local device has been revoked. All operations refuse.
    DeviceRevoked,
    /// Internal invariant broken. Always fail-closed.
    Internal,
}

/// Public error type. `Display` intentionally does NOT include backend
/// internals — anything the WebView renders comes from `code` + a generic
/// message, so we never leak key material, session state, or plaintext.
#[derive(Debug, Error)]
#[error("whispr-crypto-host: {code:?}: {message}")]
pub struct CryptoError {
    /// Stable error code shared with the TypeScript layer.
    pub code: CryptoErrorCode,
    /// Human-readable message — MUST NOT contain plaintext, keys, or
    /// session material. Safe strings only.
    pub message: String,
}

impl CryptoError {
    /// Build an error with a stable code and a safe generic message.
    pub fn new(code: CryptoErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Convenience: unsupported operation.
    pub fn unsupported(op: &str) -> Self {
        Self::new(
            CryptoErrorCode::Unsupported,
            format!("operation not supported: {op}"),
        )
    }

    /// Convenience: internal invariant. Message is safe-generic.
    pub fn internal(hint: &str) -> Self {
        // NB: `hint` MUST be a static-ish description, not a formatted value
        // that could include secrets.
        Self::new(CryptoErrorCode::Internal, format!("internal error: {hint}"))
    }
}

/// Wire representation of an error crossing IPC. Backend-specific `source`
/// chains are deliberately dropped here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireError {
    /// Stable error code.
    pub code: CryptoErrorCode,
    /// Safe, generic error message.
    pub message: String,
}

impl From<CryptoError> for WireError {
    fn from(e: CryptoError) -> Self {
        WireError {
            code: e.code,
            message: e.message,
        }
    }
}

/// Result alias for the crypto host.
pub type Result<T> = std::result::Result<T, CryptoError>;
