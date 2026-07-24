# OpenMLS Baseline — Whispr Phase B

Status: **Scaffolding only.** Whispr does NOT yet ship MLS-encrypted messages.
The public security label is unchanged: "encrypted in transit and at rest."

This document pins the exact dependency baseline Whispr's `openmls` backend
targets, so that any change to protocol version, ciphersuite, provider, or
audit posture is a deliberate, reviewable event.

## Version correction (supersedes prior 0.6.0 pin)

An earlier revision of this document pinned `openmls = 0.6.0`. That pin was
**wrong** and has been replaced. Reasoning:

- `0.6.0` was released **2024-09-04** and predates the SRLabs audit
  remediations by ~17 months.
- The public SRLabs disclosure (Phoenix R&D blog, 2026-05-27) states that
  fixes for 7 of 8 findings shipped in OpenMLS crate releases "8.1" and
  "7.3". OpenMLS is still on the `0.x` line and the disclosure used the
  shortened form. Those releases map to `openmls = 0.8.1` (2026-02-13) and
  `openmls = 0.7.3` (2026-02-13) on crates.io.
- `openmls = 0.8.1` is the newest stable at pin time. `0.7.4` (2026-03-02)
  is a maintenance-branch release on the older `0.7` line; new
  integrations should target `0.8.x`.

## Pinned dependencies

| Component               | Version   | Release date | Source    |
| ----------------------- | --------- | ------------ | --------- |
| `openmls`               | `= 0.8.1` | 2026-02-13   | crates.io |
| `openmls_rust_crypto`   | `= 0.5.1` | 2026-02-13   | crates.io |
| `openmls_traits`        | `= 0.5.0` | 2026-02-04   | crates.io |
| `tls_codec`             | `= 0.5.0` | 2026-07-13   | crates.io (transitive; resolved by lockfile) |

Exact resolved versions and content hashes are locked in
`desktop/src-tauri/Cargo.lock` once the `crypto-host CI` workflow runs
`cargo generate-lockfile --features openmls`. **The lockfile is the
source of truth for hashes**; this document only records the intended
top-line pins.

Upgrades require:
1. A new entry in this file with rationale.
2. Re-running the full `run_messaging_capabilities` conformance suite.
3. `cargo audit --deny warnings` clean against the new lockfile.
4. Re-checking the SRLabs audit-remediation matrix below.

## Cryptographic profile

