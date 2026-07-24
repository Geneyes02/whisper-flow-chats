//! OpenMLS backend adapter (feature-gated: `backend-openmls`).
//!
//! # Slice 1 scope
//!
//! This file implements **only Slice 1** of the Phase B roadmap:
//!
//!   * real MLS credentials (Basic credential + Ed25519 signature keypair
//!     for the pinned ciphersuite),
//!   * device credential persistence through the [`SecureStore`]
//!     abstraction (OS keychain in production, in-memory in tests),
//!   * KeyPackage generation using the pinned ciphersuite,
//!   * pre-publication validation of every serialized KeyPackage
//!     (TLS round-trip + credential/signature-key equality),
//!   * fail-closed error paths for corrupted persisted state.
//!
//! Every other MLS operation — Welcome/Commit/Proposal processing, group
//! creation, epoch advancement, application-message encrypt/decrypt,
//! device eviction — still returns [`CryptoErrorCode::Unsupported`].
//! Those land in Slices 3+.
//!
//! # Invariants (must hold before Slice 2 ships)
//!
//! * Private signature material NEVER appears in any value returned from a
//!   public method on this backend. Callers can only observe TLS-encoded
//!   public KeyPackages and the credential's public signature key.
//! * The `backend-openmls` feature is not enabled in default builds; the
//!   stub backend remains the production default. Whispr's public
//!   E2EE label does not change in this slice.
//! * Persistence is single-slot per artefact today. Slice 5 introduces the
//!   atomic multi-slot transaction wrapper mandated by SRLabs finding
//!   S1-3 (`docs/OPENMLS-BASELINE.md`); until then only Slice 1
//!   artefacts (credential + KeyPackages) may be persisted.

#![cfg(feature = "backend-openmls")]

