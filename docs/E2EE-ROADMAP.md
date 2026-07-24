# Whispr E2EE Roadmap

Target architecture — hybrid, per-surface. No protocol handles every feature; no
surface silently downgrades to transport-only encryption.

## Guarantees never shipped without independent review

Any code that changes the "Current status" line on `/security` must land with:

1. Independent cryptographic review of the added component.
2. Migration plan documented (how existing plaintext-in-transit messages coexist).
3. A published test vector suite covering the primitives.
4. A "refuse to send" fallback for keys that can't be resolved — never a
   downgrade path.

## Phase 1 — libsignal for 1:1 chats

**Primitive:** X3DH + Double Ratchet via the `libsignal-protocol-typescript` port
(or the official WASM build once packaged).

**Server changes:**
- `devices.identity_public_key` (Curve25519), `devices.signed_prekey`,
  `devices.signed_prekey_sig`, `devices.one_time_prekeys[]` (topped up on login).
- `message_envelopes` per-recipient-device fan-out (already present in schema).

**Client changes:**
- Generate identity keypair on first login. Private key stored in IndexedDB,
  origin-scoped, per-device. Never leaves the device.
- Publish public bundle to the server on sign-in.
- On send: fetch peer devices' prekey bundles, run X3DH, encrypt per device.
- On receive: subscribe to envelopes for each of my devices, decrypt with the
  ratchet session, GC one-time prekeys.

**UI:**
- Safety-number screen (60-digit fingerprint, derived from both users'
  identity keys). Verify out-of-band.
- Per-conversation lock icon reflecting real session state.

**Exit criteria:** two devices on separate accounts exchange messages that a
DB dump cannot decrypt.

## Phase 2 — MLS for group chats

**Primitive:** RFC 9420 (Messaging Layer Security) via `mls-rs` compiled to
WASM, or `openmls` when a stable WASM build exists.

**Server changes:**
- Key package store per user.
- Ratcheted commit / welcome message delivery.

**Client changes:**
- Group state machine per group, persisted in IndexedDB.
- Add/remove members via MLS commits — not by re-sharing a group key.

**Exit criteria:** removing a member instantly cuts them off from future
messages without re-encrypting existing history.

## Phase 3 — WebRTC calls with SFrame

**Primitive:** WebRTC Encoded Transform (Insertable Streams) + SFrame media
encryption. SFU/TURN routes packets; keys stay on peers.

**Client changes:**
- Per-call ephemeral keys derived from the Signal/MLS session.
- Frame-level authenticated encryption before the encoder emits packets.

**Exit criteria:** an SFU with logged frames cannot recover any media.

## Phase 4 — Client-side attachment encryption

**Primitive:** AES-256-GCM with keys derived from the conversation session.

**Server changes:**
- `chat-media` bucket restricted to opaque `application/octet-stream` blobs
  with random object names.

**Client changes:**
- Encrypt file → upload ciphertext → send only the key + object handle inside
  the E2EE message.
- Decrypt on download.

**Exit criteria:** an operator with full Storage access sees only ciphertext.

## Non-negotiables

- No new schema, code, or UI copy asserts E2EE before its phase ships.
- Every phase ships behind a versioned protocol tag so old clients can be
  refused rather than downgraded.
- `/security` and `/privacy-dashboard` are the single source of truth for
  what's live today.
