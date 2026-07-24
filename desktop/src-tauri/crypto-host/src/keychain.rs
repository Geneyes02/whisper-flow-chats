//! OS keychain wrapper.
//!
//! Every persistent secret bytestring on the device goes through this
//! module. On macOS this is Keychain Services, on Windows the Credential
//! Manager, and on Linux the SecretService D-Bus API (GNOME Keyring / KWallet).
//!
//! We store *sealed blobs* here — the backend chooses the format (a
//! libsignal `IdentityKeyStore` snapshot, a serialized session store, an
//! at-rest encryption key for the session DB, etc.). The keychain treats
//! them as opaque strings.
//!
//! Failure modes:
//!   * Keychain locked / user denied access → `StorageLocked`
//!   * Entry missing → `Ok(None)` for reads, no-op for deletes
//!   * Any other backend error → `StorageCorrupt`
//!
//! Nothing in this module logs values. `Debug` is intentionally not
//! implemented on the secret payload.

use crate::error::{CryptoError, CryptoErrorCode, Result};

/// The service name registered in the OS keychain. All Whispr entries live
/// under this namespace.
pub const KEYCHAIN_SERVICE: &str = "app.whispr.desktop";

/// A logical secret slot. Not the raw account string — that's derived
/// deterministically from the slot so we can enumerate + rotate.
#[derive(Debug, Clone, Copy)]
pub enum Slot {
    /// The device identity keypair + registration metadata (serialized by
    /// the backend, opaque to this module).
    DeviceIdentity,
    /// The at-rest encryption key for the local session database.
    SessionDbKey,
    /// The prekey store snapshot.
    PrekeyStore,
    /// The session store snapshot.
    SessionStore,
}

impl Slot {
    fn account(self) -> &'static str {
        match self {
            Slot::DeviceIdentity => "device-identity",
            Slot::SessionDbKey   => "session-db-key",
            Slot::PrekeyStore    => "prekey-store",
            Slot::SessionStore   => "session-store",
        }
    }
}

/// The keychain interface. Kept as a trait so tests can substitute an
/// in-memory implementation without touching the real OS keychain.
pub trait SecureStore: Send + Sync {
    /// Read the current value for `slot`, if any.
    fn get(&self, slot: Slot) -> Result<Option<String>>;
    /// Write / overwrite the value for `slot`.
    fn put(&self, slot: Slot, value: &str) -> Result<()>;
    /// Delete the value for `slot`. Missing entries are not an error.
    fn delete(&self, slot: Slot) -> Result<()>;
}

/// Production `SecureStore` — the OS keychain via the `keyring` crate.
pub struct OsKeychain;

impl OsKeychain {
    /// Construct a new OS-backed keychain handle.
    pub fn new() -> Self { Self }

    fn entry(slot: Slot) -> Result<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, slot.account())
            .map_err(|_| CryptoError::new(
                CryptoErrorCode::StorageCorrupt,
                "keychain entry construction failed",
            ))
    }
}

impl Default for OsKeychain {
    fn default() -> Self { Self::new() }
}

impl SecureStore for OsKeychain {
    fn get(&self, slot: Slot) -> Result<Option<String>> {
        match Self::entry(slot)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(keyring::Error::PlatformFailure(_)) => Err(CryptoError::new(
                CryptoErrorCode::StorageLocked,
                "keychain platform failure",
            )),
            Err(_) => Err(CryptoError::new(
                CryptoErrorCode::StorageCorrupt,
                "keychain read failed",
            )),
        }
    }

    fn put(&self, slot: Slot, value: &str) -> Result<()> {
        Self::entry(slot)?.set_password(value).map_err(|e| match e {
            keyring::Error::PlatformFailure(_) => CryptoError::new(
                CryptoErrorCode::StorageLocked,
                "keychain platform failure",
            ),
            _ => CryptoError::new(CryptoErrorCode::StorageCorrupt, "keychain write failed"),
        })
    }

    fn delete(&self, slot: Slot) -> Result<()> {
        match Self::entry(slot)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(keyring::Error::PlatformFailure(_)) => Err(CryptoError::new(
                CryptoErrorCode::StorageLocked,
                "keychain platform failure",
            )),
            Err(_) => Err(CryptoError::new(
                CryptoErrorCode::StorageCorrupt,
                "keychain delete failed",
            )),
        }
    }
}

// -------- in-memory store used by tests and by the stub backend when the
// -------- OS keychain is unavailable (CI containers without a secret service).

/// Ephemeral in-memory `SecureStore`. Not for production use.
pub struct MemoryStore {
    inner: parking_lot::Mutex<std::collections::HashMap<&'static str, String>>,
}

impl MemoryStore {
    /// Empty store.
    pub fn new() -> Self {
        Self { inner: parking_lot::Mutex::new(std::collections::HashMap::new()) }
    }
}

impl Default for MemoryStore {
    fn default() -> Self { Self::new() }
}

impl SecureStore for MemoryStore {
    fn get(&self, slot: Slot) -> Result<Option<String>> {
        Ok(self.inner.lock().get(slot.account()).cloned())
    }
    fn put(&self, slot: Slot, value: &str) -> Result<()> {
        self.inner.lock().insert(slot.account(), value.to_string());
        Ok(())
    }
    fn delete(&self, slot: Slot) -> Result<()> {
        self.inner.lock().remove(slot.account());
        Ok(())
    }
}
