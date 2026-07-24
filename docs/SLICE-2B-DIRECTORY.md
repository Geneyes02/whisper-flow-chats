# Slice 2B — MLS KeyPackage Directory

Server-side lifecycle for the OpenMLS KeyPackage pool. Complements the
in-Rust Slice 2 client-side lifecycle documented in
`../desktop/src-tauri/crypto-host/src/backend/openmls.rs`.

## Storage

| Table                                    | Purpose                                                                                          | Access                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `public.mls_key_packages`                | Active pool. **Public wire form only.** No private material.                                     | Owner SELECT via RLS. Writes RPC-only. |
| `public.mls_key_package_consumption_log` | Permanent ledger of every consumed hash. Row survives the source-row delete.                     | Service role only. Read/write RPC-only. |

## RPCs

- `publish_mls_key_packages(bundles jsonb)` — owner publishes. Enforces
  device ownership, device binding (`credential_identity == device_public_id`),
  server-side hash recomputation, expiry, and permanent-replay rejection
  (declines to reinsert a hash present in the consumption log).
- `consume_mls_key_package(target_user, target_device?)` — peer consumes ONE
  KeyPackage. Uses `FOR UPDATE SKIP LOCKED` + `DELETE` for atomic one-time
  semantics and logs the consumed hash. Rejects revoked devices.
- `mls_key_package_directory_status(device_id)` — owner-only remaining count
  so the client knows when to replenish.

## Replay defense — two layers

1. **Owner-local bounded consumed-hash history** (10,000 entries, in
   `PersistedKeyPackages.consumed_hashes_hex` on the Rust side). Fast local
   rejection when a peer replays a request for a KP whose private bundle
   the owner has already erased. Bounded so identity storage does not grow
   unbounded — this list is a **guard**, not the primary defense.
2. **Server-side permanent consumption ledger** (`mls_key_package_consumption_log`).
   Unbounded and never pruned. Guarantees that a consumed KeyPackage hash
   can never be published or re-consumed, even after eviction from the
   bounded local list, and even across owner-device restarts / snapshot
   restores. **This is the authoritative replay defense.**

Deletion terminology: when a `mls_key_packages` row is consumed we say it
is **removed from active persisted state** — not "securely deleted". The
underlying storage (Postgres heap, TOAST slices, WAL) may retain the bytes
for an indeterminate window. That is acceptable because the material was
public to begin with; the security-critical private bundle on the owner
device is what receives zeroization (see `openmls.rs`).

## Client-side substitution detection

`assertConsumedKeyPackageIntegrity()` in
`src/lib/mls-directory.functions.ts` recomputes SHA-256 over the returned
`key_package_b64` and rejects any response whose bytes do not hash to the
declared `key_package_hash`. Runs on every consume, before the bytes reach
the native MLS decoder.

This is a **cheap transport-layer sanity check**, not the primary defense
against substitution. The real defense is the credential signature over
the KeyPackage: OpenMLS on the native side validates the signature against
the device's Ed25519 credential identity, and any substitution by the
server that does not also forge that signature fails validation.

## Security-linter warnings we accept

The migration triggers linter warnings 3–10 (SECURITY DEFINER functions
executable by `authenticated`). These are structural: peer consumption of
a KeyPackage owned by another user cannot use RLS-INVOKER semantics
because the caller has no policy right to read the target row. This
matches the pre-existing `get_prekey_bundle` function used by the Signal-
style prekey path. The RPC bodies themselves enforce all authorization
checks (device ownership on publish, target-device validity on consume,
no cross-user reads exposed).
