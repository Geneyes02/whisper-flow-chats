# Whispr Desktop (Tauri wrapper)

This folder contains a minimal Tauri v2 wrapper that packages the published
Whispr web app as a native macOS `.dmg` (and, later, a Windows `.msi` when
you obtain a code signing certificate).

Tauri is preferred over Electron: the resulting `.dmg` is ~5 MB instead of
~120 MB, uses the system WebView, and starts instantly.

## What this ships

The wrapper loads `https://whisper-flow-chats.lovable.app` (or your custom
domain) in a native window. Updates to Whispr ship the moment you publish —
the desktop app pulls the latest web build on launch.

## Building locally (macOS)

Prerequisites:
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Xcode Command Line Tools (`xcode-select --install`)
- Node/Bun

```bash
cd desktop
bun install
bunx tauri build
```

The unsigned `.dmg` lands in `desktop/src-tauri/target/release/bundle/dmg/`.

## Shipping signed + notarized builds (GitHub Actions)

`.github/workflows/desktop-release.yml` in the repo root builds, signs, and
notarizes the Mac `.dmg` automatically when you push a tag like `v0.1.0`.

Add these repo secrets (Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Base64 of your Developer ID Application `.p12` — run `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | Password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | E.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com → Sign-in & Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character Team ID from developer.apple.com → Membership |
| `TAURI_SIGNING_PRIVATE_KEY` | (Optional) For auto-update signing — `bunx tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | (Optional) Password for the above |

To cut a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds a signed, notarized universal `.dmg` and attaches it to
a GitHub release. The `/download` page's `MAC_DMG_URL` points at
`releases/latest/download/Whispr.dmg` — update the `OWNER/REPO` placeholder
in `src/routes/download.tsx` once your GitHub repo exists.

## Windows

Windows builds are intentionally not enabled in the workflow yet. Without a
code signing certificate (~$200–500/yr) users see the SmartScreen
"unrecognized app" prompt. For now, Windows users install the PWA from the
`/download` page, which has zero warnings.

When you're ready to ship a signed `.exe`/`.msi`:
1. Buy an OV or EV code signing certificate (SSL.com, Sectigo, DigiCert).
2. Add `WINDOWS_CERTIFICATE` (base64 `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD` secrets.
3. Add a `windows-latest` matrix entry to the workflow.
