//! Native OpenMLS runtime for Whispr direct messaging.
//!
//! Security boundary:
//! - OpenMLS state (signature private key, KeyPackage private material, group
//!   secrets and ratchet state) lives only in the OpenMLS provider and is
//!   snapshotted atomically into SecureStore/SessionStore.
//! - Tauri/JS sees public credentials, public KeyPackages and opaque MLS wire
//!   messages only.
//! - There is no plaintext fallback. Any protocol/storage/authentication error
//!   is returned as a CryptoError.

#![cfg(feature = "backend-openmls")]

use std::{collections::HashMap, sync::Arc};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use openmls::prelude::{
    BasicCredential, Ciphersuite, CredentialType, CredentialWithKey, GroupId, KeyPackage,
    KeyPackageIn, LeafNodeParameters, Lifetime, MlsGroup, MlsGroupCreateConfig, MlsGroupJoinConfig,
    MlsMessageBodyIn, MlsMessageIn, ProcessedMessageContent, ProtocolVersion, StagedWelcome,
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{types::SignatureScheme, OpenMlsProvider};
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
    signature_public_b64: String,
    created_at_ms: i64,
    revoked: bool,
}

/// One atomic persisted value containing all OpenMLS provider state plus the
/// minimum Whispr-owned delivery metadata needed across restarts.
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

#[derive(Serialize, Deserialize)]
struct BoundAad {
    sender_device_id: String,
    recipient_device_id: String,
    application_aad_b64: String,
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
            Some(snapshot) => {
                let id: PersistedIdentity =
                    serde_json::from_str(&snapshot.payload).map_err(|_| {
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

        if let Some(id) = backend.identity.lock().as_ref() {
            if !id.revoked {
                backend.signer(id)?;
            }
        }

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

    fn signer(&self, id: &PersistedIdentity) -> Result<SignatureKeyPair> {
        let public = decode_b64(&id.signature_public_b64)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "signature public"))?;
        SignatureKeyPair::read(self.provider.storage(), &public, SignatureScheme::ED25519)
            .ok_or_else(|| {
                CryptoError::new(
                    CryptoErrorCode::StorageCorrupt,
                    "signature key missing from provider state",
                )
            })
    }

    fn credential_with_key(&self, id: &PersistedIdentity) -> Result<CredentialWithKey> {
        let signer = self.signer(id)?;
        Ok(CredentialWithKey {
            credential: BasicCredential::new(id.device_id.as_bytes().to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        })
    }

    fn load_runtime_snapshot(&self) -> Result<RuntimeSnapshot> {
        match Snapshot::load(&*self.store, Slot::SessionStore, OPENMLS_RUNTIME_BACKEND)? {
            Some(snapshot) => serde_json::from_str(&snapshot.payload)
                .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "runtime snapshot")),
            None => Ok(RuntimeSnapshot::default()),
        }
    }

    fn restore_runtime(&self) -> Result<()> {
        let snapshot = self.load_runtime_snapshot()?;
        let mut values = self
            .provider
            .storage()
            .values
            .write()
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider lock"))?;
        values.clear();
        for (key_b64, value_b64) in snapshot.provider_entries {
            let key = decode_b64(&key_b64)
                .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider key"))?;
            let value = decode_b64(&value_b64)
                .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider value"))?;
            values.insert(key, value);
        }
        Ok(())
    }

