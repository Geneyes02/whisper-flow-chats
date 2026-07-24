//! Stub backend — deterministic, fail-closed, no real cryptography.
//!
//! Purpose:
//!   * exercise the full command surface, storage layout, and IPC contract
//!     in CI without linking any protocol implementation,
//!   * give the Whispr UI a stable target while the libsignal licensing
//!     question is unresolved,
//!   * refuse EVERY messaging operation so a stub build is never
//!     mistakable for a real E2EE build.
//!
//! Identity + prekey generation produce valid-looking public keys derived
//! from `getrandom`, so tests can exercise identity provisioning and prekey
//! publishing end-to-end. But `encrypt`, `decrypt`, `establish_session`,
//! and `rotate_session` all return `Unsupported` — the stub does not
//! pretend to be secure and will not silently emit plaintext.

use std::sync::Arc;

use parking_lot::Mutex;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::backend::CryptoBackend;
use crate::error::{CryptoError, CryptoErrorCode, Result};
use crate::keychain::{SecureStore, Slot};
use crate::storage::Snapshot;
use crate::types::{
    DeviceIdentity, EncryptedEnvelope, OneTimePrekey, PrekeyBundle, SafetyNumber,
};

/// Backend name embedded in envelopes and snapshots.
pub const STUB_BACKEND: &str = "stub-v0";

#[derive(Serialize, Deserialize, Clone)]
struct StubIdentity {
    device_id: String,
    identity_public_key_b64: String,
    // Private key stays in the keychain snapshot. It is *not* used for
    // messaging (the stub refuses to encrypt); we persist it only so tests
    // can verify snapshot round-tripping.
    identity_private_key_b64: String,
    created_at_ms: i64,
    revoked: bool,
}

/// Deterministic fail-closed backend.
pub struct StubBackend {
    store: Arc<dyn SecureStore>,
    state: Mutex<Option<StubIdentity>>,
}

