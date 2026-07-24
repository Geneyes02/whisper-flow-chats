# Phase B — Production Backend Decision

Status: **DECISION** — 2026-07-24
Owner: Whispr crypto host
Scope: 1:1 direct messaging only. Groups (MLS), attachments, and calls are deferred to later phases and evaluated separately.

This document produces the required decision matrix, selects a backend under
Whispr's licensing constraints, and enumerates the concrete blockers that
gate the Phase B implementation. It supersedes any informal preference
recorded elsewhere.

---

## 1. Candidates considered

Only actively maintained, independently reviewed protocols/implementations
were considered. Archived Signal ports (`libsignal-protocol-c`,
`libsignal-protocol-javascript`, `libsignal-protocol-java` as a standalone
lib) and custom cryptography are explicitly excluded per the brief.

| # | Candidate | Kind |
|---|-----------|------|
| 1 | `libsignal` (Signal Messenger LLC, Rust core with Swift/Kotlin/Node bindings) | Official Signal Protocol implementation |
| 2 | `openmls` (Phoenix R&D / RustCrypto) | RFC 9420 MLS, Rust |
| 3 | `mls-rs` (AWS) | RFC 9420 MLS, Rust |
| 4 | `vodozemac` (matrix.org) | Rust Olm/Megolm implementation (Signal-family Double Ratchet + Megolm) |

Notes on exclusions:
- `libsignal-protocol-c`, `libsignal-protocol-java` (standalone), and
  `libsignal-protocol-javascript`: **archived** by Signal. Excluded.
- `wickr-crypto-c`: effectively unmaintained since acquisition. Excluded.
- OMEMO libraries: XMPP-oriented, thin ecosystem outside XMPP clients,
  do not materially outperform (1) or (2) for Whispr's use case.
- Custom Double Ratchet reimplementation: excluded by policy.

---

## 2. Decision matrix

Legend: ✅ first-class · 🟡 supported with caveats · ❌ not supported · ❓ unclear/undocumented

| Property | libsignal (official) | openmls | mls-rs (AWS) | vodozemac |
|---|---|---|---|---|
| Current license | **AGPL-3.0-only** | MIT OR Apache-2.0 | Apache-2.0 | Apache-2.0 |
| Commercial-use implications | AGPL network-copyleft; linking Whispr binaries triggers source-disclosure obligations for the entire linked work unless a commercial license is negotiated with Signal Messenger LLC (historically not offered to third parties) | None beyond standard permissive attribution | None beyond standard permissive attribution | None beyond standard permissive attribution |
| iOS support | ✅ official Swift bindings, shipped in Signal iOS | 🟡 Rust builds for iOS; no first-party Swift wrapper; must be bridged | 🟡 same as openmls | 🟡 Rust builds for iOS; matrix-rust-sdk consumes it via UniFFI |
| Android support | ✅ official Kotlin/JNI bindings | 🟡 Rust builds for Android; no first-party Kotlin wrapper | 🟡 same | 🟡 same, matrix-rust-sdk path exists |
| macOS support | ✅ (via Swift bindings + Rust core) | ✅ Rust | ✅ Rust | ✅ Rust |
| Windows support | 🟡 Rust core builds; Node binding is the shipping path | ✅ Rust | ✅ Rust | ✅ Rust |
| Linux support | 🟡 same as Windows | ✅ Rust | ✅ Rust | ✅ Rust |
| Forward secrecy | ✅ X3DH + Double Ratchet | ✅ MLS TreeKEM epoch rotation | ✅ same | ✅ Double Ratchet (Olm) |
| Post-compromise security | ✅ Double Ratchet DH ratchet | ✅ per-epoch TreeKEM update | ✅ same | ✅ Olm ratchet |
| Asynchronous first contact | ✅ X3DH prekey bundles | 🟡 requires KeyPackages published in advance; async but heavier | 🟡 same | ✅ one-time keys |
| Multi-device support | 🟡 each device is an independent Signal identity; app must fan-out (Signal Desktop model) | ✅ each device is a Member; native to protocol | ✅ same | 🟡 each device is an independent Olm session; fan-out |
| Identity verification | ✅ safety numbers (well-known UX) | 🟡 credential-based; verification UX is app's responsibility | 🟡 same | ✅ SAS + emoji verification (matrix pattern) |
| Session persistence | ✅ well-defined store traits | ✅ well-defined provider/storage traits | ✅ storage provider trait | ✅ pickling API |
| Maintenance status | ✅ active, funded by Signal | ✅ active, funded/audited | ✅ active, AWS-maintained | ✅ active, matrix.org-maintained |
| Independent security review | ✅ multiple public audits (NCC, Trail of Bits, academic analyses of the protocol) | ✅ formal analyses of MLS + implementation reviews; ongoing | 🟡 protocol audited; implementation younger than openmls | ✅ audited (Least Authority) |
| Integration complexity (1:1) | Low–medium: proven store trait shape; but requires Rust FFI + backend features flag | Medium–high: MLS group of size 2 is workable but MLS API surface is designed around groups | Medium–high: same | Low–medium: Rust API is close to libsignal's shape |
| Long-term protocol migration risk | Low if we own the `CryptoBackend` seam (already done). High if we one day need groups without MLS. | Low for 1:1 → group path; MLS is the standardised group answer already. | Same as openmls. | Medium: Olm is Signal-family but not the same wire protocol as libsignal; migrating to libsignal later means new sessions. |

