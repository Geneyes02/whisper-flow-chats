# E2EE Runtime Investigation — libsignal in Whispr

_Written before Phase 2. Informs the native-first pivot._

## Question

Can Whispr use the official Signal libsignal implementation to deliver real
1:1 end-to-end encryption today, in the runtimes Whispr currently ships to?

## Runtimes Whispr targets

| Runtime                | Native module loading | libsignal availability                        |
|------------------------|-----------------------|-----------------------------------------------|
| Browser (Chromium, WebKit, Gecko) | No                    | **None official.** No WASM build published by Signal. |
| Cloudflare Workers (server)       | No                    | No. Workers has `nodejs_compat` but not native addon loading. |
| Node.js (dev/CI)                  | Yes (N-API)           | `@signalapp/libsignal-client` — prebuilt binaries per platform. |
| Tauri desktop (Rust host)         | Yes (Rust crate)      | `libsignal-client` crate (source of the Node bindings). |
| iOS (Swift)                       | Yes                   | `LibSignalClient` Swift package. Signal-published. |
| Android (Kotlin/Java)             | Yes                   | `org.signal:libsignal-android` AAR. Signal-published. |

## What Signal publishes

- **`@signalapp/libsignal-client`** (npm) — Node.js only. Ships `.node`
  addons via N-API for `darwin-x64`, `darwin-arm64`, `linux-x64`,
  `linux-arm64`, `win32-x64`. AGPL-3.0.
- **`libsignal-client`** (Rust crate) — the source. AGPL-3.0.
- **`LibSignalClient`** (Swift package) and **`libsignal-android`** (AAR).
- **No `libsignal-web`, no WASM.** Signal has consistently declined to
  ship a browser build. Signal Desktop uses Electron so it can load the
  Node addon.

## What Signal has archived / does not maintain

- **`libsignal-protocol-javascript`** — archived on GitHub in 2020. It
  implements an older protocol revision. Signal has been explicit that
  it should not be used for new work. Whispr will not adopt it.
- Community WASM rebuilds of `libsignal-client` exist as
  proof-of-concept forks. None are Signal-published, none are audited,
  none receive security fixes. Shipping one would be the
  "security theatre" pattern Whispr's design rules forbid.

## Runtime constraint analysis for Whispr

### Browser
- **APIs available:** WebCrypto (AES-GCM, ECDH P-256 / X25519, ECDSA,
  HKDF), plus `@noble/curves` for X25519/Ed25519. Sufficient for identity
  keys, safety numbers, and attachment-key derivation.
- **Native bindings:** Not possible.
- **Bundle constraint:** even a hypothetical WASM libsignal would add
  several megabytes to the initial bundle and would still lack an audit.
- **Verdict:** Whispr cannot ship libsignal in the browser. The web
  surface must remain non-messaging-capable for E2EE purposes.

### Cloudflare Workers (Whispr's TanStack server)
- Server functions run in `workerd`. `nodejs_compat` provides polyfills
  for many Node built-ins but not native addon loading. `.node` files
  cannot be `require`d.
- Whispr's server never has plaintext anyway; it only stores opaque
  envelopes. libsignal on the server is not a design goal.
- **Verdict:** Not applicable. The server does not need libsignal.

### Tauri desktop (`desktop/`)
- Rust host process. Adding the `libsignal-client` crate to
  `desktop/src-tauri/Cargo.toml` is straightforward.
- Prebuilt binaries are not required — Cargo compiles the crate at
  Tauri build time. GitHub Actions workflow already builds signed +
  notarized macOS `.dmg` (Phase already scaffolded).
- IPC surface is the constraint: private keys stay in Rust, only opaque
  bytes cross the WebView boundary.
- **Verdict:** Viable. This is Whispr's Phase A target.

### iOS
- Swift Package Manager can pull `LibSignalClient`. Requires iOS 14+.
- **Verdict:** Viable when mobile shell is scaffolded (post-Phase B).

### Android
- Gradle dependency: `org.signal:libsignal-android:<version>`.
- **Verdict:** Viable when mobile shell is scaffolded (post-Phase B).

## Licensing implications

`libsignal-client` is **AGPL-3.0**. Linking it into a distributed binary
requires that binary's source to be AGPL-3.0 as well, unless Whispr
negotiates a commercial license from Signal Messenger, LLC.

Impact by surface:

- **Web (this repo, browser + Workers):** No libsignal linked. **Unaffected.**
  The web app can remain under Whispr's chosen license.
- **Tauri desktop:** Links `libsignal-client` (Rust). The desktop binary
  falls under AGPL-3.0 unless commercially licensed.
- **iOS/Android:** Same as desktop.

Whispr acknowledges this trade-off explicitly in `docs/ARCHITECTURE.md`
under "Open decisions" and will surface it in the desktop `README.md`
before the first signed build ships libsignal linkage.

## Alternatives considered

| Option                                    | Browser | Audit                      | Fit for Whispr                                      |
|-------------------------------------------|---------|----------------------------|-----------------------------------------------------|
| Official `libsignal-client` (Rust/native) | No      | Yes (Signal, ongoing)      | **Chosen** for native clients (Phase A/B/C).       |
| Archived `libsignal-protocol-javascript`  | Yes     | Stale; abandoned           | Rejected. Explicitly forbidden by Whispr rules.    |
| Third-party WASM rebuild of libsignal     | Yes     | None                       | Rejected. Would ship unaudited crypto.             |
| Rebuild Signal protocol in-house          | Both    | None                       | Rejected. Never invent a replacement protocol.     |
| MLS (`openmls`) for 1:1                   | Native + WASM | Yes (Wire, RustCrypto) | Group-first; less deniability than Signal for 1:1. Kept as Phase D primary, re-evaluated at Phase D start. |
| Sealed-box (libsodium)                    | Yes     | Yes (libsodium)            | No forward secrecy. Not acceptable for a messenger claiming Signal-level guarantees. |

## Conclusion

Official libsignal cannot run in Whispr's browser or Workers runtime, and
no maintained, audited browser build exists. Whispr's response is the
native-first pivot documented in `docs/ARCHITECTURE.md`:

1. The **CryptoProvider** interface stays. Every crypto call in Whispr
   routes through it.
2. **`NoblePreviewProvider`** remains the browser provider, with
   `encryptMessage` / `decryptMessage` continuing to throw
   `CryptoError('unsupported')`. Identity keys and safety numbers still
   work in the browser for account/device management surfaces.
3. **`LibsignalBridgeProvider`** is added as the Tauri/native provider.
   It proxies every session operation to the Rust host via
   `@tauri-apps/api/core`'s `invoke`. Private keys never enter JS.
4. The web `/security` page publishes the current platform E2EE matrix
   and updates only when a phase actually ships.

Whispr does not label a surface "end-to-end encrypted" until the
capability actually works on that surface and has passed the adversarial
test suite.
