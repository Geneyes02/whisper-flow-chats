# Whispr — Data Map

Authoritative catalogue of what Whispr stores, where, and under what
protection. Any change to secret material MUST be reflected here in the
same commit.

Scope: this document covers the native desktop client's crypto host
(`desktop/src-tauri/crypto-host`). Web/browser storage is documented in
`docs/ARCHITECTURE.md`.

## Ground rules

1. Private identity keys, session secrets, and message keys **never** leave
   the crypto host process boundary.
2. Nothing above the crypto host is allowed to persist private material to
   ordinary application configuration files, log files, telemetry, crash
   reports, or Whispr Cloud.
3. Whispr Cloud only ever sees encrypted envelopes, encrypted attachments,
   routing metadata, and the minimum public key material required for
   delivery.
4. Fail-closed: if secure storage is unavailable, the host refuses to run.
   There is no plaintext fallback and no unencrypted config file fallback.

## Storage locations

### OS secure storage (`SecureStore` slots)

All persistent secret material lives in the OS keychain, namespaced under
service `app.whispr.desktop`. The backing store is selected by the
`keyring` crate at compile time:

| Platform | Backing store |
|----------|---------------|
| macOS    | Keychain Services (`SecKeychainItem`) |
| Windows  | Credential Manager (`CredWrite`/`CredRead`) |
| Linux    | Secret Service via D-Bus (GNOME Keyring / KWallet) |

Slots (see `crypto-host/src/keychain.rs`):

| Slot              | Contents |
|-------------------|----------|
| `DeviceIdentity`  | Sealed snapshot of the device identity keypair + registration metadata. Backend-defined payload. |
| `SessionDbKey`    | At-rest encryption key for the local session database (used by future backends that keep session state on disk). |
| `PrekeyStore`     | Sealed snapshot of one-time prekeys (private halves included). |
| `SessionStore`    | Sealed snapshot of per-peer sessions (ratchet state included). |

Each slot value is a JSON `Snapshot { version, backend, payload }` where
`payload` is opaque to the keychain layer and defined by the active
backend. Cross-backend or wrong-version snapshots are rejected as
`StorageCorrupt`.

### Local encrypted state (on-disk, outside the keychain)

Currently: **none**. The stub backend keeps only what fits in the keychain
slots above.

Future messaging backends that need a large session database (e.g. an
encrypted SQLite of ratchet state) will place it here. The database file
will be encrypted at rest with the key stored in `SessionDbKey`; the file
itself carries no plaintext key material.

### Whispr Cloud (Supabase)

Server-visible data only:

- Public identity keys and prekey bundles (for directory discovery).
- Encrypted message envelopes (`EncryptedEnvelope`) — ciphertext + routing
  metadata + protocol/version tags. No plaintext.
- Encrypted attachment blobs and encrypted attachment metadata.
- Routing metadata: sender/recipient device IDs, conversation IDs, message
  IDs, timestamps, delivery/read receipts.
- Account records (email, display name, membership).

Never stored server-side:

- Private identity keys.
- Private prekeys.
- Session/ratchet state.
- Attachment encryption keys.
- Plaintext message content or attachment content.

### In-memory only

- Decrypted plaintext (short-lived; returned to the caller and dropped).
- Backend runtime state between snapshot writes.
- Lock state (`LockState::{Locked,Unlocked}`).

Sensitive in-memory buffers use `zeroize` where the buffer's lifetime is
bounded and the compiler cannot elide the wipe.

## What we do NOT log

Under any circumstances:

- private keys of any kind
- session secrets, chain keys, root keys, ratchet state
- decrypted plaintext or attachment contents
- attachment encryption keys
- keychain payloads

Error messages crossing the WebView boundary are structured `WireError`
values with a stable code and a safe generic message string. Backend
internals (source chains, offsets, key material lengths) are dropped.

## Lifecycle transitions

`CryptoHost` moves between the states below. Every gate is checked before
the backend is invoked.

```
Uninitialized ──create_identity──▶ Provisioned ──revoke_device──▶ Revoked (terminal)
                                        │  ▲
                                     lock│  │unlock
                                        ▼  │
                                       Locked
```

- `logout()` / `wipe()` — deletes every keychain slot, rebuilds the backend
  from an empty store, returns to `Uninitialized`.
- `revoke_device()` — marks the device revoked. Terminal until wiped.
- `lock()` — refuses cryptographic operations with `StorageLocked`; does not
  drop persisted material. Reads of public identity remain permitted so the
  UI can render.
