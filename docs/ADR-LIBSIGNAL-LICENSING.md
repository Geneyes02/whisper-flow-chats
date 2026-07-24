# ADR: libsignal licensing posture

**Status:** Draft — legal counsel review required before any change to build defaults.
**Date:** 2026-07-24
**Owners:** Whispr engineering.
**Blocks:** enabling the `backend-libsignal` Cargo feature in `desktop/src-tauri/crypto-host`.

> This document records what we know about libsignal's license and what
> Whispr's obligations *would* be if we shipped it. It deliberately does
> not draw legal conclusions. Anything requiring a lawyer is marked
> **UNRESOLVED — requires counsel**.

## 1. What library are we talking about

- Upstream: `signalapp/libsignal` (Rust core with FFI to Swift, Kotlin, Node).
- Crate we would consume from Whispr: `libsignal-protocol` (the Rust API for
  the Signal protocol: identity keys, prekeys, X3DH session establishment,
  Double Ratchet, Sealed Sender). We intentionally do not depend on the
  higher-level `libsignal-service` client, only the protocol core.
- License stated in the repository at the time of writing: **AGPL-3.0-only**.
  Some ancillary packages historically carried other terms; treat only the
  version we actually pin as authoritative.

## 2. What parts of Whispr would interact with libsignal

Direct interaction is confined to one Rust crate:

- `desktop/src-tauri/crypto-host/src/backend/libsignal.rs` — implements the
  `CryptoBackend` trait using libsignal types.

Every other part of Whispr — the TypeScript UI, the Tauri command shims,
the messaging layer, the server — communicates with libsignal only through
the `whispr_crypto_*` IPC command surface documented in
`desktop/src-tauri/src/commands.rs`.

Design intent: keep libsignal's linkage surface minimal and swappable, so
that whichever legal outcome we reach affects a single crate and never the
application code. This is why the trait exists.

## 3. The obligations AGPL-3.0 imposes (as we understand them)

Section references are to AGPL-3.0. This is a summary for engineering, not
legal advice.

1. **Source availability on distribution** (§4–§6). If we distribute a
   binary that includes AGPL-covered code, we must offer the corresponding
   Complete Corresponding Source under AGPL to the recipients of that
   binary.
2. **Source availability on network interaction** (§13). If users interact
   with a modified version over a network, we must offer them the
   Complete Corresponding Source. The Whispr desktop app is user-installed,
   not primarily network-served, but this clause could still be triggered
   by ancillary services.
3. **License compatibility of combined works** (§7, §13). Whatever we
   combine libsignal with must be distributable under AGPL-3.0 (or a
   compatible license — for AGPL-3.0 the compatible list is narrow). This
   is the tension: closed-source dependencies bundled into the desktop
   binary alongside libsignal would need scrutiny.
4. **Anti-DRM / anti-Tivoization** (§3, §6). If we sign the binary such
   that a user cannot install a modified version on the same hardware,
   §6's installation-information requirement applies to consumer products.

## 4. What we can architect around versus what is a legal question

**Architecture can address:**

- Keeping libsignal isolated to one crate behind a stable IPC surface
  (done — see `crypto-host`).
- Ensuring the Whispr application code has no direct dependency on
  libsignal types.
- Making the backend selectable at build time so a non-libsignal build is
  always available (done — the `backend-stub` build is the default and the
  CI-tested path).
- Publishing the corresponding source for the `crypto-host` crate as its
  own repository if we distribute a libsignal-linked build.

**Architecture cannot address:**

- Whether isolating libsignal in a separate process or a separately-licensed
  crate is sufficient to keep the rest of the Whispr desktop binary out of
  the AGPL-3.0 "combined work" scope. The FSF's historical position on
  dynamic linking, IPC, and process separation is not a safe harbor by
  itself. **UNRESOLVED — requires counsel.**
- Whether Whispr's own source (UI, server, marketing site) must be released
  under AGPL as a consequence of shipping a libsignal-linked desktop
  binary. **UNRESOLVED — requires counsel.**
- Whether a mobile app store distribution (Apple, Google) triggers
  additional obligations under §6 or §13. **UNRESOLVED — requires counsel.**
- Whether §13's network interaction clause applies to Whispr's server-side
  components even though they do not link libsignal. **UNRESOLVED —
  requires counsel.**

## 5. Distribution & source-availability obligations if we ship libsignal

Assuming §7/§13 apply as read:

- Publish the exact source revision of libsignal we build against, with any
  modifications, under AGPL-3.0.
- Publish the source of the `crypto-host` crate under an AGPL-3.0-compatible
  license.