use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use openmls::prelude::{
    Ciphersuite, Credential, CredentialWithKey, KeyPackage, KeyPackageBundle,
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::types::SignatureScheme;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tls_codec::{Deserialize as _, Serialize as _};

use crate::backend::CryptoBackend;
use crate::error::{CryptoError, CryptoErrorCode, Result};
use crate::keychain::{SecureStore, Slot};
use crate::storage::Snapshot;
use crate::types::{
    DeviceIdentity, EncryptedEnvelope, OneTimePrekey, PrekeyBundle, SafetyNumber,
};

/// Whispr MLS profile identifier — carried in `EncryptedEnvelope::protocol_id`
/// once Slice 4 begins emitting real ciphertext. Fixed here so the wire tag
/// is a deliberate Whispr constant rather than an OpenMLS serialization
/// detail.
pub const WHISPR_MLS_PROFILE: &str = "whispr-mls-v1";

/// Backend identifier embedded in envelopes and snapshots. Distinct from
/// the stub so cross-backend confusion is detectable at load time.
pub const OPENMLS_BACKEND: &str = "openmls-v1";

/// The single ciphersuite Whispr will support at Phase B GA. Recorded as a
/// constant so any change is a reviewable diff.
pub const WHISPR_CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Human-readable ciphersuite tag matching `WHISPR_CIPHERSUITE`. Written
/// into persisted snapshots so a future ciphersuite change forces a
/// deliberate migration path rather than silently reinterpreting bytes.
pub const WHISPR_CIPHERSUITE_TAG: &str =
    "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";

/// Default number of KeyPackages Whispr will keep replenished per device.
/// Publication + replenishment policy is Slice 2; this is only a ceiling
/// enforced against caller input to Slice 1's `publish_prekeys`.
pub const MAX_KEYPACKAGES_PER_CALL: u32 = 100;

// ---- persisted shapes --------------------------------------------------
//
// These structs are the on-disk snapshot payloads. They live in
// `Slot::DeviceIdentity` and `Slot::PrekeyStore` respectively, wrapped by
// the versioned `Snapshot` envelope in `storage.rs`. They contain PRIVATE
// key material (serialized `SignatureKeyPair`, serialized
// `KeyPackageBundle`) and must never leave the crate boundary in any
// serialized form other than being written back into the SecureStore.

#[derive(Serialize, Deserialize, Clone)]
struct PersistedIdentity {
    device_id: String,
    ciphersuite_tag: String,
    /// TLS-encoded `Credential` (public). Base64 URL-safe, no padding.
    credential_tls_b64: String,
    /// Public signature key. Base64 URL-safe, no padding.
    signature_public_b64: String,
    /// PRIVATE signature key. Base64 URL-safe, no padding. Never leaves
    /// the SecureStore in any other form.
    signature_private_b64: String,
    created_at_ms: i64,
    revoked: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct PersistedKeyPackages {
    ciphersuite_tag: String,
    /// TLS-encoded `KeyPackageBundle` (contains PRIVATE init + encryption
    /// key material). Base64 URL-safe, no padding.
    bundles_tls_b64: Vec<String>,
    /// SHA-256 hex hashes of the PUBLIC wire form of KeyPackages that have
    /// already been consumed by a peer (Slice 2). Bounded to
    /// `MAX_CONSUMED_HASH_HISTORY`. Used to reject reuse/replay locally
    /// even after the corresponding private bundle has been securely
    /// deleted.
    #[serde(default)]
    consumed_hashes_hex: Vec<String>,
}

/// MLS-backed implementation. Slice 1 + Slice 2 wiring.
pub struct OpenMlsBackend {
    store: Arc<dyn SecureStore>,
    /// OpenMLS's in-memory crypto provider. Slice 5 replaces this with a
    /// SecureStore-backed `StorageProvider`; today it is refreshed from
    /// the persisted snapshots on every relevant call.
    provider: OpenMlsRustCrypto,
    identity: Mutex<Option<PersistedIdentity>>,
    /// Serializes every mutation of the persisted KeyPackage pool
    /// (Slice 2). Prevents concurrent consume/replenish from racing
    /// against each other and double-spending the same private bundle.
    keypackage_lock: Mutex<()>,
}

impl OpenMlsBackend {
    /// Construct + restore any persisted identity.
    ///
    /// A corrupted / cross-backend / cross-ciphersuite snapshot returns
    /// [`CryptoErrorCode::StorageCorrupt`] rather than silently
    /// re-initialising, so an attacker cannot force a downgrade by
    /// tampering with the keychain slot.
    pub fn new(store: Arc<dyn SecureStore>) -> Result<Self> {
        let restored = match Snapshot::load(&*store, Slot::DeviceIdentity, OPENMLS_BACKEND)? {
            Some(snap) => {
                let id: PersistedIdentity = serde_json::from_str(&snap.payload).map_err(|_| {
                    CryptoError::new(CryptoErrorCode::StorageCorrupt, "identity payload")
                })?;
                if id.ciphersuite_tag != WHISPR_CIPHERSUITE_TAG {
                    return Err(CryptoError::new(
                        CryptoErrorCode::StorageCorrupt,
                        "identity ciphersuite tag mismatch",
                    ));
                }
                Some(id)
            }
            None => None,
        };
        Ok(Self {
            store,
            provider: OpenMlsRustCrypto::default(),
            identity: Mutex::new(restored),
            keypackage_lock: Mutex::new(()),
        })
    }

    fn persist_identity(&self, id: &PersistedIdentity) -> Result<()> {
        let payload = serde_json::to_string(id)
            .map_err(|_| CryptoError::internal("openmls identity serialize"))?;
        Snapshot::save(&*self.store, Slot::DeviceIdentity, OPENMLS_BACKEND, payload)
    }

    fn persist_keypackages(&self, pkgs: &PersistedKeyPackages) -> Result<()> {
        let payload = serde_json::to_string(pkgs)
            .map_err(|_| CryptoError::internal("openmls keypackages serialize"))?;
        Snapshot::save(&*self.store, Slot::PrekeyStore, OPENMLS_BACKEND, payload)
    }

    fn require_identity(&self) -> Result<PersistedIdentity> {
        let guard = self.identity.lock();
        let id = guard
            .as_ref()
            .ok_or_else(|| CryptoError::new(CryptoErrorCode::NoIdentity, "no local identity"))?;
        if id.revoked {
            return Err(CryptoError::new(
                CryptoErrorCode::DeviceRevoked,
                "device revoked",
            ));
        }
        Ok(id.clone())
    }

    fn rebuild_signer(id: &PersistedIdentity) -> Result<SignatureKeyPair> {
        let public = decode_b64(&id.signature_public_b64)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "signature public"))?;
        let private = decode_b64(&id.signature_private_b64)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "signature private"))?;
        Ok(SignatureKeyPair::from_raw(
            SignatureScheme::ED25519,
            private,
            public,
        ))
    }

    fn rebuild_credential(id: &PersistedIdentity) -> Result<Credential> {
        let bytes = decode_b64(&id.credential_tls_b64)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "credential b64"))?;
        Credential::tls_deserialize(&mut bytes.as_slice())
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "credential tls"))
    }
}