    fn persist_runtime_with(&self, mut metadata: RuntimeSnapshot) -> Result<()> {
        let values = self
            .provider
            .storage()
            .values
            .read()
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "provider lock"))?;
        metadata.provider_entries = values
            .iter()
            .map(|(key, value)| (encode_b64(key), encode_b64(value)))
            .collect();
        drop(values);

        let payload = serde_json::to_string(&metadata)
            .map_err(|_| CryptoError::internal("runtime snapshot serialize"))?;
        Snapshot::save(
            &*self.store,
            Slot::SessionStore,
            OPENMLS_RUNTIME_BACKEND,
            payload,
        )
    }

    fn persist_runtime(&self) -> Result<()> {
        let metadata = self.load_runtime_snapshot()?;
        self.persist_runtime_with(metadata)
    }

    fn group_id(local: &str, peer: &str) -> GroupId {
        let (a, b) = if local <= peer {
            (local, peer)
        } else {
            (peer, local)
        };
        let mut hash = Sha256::new();
        hash.update(b"whispr-direct-mls-v1\0");
        hash.update(a.as_bytes());
        hash.update([0]);
        hash.update(b.as_bytes());
        GroupId::from_slice(&hash.finalize())
    }

    fn group_for_peer(&self, peer: &str) -> Result<MlsGroup> {
        let id = self.require_identity()?;
        let group_id = Self::group_id(&id.device_id, peer);
        MlsGroup::load(self.provider.storage(), &group_id)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "group load"))?
            .ok_or_else(|| CryptoError::new(CryptoErrorCode::NoSession, "no MLS group for peer"))
    }

    fn validate_peer_keypackage(&self, wire: &[u8], peer: &PrekeyBundle) -> Result<KeyPackage> {
        let key_package_in = KeyPackageIn::tls_deserialize(&mut &wire[..]).map_err(|_| {
            CryptoError::new(CryptoErrorCode::InvalidBundle, "malformed keypackage")
        })?;
        let key_package = key_package_in
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::InvalidBundle, "keypackage validation")
            })?;

        if key_package.ciphersuite() != WHISPR_CIPHERSUITE {
            return Err(CryptoError::new(
                CryptoErrorCode::InvalidBundle,
                "wrong ciphersuite",
            ));
        }

        let credential = key_package.leaf_node().credential();
        if credential.credential_type() != CredentialType::Basic
            || credential.serialized_content() != peer.device_id.as_bytes()
        {
            return Err(CryptoError::new(
                CryptoErrorCode::IdentityMismatch,
                "keypackage device binding mismatch",
            ));
        }

        let expected_signature_key = decode_b64(&peer.identity_public_key).map_err(|_| {
            CryptoError::new(CryptoErrorCode::InvalidBundle, "identity key encoding")
        })?;
        if key_package.leaf_node().signature_key().as_slice() != expected_signature_key.as_slice() {
            return Err(CryptoError::new(
                CryptoErrorCode::IdentityMismatch,
                "keypackage signature key mismatch",
            ));
        }

        Ok(key_package)
    }

    fn parse_routing_aad(aad: &[u8]) -> RoutingAad {
        serde_json::from_slice(aad).unwrap_or_default()
    }

    fn make_bound_aad(sender: &str, recipient: &str, application_aad: &[u8]) -> Result<Vec<u8>> {
        serde_json::to_vec(&BoundAad {
            sender_device_id: sender.to_string(),
            recipient_device_id: recipient.to_string(),
            application_aad_b64: encode_b64(application_aad),
        })
        .map_err(|_| CryptoError::internal("bound aad serialize"))
    }

    fn validate_bound_aad(envelope: &EncryptedEnvelope, processed_aad: &[u8]) -> Result<Vec<u8>> {
        let bound: BoundAad = serde_json::from_slice(processed_aad)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "bound aad parse"))?;
        if bound.sender_device_id != envelope.sender_device_id
            || bound.recipient_device_id != envelope.recipient_device_id
        {
            return Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "routing aad mismatch",
            ));
        }
        let application_aad = decode_b64(&bound.application_aad_b64)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "application aad"))?;
        let routing = Self::parse_routing_aad(&application_aad);
        if routing.conversation_id != envelope.conversation_id
            || routing.message_id != envelope.message_id
        {
            return Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "conversation/message binding mismatch",
            ));
        }
        Ok(application_aad)
    }

    fn process_control_message(&self, group: &mut MlsGroup, bytes: &[u8]) -> Result<()> {
        let message = MlsMessageIn::tls_deserialize_exact(bytes.to_vec()).map_err(|_| {
            CryptoError::new(CryptoErrorCode::BadCiphertext, "control message parse")
        })?;
        let protocol = message.try_into_protocol_message().map_err(|_| {
            CryptoError::new(CryptoErrorCode::BadCiphertext, "control message type")
        })?;
        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::BadCiphertext, "control message validation")
            })?;
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged_commit) => group
                .merge_staged_commit(&self.provider, *staged_commit)
                .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "commit merge")),
            _ => Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "unexpected control message",
            )),
        }
    }

    fn accept_welcome(&self, sender_device_id: &str, welcome_bytes: &[u8]) -> Result<()> {
        let id = self.require_identity()?;
        let message = MlsMessageIn::tls_deserialize_exact(welcome_bytes.to_vec())
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome parse"))?;
        let welcome = match message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => {
                return Err(CryptoError::new(
                    CryptoErrorCode::BadCiphertext,
                    "expected welcome",
                ))
            }
        };

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

        let expected_group_id = Self::group_id(&id.device_id, sender_device_id);
        if group.group_id() != &expected_group_id {
            return Err(CryptoError::new(
                CryptoErrorCode::IdentityMismatch,
                "welcome group binding mismatch",
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

        let device_id = random_device_id();
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|_| CryptoError::internal("signature keypair"))?;
        signer
            .store(self.provider.storage())
            .map_err(|_| CryptoError::internal("signature provider store"))?;

        let id = PersistedIdentity {
            device_id,
            ciphersuite_tag: WHISPR_CIPHERSUITE_TAG.to_string(),
            signature_public_b64: encode_b64(signer.public()),
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
        let signer = self.signer(&id)?;
        let credential_with_key = self.credential_with_key(&id)?;
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
        let peer_key_package = self.validate_peer_keypackage(&wire, &peer)?;
        let signer = self.signer(&id)?;
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(WHISPR_CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build();
        let mut group = MlsGroup::new_with_group_id(
            &self.provider,
            &signer,
            &config,
            group_id,
            self.credential_with_key(&id)?,
        )
        .map_err(|_| CryptoError::internal("group create"))?;
        let (_commit, welcome, _group_info) = group
            .add_members(
                &self.provider,
                &signer,
                std::slice::from_ref(&peer_key_package),
            )
            .map_err(|_| CryptoError::new(CryptoErrorCode::InvalidBundle, "add peer"))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CryptoError::internal("merge add commit"))?;

        let welcome_bytes = welcome
            .tls_serialize_detached()
            .map_err(|_| CryptoError::internal("welcome serialize"))?;
        let mut metadata = self.load_runtime_snapshot()?;
        metadata
            .pending_welcomes
            .insert(peer.device_id, encode_b64(&welcome_bytes));
        self.persist_runtime_with(metadata)
    }

    fn rotate_session(&self, recipient_device_id: &str) -> Result<()> {
        let _lock = self.mutation_lock.lock();
        let id = self.require_identity()?;
        let signer = self.signer(&id)?;
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
        let mut metadata = self.load_runtime_snapshot()?;
        metadata
            .pending_commits
            .insert(recipient_device_id.to_string(), encode_b64(&bytes));
        self.persist_runtime_with(metadata)
    }

    fn encrypt(
        &self,
        recipient_device_id: &str,
        plaintext: &[u8],
        application_aad: &[u8],
    ) -> Result<EncryptedEnvelope> {
        let _lock = self.mutation_lock.lock();
        let id = self.require_identity()?;
        let signer = self.signer(&id)?;
        let mut group = self.group_for_peer(recipient_device_id)?;
        let bound_aad = Self::make_bound_aad(&id.device_id, recipient_device_id, application_aad)?;
        group.set_aad(bound_aad.clone());
        let application = group
            .create_message(&self.provider, &signer, plaintext)
            .map_err(|_| CryptoError::internal("application encrypt"))?;
        let application_bytes = application
            .tls_serialize_detached()
            .map_err(|_| CryptoError::internal("application serialize"))?;

        let mut metadata = self.load_runtime_snapshot()?;
        let welcome_b64 = metadata.pending_welcomes.remove(recipient_device_id);
        let commit_b64 = metadata.pending_commits.remove(recipient_device_id);
        let counter = metadata
            .send_counters
            .entry(recipient_device_id.to_string())
            .and_modify(|value| *value = value.saturating_add(1))
            .or_insert(1);
        let counter = *counter;
        let first_contact = welcome_b64.is_some();
        let frame = TransportFrame {
            welcome_b64,
            commit_b64,
            application_b64: encode_b64(&application_bytes),
        };
        let frame_bytes = serde_json::to_vec(&frame)
            .map_err(|_| CryptoError::internal("transport frame serialize"))?;
        let routing = Self::parse_routing_aad(application_aad);
        self.persist_runtime_with(metadata)?;

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
            aad: encode_b64(&bound_aad),
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

        let mut metadata = self.load_runtime_snapshot()?;
        if !envelope.message_id.is_empty()
            && metadata
                .seen_message_ids
                .iter()
                .any(|value| value == &envelope.message_id)
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

        let group_id = Self::group_id(&id.device_id, &envelope.sender_device_id);
        let group_exists = MlsGroup::load(self.provider.storage(), &group_id)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "group lookup"))?
            .is_some();
        if !group_exists {
            let welcome_b64 = frame.welcome_b64.as_deref().ok_or_else(|| {
                CryptoError::new(CryptoErrorCode::NoSession, "missing first-contact welcome")
            })?;
            let welcome_bytes = decode_b64(welcome_b64).map_err(|_| {
                CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome encoding")
            })?;
            self.accept_welcome(&envelope.sender_device_id, &welcome_bytes)?;
        }

        let mut group = self.group_for_peer(&envelope.sender_device_id)?;
        if let Some(commit_b64) = frame.commit_b64.as_deref() {
            let commit_bytes = decode_b64(commit_b64)
                .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "commit encoding"))?;
            self.process_control_message(&mut group, &commit_bytes)?;
        }

        let application_bytes = decode_b64(&frame.application_b64).map_err(|_| {
            CryptoError::new(CryptoErrorCode::BadCiphertext, "application encoding")
        })?;
        let message = MlsMessageIn::tls_deserialize_exact(application_bytes)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "application parse"))?;
        let protocol = message
            .try_into_protocol_message()
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "application type"))?;
        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::BadCiphertext, "application validation")
            })?;

        let envelope_aad = decode_b64(&envelope.aad)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "aad encoding"))?;
        if processed.aad() != envelope_aad.as_slice() {
            return Err(CryptoError::new(
                CryptoErrorCode::BadCiphertext,
                "aad authentication mismatch",
            ));
        }
        Self::validate_bound_aad(envelope, processed.aad())?;

        let plaintext = match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => message.into_bytes(),
            _ => {
                return Err(CryptoError::new(
                    CryptoErrorCode::BadCiphertext,
                    "unexpected message type",
                ))
            }
        };

        if !envelope.message_id.is_empty() {
            metadata.seen_message_ids.push(envelope.message_id.clone());
            if metadata.seen_message_ids.len() > MAX_SEEN_MESSAGE_IDS {
                let remove_count = metadata.seen_message_ids.len() - MAX_SEEN_MESSAGE_IDS;
                metadata.seen_message_ids.drain(0..remove_count);
            }
        }
        self.persist_runtime_with(metadata)?;
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
        let mut hash = Sha256::new();
        hash.update(b"whispr-safety-v1\0");
        hash.update(a);
        hash.update(b);
        let fingerprint = hash.finalize();
        let mut digits = String::with_capacity(60);
        for byte in fingerprint.iter().take(30) {
            digits.push_str(&format!("{:02}", byte % 100));
        }
        let grouped = digits
            .as_bytes()
            .chunks(5)
            .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
            .collect::<Vec<_>>()
            .join(" ");
        Ok(SafetyNumber {
            digits: grouped,
            fingerprint: encode_b64(&fingerprint),
            qr_payload: encode_b64(&fingerprint),
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

fn random_device_id() -> String {
    use rand_core::{OsRng, RngCore};
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    // UUID-shaped identifier so it can bind directly to Whispr's device row.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{}-{}-{}-{}-{}",
        hex::encode(&bytes[0..4]),
        hex::encode(&bytes[4..6]),
        hex::encode(&bytes[6..8]),
        hex::encode(&bytes[8..10]),
        hex::encode(&bytes[10..16])
    )
}

fn encode_b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn decode_b64(value: &str) -> std::result::Result<Vec<u8>, base64::DecodeError> {
    URL_SAFE_NO_PAD.decode(value)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
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
        let alice_store = Arc::new(MemoryStore::new());
        let bob_store = Arc::new(MemoryStore::new());
        let alice = OpenMlsRuntimeBackend::new(alice_store.clone()).unwrap();
        let bob = OpenMlsRuntimeBackend::new(bob_store.clone()).unwrap();
        let alice_id = alice.create_identity().unwrap();
        let bob_id = bob.create_identity().unwrap();
        (alice_store, bob_store, alice, bob, alice_id, bob_id)
    }

    fn aad(index: usize) -> Vec<u8> {
        format!(r#"{{"conversation_id":"conv-1","message_id":"m-{index}"}}"#).into_bytes()
    }

    #[test]
    fn s2_keypackage_is_valid_and_bound_to_device() {
        let (_stores_a, _stores_b, alice, bob, _alice_id, bob_id) = pair();
        let bundle = bob.publish_prekeys(2).unwrap();
        let wire = decode_b64(&bundle.one_time_prekeys[0].public_key).unwrap();
        alice.validate_peer_keypackage(&wire, &bundle).unwrap();

        let mut wrong = bundle.clone();
        wrong.device_id = "00000000-0000-4000-8000-000000000000".to_string();
        let error = alice.validate_peer_keypackage(&wire, &wrong).unwrap_err();
        assert_eq!(error.code, CryptoErrorCode::IdentityMismatch);
        assert_ne!(bob_id.device_id, wrong.device_id);
    }

    #[test]
    fn s2_malformed_keypackage_fails_closed() {
        let (_stores_a, _stores_b, alice, bob, _alice_id, _bob_id) = pair();
        let mut bundle = bob.publish_prekeys(1).unwrap();
        bundle.one_time_prekeys[0].public_key = encode_b64(b"not-an-mls-keypackage");
        let wire = decode_b64(&bundle.one_time_prekeys[0].public_key).unwrap();
        let error = alice.validate_peer_keypackage(&wire, &bundle).unwrap_err();
        assert_eq!(error.code, CryptoErrorCode::InvalidBundle);
    }

    #[test]
    fn s2_public_bundle_contains_no_session_snapshot() {
        let (alice_store, _bob_store, alice, _bob, _alice_id, _bob_id) = pair();
        let bundle = alice.publish_prekeys(3).unwrap();
        let public = serde_json::to_vec(&bundle).unwrap();
        let persisted = alice_store
            .inject_for_test_read(Slot::SessionStore)
            .unwrap_or_default();
        assert!(!persisted.is_empty());
        assert_ne!(public, persisted.as_bytes());
        assert!(!String::from_utf8_lossy(&public).contains("provider_entries"));
    }

    #[test]
    fn rt_first_contact_and_reply() {
        let (_alice_store, _bob_store, alice, bob, alice_id, bob_id) = pair();
        alice
            .establish_session(bob.publish_prekeys(4).unwrap())
            .unwrap();
        let envelope = alice
            .encrypt(&bob_id.device_id, b"hello bob", &aad(1))
            .unwrap();
        assert_eq!(envelope.kind, EnvelopeKind::Prekey);
        assert_eq!(bob.decrypt(&envelope).unwrap(), b"hello bob");

        let reply = bob
            .encrypt(&alice_id.device_id, b"hello alice", &aad(2))
            .unwrap();
        assert_eq!(alice.decrypt(&reply).unwrap(), b"hello alice");
    }

    #[test]
    fn rt_restart_restores_group_and_ratchet_state() {
        let (alice_store, bob_store, alice, bob, alice_id, bob_id) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let first = alice.encrypt(&bob_id.device_id, b"one", &aad(1)).unwrap();
        assert_eq!(bob.decrypt(&first).unwrap(), b"one");
        drop(alice);
        drop(bob);

        let alice = OpenMlsRuntimeBackend::new(alice_store).unwrap();
        let bob = OpenMlsRuntimeBackend::new(bob_store).unwrap();
        let second = bob.encrypt(&alice_id.device_id, b"two", &aad(2)).unwrap();
        assert_eq!(alice.decrypt(&second).unwrap(), b"two");
    }

    #[test]
    fn rt_replay_tamper_and_routing_rewrite_fail_closed() {
        let (_alice_store, _bob_store, alice, bob, _alice_id, bob_id) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let envelope = alice
            .encrypt(&bob_id.device_id, b"secret sentinel", &aad(10))
            .unwrap();
        assert_eq!(bob.decrypt(&envelope).unwrap(), b"secret sentinel");
        assert_eq!(
            bob.decrypt(&envelope).unwrap_err().code,
            CryptoErrorCode::BadCiphertext
        );

        let mut tampered = alice
            .encrypt(&bob_id.device_id, b"second", &aad(11))
            .unwrap();
        let mut raw = decode_b64(&tampered.ciphertext).unwrap();
        let midpoint = raw.len() / 2;
        raw[midpoint] ^= 1;
        tampered.ciphertext = encode_b64(&raw);
        assert_eq!(
            bob.decrypt(&tampered).unwrap_err().code,
            CryptoErrorCode::BadCiphertext
        );

        let mut rewritten = alice
            .encrypt(&bob_id.device_id, b"third", &aad(12))
            .unwrap();
        rewritten.conversation_id = "attacker-conversation".to_string();
        assert_eq!(
            bob.decrypt(&rewritten).unwrap_err().code,
            CryptoErrorCode::BadCiphertext
        );
    }

    #[test]
    fn rt_rotation_commit_is_delivered_before_application_message() {
        let (_alice_store, _bob_store, alice, bob, alice_id, bob_id) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let first = alice
            .encrypt(&bob_id.device_id, b"before", &aad(1))
            .unwrap();
        bob.decrypt(&first).unwrap();

        alice.rotate_session(&bob_id.device_id).unwrap();
        let after = alice.encrypt(&bob_id.device_id, b"after", &aad(2)).unwrap();
        assert_eq!(bob.decrypt(&after).unwrap(), b"after");
        let reply = bob
            .encrypt(&alice_id.device_id, b"still synced", &aad(3))
            .unwrap();
        assert_eq!(alice.decrypt(&reply).unwrap(), b"still synced");
    }

    #[test]
    fn rt_1000_sequential_messages() {
        let (_alice_store, _bob_store, alice, bob, _alice_id, bob_id) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        for index in 0..1000usize {
            let plaintext = format!("message-{index}");
            let envelope = alice
                .encrypt(&bob_id.device_id, plaintext.as_bytes(), &aad(index))
                .unwrap();
            assert_eq!(bob.decrypt(&envelope).unwrap(), plaintext.as_bytes());
        }
    }

    #[test]
    fn rt_server_visible_envelope_does_not_contain_plaintext() {
        let (_alice_store, _bob_store, alice, bob, _alice_id, bob_id) = pair();
        alice
            .establish_session(bob.publish_prekeys(2).unwrap())
            .unwrap();
        let sentinel = b"WHISPR-SERVER-BLINDNESS-SENTINEL-7b6ac1";
        let envelope = alice
            .encrypt(&bob_id.device_id, sentinel, &aad(77))
            .unwrap();
        let json = serde_json::to_vec(&envelope).unwrap();
        assert!(!json
            .windows(sentinel.len())
            .any(|window| window == sentinel));
        let frame = decode_b64(&envelope.ciphertext).unwrap();
        assert!(!frame
            .windows(sentinel.len())
            .any(|window| window == sentinel));
    }
}
