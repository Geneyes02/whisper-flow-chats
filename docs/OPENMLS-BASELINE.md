# OpenMLS Baseline — Whispr Phase B

Status: **Scaffolding only.** Whispr does NOT yet ship MLS-encrypted messages.
The public security label is unchanged: "encrypted in transit and at rest."

This document pins the exact dependency baseline Whispr's `openmls` backend
targets, so that any change to protocol version, ciphersuite, provider, or
audit posture is a deliberate, reviewable event.

## Pinned dependencies

| Component            | Version                 | Source                                  |
| -------------------- | ----------------------- | --------------------------------------- |
| `openmls`            | `= 0.6.0`               | crates.io                               |
| `openmls_rust_crypto`| `= 0.3.0`               | crates.io (RustCrypto provider)         |
| `openmls_traits`     | `= 0.3.0`               | crates.io                               |
| `tls_codec`          | `= 0.4`                 | crates.io                               |

The exact resolved versions are locked in `desktop/src-tauri/Cargo.lock`.
Upgrades require:
1. A new entry in this file with rationale.
2. Re-running the full `run_messaging_capabilities` conformance suite.
3. Re-checking the SRLabs audit scope table below.

## Cryptographic profile

- **Protocol**: MLS (RFC 9420).
- **Ciphersuite**: `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (0x0001).
- **Provider**: `openmls_rust_crypto::OpenMlsRustCrypto` — pure-Rust
  (RustCrypto). Chosen over the libcrux provider to avoid the second
  supply-chain surface until we have a specific reason to switch.
- **KeyPackage lifetime**: 30 days (rotated eagerly on depletion).
- **Credential type**: `BasicCredential` bound to a Whispr device id.
  X.509 credentials are out of scope for Phase B.

## OpenMLS feature flags

Enabled: (default set)
Disabled: `test-utils`, `crypto-subtle`, `libcrux-provider`.

## SRLabs audit scope

- **Audit**: SRLabs MLS/OpenMLS review (published 2024). Whispr does NOT
  yet have visibility into a 2026 remediation cycle referenced in the
  Phase B brief; when that report is public, this document must be updated
  with (a) its exact scope, (b) the OpenMLS version it covers, and (c) an
  explicit statement of which findings apply to the version pinned above.
- Until then, Whispr's shipping label MUST NOT claim "audited MLS
  implementation" and MUST NOT claim "post-remediation OpenMLS."
- **Whispr's integration is separately unaudited.** The audit covers
  OpenMLS itself. It does not cover:
  - Whispr's Delivery Service / server-blindness properties.
  - Whispr's KeyPackage publication and replacement flow.
  - Whispr's group-state persistence and recovery.
  - Whispr's membership-change authorization model.
  - Whispr's envelope binding of `conversation_id`, `sender_device_id`,
    `message_id`, and protocol version.

## Applicable findings tracker

| Finding | Status in pinned version | Whispr integration impact |
| ------- | ------------------------ | ------------------------- |
| _pending_ — populate when SRLabs 2026 report is public |||

## Backend selection

- Cargo feature: `backend-openmls` on the `whispr-crypto-host` crate.
- Workspace surface: `desktop/src-tauri/Cargo.toml` exposes
  `--features openmls` on the top-level `whispr-desktop` crate.
- Default build ships the deterministic `backend-stub` — no MLS types
  are linked into a default build.

## Non-goals for the baseline PR

- No MLS group lifecycle implementation.
- No `run_messaging_capabilities` assertions.
- No change to the Whispr Cloud schema.
- No change to the public security label.

The next PR wires credential + KeyPackage generation behind the
`CryptoBackend` seam, without changing the envelope wire format.
