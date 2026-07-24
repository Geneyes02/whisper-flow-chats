//! Tauri command shims.
//!
//! These are the ONLY entry points the WebView can invoke. Each shim is a
//! thin wrapper that:
//!   1. resolves the shared `CryptoHost` from Tauri state,
//!   2. validates inputs at the IPC boundary (length, encoding, size),
//!   3. calls the corresponding host method,
//!   4. maps `CryptoError` -> `WireError` before returning.
//!
//! Every input crossing the WebView → Rust boundary is treated as
//! untrusted. Validation is layered: this file rejects obviously malformed
//! shapes; the host layer applies protocol-specific rules; the backend
//! applies cryptographic rules. No panics are ever reachable from
//! malformed frontend input — every early rejection returns a structured
//! `WireError`.
//!
//! The command names here MUST stay in sync with
//! `src/lib/crypto/libsignal-bridge.ts`.

use tauri::State;
use whispr_crypto_host::{
    error::{CryptoError, CryptoErrorCode, WireError},
    types::{MAX_AAD_LEN, MAX_ID_LEN, MAX_PLAINTEXT_LEN},
    BackendInfo, CryptoHost, DeviceIdentity, EncryptedEnvelope, HostStatus, PrekeyBundle,
    SafetyNumber,
};

/// Shared state handle. Wrapped in `Arc` by Tauri when we `.manage(...)`.
pub struct HostState(pub CryptoHost);

fn map<T>(r: whispr_crypto_host::error::Result<T>) -> Result<T, WireError> {
    r.map_err(Into::into)
}

fn err(code: CryptoErrorCode, msg: &str) -> WireError {
    CryptoError::new(code, msg).into()
}

fn ensure_id(field: &str, value: &str) -> Result<(), WireError> {
    if value.is_empty() {
        return Err(err(CryptoErrorCode::Internal, &format!("{field}: empty")));
    }
    if value.len() > MAX_ID_LEN {
        return Err(err(CryptoErrorCode::Internal, &format!("{field}: too long")));
    }
    if !value.chars().all(|c| c.is_ascii_graphic() || c == '-' || c == '_' || c == ':') {
        return Err(err(CryptoErrorCode::Internal, &format!("{field}: invalid characters")));
    }
    Ok(())
}

// ---- lifecycle -----------------------------------------------------------

#[tauri::command]
pub fn whispr_crypto_status(state: State<'_, HostState>) -> Result<HostStatus, WireError> {
    Ok(state.0.status())
}

#[tauri::command]
pub fn whispr_crypto_backend_info(state: State<'_, HostState>) -> Result<BackendInfo, WireError> {
    Ok(state.0.backend_info())
}

#[tauri::command]
pub fn whispr_crypto_initialize(state: State<'_, HostState>) -> Result<HostStatus, WireError> {
    map(state.0.initialize())
}

#[tauri::command]
pub fn whispr_crypto_lock(state: State<'_, HostState>) -> Result<HostStatus, WireError> {
    state.0.lock();
    Ok(state.0.status())
}

#[tauri::command]
pub fn whispr_crypto_unlock(state: State<'_, HostState>) -> Result<HostStatus, WireError> {
    state.0.unlock();
    Ok(state.0.status())
}

#[tauri::command]
pub fn whispr_crypto_logout(state: State<'_, HostState>) -> Result<HostStatus, WireError> {
    map(state.0.logout())?;
    Ok(state.0.status())
}

#[tauri::command]
pub fn whispr_crypto_wipe(state: State<'_, HostState>) -> Result<HostStatus, WireError> {
    map(state.0.wipe())?;
    Ok(state.0.status())
}

// ---- identity + prekeys --------------------------------------------------

#[tauri::command]
pub fn whispr_crypto_create_identity(state: State<'_, HostState>) -> Result<DeviceIdentity, WireError> {
    map(state.0.create_identity())
}

#[tauri::command]
pub fn whispr_crypto_load_identity(state: State<'_, HostState>) -> Result<Option<DeviceIdentity>, WireError> {
    map(state.0.load_identity())
}

#[tauri::command]
pub fn whispr_crypto_publish_prekeys(state: State<'_, HostState>, count: u32) -> Result<PrekeyBundle, WireError> {
    if count > 1000 {
        return Err(err(CryptoErrorCode::Internal, "prekey count too large"));
    }
    map(state.0.publish_prekeys(count))
}

// ---- sessions ------------------------------------------------------------

#[tauri::command]
pub fn whispr_crypto_establish_session(state: State<'_, HostState>, bundle: PrekeyBundle) -> Result<(), WireError> {
    ensure_id("bundle.device_id", &bundle.device_id)?;
    if bundle.identity_public_key.is_empty() {
        return Err(err(CryptoErrorCode::InvalidBundle, "missing identity key"));
    }
    if bundle.one_time_prekeys.len() > 1000 {
        return Err(err(CryptoErrorCode::InvalidBundle, "too many one-time prekeys"));
    }
    map(state.0.establish_session(bundle))
}

// ---- messaging -----------------------------------------------------------

#[tauri::command]
pub fn whispr_crypto_encrypt(
    state: State<'_, HostState>,
    recipient_device_id: String,
    plaintext: Vec<u8>,
    aad: Vec<u8>,
) -> Result<EncryptedEnvelope, WireError> {
    ensure_id("recipient_device_id", &recipient_device_id)?;
    if plaintext.len() > MAX_PLAINTEXT_LEN {
        return Err(err(CryptoErrorCode::Internal, "plaintext too large"));
    }
    if aad.len() > MAX_AAD_LEN {
        return Err(err(CryptoErrorCode::Internal, "aad too large"));
    }
    map(state.0.encrypt(&recipient_device_id, &plaintext, &aad))
}

#[tauri::command]
pub fn whispr_crypto_decrypt(state: State<'_, HostState>, envelope: EncryptedEnvelope) -> Result<Vec<u8>, WireError> {
    // Structural validation is duplicated at the host layer; performing it
    // here as well keeps the boundary strict even if a future refactor
    // relaxes it deeper down.
    if envelope.ciphertext.is_empty() {
        return Err(err(CryptoErrorCode::BadCiphertext, "empty ciphertext"));
    }
    map(state.0.decrypt(&envelope))
}

#[tauri::command]
pub fn whispr_crypto_safety_number(
    state: State<'_, HostState>,
    peer_identity_public_key: Vec<u8>,
) -> Result<SafetyNumber, WireError> {
    if peer_identity_public_key.is_empty() {
        return Err(err(CryptoErrorCode::Internal, "peer key empty"));
    }
    if peer_identity_public_key.len() > 1024 {
        return Err(err(CryptoErrorCode::Internal, "peer key too large"));
    }
    map(state.0.safety_number(&peer_identity_public_key))
}

#[tauri::command]
pub fn whispr_crypto_rotate_session(state: State<'_, HostState>, recipient_device_id: String) -> Result<(), WireError> {
    ensure_id("recipient_device_id", &recipient_device_id)?;
    map(state.0.rotate_session(&recipient_device_id))
}

#[tauri::command]
pub fn whispr_crypto_revoke_device(state: State<'_, HostState>) -> Result<(), WireError> {
    map(state.0.revoke_device())
}
