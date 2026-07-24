# Whispr — Product & Platform Architecture

_Last updated: native-first pivot_

## Product split

Whispr is a **native privacy messenger with a supporting web platform**. It is
not a browser messenger. The web app exists to onboard, market, document,
and administer — it does not carry the primary secure conversation.

### Web (this repository, `src/routes/**`)

The web surface owns everything that does **not** require end-to-end
encrypted message content on-device:

- Marketing / landing (`/`)
- Pricing (section on `/`)
- Security documentation (`/security`)
- Privacy dashboard (`/_authenticated/privacy-dashboard`)
- Account management (`/_authenticated/settings`)
- Device & session management (`/_authenticated/devices`)
- Download links (`/download`)
- Community discovery (planned)
- Support, docs, status (planned)

The web surface **may** ship a "conversations preview" for demos and
onboarding, but that preview is **not E2EE** and must never be labeled as
such. The `/security` page publishes the authoritative platform matrix.

### Native clients

Whispr's messaging surfaces are:

| Client   | Runtime          | Primary crypto binding                                |
|----------|------------------|--------------------------------------------------------|
| macOS    | Tauri (Rust)     | `libsignal-client` Rust crate                          |
| Windows  | Tauri (Rust)     | `libsignal-client` Rust crate                          |
| Linux    | Tauri (Rust)     | `libsignal-client` Rust crate                          |
| iOS      | Swift + WebView  | Signal `LibSignalClient` Swift package (iOS 14+)       |
| Android  | Kotlin + WebView | Signal `libsignal-client` AAR (`org.signal:libsignal`) |

Native clients are the **only** surfaces that will eventually claim full
Whispr E2EE. They reuse Whispr's existing web UI (Tauri WebView / mobile
WebView) so the interface stays consistent, but private key material
never crosses into the WebView layer — see the crypto bridge below.

## Crypto provider abstraction

The web codebase already defines a **`CryptoProvider`** interface in
`src/lib/crypto/types.ts`. That interface stays. Every crypto call in the
Whispr UI goes through it; there is no direct call into a specific crypto
library from route or component code.

Providers registered today:

| Provider                | Runtime                      | Messaging | Purpose                                             |
|-------------------------|------------------------------|-----------|-----------------------------------------------------|
| `NoblePreviewProvider`  | Browser (any)                | **NO**    | Identity keys, safety numbers, attachment key derivation only. `encryptMessage` / `decryptMessage` throw `CryptoError('unsupported')`. |
| `LibsignalBridgeProvider` | Tauri / native WebView      | Planned   | Delegates every session/encrypt/decrypt op to the Rust host over `@tauri-apps/api/core`'s `invoke`. Private keys never enter JavaScript. |

Selection happens in `src/lib/crypto/provider-registry.ts`. Runtime detection
prefers the native bridge when `window.__TAURI_INTERNALS__` is present;
otherwise it returns the Noble preview provider with messaging disabled.

## Native crypto bridge (Tauri)

The bridge is a thin, one-directional contract:

```text
+--------------------------+       invoke("whispr_crypto_*", …)       +--------------------------+
|  Whispr UI (WebView)     | ---------------------------------------> |  Rust host process       |
|  LibsignalBridgeProvider |                                          |  libsignal-client crate  |
|                          | <---------------------------------------  |  OS secure key storage   |
|  opaque prekey bundles,  |         opaque bytes / errors            |  (macOS Keychain,        |
|  opaque ciphertext, ids  |                                          |   Windows DPAPI,         |
+--------------------------+                                          |   Linux SecretService)   |
                                                                       +--------------------------+
```

Contract rules:

1. **Private keys never leave Rust.** The bridge exposes only public
   material (identity pubkey, prekey bundles, ciphertext, envelope ids,
   safety-number groups). Private keys, session state, and MLS ratchets
   live in Rust-owned storage encrypted with OS-native primitives.
2. **Opaque handles.** Session identifiers passed across the bridge are
   opaque strings; the UI never inspects them.
3. **Fail-closed.** Any bridge error (missing session, prekey exhaustion,
   identity mismatch, protocol version mismatch) propagates as
   `CryptoError` with a specific code; the UI does not retry with
   weaker crypto and never sends plaintext as a fallback.
4. **No plaintext logs.** The Rust host must not log plaintext,
   decrypted payloads, or key material. UI logs are already stripped of
   message content.
5. **Signed IPC surface.** The Tauri allowlist exposes only the
   `whispr_crypto_*` commands; no arbitrary command invocation.

### Command surface (planned — Phase A/B)

