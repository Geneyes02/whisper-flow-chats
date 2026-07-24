/**
 * LibsignalBridgeProvider — thin proxy to the Rust host over Tauri IPC.
 *
 * SECURITY CONTRACT
 * =================
 * Private key material NEVER enters JavaScript. Every session, encryption,
 * decryption, and identity operation happens in the Rust host process via
 * `@tauri-apps/api/core`'s `invoke("whispr_crypto_*", ...)`.
 *
 * This module ships in the web bundle too, but its constructor throws when
 * loaded outside a Tauri runtime — the provider registry only instantiates
 * it when `isTauriRuntime()` is true. That keeps a single import graph for
 * both browser and desktop builds without dragging Rust-only assumptions
 * into the browser.
 *
 * PHASE STATE
 * ===========
 * The command surface below matches what `desktop/src-tauri/src/crypto.rs`
 * will expose in Phase A. Until those commands are wired, every method
 * throws CryptoError('unsupported') so the UI fails closed. This is
 * intentional — no plaintext ever ships as a fallback.
 */

import {
  CryptoError,
  type Bytes,
  type CryptoCapabilities,
  type CryptoProvider,
  type DeviceIdentity,
  type EncryptedEnvelope,
  type PrekeyBundle,
  type SafetyNumber,
} from './types';

// Tauri v2 sets this global on WebView load. Feature-detect it; do NOT try
// to statically import `@tauri-apps/api` from browser-only code.
type TauriGlobal = { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as TauriGlobal;
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

/**
 * Lazy-load Tauri's `invoke`. Kept behind an async import so the browser
 * bundle never resolves `@tauri-apps/api/core` at module evaluation time.
 * If the module is unavailable, we throw a fail-closed CryptoError.
 */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new CryptoError(
      `Tauri IPC not available; cannot invoke ${cmd}`,
      'unsupported',
    );
  }
  try {
    // Runtime-only import. String is a variable so the web build's type
    // checker and bundler do not try to resolve `@tauri-apps/api/core`
    // (it's a desktop-only dep, added under `desktop/`, not this package).
    const tauriModuleId = '@tauri-apps/api/core';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ tauriModuleId);
    return (await mod.invoke(cmd, args)) as T;
  } catch (err) {
    // Never leak error internals — remap everything to unsupported so the
    // UI treats it as fail-closed.
    throw new CryptoError(
      `Tauri crypto command failed: ${cmd}`,
      err instanceof CryptoError ? err.code : 'unsupported',
    );
  }
}

export class LibsignalBridgeProvider implements CryptoProvider {
  readonly capabilities: CryptoCapabilities = {
    name: 'libsignal-bridge-v0',
    // Flipped to true only when the Rust host wires the corresponding
    // commands in Phase A/B and the adversarial test suite passes for
    // that capability. Stays false today so the UI honestly reports
    // "not yet available on this platform".
    supportsOneOnOne: false,
    supportsGroups: false,
    supportsCalls: false,
    supportsAttachments: true, // AES-256-GCM key derivation stays in JS
    audited: false,
  };

  constructor() {
    if (!isTauriRuntime()) {
      throw new CryptoError(
        'LibsignalBridgeProvider requires a Tauri runtime',
        'unsupported',
      );
    }
  }

  async createIdentity(): Promise<DeviceIdentity> {
    return tauriInvoke<DeviceIdentity>('whispr_crypto_create_identity');
  }

  async loadIdentity(): Promise<DeviceIdentity | null> {
    return tauriInvoke<DeviceIdentity | null>('whispr_crypto_load_identity');
  }

  async publishPrekeyBundle(count = 100): Promise<{
    identity: DeviceIdentity;
    signedPrekey: Bytes;
    signedPrekeySignature: Bytes;
    oneTimePrekeys: Array<{ keyId: number; publicKey: Bytes }>;
  }> {
    return tauriInvoke('whispr_crypto_publish_prekeys', { count });
  }

  async establishSession(bundle: PrekeyBundle): Promise<void> {
    await tauriInvoke('whispr_crypto_establish_session', { bundle });
  }

  async encryptMessage(
    recipientDeviceId: string,
    plaintext: Bytes,
    aad: Bytes,
  ): Promise<EncryptedEnvelope> {
    return tauriInvoke('whispr_crypto_encrypt', {
      recipientDeviceId,
      plaintext,
      aad,
    });
  }

  async decryptMessage(envelope: EncryptedEnvelope): Promise<Bytes> {
    return tauriInvoke('whispr_crypto_decrypt', { envelope });
  }

  async rotateSession(recipientDeviceId: string): Promise<void> {
    await tauriInvoke('whispr_crypto_rotate_session', { recipientDeviceId });
  }

  async verifyIdentity(peerPublicIdentityKey: Bytes): Promise<SafetyNumber> {
    return tauriInvoke('whispr_crypto_safety_number', { peerPublicIdentityKey });
  }

  async revokeDevice(): Promise<void> {
    await tauriInvoke('whispr_crypto_revoke_device');
  }
}
