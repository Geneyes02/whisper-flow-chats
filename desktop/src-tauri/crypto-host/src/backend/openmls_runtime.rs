//! Production-candidate OpenMLS runtime for native Whispr direct messaging.
//!
//! This module intentionally sits behind `backend-openmls`. It implements the
//! stable `CryptoBackend` seam without exposing OpenMLS types to Tauri/JS.
//! Direct conversations are represented as two-device MLS groups. The first
//! outbound application envelope carries the MLS Welcome in-band; subsequent
//! epoch-control commits are carried in-band before the application message.
//!
//! The complete OpenMLS provider state is snapshotted as one opaque value in
//! `Slot::SessionStore`. That makes group/epoch state persistence a single
//! SecureStore write rather than a collection of partially-updated files.

#![cfg(feature = "backend-openmls")]

use std::{collections::HashMap, sync::Arc};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use openmls::prelude::{
    Ciphersuite, Credential, CredentialType, CredentialWithKey, GroupId, KeyPackage, KeyPackageIn,
    LeafNodeParameters, Lifetime, MlsGroup, MlsGroupCreateConfig, MlsGroupJoinConfig, MlsMessageIn,
    ProcessedMessageContent, ProtocolVersion, StagedWelcome,
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{signatures::Signer, types::SignatureScheme, OpenMlsProvider};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tls_codec::{Deserialize as _, Serialize as _};

use crate::backend::CryptoBackend;
use crate::error::{CryptoError, CryptoErrorCode, Result};
use crate::keychain::{SecureStore, Slot};
use crate::storage::Snapshot;
use crate::types::{
    DeviceIdentity, EncryptedEnvelope, EnvelopeKind, OneTimePrekey, PrekeyBundle, SafetyNumber,
    ENVELOPE_VERSION,
};

pub const OPENMLS_RUNTIME_BACKEND: &str = "openmls-runtime-v1";
pub const WHISPR_MLS_PROFILE: &str = "whispr-mls-v1";
pub const WHISPR_CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
pub const WHISPR_CIPHERSUITE_TAG: &str = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const KEYPACKAGE_LIFETIME_SECS: u64 = 60 * 60 * 24 * 90;
const MAX_PREKEYS: u32 = 200;
const MAX_SEEN_MESSAGE_IDS: usize = 20_000;

#[derive(Clone, Serialize, Deserialize)]
struct PersistedIdentity {
    device_id: String,
    ciphersuite_tag: String,
    credential_tls_b64: String,
    signature_public_b64: String,
    signature_private_b64: String,
    created_at_ms: i64,
    revoked: bool,
}

/// A complete atomic snapshot of the OpenMLS in-memory storage provider plus
/// Whispr-owned transport metadata that OpenMLS deliberately does not know.
#[derive(Default, Serialize, Deserialize)]
struct RuntimeSnapshot {
    provider_entries: Vec<(String, String)>,
    pending_welcomes: HashMap<String, String>,
    pending_commits: HashMap<String, String>,
    send_counters: HashMap<String, u64>,
    seen_message_ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct TransportFrame {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    welcome_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    commit_b64: Option<String>,
    application_b64: String,
}

#[derive(Default, Deserialize)]
struct RoutingAad {
    #[serde(default, alias = "conversationId")]
    conversation_id: String,
    #[serde(default, alias = "messageId")]
    message_id: String,
}

pub struct OpenMlsRuntimeBackend {
    store: Arc<dyn SecureStore>,
    provider: OpenMlsRustCrypto,
    identity: Mutex<Option<PersistedIdentity>>,
    mutation_lock: Mutex<()>,
}

impl OpenMlsRuntimeBackend {
    pub fn new(store: Arc<dyn SecureStore>) -> Result<Self> {
        let identity = match Snapshot::load(&*store, Slot::DeviceIdentity, OPENMLS_RUNTIME_BACKEND)?
        {
            Some(s) => {
                let id: PersistedIdentity = serde_json::from_str(&s.payload).map_err(|_| {
                    CryptoError::new(CryptoErrorCode::StorageCorrupt, "identity payload")
                })?;
                if id.ciphersuite_tag != WHISPR_CIPHERSUITE_TAG {
                    return Err(CryptoError::new(
                        CryptoErrorCode::StorageCorrupt,
                        "identity ciphersuite mismatch",
                    ));
                }
                Some(id)
            }
            None => None,
        };

        let backend = Self {
            store,
            provider: OpenMlsRustCrypto::default(),
            identity: Mutex::new(identity),
            mutation_lock: Mutex::new(()),
        };
        backend.restore_runtime()?;
        backend.restore_signer_into_provider()?;
        Ok(backend)
    }

    fn persist_identity(&self, id: &PersistedIdentity) -> Result<()> {
        let payload = serde_json::to_string(id)
            .map_err(|_| CryptoError::internal("openmls identity serialize"))?;
        Snapshot::save(
            &*self.store,
            Slot::DeviceIdentity,
            OPENMLS_RUNTIME_BACKEND,
            payload,
        )
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

    fn signer(id: &PersistedIdentity) -> Result<SignatureKeyPair> {
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

    fn credential(id: &PersistedIdentity) -> Result<Credential> {
        let bytes = decode_b64(&id.credential_tls_b64)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "credential b64"))?;
        Credential::tls_deserialize(&mut bytes.as_slice())
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "credential tls"))
    }

    fn credential_with_key(id: &PersistedIdentity) -> Result<CredentialWithKey> {
        let signer = Self::signer(id)?;
        Ok(CredentialWithKey {
            credential: Self::credential(id)?,
            signature_key: signer.public().into(),
        })
    }

    fn restore_signer_into_provider(&self) -> Result<()> {
        let Some(id) = self.identity.lock().clone() else {
            return Ok(());
        };
        if id.revoked {
            return Ok(());
        }
        let signer = Self::signer(&id)?;
        signer
            .store(self.provider.storage())
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "signature store"))
    }

    fn load_runtime_snapshot(&self) -> Result<RuntimeSnapshot> {
        match Snapshot::load(&*self.store, Slot::SessionStore, OPENMLS_RUNTIME_BACKEND)? {
            Some(s) => serde_json::from_str(&s.payload)
                .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "runtime snapshot")),
            None => Ok(RuntimeSnapshot::default()),
        }
    }

    fn restore_runtime(&self) -> Result<()> {
        let snap = self.load_runtime_snapshot()?;
        let mut values = self
            .provider
            .storage()
            .values
            .write()
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider lock"))?;
        values.clear();
        for (k, v) in snap.provider_entries {
            let key = decode_b64(&k)
                .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider key"))?;
            let value = decode_b64(&v)
                .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider value"))?;
            values.insert(key, value);
        }
        Ok(())
    }

    fn persist_runtime_with(&self, mut meta: RuntimeSnapshot) -> Result<()> {
        let values = self
            .provider
            .storage()
            .values
            .read()
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider lock"))?;
        meta.provider_entries = values
            .iter()
            .map(|(k, v)| (encode_b64(k), encode_b64(v)))
            .collect();
        drop(values);
        let payload = serde_json::to_string(&meta)
            .map_err(|_| CryptoError::internal("runtime snapshot serialize"))?;
        Snapshot::save(
            &*self.store,
            Slot::SessionStore,
            OPENMLS_RUNTIME_BACKEND,
            payload,
        )
    }

    fn persist_runtime(&self) -> Result<()> {
        let meta = self.load_runtime_snapshot()?;
        self.persist_runtime_with(meta)
    }

    fn group_id(local: &str, peer: &str) -> GroupId {
        let (a, b) = if local <= peer {
            (local, peer)
        } else {
            (peer, local)
        };
        let mut h = Sha256::new();
        h.update(b"whispr-direct-mls-v1\0");
        h.update(a.as_bytes());
        h.update([0]);
        h.update(b.as_bytes());
        GroupId::from_slice(&h.finalize())
    }

    fn group_for_peer(&self, peer: &str) -> Result<MlsGroup> {
        let id = self.require_identity()?;
        let group_id = Self::group_id(&id.device_id, peer);
        MlsGroup::load(self.provider.storage(), &group_id)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "group load"))?
            .ok_or_else(|| CryptoError::new(CryptoErrorCode::NoSession, "no MLS group for peer"))
    }

    fn validate_peer_keypackage(&self, wire: &[u8], peer: &PrekeyBundle) -> Result<KeyPackage> {
        let kp_in = KeyPackageIn::tls_deserialize(&mut &wire[..]).map_err(|_| {
            CryptoError::new(CryptoErrorCode::InvalidBundle, "malformed keypackage")
        })?;
        let kp = kp_in
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::InvalidBundle, "keypackage validation")
            })?;
        if kp.ciphersuite() != WHISPR_CIPHERSUITE {
            return Err(CryptoError::new(
                CryptoErrorCode::InvalidBundle,
                "wrong ciphersuite",
            ));
        }
        let cred = kp.leaf_node().credential();
        if cred.credential_type() != CredentialType::Basic
            || cred.serialized_content() != peer.device_id.as_bytes()
        {
            return Err(CryptoError::new(
                CryptoErrorCode::IdentityMismatch,
                "device binding",
            ));
        }
        let expected_sig = decode_b64(&peer.identity_public_key).map_err(|_| {
            CryptoError::new(CryptoErrorCode::InvalidBundle, "identity key encoding")
        })?;
        if kp.leaf_node().signature_key().as_slice() != expected_sig.as_slice() {
            return Err(CryptoError::new(
                CryptoErrorCode::IdentityMismatch,
                "signature key mismatch",
            ));
        }
        Ok(kp)
    }

    fn parse_routing_aad(aad: &[u8]) -> RoutingAad {
        serde_json::from_slice(aad).unwrap_or_default()
    }

    fn process_control_message(&self, group: &mut MlsGroup, bytes: &[u8]) -> Result<()> {
        let msg = MlsMessageIn::tls_deserialize_exact(bytes.to_vec()).map_err(|_| {
            CryptoError::new(CryptoErrorCode::BadCiphertext, "control message parse")
        })?;
        let protocol = msg.try_into_protocol_message().map_err(|_| {
            CryptoError::new(CryptoErrorCode::BadCiphertext, "control message type")
        })?;
        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::BadCiphertext, "control message validation")
            })?;
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => group
                .merge_staged_commit(&self.provider, *staged)
                .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "commit merge")),
            _ => Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "unexpected control message",
            )),
        }
    }

    fn accept_welcome(&self, sender_device_id: &str, welcome_bytes: &[u8]) -> Result<()> {
        let id = self.require_identity()?;
        let msg = MlsMessageIn::tls_deserialize_exact(welcome_bytes.to_vec())
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome parse"))?;
        let welcome = msg
            .into_welcome()
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "expected welcome"))?;
        let join_config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let staged = StagedWelcome::new_from_welcome(&self.provider, &join_config, welcome, None)
            .map_err(|_| {
            CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome validation")
        })?;
        let group = staged
            .into_group(&self.provider)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome join"))?;
        let expected = Self::group_id(&id.device_id, sender_device_id);
        if group.group_id() != &expected {
            return Err(CryptoError::new(
                CryptoErrorCode::IdentityMismatch,
                "welcome group binding",
            ));
        }
        Ok(())
    }

    fn clear_provider(&self) -> Result<()> {
        let mut values = self
            .provider
            .storage()
            .values
            .write()
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider lock"))?;
        values.clear();
        Ok(())
    }
}