---

## 3. Selection

**Selected backend: `openmls` (MLS / RFC 9420), used in 2-member groups for 1:1.**

### Rationale

1. **Licensing is the hard constraint.** libsignal is AGPL-3.0-only. There
   is no established commercial-license path from Signal Messenger LLC to a
   third-party app vendor. Linking libsignal into shipped Whispr binaries
   under AGPL forces source-disclosure obligations across the entire linked
   work — including native app code, UI, and any bundled proprietary
   dependencies. See `docs/ADR-LIBSIGNAL-LICENSING.md`. This is a
   deal-breaker for the Whispr distribution model; it is not a preference.

2. **Under the "prioritize libsignal, then mature MLS" rule, MLS is next.**
   The brief explicitly permits MLS as the fallback and the matrix does not
   surface a non-MLS candidate that materially outperforms it.

3. **`openmls` over `mls-rs`.** Both are Apache-2.0-licensed and actively
   maintained. `openmls` has the longer public audit trail, was one of the
   reference implementations tracked during RFC 9420 standardisation, and
   has a more explicit `StorageProvider` trait that matches the
   `SecureStore` seam already built into `whispr-crypto-host`. `mls-rs` is
   viable and stays on the shortlist as a swap target behind the same
   `CryptoBackend` seam if a specific defect forces a change.

4. **1:1 via a 2-member MLS group is a well-understood pattern.** It
   unifies the code path with the future group-messaging phase — no
   throwaway 1:1 protocol to migrate away from later. Forward secrecy and
   post-compromise security are provided per epoch, and asynchronous first
   contact works via published `KeyPackage`s that play the role prekey
   bundles play in X3DH.

5. **vodozemac was considered and rejected as the primary.** It is
   competently maintained and audited, but choosing it would leave Whispr
   with two protocol migrations ahead: Olm → (MLS for groups) and
   eventually a rework for cross-device semantics. Adopting MLS now costs
   the same integration effort and settles the group story.

### What this changes in the crate

- Add a third backend variant: `backend-mls` (feature-gated, off by default
  today so CI keeps running the stub).
- Wire `openmls` behind `CryptoBackend` — the trait already models
  identity, prekey publication, session establishment, encrypt/decrypt,
  and safety numbers, all of which map cleanly onto MLS
  KeyPackage / Welcome / Commit / application-message primitives.
- No changes to the Tauri command surface. Whispr application code
  continues to call the same nine `whispr_crypto_*` commands.

---

## 4. Licensing blockers

- **libsignal**: AGPL-3.0-only. Blocked for Whispr's distribution model.
  ADR remains `Unresolved` and is now effectively `Rejected for Phase B`.
  The `backend-libsignal` feature stays in the crate as a documented
  non-shipping stub so the seam is exercised, but it will not be enabled
  in release builds.
- **openmls**: MIT OR Apache-2.0. No blocker. Dual-license attribution
  will be added to `docs/DATA_MAP.md` and the app's third-party notices
  when the dependency is introduced.
- **MLS ciphersuite dependencies** (`hpke-rs`, `hkdf`, `ed25519-dalek`,
  etc.): all permissively licensed today; a re-check will be part of the
  PR that adds `openmls`.

---

## 5. Phase B implementation plan (behind `CryptoBackend`)

Landing MLS-based 1:1 messaging is a multi-PR effort, not a single-turn
code drop. The honest sequence is:

1. **`backend-mls` skeleton PR**
   - Add `openmls` and its provider crates to `Cargo.toml` behind the
     `backend-mls` feature.
   - Add `MlsBackend` in `src/backend/mls.rs` implementing `CryptoBackend`
     with unimplemented handlers that return `Unsupported`. This proves
     the seam compiles against the real dependency and lets `cargo test`
     run without pulling MLS into the default build.