- **Protocol**: MLS (RFC 9420).
- **Ciphersuite**: `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (0x0001).
  This is a MUST-support suite in RFC 9420 §17.1 and remains available in
  `openmls 0.8.1` as `Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_ED25519`.
- **Wire format**: `PrivateMessage` only. Whispr never emits `PublicMessage`;
  the `openmls` backend rejects the public wire format at the seam. This
  materially narrows the exposure of any residual membership-tag bug (see
  S3-7 below).
- **Provider**: `openmls_rust_crypto::OpenMlsRustCrypto` — pure-Rust
  (RustCrypto). Chosen over the libcrux provider to keep the supply-chain
  surface narrow.
- **KeyPackage lifetime**: 30 days (rotated eagerly on depletion).
- **Credential type**: `BasicCredential` bound to a Whispr device id.
  X.509 credentials are out of scope for Phase B.
- **`max_past_epochs`**: `0` for Phase B (no historical-epoch decryption).
  This neutralises the class of bug flagged in S2-2.

## OpenMLS feature flags

Enabled: default set on `openmls` 0.8.1.
Disabled: `test-utils`, `crypto-subtle`, any libcrux provider feature.
The exact feature set is recorded in `Cargo.lock` once the feature
compiles.

## SRLabs audit — remediation matrix

**Source of record.** SRLabs, *OpenMLS Security Assurance Assessment*
report v1.2 (2026-03-11), published on the OpenMLS blog on 2026-05-27:
<https://blog.openmls.tech/SRL-OpenMLS_security_assurance_assessment.pdf>.
Companion disclosure post:
<https://blog.phnx.im/openmls-independent-security-audit/>.
Local copy: `docs/audits/srlabs-openmls-2026-05.pdf` (to be committed on
next admin sync — the file is a public PDF and does not contain any
secret material).

The audit reports 8 findings: **1 High**, 3 Medium, 2 Low, 2
Informational. Per the Phoenix R&D disclosure, **7 of 8 shipped fixed in
`openmls` 0.8.1 / 0.7.3**; **1 Low remains under remediation** (S1-3,
"Acknowledged" in the report itself).

Legend for the "In 0.8.1?" column:
- **Yes** — SRLabs status is "Mitigated" and the fix released in a
  version ≤ 0.8.1 on the 0.8.x line (or in a 0.7.x line that was later
  merged into 0.8.x).
- **No** — SRLabs status is "Acknowledged" or "Risk Accepted"; behaviour
  in 0.8.1 is unchanged from the audited revision.

| # | SRLabs ID | Title | Severity | Affected component | Affected versions | First fixed OpenMLS release | GH advisory / commit evidence | In 0.8.1? | Applies to Whispr's chosen profile? | Whispr-side action | Current status |
|---|-----------|-------|----------|--------------------|-------------------|-----------------------------|-------------------------------|-----------|-------------------------------------|--------------------|----------------|
| 1 | S3-7 | MAC verification accepts truncated/empty tags (`membership_tag`, `confirmation_tag`; `Mac::eq` → `equal_ct` compared only `min(len(a),len(b))`) | **High** (CVSS v4 7.1; CWE-354) | `openmls` — `Mac::eq` / `equal_ct` used by membership + confirmation-tag verification | `openmls < 0.7.2` | **`openmls 0.7.2`** (2026-02-04); rolled forward into 0.8.0 (2026-02-04) and 0.7.3 (2026-02-13) | GH advisory **GHSA-8x3w-qj7j-gqhf** — <https://github.com/openmls/openmls/security/advisories/GHSA-8x3w-qj7j-gqhf>. Regression test added upstream (Appendix A PoC in SRLabs report; corresponding unit test in OpenMLS `mac` module). | **Yes** | **Reduced but not zero.** The advisory notes the bypass requires (a) `PublicMessage` wire format and (b) proposals-by-reference. Whispr uses `PrivateMessage` only, which removes the primary vector. Fix present regardless. | Keep the `PrivateMessage`-only invariant enforced at the seam (`openmls` backend rejects `PublicMessage`); add a conformance test that asserts the rejection. | Fixed in pinned version. |
| 2 | S2-5 | `MlsGroup.store()` does not check for `GroupID` collisions — creating an `MlsGroup` with a duplicate `GroupID` silently overwrites existing storage entries | Medium (CWE-694) | `openmls` — `MlsGroup::builder().build()` storage path | `openmls ≤ 0.7.1` (audited HEAD) | **`openmls 0.8.0`** (2026-02-04); backported to `0.7.3` (2026-02-13) | No dedicated GHSA; landed via the 0.8.0 audit-remediation batch (release notes for 0.8.0: *"This update includes critical security patches addressing vulnerabilities identified through external security research"*, <https://github.com/openmls/openmls/releases/tag/openmls-v0.8.0>). Upstream added a "duplicate `GroupID`" guard test as part of the mitigation. | **Yes** | Yes — Whispr generates `GroupID`s server-side and could plausibly see collisions if the server misbehaves. | Additionally, Whispr's device-local storage adapter treats duplicate-`GroupID` insertion as a hard error and surfaces it to the host lifecycle (never silently overwrites). Covered by conformance case `duplicate_group_id_rejected`. | Fixed in pinned version. |
| 3 | S2-2 | Past-epoch credential lookup may fail after tree updates — `leaf_node_index` (plain, includes blanks) indexes the condensed member vector stored with `MessageSecrets`, so out-of-order messages after a blank-creating commit either decrypt against the wrong credential or fail out-of-bounds | Medium (CWE-825) | `openmls` — `parse_message` / `MessageSecretsStore` path when `max_past_epochs > 0` | `openmls ≤ 0.7.1` | **`openmls 0.8.0`** (2026-02-04); backported to `0.7.3` | No dedicated GHSA; landed in the 0.8.0 audit batch. Upstream added a regression test derived from the SRLabs PoC (Appendix A, Alice/Bob/Charlie/David 4-member fork). | **Yes** | **No, structurally.** Whispr Phase B pins `max_past_epochs = 0`, which is the precondition for the bug. Retained for defence-in-depth if the setting ever changes. | Conformance test `max_past_epochs_is_zero` asserts the pin. If the pin changes in future, the S2-2 regression test must be re-run against the new configuration. | Fixed in pinned version, and not reachable in Whispr's configuration. |
| 4 | S2-6 | Clients joining an MLS group do not fully verify support for group extensions — a joining client can end up in a `GroupContext` whose extensions it does not implement | Medium | `openmls` — `Welcome`/join path | `openmls ≤ 0.7.1` | **`openmls 0.8.0`** (2026-02-04); backported to `0.7.3` | No dedicated GHSA; landed in the 0.8.0 audit batch. Upstream added a join-time "verify all `GroupContext` extensions are supported" check. | **Yes** | Yes — Whispr will support only a small, pinned extension set, but the check hardens against a malicious inviter advertising extensions the joiner does not implement. | Whispr's backend declares its supported extension set explicitly and refuses to join a group whose `GroupContext` requires any extension outside that set. | Fixed in pinned version. |
| 5 | S1-4 | Mismatches between documented and implemented status of validations (`validation.openmls.tech` vs the OpenMLS book vs the code) | Low (CWE-1059) | Documentation of validation checks across the crate | Documentation baseline audited alongside `openmls ≤ 0.7.1` | Documentation corrections landed alongside the **0.8.0** audit batch; SRLabs status recorded as "Mitigated" in the final report | No dedicated GHSA (documentation change); reflected in the validation dashboard and OpenMLS book updates around the 0.8.0 release. | **Yes** | No direct security impact on Whispr; matters only when we cross-reference validation behaviour to spec expectations. | Whispr's conformance suite asserts the specific validation behaviours it depends on (e.g. duplicate PSK-ID rejection) rather than trusting upstream documentation alone. | Fixed in pinned version. |
| 6 | **S1-3** | **Desync between group state and storage provider** — `merge_pending_commit`, `commit_to_pending_proposals`, `process_message`, `propose_self_update` mutate in-memory state even when the storage-provider write fails, leaving on-disk and in-memory state divergent | Low (CWE-460) | `openmls` — non-atomic in-memory ↔ storage-provider updates on the paths listed above | `openmls ≤ 0.7.1` (and, per developer comment in the SRLabs report, **still current at 0.8.1**) | **Not yet fixed upstream** — SRLabs status is "Acknowledged", not "Mitigated". Phoenix R&D disclosure confirms this is the one Low finding still under remediation at publication time. | No GHSA published. Upstream developer response (SRLabs §8.6): applications must currently use a storage provider that offers atomic writes (e.g. a SQLite transaction); multiple approaches to make the provider trait safer are being considered. | **No** — behaviour in 0.8.1 is unchanged. | **Yes.** Whispr's persistence path is exactly this shape. | **Required Whispr-side mitigation.** The `whispr-crypto-host` storage adapter wraps every state-changing OpenMLS call in an atomic transaction on the underlying store (SQLite in Tauri; equivalent single-write journaling for the in-memory test adapter). Failure of the storage write MUST cause the adapter to (a) not return success to `openmls`, (b) discard the in-memory `MlsGroup` handle, and (c) reload from the last-committed on-disk state. Covered by conformance cases `storage_write_failure_rolls_back_group_state` and `crash_between_process_and_persist_is_recoverable`. | **OPEN upstream, Whispr-side mitigated.** Tracked here until an upstream release marks S1-3 "Mitigated". Does not block Phase B lifecycle work under the current mitigation; does block any future removal of the storage-adapter transaction wrapper. |
| 7 | S0-1 | Unbounded allocations in `LeafNodePayload::UnknownExtension` can slow down / OOM group members (50 MiB PoC took ~4 s on a modern ThinkPad) | Informational (CWE-770) | `openmls` — `UnknownExtension` sizing in ratchet-tree leaves | All versions incl. 0.8.1 (spec-compliant behaviour) | **Not fixed** — SRLabs status is "Risk Accepted" per upstream developer comment: attacks of this shape manifest at the transport / deserialisation layer before OpenMLS sees them, and applications should size-limit incoming payloads themselves. | Upstream developer comment recorded in SRLabs §8.7. No code change; no GHSA. | **No** | Yes in principle — a malicious peer could publish a bloated `KeyPackage`. | Whispr enforces a hard cap on `KeyPackage` and `LeafNode` byte length at the delivery-service ingress *and* at the crypto-host `Envelope::validate` boundary before handing bytes to `openmls`. Cap is set in `whispr-crypto-host::limits` and covered by conformance case `oversized_keypackage_rejected`. | Risk accepted upstream; mitigated Whispr-side by size caps. |
| 8 | S0-8 | Small spec divergence in proposal-list validation — `validate_proposal_type_support` builds the capability intersection over *all* non-blank leaves, including members targeted by `Remove` proposals; RFC 9420 §12.2 (`valn0311`) says those members need not support the proposal type | Informational | `openmls` — `validate_proposal_type_support` | `openmls ≤ 0.7.1` | Correction landed in the **0.8.0** audit batch (2026-02-04); SRLabs status "Mitigated" | No GHSA (spec-compliance correction, no security impact identified). | **Yes** | No security impact; only affects commit acceptance in edge cases we do not exercise in Phase B. | None required. | Fixed in pinned version. |

### Findings that do NOT block Phase B

Findings 1–5, 7 and 8 are either fixed in the pinned `openmls = 0.8.1`
(#1, #2, #3, #4, #5, #8) or explicitly out of scope for the OpenMLS
library and mitigated in Whispr code (#7). None of them prevent
enabling the `backend-openmls` feature.

### Findings that DO gate later work

**Finding #6 (S1-3)** is OPEN upstream. Phase B lifecycle work may
proceed only under the storage-adapter transaction wrapper described in
the "Whispr-side action" column of that row. The two conformance cases
named there MUST be present and green before the milestone declared at
the top of this document is considered achieved. Removal or weakening of
that wrapper is not permitted while S1-3 remains upstream-open.

### Findings that do NOT apply to Whispr's audited surface

**Finding #3 (S2-2)** is structurally unreachable in Phase B because
Whispr pins `max_past_epochs = 0`. **Finding #1 (S3-7)** has a
significantly narrowed exposure because Whispr uses `PrivateMessage`
only. Both are noted here so a future configuration change re-opens the
review.

## Whispr's integration is separately unaudited

The audit covers OpenMLS itself. It does not cover:
- Whispr's Delivery Service / server-blindness properties.
- Whispr's KeyPackage publication and replacement flow.
- Whispr's group-state persistence and recovery (including the S1-3
  mitigation above).
- Whispr's membership-change authorization model.
- Whispr's envelope binding of `conversation_id`, `sender_device_id`,
  `message_id`, and protocol version.

Until Whispr's own integration is independently reviewed, the shipping
label MUST NOT claim "audited MLS" or equivalent. It may factually state
that the pinned OpenMLS release incorporates the SRLabs remediations
listed above.

## Dependency-audit workflow

`cargo audit`, `cargo deny` and the native builds cannot be executed
from Lovable's build sandbox — the desktop workspace has no toolchain
there. They run in the `crypto-host CI` GitHub Actions workflow, which:

1. Runs `cargo generate-lockfile` for the `openmls` feature.
2. Runs `cargo test -p whispr-crypto-host --all-features` (includes the
   backend-conformance suite).
3. Runs `cargo audit --deny warnings`.
4. Runs `cargo deny check licenses`, `cargo deny check bans`, and
   `cargo deny check sources` against the pinned `deny.toml`.
5. Builds `whispr-crypto-host` (and the crate's `openmls` feature) on
   macOS, Windows and Linux runners.
6. Uploads `Cargo.lock` as a build artifact so the exact resolved
   dependency graph (with content hashes) is preserved per commit.

**Phase B lifecycle work does not begin** if any of the following is
red on CI:

- `cargo audit --deny warnings`
- `cargo deny check licenses` / `bans` / `sources`
- native builds on any of the three targets
- host-invariant assertions in `whispr-crypto-host` tests
- the OpenMLS remediation baseline in this document cannot be
  established (i.e. an upstream advisory changes the status of any row
  above)
- the resolved dependency graph introduces an unresolved security
  advisory

## Backend selection

- Cargo feature: `backend-openmls` on the `whispr-crypto-host` crate.
- Workspace surface: `desktop/src-tauri/Cargo.toml` exposes
  `--features openmls` on the top-level `whispr-desktop` crate.
- Default build ships the deterministic `backend-stub` — no MLS types
  are linked into a default build.

## Non-goals for the baseline PR

- No MLS group lifecycle implementation.
- No `run_messaging_capabilities` assertions beyond the stub backend.
- No change to the Whispr Cloud schema.
- No change to the public security label.

The next PR wires credential + KeyPackage generation behind the
`CryptoBackend` seam, once CI is green against the pins above (including
`cargo audit`, `cargo deny`, and native builds on all three targets),
and the S1-3 storage-adapter mitigation is in place with its two
conformance cases passing.
