//! Native local-cache sealing.
//!
//! The AES-256-GCM key is generated once and persisted only in the OS
//! keychain (`Slot::SessionDbKey`). JavaScript never receives the key. The
//! caller provides plaintext + AAD over local Tauri IPC and receives an opaque
//! base64url blob suitable for IndexedDB. Logout/wipe removes the key through
//! the existing `wipe_all` lifecycle, making old local-cache blobs unreadable.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand_core::{OsRng, RngCore};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{CryptoError, CryptoErrorCode, Result};
use crate::keychain::{SecureStore, Slot};

const VERSION: u8 = 1;
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const MAX_PLAINTEXT_LEN: usize = 16 * 1024 * 1024;
const MAX_AAD_LEN: usize = 128 * 1024;

fn load_or_create_key(store: &dyn SecureStore) -> Result<Zeroizing<Vec<u8>>> {
    if let Some(encoded) = store.get(Slot::SessionDbKey)? {
        let key = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| {
            CryptoError::new(CryptoErrorCode::StorageCorrupt, "local seal key encoding")
        })?;
        if key.len() != KEY_LEN {
            return Err(CryptoError::new(
                CryptoErrorCode::StorageCorrupt,
                "local seal key length",
            ));
        }
        return Ok(Zeroizing::new(key));
    }

    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    let encoded = URL_SAFE_NO_PAD.encode(key);
    store.put(Slot::SessionDbKey, &encoded)?;
    let out = Zeroizing::new(key.to_vec());
    key.zeroize();
    Ok(out)
}

/// Seal local plaintext with AES-256-GCM and caller-supplied AAD.
pub fn seal(store: &dyn SecureStore, plaintext: &[u8], aad: &[u8]) -> Result<String> {
    if plaintext.len() > MAX_PLAINTEXT_LEN || aad.len() > MAX_AAD_LEN {
        return Err(CryptoError::new(
            CryptoErrorCode::Internal,
            "local seal input too large",
        ));
    }

    let key = load_or_create_key(store)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "local seal key"))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|_| CryptoError::internal("local seal encrypt"))?;

    let mut blob = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    blob.push(VERSION);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    nonce_bytes.zeroize();
    Ok(URL_SAFE_NO_PAD.encode(blob))
}

/// Authenticate and open a local sealed blob. Authentication failure returns
/// `BadCiphertext`; no partial plaintext is ever returned.
pub fn open(store: &dyn SecureStore, blob_b64: &str, aad: &[u8]) -> Result<Vec<u8>> {
    if aad.len() > MAX_AAD_LEN || blob_b64.len() > (MAX_PLAINTEXT_LEN * 2) {
        return Err(CryptoError::new(
            CryptoErrorCode::BadCiphertext,
            "local sealed blob too large",
        ));
    }
    let blob = URL_SAFE_NO_PAD.decode(blob_b64).map_err(|_| {
        CryptoError::new(CryptoErrorCode::BadCiphertext, "local sealed blob encoding")
    })?;
    if blob.len() <= 1 + NONCE_LEN || blob[0] != VERSION {
        return Err(CryptoError::new(
            CryptoErrorCode::BadCiphertext,
            "local sealed blob version",
        ));
    }

    let key = load_or_create_key(store)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "local seal key"))?;
    let nonce = Nonce::from_slice(&blob[1..1 + NONCE_LEN]);
    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &blob[1 + NONCE_LEN..],
                aad,
            },
        )
        .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "local seal authentication"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keychain::MemoryStore;

    #[test]
    fn round_trip_and_aad_binding() {
        let store = MemoryStore::new();
        let sealed = seal(&store, b"private history", b"conv-1/msg-1").unwrap();
        assert!(!sealed.contains("private history"));
        assert_eq!(
            open(&store, &sealed, b"conv-1/msg-1").unwrap(),
            b"private history"
        );
        assert_eq!(
            open(&store, &sealed, b"conv-2/msg-1").unwrap_err().code,
            CryptoErrorCode::BadCiphertext
        );
    }

    #[test]
    fn tamper_fails_closed() {
        let store = MemoryStore::new();
        let sealed = seal(&store, b"secret", b"aad").unwrap();
        let mut raw = URL_SAFE_NO_PAD.decode(sealed).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 1;
        let tampered = URL_SAFE_NO_PAD.encode(raw);
        assert_eq!(
            open(&store, &tampered, b"aad").unwrap_err().code,
            CryptoErrorCode::BadCiphertext
        );
    }

    #[test]
    fn key_is_not_in_sealed_blob_and_survives_restart_store() {
        let store = MemoryStore::new();
        let sealed = seal(&store, b"history", b"aad").unwrap();
        let key = store.get(Slot::SessionDbKey).unwrap().unwrap();
        assert!(!sealed.contains(&key));
        assert_eq!(open(&store, &sealed, b"aad").unwrap(), b"history");
    }
}
