/**
 * Runtime provider selection.
 *
 * Whispr is native-first for messaging. This registry picks the correct
 * CryptoProvider for the current runtime:
 *
 *   Tauri desktop / native WebView -> LibsignalBridgeProvider (Phase A+)
 *   Browser / Workers              -> NoblePreviewProvider (identity + safety
 *                                     numbers only; messaging fails closed)
 *
 * The rest of the app imports `getCryptoProvider()` — never a specific
 * provider class directly. This is the ONLY place that decides.
 */

import type { CryptoProvider } from './types';
import { NoblePreviewProvider } from './noble-provider';
import { LibsignalBridgeProvider, isTauriRuntime } from './libsignal-bridge';

export type RuntimeKind = 'tauri' | 'browser' | 'ssr';

export function detectRuntime(): RuntimeKind {
  if (typeof window === 'undefined') return 'ssr';
  if (isTauriRuntime()) return 'tauri';
  return 'browser';
}

let cached: CryptoProvider | null = null;

/**
 * Get the CryptoProvider for the current runtime. Cached per session.
 *
 * IMPORTANT: on the server (SSR) this throws. Crypto operations must never
 * run during SSR — call from useEffect, event handlers, or after hydration.
 */
export function getCryptoProvider(): CryptoProvider {
  if (cached) return cached;
  const runtime = detectRuntime();
  if (runtime === 'ssr') {
    throw new Error(
      'getCryptoProvider() called during SSR. Crypto must run client-side only.',
    );
  }
  cached = runtime === 'tauri'
    ? new LibsignalBridgeProvider()
    : new NoblePreviewProvider();
  return cached;
}

/**
 * True when the current runtime can perform real E2EE message encryption.
 * The UI uses this to decide whether to show the composer as active or as
 * "Open Whispr for macOS/Windows/iOS/Android to send end-to-end encrypted".
 */
export function isMessagingCapableRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return getCryptoProvider().capabilities.supportsOneOnOne;
  } catch {
    return false;
  }
}

/** For tests. */
export function __resetProviderCacheForTests(): void {
  cached = null;
}
