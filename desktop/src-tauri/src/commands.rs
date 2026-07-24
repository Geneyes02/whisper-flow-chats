//! Tauri command shims.
//!
//! These are the ONLY entry points the WebView can invoke. Each shim is a
//! thin wrapper that:
//!   1. resolves the shared `CryptoHost` from Tauri state,
//!   2. calls the corresponding host method,
//!   3. maps `CryptoError` -> `WireError` before returning.
//!
//! The command names here MUST stay in sync with
//! `src/lib/crypto/libsignal-bridge.ts`.

use tauri::State;
use whispr_crypto_host::{
    error::WireError, CryptoHost, DeviceIdentity, EncryptedEnvelope, PrekeyBundle,
    SafetyNumber,
};

/// Shared state handle. Wrapped in `Arc` by Tauri when we `.manage(...)`.
pub struct HostState(pub CryptoHost);

fn map<T>(r: whispr_crypto_host::error::Result<T>) -> Result<T, WireError> {
    r.map_err(Into::into)
}

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
    map(state.0.publish_prekeys(count))
}

#[tauri::command]
pub fn whispr_crypto_establish_session(state: State<'_, HostState>, bundle: PrekeyBundle) -> Result<(), WireError> {
    map(state.0.establish_session(bundle))
}

#[tauri::command]
pub fn whispr_crypto_encrypt(
    state: State<'_, HostState>,
    recipient_device_id: String,
    plaintext: Vec<u8>,
    aad: Vec<u8>,
) -> Result<EncryptedEnvelope, WireError> {
    map(state.0.encrypt(&recipient_device_id, &plaintext, &aad))
}

#[tauri::command]
pub fn whispr_crypto_decrypt(state: State<'_, HostState>, envelope: EncryptedEnvelope) -> Result<Vec<u8>, WireError> {
    map(state.0.decrypt(&envelope))
}

#[tauri::command]
pub fn whispr_crypto_safety_number(
    state: State<'_, HostState>,
    peer_identity_public_key: Vec<u8>,
) -> Result<SafetyNumber, WireError> {
    map(state.0.safety_number(&peer_identity_public_key))
}

#[tauri::command]
pub fn whispr_crypto_rotate_session(state: State<'_, HostState>, recipient_device_id: String) -> Result<(), WireError> {
    map(state.0.rotate_session(&recipient_device_id))
}

#[tauri::command]
pub fn whispr_crypto_revoke_device(state: State<'_, HostState>) -> Result<(), WireError> {
    map(state.0.revoke_device())
}
