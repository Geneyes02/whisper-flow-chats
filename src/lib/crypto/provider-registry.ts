/**
 * Runtime provider selection.
 *
 * Whispr is native-first for messaging:
 *
 *   Tauri desktop / native WebView -> NativeMlsBridgeProvider
 *   Browser / Workers              -> NoblePreviewProvider (identity + safety
 *                                     numbers only; messaging fails closed)
 */

import type { CryptoProvider } from './types';
import { NoblePreviewProvider } from './noble-provider';
import { NativeMlsBridgeProvider, isTauriRuntime } from './libsignal-bridge';

export type RuntimeKind = 'tauri' | 'browser' | 'ssr';

export function detectRuntime(): RuntimeKind {
  if (typeof window === 'undefined') return 'ssr';
  if (isTauriRuntime()) return 'tauri';
  return 'browser';
}

let cached: CryptoProvider | null = null;

/**
 * Get the provider for the current runtime. Crypto operations are forbidden
 * during SSR and browser messaging never silently falls back from native MLS.
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
    ? new NativeMlsBridgeProvider()
    : new NoblePreviewProvider();
  return cached;
}

/** True only when the selected provider has passed its production message gate. */
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