impl StubBackend {
    /// Construct + restore any persisted identity.
    pub fn new(store: Arc<dyn SecureStore>) -> Result<Self> {
        let restored = match Snapshot::load(&*store, Slot::DeviceIdentity, STUB_BACKEND)? {
            Some(snap) => serde_json::from_str::<StubIdentity>(&snap.payload)
                .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "identity payload"))?
                .into(),
            None => None,
        };
        Ok(Self { store, state: Mutex::new(restored) })
    }

    fn persist(&self, id: &StubIdentity) -> Result<()> {
        let payload = serde_json::to_string(id)
            .map_err(|_| CryptoError::internal("stub identity serialize"))?;
        Snapshot::save(&*self.store, Slot::DeviceIdentity, STUB_BACKEND, payload)
    }

    fn require_identity(&self) -> Result<StubIdentity> {
        let guard = self.state.lock();
        let id = guard.as_ref().ok_or_else(|| {
            CryptoError::new(CryptoErrorCode::NoIdentity, "no local identity")
        })?;
        if id.revoked {
            return Err(CryptoError::new(CryptoErrorCode::DeviceRevoked, "device revoked"));
        }
        Ok(id.clone())
    }
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    OsRng.fill_bytes(&mut buf);
    buf
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl CryptoBackend for StubBackend {
    fn name(&self) -> &'static str { STUB_BACKEND }

    fn create_identity(&self) -> Result<DeviceIdentity> {
        let mut guard = self.state.lock();
        if let Some(existing) = guard.as_ref() {
            return Ok(public_view(existing));
        }
        let id = StubIdentity {
            device_id: hex::encode(random_bytes(16)),
            identity_public_key_b64: base64(&random_bytes(32)),
            identity_private_key_b64: base64(&random_bytes(32)),
            created_at_ms: now_ms(),
            revoked: false,
        };
        self.persist(&id)?;
        let public = public_view(&id);
        *guard = Some(id);
        Ok(public)
    }

    fn load_identity(&self) -> Result<Option<DeviceIdentity>> {
        Ok(self.state.lock().as_ref().map(public_view))
    }

    fn revoke_device(&self) -> Result<()> {
        let mut guard = self.state.lock();
        if let Some(id) = guard.as_mut() {
            id.revoked = true;
            self.persist(id)?;
        }
        // Clear session material regardless.
        Snapshot::clear(&*self.store, Slot::SessionStore)?;
        Snapshot::clear(&*self.store, Slot::PrekeyStore)?;
        Ok(())
    }

    fn publish_prekeys(&self, count: u32) -> Result<PrekeyBundle> {
        let id = self.require_identity()?;
        let one_time_prekeys: Vec<OneTimePrekey> = (0..count)
            .map(|i| OneTimePrekey {
                key_id: i + 1,
                public_key: base64(&random_bytes(32)),
            })
            .collect();
        let signed_prekey_public = base64(&random_bytes(32));
        // Deterministic pseudo-signature so the wire shape is exercised; it
        // is NOT a valid cryptographic signature. Consumers of the stub
        // backend MUST NOT trust it.
        let signature = {
            let mut h = Sha256::new();
            h.update(id.identity_private_key_b64.as_bytes());
            h.update(signed_prekey_public.as_bytes());
            base64(&h.finalize())
        };
        // Persist a placeholder snapshot so keychain round-tripping is
        // exercised in tests.
        Snapshot::save(
            &*self.store,
            Slot::PrekeyStore,
            STUB_BACKEND,
            serde_json::to_string(&one_time_prekeys).unwrap_or_default(),
        )?;
        Ok(PrekeyBundle {
            device_id: id.device_id,
            registration_id: None,
            identity_public_key: id.identity_public_key_b64,
            signed_prekey_id: 1,
            signed_prekey_public,
            signed_prekey_signature: signature,
            one_time_prekeys,
        })
    }

    fn establish_session(&self, _bundle: PrekeyBundle) -> Result<()> {
        // Fail closed: stub cannot establish a real session.
        Err(CryptoError::unsupported("stub backend cannot establish sessions"))
    }

    fn rotate_session(&self, _recipient_device_id: &str) -> Result<()> {
        Err(CryptoError::unsupported("stub backend cannot rotate sessions"))
    }

    fn encrypt(
        &self,
        _recipient_device_id: &str,
        _plaintext: &[u8],
        _aad: &[u8],
    ) -> Result<EncryptedEnvelope> {
        // CRITICAL: never emit a ciphertext-shaped payload containing the
        // plaintext. Refuse.
        Err(CryptoError::unsupported("stub backend does not encrypt"))
    }

    fn decrypt(&self, _envelope: &EncryptedEnvelope) -> Result<Vec<u8>> {
        Err(CryptoError::unsupported("stub backend does not decrypt"))
    }

    fn safety_number(&self, peer_identity_public_key: &[u8]) -> Result<SafetyNumber> {
        let id = self.require_identity()?;
        let mut hasher = Sha256::new();
        hasher.update(b"whispr-safety-v0");
        hasher.update(id.identity_public_key_b64.as_bytes());
        hasher.update(peer_identity_public_key);
        let fp = hasher.finalize();
        // 60-digit grouped presentation, Signal-style.
        let mut digits = String::with_capacity(60);
        for byte in fp.iter().take(30) {
            digits.push_str(&format!("{:02}", byte % 100));
        }
        let grouped = digits
            .as_bytes()
            .chunks(5)
            .map(|c| std::str::from_utf8(c).unwrap_or(""))
            .collect::<Vec<_>>()
            .join(" ");
        Ok(SafetyNumber {
            digits: grouped,
            fingerprint: base64(&fp),
            qr_payload: base64(&fp),
        })
    }
}

fn public_view(id: &StubIdentity) -> DeviceIdentity {
    DeviceIdentity {
        device_id: id.device_id.clone(),
        registration_id: None,
        identity_public_key: id.identity_public_key_b64.clone(),
        created_at_ms: id.created_at_ms,
    }
}

// Minimal base64 (URL-safe, no padding) so we don't take a new dependency.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() * 4 + 2) / 3);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | (bytes[i + 2] as u32);
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 6) & 63) as usize] as char);
        out.push(ALPHABET[(n & 63) as usize] as char);
        i += 3;
    }
    let rem = bytes.len() - i;
    if rem == 1 {
        let n = (bytes[i] as u32) << 16;
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
    } else if rem == 2 {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 6) & 63) as usize] as char);
    }
    out
}