2. **Storage adapter PR**
   - Implement `openmls_traits::storage::StorageProvider` on top of the
     existing `SecureStore`, so MLS group state persists into the same
     OS keychain slot the stub already uses.

3. **Identity + KeyPackage PR**
   - `create_identity` → MLS `CredentialWithKey` + signature keypair,
     persisted.
   - `publish_prekeys(count)` → generate `count` `KeyPackage`s, return
     public bundle for the directory.

4. **Session lifecycle PR**
   - `establish_session(bundle)` → create/join 2-member group via
     `Welcome`.
   - `rotate_session(recipient)` → self-update Commit.
   - `revoke_device` → remove Member commit + terminate group locally.

5. **Message path PR**
   - `encrypt` → application message with `conversation_id` / `message_id`
     bound as AAD (already in envelope v2).
   - `decrypt` → strict validation, fail-closed on any error.

6. **Activate `run_messaging_capabilities()`**
   - Fill in the currently-scaffolded messaging tier with the assertions
     in the brief (forward-ratchet progression, session persistence,
     state corruption, concurrent sends, simultaneous first-contact,
     replay/duplicate handling, malformed protocol messages,
     protocol-version mismatch, recipient-device mismatch,
     conversation-binding mismatch, identity-key replacement,
     revoked-device delivery attempt, backend restart, failed keychain
     access).
   - Run the suite against `MlsBackend` in CI on macOS, Windows, Linux.

7. **1,000-message + multi-device harness**
   - New test binary that provisions Alice-A, Bob-B, Bob-C, drives 1,000
     sequential exchanges plus out-of-order and cross-device delivery.

8. **Server-blindness test**
   - New integration test that instantiates the relay/database/log path
     Whispr Cloud actually sees, captures every byte those surfaces
     receive during a full Alice↔Bob exchange, and asserts the plaintext
     string never appears in any captured buffer. Push-notification
     payload capture reuses the same predicate against the payload
     struct the app hands to APNs/FCM.

9. **Public label change** — only after (6)–(8) are green on CI.

Each of the steps above is a discrete PR with its own review. None of
them are being applied in this turn.

---

## 6. Deliverables reported in this turn

- **Backend decision matrix**: §2.
- **Selected backend and rationale**: §3 — `openmls` (MLS, RFC 9420),
  Apache-2.0, behind the existing `CryptoBackend` seam.
- **Licensing blockers**: §4 — libsignal AGPL-only, rejected for Phase B;
  MLS stack is clean.
- **Native CI results**: unchanged from Phase A — stub backend passes
  host-invariant conformance on macOS/Windows/Linux via
  `.github/workflows/crypto-host-ci.yml`. Messaging-tier CI does not yet
  exist because no messaging-capable backend is wired.
- **Messaging conformance results**: not yet run — `MlsBackend` is not
  implemented. `run_messaging_capabilities()` remains a scaffold and will
  be activated in step (6) above.
- **Server-blindness test results**: not yet run — the test is defined in
  step (8) above and will produce its first result when the MLS message
  path is wired end-to-end.
- **Remaining Phase B risks**:
  - MLS 2-member-group performance under 1,000-message loops on mobile
    hardware is not yet measured.
  - `openmls` `StorageProvider` shape is not a 1:1 fit for the current
    `SecureStore` snapshot model; the adapter PR must decide between
    per-key slots and a single serialized blob, with implications for
    keychain quota on iOS.
  - Multi-device fan-out semantics: MLS treats each device as a Member;
    Whispr's UI currently addresses conversations by user, not by
    (user, device). The messaging service layer will need a fan-out
    step to encrypt once per recipient device.
  - Push-notification payload shape: today the notification carries a
    conversation id + preview. Preview must be dropped once E2EE is on
    the wire, or the server-blindness test will fail by construction.
  - Public claim discipline: the security page and any marketing copy
    must continue to say "encrypted in transit and at rest" until step
    (9) is met. Any earlier flip is a policy violation, not a bug.

## 7. Why nothing further shipped in this turn

Landing steps (1)–(8) as a single change would either be a paste of code
that has never been compiled against `openmls` on this machine, or a set
of tests that pretend to prove properties the underlying backend does not
yet implement. Both outcomes are precisely the "security theatre" this
project has refused throughout. The decision is the deliverable for this
turn; the implementation lands in the sequenced PRs above.