impl CryptoBackend for OpenMlsRuntimeBackend {
    fn name(&self) -> &'static str {
        OPENMLS_RUNTIME_BACKEND
    }

    fn protocol_id(&self) -> &'static str {
        WHISPR_MLS_PROFILE
    }

    fn protocol_version(&self) -> u16 {
        1
    }

    fn create_identity(&self) -> Result<DeviceIdentity> {
        let _lock = self.mutation_lock.lock();
        let mut guard = self.identity.lock();
        if let Some(existing) = guard.as_ref() {
            return Ok(public_view(existing));
        }

        let device_id = hex::encode({
            let mut b = [0u8; 16];
            use rand_core::{OsRng, RngCore};
            OsRng.fill_bytes(&mut b);
            b
        });
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|_| CryptoError::internal("signature keypair"))?;
        signer
            .store(self.provider.storage())
            .map_err(|_| CryptoError::internal("signature provider store"))?;
        let credential = Credential::new_basic(device_id.as_bytes().to_vec());
        let credential_tls = credential
            .tls_serialize_detached()
            .map_err(|_| CryptoError::internal("credential serialize"))?;
        let id = PersistedIdentity {
            device_id,
            ciphersuite_tag: WHISPR_CIPHERSUITE_TAG.to_string(),
            credential_tls_b64: encode_b64(&credential_tls),
            signature_public_b64: encode_b64(signer.public()),
            signature_private_b64: encode_b64(signer.private()),
            created_at_ms: now_ms(),
            revoked: false,
        };
        self.persist_identity(&id)?;
        self.persist_runtime()?;
        let view = public_view(&id);
        *guard = Some(id);
        Ok(view)
    }

    fn load_identity(&self) -> Result<Option<DeviceIdentity>> {
        Ok(self.identity.lock().as_ref().map(public_view))
    }

    fn revoke_device(&self) -> Result<()> {
        let _lock = self.mutation_lock.lock();
        let mut guard = self.identity.lock();
        if let Some(id) = guard.as_mut() {
            id.revoked = true;
            self.persist_identity(id)?;
        }
        self.clear_provider()?;
        Snapshot::clear(&*self.store, Slot::SessionStore)?;
        Snapshot::clear(&*self.store, Slot::PrekeyStore)?;
        Ok(())
    }

    fn publish_prekeys(&self, count: u32) -> Result<PrekeyBundle> {
        let _lock = self.mutation_lock.lock();
        if count == 0 || count > MAX_PREKEYS {
            return Err(CryptoError::new(
                CryptoErrorCode::InvalidBundle,
                "prekey count",
            ));
        }
        let id = self.require_identity()?;
        let signer = Self::signer(&id)?;
        let credential_with_key = Self::credential_with_key(&id)?;
        let mut one_time_prekeys = Vec::with_capacity(count as usize);
        for key_id in 1..=count {
            let bundle = KeyPackage::builder()
                .key_package_lifetime(Lifetime::new(KEYPACKAGE_LIFETIME_SECS))
                .build(
                    WHISPR_CIPHERSUITE,
                    &self.provider,
                    &signer,
                    credential_with_key.clone(),
                )
                .map_err(|_| CryptoError::internal("keypackage build"))?;
            let bytes = bundle
                .key_package()
                .tls_serialize_detached()
                .map_err(|_| CryptoError::internal("keypackage serialize"))?;
            one_time_prekeys.push(OneTimePrekey {
                key_id,
                public_key: encode_b64(&bytes),
            });
        }
        self.persist_runtime()?;
        Ok(PrekeyBundle {
            device_id: id.device_id,
            registration_id: None,
            identity_public_key: id.signature_public_b64,
            signed_prekey_id: 0,
            signed_prekey_public: String::new(),
            signed_prekey_signature: String::new(),
            one_time_prekeys,
        })
    }

    fn establish_session(&self, peer: PrekeyBundle) -> Result<()> {
        let _lock = self.mutation_lock.lock();
        let id = self.require_identity()?;
        let group_id = Self::group_id(&id.device_id, &peer.device_id);
        if MlsGroup::load(self.provider.storage(), &group_id)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "group lookup"))?
            .is_some()
        {
            return Ok(());
        }
        let public = peer
            .one_time_prekeys
            .first()
            .ok_or_else(|| CryptoError::new(CryptoErrorCode::InvalidBundle, "no keypackage"))?;
        let wire = decode_b64(&public.public_key)
            .map_err(|_| CryptoError::new(CryptoErrorCode::InvalidBundle, "keypackage encoding"))?;
        let peer_kp = self.validate_peer_keypackage(&wire, &peer)?;
        let signer = Self::signer(&id)?;
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(WHISPR_CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build();
        let mut group = MlsGroup::new_with_group_id(
            &self.provider,
            &signer,
            &config,
            group_id,
            Self::credential_with_key(&id)?,
        )
        .map_err(|_| CryptoError::internal("group create"))?;
        let (_commit, welcome, _group_info) = group
            .add_members(&self.provider, &signer, std::slice::from_ref(&peer_kp))
            .map_err(|_| CryptoError::new(CryptoErrorCode::InvalidBundle, "add peer"))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CryptoError::internal("merge add commit"))?;
        let welcome_bytes = welcome
            .tls_serialize_detached()
            .map_err(|_| CryptoError::internal("welcome serialize"))?;
        let mut meta = self.load_runtime_snapshot()?;
        meta.pending_welcomes
            .insert(peer.device_id, encode_b64(&welcome_bytes));
        self.persist_runtime_with(meta)
    }

    fn rotate_session(&self, recipient_device_id: &str) -> Result<()> {
        let _lock = self.mutation_lock.lock();
        let id = self.require_identity()?;
        let signer = Self::signer(&id)?;
        let mut group = self.group_for_peer(recipient_device_id)?;
        let (commit, _welcome, _group_info) = group
            .self_update(&self.provider, &signer, LeafNodeParameters::default())
            .map_err(|_| CryptoError::internal("self update"))?
            .into_contents();
        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CryptoError::internal("merge self update"))?;
        let bytes = commit
            .tls_serialize_detached()
            .map_err(|_| CryptoError::internal("commit serialize"))?;
        let mut meta = self.load_runtime_snapshot()?;
        meta.pending_commits
            .insert(recipient_device_id.to_string(), encode_b64(&bytes));
        self.persist_runtime_with(meta)
    }

    fn encrypt(
        &self,
        recipient_device_id: &str,
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<EncryptedEnvelope> {
        let _lock = self.mutation_lock.lock();
        let id = self.require_identity()?;
        let signer = Self::signer(&id)?;
        let mut group = self.group_for_peer(recipient_device_id)?;
        group.set_aad(aad.to_vec());
        let app = group
            .create_message(&self.provider, &signer, plaintext)
            .map_err(|_| CryptoError::internal("application encrypt"))?;
        let app_bytes = app
            .tls_serialize_detached()
            .map_err(|_| CryptoError::internal("application serialize"))?;

        let mut meta = self.load_runtime_snapshot()?;
        let welcome_b64 = meta.pending_welcomes.remove(recipient_device_id);
        let commit_b64 = meta.pending_commits.remove(recipient_device_id);
        let counter = meta
            .send_counters
            .entry(recipient_device_id.to_string())
            .and_modify(|n| *n = n.saturating_add(1))
            .or_insert(1);
        let counter = *counter;
        let frame = TransportFrame {
            welcome_b64,
            commit_b64,
            application_b64: encode_b64(&app_bytes),
        };
        let first_contact = frame.welcome_b64.is_some();
        let frame_bytes = serde_json::to_vec(&frame)
            .map_err(|_| CryptoError::internal("transport frame serialize"))?;
        let routing = Self::parse_routing_aad(aad);
        self.persist_runtime_with(meta)?;

        Ok(EncryptedEnvelope {
            version: ENVELOPE_VERSION,
            backend: OPENMLS_RUNTIME_BACKEND.to_string(),
            protocol_id: WHISPR_MLS_PROFILE.to_string(),
            protocol_version: 1,
            sender_device_id: id.device_id,
            recipient_device_id: recipient_device_id.to_string(),
            conversation_id: routing.conversation_id,
            message_id: routing.message_id,
            counter,
            ciphertext: encode_b64(&frame_bytes),
            aad: encode_b64(aad),
            kind: if first_contact {
                EnvelopeKind::Prekey
            } else {
                EnvelopeKind::Whisper
            },
        })
    }

    fn decrypt(&self, envelope: &EncryptedEnvelope) -> Result<Vec<u8>> {
        let _lock = self.mutation_lock.lock();
        let id = self.require_identity()?;
        if envelope.backend != OPENMLS_RUNTIME_BACKEND
            || envelope.protocol_id != WHISPR_MLS_PROFILE
            || envelope.protocol_version != 1
        {
            return Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "protocol mismatch",
            ));
        }
        if envelope.recipient_device_id != id.device_id {
            return Err(CryptoError::new(
                CryptoErrorCode::IdentityMismatch,
                "wrong recipient",
            ));
        }

        let mut meta = self.load_runtime_snapshot()?;
        if !envelope.message_id.is_empty()
            && meta
                .seen_message_ids
                .iter()
                .any(|v| v == &envelope.message_id)
        {
            return Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "message replay",
            ));
        }

        let frame_bytes = decode_b64(&envelope.ciphertext)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "frame encoding"))?;
        let frame: TransportFrame = serde_json::from_slice(&frame_bytes)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "frame parse"))?;

        if let Some(welcome_b64) = frame.welcome_b64.as_deref() {
            if MlsGroup::load(
                self.provider.storage(),
                &Self::group_id(&id.device_id, &envelope.sender_device_id),
            )
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "group lookup"))?
            .is_none()
            {
                let bytes = decode_b64(welcome_b64).map_err(|_| {
                    CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome encoding")
                })?;
                self.accept_welcome(&envelope.sender_device_id, &bytes)?;
            }
        }

        let mut group = self.group_for_peer(&envelope.sender_device_id)?;
        if let Some(commit_b64) = frame.commit_b64.as_deref() {
            let bytes = decode_b64(commit_b64)
                .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "commit encoding"))?;
            self.process_control_message(&mut group, &bytes)?;
        }

        let app_bytes = decode_b64(&frame.application_b64).map_err(|_| {
            CryptoError::new(CryptoErrorCode::BadCiphertext, "application encoding")
        })?;
        let msg = MlsMessageIn::tls_deserialize_exact(app_bytes)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "application parse"))?;
        let protocol = msg
            .try_into_protocol_message()
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "application type"))?;
        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::BadCiphertext, "application validation")
            })?;
        let aad = decode_b64(&envelope.aad)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "aad encoding"))?;
        if processed.aad() != aad.as_slice() {
            return Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "aad mismatch",
            ));
        }
        let plaintext = match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(m) => m.into_bytes(),
            _ => {
                return Err(CryptoError::new(
                    CryptoErrorCode::BadCiphertext,
                    "unexpected message type",
                ))
            }
        };

        if !envelope.message_id.is_empty() {
            meta.seen_message_ids.push(envelope.message_id.clone());
            if meta.seen_message_ids.len() > MAX_SEEN_MESSAGE_IDS {
                let drop_n = meta.seen_message_ids.len() - MAX_SEEN_MESSAGE_IDS;
                meta.seen_message_ids.drain(0..drop_n);
            }
        }
        self.persist_runtime_with(meta)?;
        Ok(plaintext)
    }

    fn safety_number(&self, peer_identity_public_key: &[u8]) -> Result<SafetyNumber> {
        let id = self.require_identity()?;
        let local = decode_b64(&id.signature_public_b64)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "identity public"))?;
        let (a, b) = if local.as_slice() <= peer_identity_public_key {
            (local.as_slice(), peer_identity_public_key)
        } else {
            (peer_identity_public_key, local.as_slice())
        };
        let mut h = Sha256::new();
        h.update(b"whispr-safety-v1\0");
        h.update(a);
        h.update(b);
        let fp = h.finalize();
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
            fingerprint: encode_b64(&fp),
            qr_payload: encode_b64(&fp),
        })
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keychain::MemoryStore;

    fn pair() -> (
        Arc<MemoryStore>,
        Arc<MemoryStore>,
        OpenMlsRuntimeBackend,
        OpenMlsRuntimeBackend,
        DeviceIdentity,
        DeviceIdentity,
    ) {
        let as_ = Arc::new(MemoryStore::new());
        let bs = Arc::new(MemoryStore::new());
        let alice = OpenMlsRuntimeBackend::new(as_.clone()).unwrap();
        let bob = OpenMlsRuntimeBackend::new(bs.clone()).unwrap();
        let aid = alice.create_identity().unwrap();
        let bid = bob.create_identity().unwrap();
        (as_, bs, alice, bob, aid, bid)
    }

    fn aad(n: usize) -> Vec<u8> {
        format!(r#"{{"conversation_id":"conv-1","message_id":"m-{n}"}}"#).into_bytes()
    }

    #[test]
    fn rt_first_contact_and_reply() {
        let (_as, _bs, alice, bob, aid, bid) = pair();
        let bob_kp = bob.publish_prekeys(4).unwrap();
        alice.establish_session(bob_kp).unwrap();
        let env = alice
            .encrypt(&bid.device_id, b"hello bob", &aad(1))
            .unwrap();
        assert_eq!(env.kind, EnvelopeKind::Prekey);
        assert_eq!(bob.decrypt(&env).unwrap(), b"hello bob");
        let reply = bob
            .encrypt(&aid.device_id, b"hello alice", &aad(2))
            .unwrap();
        assert_eq!(alice.decrypt(&reply).unwrap(), b"hello alice");
    }

    #[test]
    fn rt_restart_restores_group_and_ratchet_state() {
        let (as_, bs, alice, bob, aid, bid) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let first = alice.encrypt(&bid.device_id, b"one", &aad(1)).unwrap();
        assert_eq!(bob.decrypt(&first).unwrap(), b"one");
        drop(alice);
        drop(bob);
        let alice = OpenMlsRuntimeBackend::new(as_).unwrap();
        let bob = OpenMlsRuntimeBackend::new(bs).unwrap();
        let second = bob.encrypt(&aid.device_id, b"two", &aad(2)).unwrap();
        assert_eq!(alice.decrypt(&second).unwrap(), b"two");
    }

    #[test]
    fn rt_replay_and_tamper_fail_closed() {
        let (_as, _bs, alice, bob, _aid, bid) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let env = alice
            .encrypt(&bid.device_id, b"secret sentinel", &aad(10))
            .unwrap();
        assert_eq!(bob.decrypt(&env).unwrap(), b"secret sentinel");
        assert_eq!(
            bob.decrypt(&env).unwrap_err().code,
            CryptoErrorCode::BadCiphertext
        );

        let mut tampered = alice.encrypt(&bid.device_id, b"second", &aad(11)).unwrap();
        let mut raw = decode_b64(&tampered.ciphertext).unwrap();
        let idx = raw.len() / 2;
        raw[idx] ^= 1;
        tampered.ciphertext = encode_b64(&raw);
        assert_eq!(
            bob.decrypt(&tampered).unwrap_err().code,
            CryptoErrorCode::BadCiphertext
        );
    }

    #[test]
    fn rt_rotation_commit_is_delivered_before_next_application_message() {
        let (_as, _bs, alice, bob, aid, bid) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let first = alice.encrypt(&bid.device_id, b"before", &aad(1)).unwrap();
        bob.decrypt(&first).unwrap();
        alice.rotate_session(&bid.device_id).unwrap();
        let after = alice.encrypt(&bid.device_id, b"after", &aad(2)).unwrap();
        assert_eq!(bob.decrypt(&after).unwrap(), b"after");
        let reply = bob
            .encrypt(&aid.device_id, b"still synced", &aad(3))
            .unwrap();
        assert_eq!(alice.decrypt(&reply).unwrap(), b"still synced");
    }

    #[test]
    fn rt_1000_sequential_messages() {
        let (_as, _bs, alice, bob, _aid, bid) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        for i in 0..1000usize {
            let p = format!("message-{i}");
            let env = alice
                .encrypt(&bid.device_id, p.as_bytes(), &aad(i))
                .unwrap();
            assert_eq!(bob.decrypt(&env).unwrap(), p.as_bytes());
        }
    }

    #[test]
    fn rt_server_visible_envelope_does_not_contain_plaintext() {
        let (_as, _bs, alice, bob, _aid, bid) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let sentinel = b"WHISPR-SERVER-BLINDNESS-SENTINEL-7b6ac1";
        let env = alice.encrypt(&bid.device_id, sentinel, &aad(77)).unwrap();
        let json = serde_json::to_vec(&env).unwrap();
        assert!(!json.windows(sentinel.len()).any(|w| w == sentinel));
        let frame = decode_b64(&env.ciphertext).unwrap();
        assert!(!frame.windows(sentinel.len()).any(|w| w == sentinel));
    }
}