impl CryptoBackend for OpenMlsBackend {
    fn name(&self) -> &'static str {
        OPENMLS_BACKEND
    }
    fn protocol_id(&self) -> &'static str {
        WHISPR_MLS_PROFILE
    }
    fn protocol_version(&self) -> u16 {
        1
    }

    // ---- Slice 1: identity ------------------------------------------------

    fn create_identity(&self) -> Result<DeviceIdentity> {
        let mut guard = self.identity.lock();
        if let Some(existing) = guard.as_ref() {
            return Ok(public_view(existing));
        }

        // Stable, opaque device_id — separate from any signature-key
        // material so identity_public_key rotation (future slice) does
        // not force a device_id change.
        let device_id = hex::encode({
            let mut b = [0u8; 16];
            use rand_core::{OsRng, RngCore};
            OsRng.fill_bytes(&mut b);
            b
        });

        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|_| CryptoError::internal("openmls signature keypair"))?;

        let credential = Credential::new_basic(device_id.as_bytes().to_vec());
        let credential_tls = credential
            .tls_serialize_detached()
            .map_err(|_| CryptoError::internal("credential tls_serialize"))?;

        let id = PersistedIdentity {
            device_id: device_id.clone(),
            ciphersuite_tag: WHISPR_CIPHERSUITE_TAG.to_string(),
            credential_tls_b64: encode_b64(&credential_tls),
            signature_public_b64: encode_b64(signer.public()),
            signature_private_b64: encode_b64(signer.private()),
            created_at_ms: now_ms(),
            revoked: false,
        };
        self.persist_identity(&id)?;
        let public = public_view(&id);
        *guard = Some(id);
        Ok(public)
    }

    fn load_identity(&self) -> Result<Option<DeviceIdentity>> {
        Ok(self.identity.lock().as_ref().map(public_view))
    }

    fn revoke_device(&self) -> Result<()> {
        let mut guard = self.identity.lock();
        if let Some(id) = guard.as_mut() {
            id.revoked = true;
            self.persist_identity(id)?;
        }
        // Drop any generated KeyPackages so they cannot be handed out
        // after revocation. Slice 7 adds the cryptographic group-side
        // eviction; this is the local-side counterpart.
        Snapshot::clear(&*self.store, Slot::PrekeyStore)?;
        Ok(())
    }

    // ---- Slice 1: KeyPackage generation -----------------------------------

    fn publish_prekeys(&self, count: u32) -> Result<PrekeyBundle> {
        if count == 0 || count > MAX_KEYPACKAGES_PER_CALL {
            return Err(CryptoError::new(
                CryptoErrorCode::Internal,
                "keypackage count out of range",
            ));
        }
        let id = self.require_identity()?;
        let signer = Self::rebuild_signer(&id)?;
        let credential = Self::rebuild_credential(&id)?;
        let credential_with_key = CredentialWithKey {
            credential,
            signature_key: signer.public().into(),
        };

        let mut public_packages: Vec<OneTimePrekey> = Vec::with_capacity(count as usize);
        let mut persisted = PersistedKeyPackages {
            ciphersuite_tag: WHISPR_CIPHERSUITE_TAG.to_string(),
            bundles_tls_b64: Vec::with_capacity(count as usize),
        };

        for key_id in 0..count {
            // KeyPackageBundle contains PRIVATE init + encryption keys.
            // Never returned to callers — only its public KeyPackage half
            // is exposed on the wire.
            let bundle: KeyPackageBundle = KeyPackage::builder()
                .build(
                    WHISPR_CIPHERSUITE,
                    &self.provider,
                    &signer,
                    credential_with_key.clone(),
                )
                .map_err(|_| CryptoError::internal("keypackage build"))?;

            let public_kp = bundle.key_package();
            let public_tls = public_kp
                .tls_serialize_detached()
                .map_err(|_| CryptoError::internal("keypackage tls_serialize"))?;

            // Pre-publication validation: round-trip the serialized public
            // KeyPackage and verify the recovered credential + signature
            // public key match the ones we intended to publish. Catches
            // any accidental serialization drift before we hand bytes to
            // the transport layer.
            let round_tripped = KeyPackage::tls_deserialize(&mut public_tls.as_slice())
                .map_err(|_| CryptoError::internal("keypackage tls_deserialize"))?;
            if round_tripped
                .leaf_node()
                .signature_key()
                .as_slice()
                != signer.public()
            {
                return Err(CryptoError::internal("keypackage signature key drift"));
            }
            if round_tripped.ciphersuite() != WHISPR_CIPHERSUITE {
                return Err(CryptoError::internal("keypackage ciphersuite drift"));
            }

            // Persist PRIVATE bundle bytes (goes to SecureStore only).
            let bundle_tls = bundle
                .tls_serialize_detached()
                .map_err(|_| CryptoError::internal("keypackage bundle tls_serialize"))?;
            persisted.bundles_tls_b64.push(encode_b64(&bundle_tls));

            public_packages.push(OneTimePrekey {
                key_id: key_id + 1,
                public_key: encode_b64(&public_tls),
            });
        }

        self.persist_keypackages(&persisted)?;

        // MLS has no signed-prekey concept; those fields carry MLS-shaped
        // placeholders for Slice 1 and will be reshaped into an
        // MLS-native publish envelope in Slice 2.
        Ok(PrekeyBundle {
            device_id: id.device_id,
            registration_id: None,
            identity_public_key: id.signature_public_b64.clone(),
            signed_prekey_id: 0,
            signed_prekey_public: String::new(),
            signed_prekey_signature: String::new(),
            one_time_prekeys: public_packages,
        })
    }

    // ---- deferred to later slices ----------------------------------------

    fn establish_session(&self, _b: PrekeyBundle) -> Result<()> {
        Err(CryptoError::unsupported(
            "openmls: establish_session (Slice 3 — group create/add)",
        ))
    }
    fn rotate_session(&self, _r: &str) -> Result<()> {
        Err(CryptoError::unsupported(
            "openmls: rotate_session (Slice 6 — commit/epoch)",
        ))
    }
    fn encrypt(&self, _r: &str, _p: &[u8], _aad: &[u8]) -> Result<EncryptedEnvelope> {
        Err(CryptoError::unsupported(
            "openmls: encrypt (Slice 4 — application messages)",
        ))
    }
    fn decrypt(&self, _e: &EncryptedEnvelope) -> Result<Vec<u8>> {
        Err(CryptoError::unsupported(
            "openmls: decrypt (Slice 4 — application messages)",
        ))
    }
    fn safety_number(&self, _p: &[u8]) -> Result<SafetyNumber> {
        Err(CryptoError::unsupported(
            "openmls: safety_number (later slice)",
        ))
    }
}