```rust
// desktop/src-tauri/src/crypto.rs (planned)

#[tauri::command] async fn whispr_crypto_register_device(user_id: String) -> Result<PublicIdentity, BridgeError>;
#[tauri::command] async fn whispr_crypto_publish_prekeys(count: u32) -> Result<PrekeyBundle, BridgeError>;
#[tauri::command] async fn whispr_crypto_establish_session(peer_bundle: PrekeyBundle) -> Result<SessionHandle, BridgeError>;
#[tauri::command] async fn whispr_crypto_encrypt(peer_device_id: String, plaintext: Vec<u8>, aad: Vec<u8>) -> Result<Envelope, BridgeError>;
#[tauri::command] async fn whispr_crypto_decrypt(envelope: Envelope) -> Result<Vec<u8>, BridgeError>;
#[tauri::command] async fn whispr_crypto_safety_number(peer_identity: Vec<u8>) -> Result<SafetyNumber, BridgeError>;
#[tauri::command] async fn whispr_crypto_revoke_device() -> Result<(), BridgeError>;
```

All types are `serde`-serialized as opaque byte arrays or short structs.
`BridgeError` maps 1:1 to `CryptoError.code`.

## Delivery phases

| Phase | Scope                                                                                       | Surfaces         |
|-------|---------------------------------------------------------------------------------------------|------------------|
| **A** | Tauri runtime detection · native secure key storage · libsignal bridge · device provisioning · prekey publishing · session persistence | Desktop (Tauri)  |
| **B** | Real 1:1 encrypted exchange · offline first contact · ratcheting · multi-device sessions · identity-change warnings · safety-number verification · device revocation | Desktop, then mobile |
| **C** | Client-side encrypted attachments · encrypted media metadata · secure local media cache      | Desktop, then mobile |
| **D** | MLS group messaging (RFC 9420)                                                              | Desktop, then mobile |
| **E** | WebRTC voice/video with client-side SFrame media keys; SFU/TURN see only opaque packets     | Desktop, then mobile |

Each phase changes public security claims **only** when the capability
demonstrably works on the target platform and has passed the adversarial
test suite in `test/crypto.test.ts`.

## What web deliberately does NOT do

- **Message encryption.** `NoblePreviewProvider` fails closed. Any browser
  "chat preview" is transport-encrypted only and must carry an inline
  "Not end-to-end encrypted — use the desktop app" affordance.
- **Silent downgrade.** If a conversation was created on a native client
  (E2EE), the web surface will not offer to continue it in plaintext.
  It shows a "Open in Whispr for macOS / Windows / iOS / Android" state.
- **Key custody.** The web app never receives or stores libsignal private
  keys, MLS ratchets, or per-device long-lived identity secrets used for
  encryption. It may cache the *public* half for display (safety numbers,
  device management UI) — nothing more.

## Repository layout (native-first)

```text
src/                       Web + shared UI (React, TanStack Start)
  lib/crypto/              CryptoProvider interface + browser-safe helpers
    types.ts                 The contract every provider implements
    provider-registry.ts     Runtime detection + selection (native > browser)
    noble-provider.ts        Browser: identity + safety numbers ONLY
    libsignal-bridge.ts      Tauri: proxy to Rust host; browser build throws
    attachments.ts           Per-file AES-256-GCM (client-side)
    safety-numbers.ts        Deterministic 30-digit fingerprints
    local-store.ts           Encrypted IndexedDB (public material + wrapped keys)

desktop/                   Tauri v2 desktop wrapper
  src-tauri/
    src/
      main.rs                Tauri entrypoint
      crypto.rs              (planned Phase A) libsignal command surface
      storage.rs             (planned Phase A) OS keychain integration
    tauri.conf.json          IPC allowlist scoped to whispr_crypto_*
  README.md                  Local build + signing + notarization

mobile/                    (planned) iOS + Android shells
  ios/                       Swift + WKWebView + LibSignalClient
  android/                   Kotlin + WebView + libsignal AAR

docs/
  ARCHITECTURE.md            This file
  E2EE-ROADMAP.md            Protocol choices + acceptance criteria
  E2EE-RUNTIME-INVESTIGATION.md   Why libsignal cannot run in the browser
  BACKEND.md                 Database schema, RLS, envelope tables
```

## Open decisions (tracked, not resolved)

1. **License:** `libsignal-client` is AGPL-3.0. Native clients that link
   it fall under AGPL unless a commercial license is negotiated with
   Signal. The web app does not link it and is unaffected.
2. **Group protocol:** MLS via `openmls` (Rust) is the default plan.
   Re-evaluation happens at the start of Phase D against Wire
   `core-crypto` (audited WASM if a browser group path ever ships).
3. **Push notifications:** Push payloads MUST NOT contain plaintext or
   decrypted metadata beyond "you have a new message." Rich previews are
   generated on-device after decryption, never server-side.