- Publish build instructions sufficient to reproduce the shipped binary.
- Provide the AGPL-3.0 license text and copyright notices in every
  distribution channel (installer, DMG, MSIX, TestFlight builds, Play
  Store internal testing, etc.).
- Provide a written offer valid for at least three years for any binary
  distributed without accompanying source (§6).

Whether these obligations extend beyond `crypto-host` to the rest of the
Whispr application is exactly the §7 combined-work question flagged above.

## 6. Desktop implications

- macOS DMG (Tauri): AGPL obligations attach to the binary we sign and
  notarize. Notarization by Apple does not affect the license terms.
- Windows MSIX / NSIS installer (Tauri): same, plus §6's installation-
  information clause is worth reviewing for the case where we later ship
  signed, locked-down builds.
- Auto-update channels: distributing an update is a distribution event and
  triggers the same source-availability obligations.

## 7. Mobile implications

- iOS App Store: Apple's standard EULA has historically been considered
  incompatible with GPL-family licenses because it restricts redistribution
  of the app binary. Signal itself distributes on the App Store, so a path
  exists — likely via an additional grant by the copyright holder — but
  Whispr cannot assume that grant transfers to third parties. **UNRESOLVED
  — requires counsel.**
- Google Play: fewer per-user redistribution restrictions than iOS, but the
  same §6 / §13 questions apply. **UNRESOLVED — requires counsel.**
- Any distribution outside app stores (enterprise MDM, sideload, F-Droid)
  changes the calculus.

## 8. Server implications

The Whispr server does not link libsignal. It handles opaque prekey
bundles, opaque ciphertext envelopes, and public identity keys. This is
intentional so §13's "modified version over a network" language does not
attach to the server through libsignal — server code is a separate work
that communicates with libsignal-linked clients over a defined protocol.
Whether that is enough to keep the server out of the AGPL combined work is
**UNRESOLVED — requires counsel**.

## 9. Commercial licensing possibilities

Signal Messenger LLC holds the copyright on libsignal. Public statements
have said Signal does not routinely grant proprietary re-licensing. We
have **not** obtained any commercial-license offer, quote, or contact
confirmation. Anyone acting on the assumption that a commercial license is
available must verify that directly with Signal Messenger LLC.
**UNRESOLVED — requires counsel and a direct inquiry to Signal.**

## 10. Alternatives if proprietary distribution is required

If legal review concludes AGPL is unacceptable and no commercial license is
obtainable, the `CryptoBackend` seam lets us swap the implementation
without touching Whispr's UI or messaging layer. Candidates to evaluate:

- **MLS-only via `openmls`** (BSD-3-Clause-like license). MLS handles group
  messaging natively; 1:1 becomes a two-member group. Trade-off: MLS is
  younger in production than Double Ratchet, tooling for out-of-order and
  offline first-contact is less mature.
- **Olm / Megolm via `vodozemac`** (Apache-2.0). Matrix's Double Ratchet
  and group-ratchet implementations. Battle-tested across Matrix clients,
  license is permissive.
- **Custom X3DH + Double Ratchet + MLS composition** built from audited
  primitives (RustCrypto, `dalek`, `hpke-rs`). Highest engineering cost
  and highest audit burden — the position stated in our public security
  page is that we will not roll our own protocol without independent
  review. Only viable with a serious external audit budget.

Each alternative is a separate ADR when it becomes the leading candidate.

## 11. Interim engineering posture

Until this ADR reaches Accepted status:

- `backend-libsignal` is a Cargo feature and is **off** by default.
- The `LibsignalBackend::new` constructor refuses to instantiate — every
  method returns `Unsupported`. This guarantees no build accidentally
  links libsignal into a shipped artifact via a mis-set feature flag.
- CI compiles and tests only `backend-stub`.
- All Whispr application code depends on `whispr-crypto-host` and never on
  `libsignal-protocol` directly. Any PR that adds a direct `libsignal-*`
  import outside `crypto-host/src/backend/libsignal.rs` must be rejected.
- Public product surfaces continue to state that E2EE is not yet available
  on any Whispr platform, per `docs/ARCHITECTURE.md` and `/security`.

## 12. What has to happen before this ADR can move to Accepted

1. Legal counsel reviews §3–§8 above and answers each `UNRESOLVED` item.
2. If AGPL is accepted: publish source repositories for `crypto-host` and
   for the exact libsignal revision we pin, add AGPL notices to every
   distribution channel, add an offer-of-source page to the marketing site.
3. If commercial licensing is required: obtain a written offer from Signal
   Messenger LLC, executed before any libsignal-linked binary is shipped.
4. If neither works: pick an alternative from §10, open a new ADR, and
   swap the backend implementation. No Whispr application code changes.
