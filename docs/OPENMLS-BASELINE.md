# OpenMLS Baseline — Whispr Phase B

Status: **Scaffolding only.** Whispr does NOT yet ship MLS-encrypted messages.
The public security label is unchanged: "encrypted in transit and at rest."

This document pins the exact dependency baseline Whispr's `openmls` backend
targets, so that any change to protocol version, ciphersuite, provider, or
audit posture is a deliberate, reviewable event.

## Version correction (supersedes prior 0.6.0 pin)

An earlier revision of this document pinned `openmls = 0.6.0`. That pin was
**wrong** and has been replaced. Reasoning:

- `0.6.0` was released **2024-09-04** and predates the May 2026 SRLabs
  audit remediations by ~17 months.
- The SRLabs disclosure references remediations landing in OpenMLS crate
  versions "8.1" and "7.3". OpenMLS is still on the `0.x` line; the audit
  used the shortened form. Those releases map to `openmls = 0.8.1`
  (2026-02-13) and `openmls = 0.7.3` (2026-02-13) on crates.io.
- `openmls = 0.8.1` is the newest stable at pin time and is on the active
  release line. `0.7.4` (2026-02-17) is a maintenance-branch release on
  the older `0.7` line; new integrations should target `0.8.x`.

## Pinned dependencies

Data verified against `https://crates.io/api/v1/crates/<name>` on
2026-07-24.

| Component               | Version   | Release date | Source    |
| ----------------------- | --------- | ------------ | --------- |
| `openmls`               | `= 0.8.1` | 2026-02-13   | crates.io |
| `openmls_rust_crypto`   | `= 0.5.1` | 2026-02-13   | crates.io |
| `openmls_traits`        | `= 0.5.0` | 2026-02-04   | crates.io |
| `tls_codec`             | `= 0.5.0` | 2026-07-13   | crates.io (transitive; resolved by lockfile) |

Exact resolved versions and content hashes are locked in
`desktop/src-tauri/Cargo.lock` once `cargo generate-lockfile --features openmls`
runs in the `crypto-host CI` workflow. **The lockfile is the source of
truth for hashes**; this document only records the intended top-line pins.

Upgrades require:
1. A new entry in this file with rationale.
2. Re-running the full `run_messaging_capabilities` conformance suite.
3. `cargo audit --deny warnings` clean against the new lockfile.
4. Re-checking the SRLabs audit-remediation matrix below.

## Cryptographic profile

- **Protocol**: MLS (RFC 9420).
- **Ciphersuite**: `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (0x0001).
  This ciphersuite is a MUST-support suite in RFC 9420 §17.1 and remains
  present in `openmls 0.8.1` (`Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_ED25519`).
  Verify with `openmls::prelude::Ciphersuite` at build time.
- **Provider**: `openmls_rust_crypto::OpenMlsRustCrypto` — pure-Rust
  (RustCrypto). Chosen over the libcrux provider to keep the supply-chain
  surface narrow. `openmls_libcrux_crypto = 0.3.1` is an available
  alternative but not selected for Phase B.
- **KeyPackage lifetime**: 30 days (rotated eagerly on depletion).
- **Credential type**: `BasicCredential` bound to a Whispr device id.
  X.509 credentials are out of scope for Phase B.

## OpenMLS feature flags

Enabled: (default set on `openmls` 0.8.1)
Disabled: `test-utils`, `crypto-subtle`, any libcrux provider feature.
The exact feature set will be recorded in `Cargo.lock` once the feature
compiles; this document is updated in the same PR that enables it.

## SRLabs audit — remediation matrix

The May 2026 SRLabs disclosure reports 8 findings against OpenMLS, 7 of
which were fixed in `0.8.1` / `0.7.3` and 1 low-severity finding
outstanding at disclosure time.

**Evidence still to be attached before this baseline is considered
verified.** Fabricating a per-finding fix-commit table without the actual
SRLabs report and the OpenMLS security advisories / release notes in hand
would defeat the point of this document. The rows below are placeholders
with the exact fields required.

| # | Severity | Finding (SRLabs id + title) | Fixed in | Fix commit / GH advisory | Applies to `openmls = 0.8.1`? | Whispr integration impact |
|---|----------|-----------------------------|----------|---------------------------|-------------------------------|---------------------------|
| 1 | _tbd_    | _tbd_ (SRLabs report URL required) | 0.8.1 / 0.7.3 | _tbd_ | _tbd_ | _tbd_ |
| 2 | _tbd_    | _tbd_ | 0.8.1 / 0.7.3 | _tbd_ | _tbd_ | _tbd_ |
| 3 | _tbd_    | _tbd_ | 0.8.1 / 0.7.3 | _tbd_ | _tbd_ | _tbd_ |
| 4 | _tbd_    | _tbd_ | 0.8.1 / 0.7.3 | _tbd_ | _tbd_ | _tbd_ |
| 5 | _tbd_    | _tbd_ | 0.8.1 / 0.7.3 | _tbd_ | _tbd_ | _tbd_ |
| 6 | _tbd_    | _tbd_ | 0.8.1 / 0.7.3 | _tbd_ | _tbd_ | _tbd_ |
| 7 | _tbd_    | _tbd_ | 0.8.1 / 0.7.3 | _tbd_ | _tbd_ | _tbd_ |
| 8 | Low      | _tbd_ (outstanding low-severity finding) | **unfixed at disclosure** | n/a | _tbd_ | _tbd_ |

Required to close out the matrix (block on Whispr side, not OpenMLS side):

1. Attach the SRLabs report (URL + archived copy) to this repo under
   `docs/audits/srlabs-openmls-2026-05.pdf`.
2. Cross-reference each finding to a GitHub commit or security advisory
   under `https://github.com/openmls/openmls/security/advisories` /
   `https://github.com/openmls/openmls/releases`.
3. Confirm the remaining low-severity finding's status against the
   current `main` branch and `0.8.x` release notes.
4. If any finding remains applicable to `0.8.1`, document a Whispr-side
   mitigation OR reject the version and re-pin.

Until the table is populated, Whispr's shipping label MUST NOT claim
"post-remediation OpenMLS," MUST NOT claim "audited MLS implementation,"
and MUST NOT enable the `openmls` feature in a shipped build.

**Whispr's integration is separately unaudited.** The audit covers
OpenMLS itself. It does not cover:
- Whispr's Delivery Service / server-blindness properties.
- Whispr's KeyPackage publication and replacement flow.
- Whispr's group-state persistence and recovery.
- Whispr's membership-change authorization model.
- Whispr's envelope binding of `conversation_id`, `sender_device_id`,
  `message_id`, and protocol version.

## Dependency-audit workflow

`cargo audit` and license checks cannot be executed from Lovable's build
sandbox — the desktop workspace has no toolchain there. They run in the
`crypto-host CI` GitHub Actions workflow, which:

1. Runs `cargo generate-lockfile` for the `openmls` feature.
2. Runs `cargo audit --deny warnings`.
3. Runs `cargo deny check licenses bans sources` against the pinned
   `deny.toml`.
4. Uploads `Cargo.lock` as a build artifact so the exact resolved
   dependency graph (with content hashes) is preserved per commit.

Any red result gates Phase B lifecycle work — the messaging code does not
land until the audit step is green against the pinned versions above.

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
`CryptoBackend` seam, once the audit-remediation matrix above is fully
populated and `cargo audit` is green on CI.
