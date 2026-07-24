#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::HostState;
use whispr_crypto_host::CryptoHost;

fn main() {
    // Build the crypto host once at startup. If the OS keychain refuses to
    // open (locked, denied, unavailable), we fail-closed and refuse to
    // launch the app rather than proceed with an in-memory fallback that
    // silently drops identity across restarts.
    let host = CryptoHost::with_os_keychain()
        .expect("whispr-crypto-host: failed to initialize (keychain unavailable)");

    tauri::Builder::default()
        .manage(HostState(host))
        .invoke_handler(tauri::generate_handler![
            commands::whispr_crypto_create_identity,
            commands::whispr_crypto_load_identity,
            commands::whispr_crypto_publish_prekeys,
            commands::whispr_crypto_establish_session,
            commands::whispr_crypto_encrypt,
            commands::whispr_crypto_decrypt,
            commands::whispr_crypto_safety_number,
            commands::whispr_crypto_rotate_session,
            commands::whispr_crypto_revoke_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Whispr");
}
