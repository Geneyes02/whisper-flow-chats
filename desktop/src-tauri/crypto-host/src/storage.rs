//! Persistence architecture for identity, prekeys, and sessions.
//!
//! Layering:
//!
//!   1. The BACKEND (stub, libsignal, …) owns the in-memory representation
//!      of identity keys, prekeys, and per-peer sessions.
//!   2. On every mutation it serializes an opaque snapshot to a
//!      [`SecureStore`](crate::keychain::SecureStore) slot. The keychain
//!      wraps this at rest with OS-level protection.
//!   3. On startup the backend restores its state by reading those slots
//!      back through [`SecureStore`].
//!
//! This module defines the storage *architecture* — the slot layout, the
//! snapshot envelope format, and helpers to load/save snapshots. The
//! concrete serde types inside each snapshot are backend-private.
//!
//! Note: no file I/O happens here. The keychain is the only sink.

use serde::{Deserialize, Serialize};

use crate::error::{CryptoError, CryptoErrorCode, Result};
use crate::keychain::{SecureStore, Slot};

/// Version tag for on-disk snapshots. Bumped on any breaking change to a
/// backend's snapshot format so old snapshots can be rejected explicitly
/// instead of silently misinterpreted.
pub const SNAPSHOT_VERSION: u16 = 1;

/// Wrapper written into the keychain. The backend serializes its own
/// payload to JSON and hands the string to `Snapshot::save`.
#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    /// Snapshot envelope version.
    pub version: u16,
    /// Backend that produced this snapshot (`"stub-v0"`, `"libsignal-v1"`).
    pub backend: String,
    /// Opaque payload (backend-defined, base64/JSON as the backend chooses).
    pub payload: String,
}

impl Snapshot {
    /// Serialize + persist a snapshot into `slot`.
    pub fn save(store: &dyn SecureStore, slot: Slot, backend: &str, payload: String) -> Result<()> {
        let snap = Snapshot {
            version: SNAPSHOT_VERSION,
            backend: backend.to_string(),
            payload,
        };
        let json = serde_json::to_string(&snap)
            .map_err(|_| CryptoError::internal("snapshot serialize"))?;
        store.put(slot, &json)
    }

    /// Load and validate a snapshot from `slot`. Returns `Ok(None)` when
    /// the slot is empty. Returns `StorageCorrupt` when the snapshot is
    /// present but unreadable or was produced by a different backend.
    pub fn load(
        store: &dyn SecureStore,
        slot: Slot,
        expected_backend: &str,
    ) -> Result<Option<Snapshot>> {
        let Some(raw) = store.get(slot)? else {
            return Ok(None);
        };
        let snap: Snapshot = serde_json::from_str(&raw)
            .map_err(|_| CryptoError::new(CryptoErrorCode::StorageCorrupt, "snapshot parse"))?;
        if snap.version != SNAPSHOT_VERSION {
            return Err(CryptoError::new(
                CryptoErrorCode::StorageCorrupt,
                "snapshot version mismatch",
            ));
        }
        if snap.backend != expected_backend {
            return Err(CryptoError::new(
                CryptoErrorCode::StorageCorrupt,
                "snapshot backend mismatch",
            ));
        }
        Ok(Some(snap))
    }

    /// Delete a snapshot slot. Missing entries are not an error.
    pub fn clear(store: &dyn SecureStore, slot: Slot) -> Result<()> {
        store.delete(slot)
    }
}