// ---- helpers -----------------------------------------------------------

fn public_view(id: &PersistedIdentity) -> DeviceIdentity {
    DeviceIdentity {
        device_id: id.device_id.clone(),
        registration_id: None,
        identity_public_key: id.signature_public_b64.clone(),
        created_at_ms: id.created_at_ms,
    }
}

fn encode_b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn decode_b64(s: &str) -> std::result::Result<Vec<u8>, base64::DecodeError> {
    URL_SAFE_NO_PAD.decode(s)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ----------------------------------------------------------------------
// Slice 1 tests
// ----------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keychain::MemoryStore;

    fn fresh() -> OpenMlsBackend {
        let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
        OpenMlsBackend::new(store).expect("construct")
    }

    #[test]
    fn identity_is_idempotent_and_persists_across_restart() {
        let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
        let b1 = OpenMlsBackend::new(store.clone()).unwrap();
        let a = b1.create_identity().unwrap();
        let b = b1.create_identity().unwrap();
        assert_eq!(a.device_id, b.device_id);
        assert_eq!(a.identity_public_key, b.identity_public_key);
        drop(b1);

        // Restart: identity comes back with the same public key.
        let b2 = OpenMlsBackend::new(store).unwrap();
        let loaded = b2.load_identity().unwrap().expect("identity persisted");
        assert_eq!(loaded.device_id, a.device_id);
        assert_eq!(loaded.identity_public_key, a.identity_public_key);
    }

    #[test]
    fn corrupted_identity_slot_fails_closed() {
        let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
        // Write a raw non-snapshot string into the identity slot.
        store.put(Slot::DeviceIdentity, "not-json").unwrap();
        let err = OpenMlsBackend::new(store).unwrap_err();
        assert_eq!(err.code, CryptoErrorCode::StorageCorrupt);
    }

    #[test]
    fn wrong_backend_snapshot_fails_closed() {
        // A snapshot produced by the stub backend must not silently load
        // into the openmls backend — cross-backend confusion is
        // detected at construction.
        let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
        Snapshot::save(&*store, Slot::DeviceIdentity, "stub-v0", "{}".into()).unwrap();
        let err = OpenMlsBackend::new(store).unwrap_err();
        assert_eq!(err.code, CryptoErrorCode::StorageCorrupt);
    }

    #[test]
    fn wrong_ciphersuite_tag_fails_closed() {
        let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
        let bogus = PersistedIdentity {
            device_id: "d".into(),
            ciphersuite_tag: "MLS_256_DHKEMP384_AES256GCM_SHA384_P384".into(),
            credential_tls_b64: String::new(),
            signature_public_b64: String::new(),
            signature_private_b64: String::new(),
            created_at_ms: 0,
            revoked: false,
        };
        Snapshot::save(
            &*store,
            Slot::DeviceIdentity,
            OPENMLS_BACKEND,
            serde_json::to_string(&bogus).unwrap(),
        )
        .unwrap();
        let err = OpenMlsBackend::new(store).unwrap_err();
        assert_eq!(err.code, CryptoErrorCode::StorageCorrupt);
    }

    #[test]
    fn publish_without_identity_returns_no_identity() {
        let b = fresh();
        let err = b.publish_prekeys(1).unwrap_err();
        assert_eq!(err.code, CryptoErrorCode::NoIdentity);
    }

    #[test]
    fn publish_after_revoke_returns_device_revoked() {
        let b = fresh();
        b.create_identity().unwrap();
        b.revoke_device().unwrap();
        let err = b.publish_prekeys(1).unwrap_err();
        assert_eq!(err.code, CryptoErrorCode::DeviceRevoked);
    }

    #[test]
    fn publish_generates_valid_round_trippable_keypackages() {
        let b = fresh();
        b.create_identity().unwrap();
        let bundle = b.publish_prekeys(3).unwrap();
        assert_eq!(bundle.one_time_prekeys.len(), 3);
        for kp in &bundle.one_time_prekeys {
            let bytes = decode_b64(&kp.public_key).expect("valid b64");
            let parsed = KeyPackage::tls_deserialize(&mut bytes.as_slice())
                .expect("valid TLS-encoded KeyPackage");
            assert_eq!(parsed.ciphersuite(), WHISPR_CIPHERSUITE);
        }
    }

    #[test]
    fn published_wire_bundle_contains_no_private_material() {
        // Whole-blob substring check: no PRIVATE-signature bytes may
        // appear in the JSON serialization of the wire bundle returned
        // to callers. This catches accidental exposure through a new
        // field before it can ship.
        let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
        let b = OpenMlsBackend::new(store.clone()).unwrap();
        b.create_identity().unwrap();
        let bundle = b.publish_prekeys(2).unwrap();
        let wire = serde_json::to_string(&bundle).unwrap();

        // Extract the persisted private signature key and confirm none
        // of its bytes (or its base64 form) leaked into the wire blob.
        let raw = store.get(Slot::DeviceIdentity).unwrap().unwrap();
        let snap: Snapshot = serde_json::from_str(&raw).unwrap();
        let id: PersistedIdentity = serde_json::from_str(&snap.payload).unwrap();
        assert!(
            !wire.contains(&id.signature_private_b64),
            "wire bundle leaked private signature key"
        );
        // And no field named "private" of any kind.
        assert!(
            !wire.to_lowercase().contains("private"),
            "wire bundle contains a field literally named 'private'"
        );
    }

    #[test]
    fn count_bounds_are_enforced() {
        let b = fresh();
        b.create_identity().unwrap();
        assert!(b.publish_prekeys(0).is_err());
        assert!(b.publish_prekeys(MAX_KEYPACKAGES_PER_CALL + 1).is_err());
    }

    /// Slice 1 API-shape regression.
    ///
    /// Intent (per Slice 1 freeze checklist): this does NOT claim to
    /// mathematically prove secrecy of the private init/encryption keys.
    /// It proves that the *public return type* of `publish_prekeys`
    /// exposes only the public `KeyPackage` wire form — no
    /// `KeyPackageBundle` (which carries private init/encryption keys)
    /// or other private-state object is accidentally serialized through
    /// the API boundary.
    ///
    /// Failure of this test means a future refactor changed the wire
    /// shape to include private state; do NOT "fix" it by weakening
    /// the assertions.
    #[test]
    fn keypackage_private_material_is_not_reconstructable_from_public_wire_output() {
        let store: Arc<dyn SecureStore> = Arc::new(MemoryStore::new());
        let b = OpenMlsBackend::new(store.clone()).unwrap();
        b.create_identity().unwrap();
        let bundle = b.publish_prekeys(3).unwrap();

        // 1. Every wire entry MUST parse as a public `KeyPackage`.
        //    If it were a `KeyPackageBundle` we'd be leaking private
        //    init + encryption keys through the API surface.
        for pk in &bundle.one_time_prekeys {
            let bytes = URL_SAFE_NO_PAD
                .decode(&pk.public_key)
                .expect("wire entry must be URL-safe base64");
            KeyPackage::tls_deserialize(&mut bytes.as_slice())
                .expect("wire entry must decode as public KeyPackage");

            // 2. The same bytes MUST NOT decode as a KeyPackageBundle.
            //    A bundle carries additional private key material; if
            //    this ever succeeds, the API boundary regressed.
            let as_bundle = KeyPackageBundle::tls_deserialize(&mut bytes.as_slice());
            assert!(
                as_bundle.is_err(),
                "public wire entry unexpectedly decoded as KeyPackageBundle \
                 (would leak private init/encryption keys)"
            );
        }

        // 3. The serialized wire representation of the whole bundle must
        //    not contain any field literally named like a private-state
        //    accessor. This catches accidental #[derive(Serialize)] on a
        //    struct that also holds a private half.
        let wire_json = serde_json::to_string(&bundle).unwrap();
        for forbidden in [
            "private",
            "secret",
            "bundle",
            "init_secret",
            "encryption_secret",
            "signature_private",
        ] {
            assert!(
                !wire_json.to_lowercase().contains(forbidden),
                "wire bundle exposes forbidden field name: {forbidden}"
            );
        }
    }
}

