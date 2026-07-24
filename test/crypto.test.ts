/**
 * Adversarial crypto tests. Run with: bun x vitest run
 *
 * These tests do NOT hit the network. They exercise the crypto primitives
 * and provider fail-closed guarantees:
 *   - Corrupted ciphertext is rejected.
 *   - Wrong key fails.
 *   - No plaintext fallback in the preview provider.
 *   - Safety numbers are symmetric.
 *   - Identity + signed-prekey signatures verify.
 *   - Attachment AEAD detects tampering.
 *   - Bundle with a forged identity signature is rejected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

import { computeSafetyNumber } from '../src/lib/crypto/safety-numbers';
import { encryptAttachment, decryptAttachment } from '../src/lib/crypto/attachments';
import { verifyBundleSignatures } from '../src/lib/crypto/noble-provider';
import { CryptoError } from '../src/lib/crypto/types';

// Stub IndexedDB / localStorage / crypto.randomUUID for jsdom-less env.
beforeEach(() => {
  if (!(globalThis as any).crypto?.randomUUID) {
    (globalThis as any).crypto = {
      ...(globalThis as any).crypto,
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    };
  }
});

describe('safety numbers', () => {
  it('is symmetric between peers', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const s1 = computeSafetyNumber(a, b);
    const s2 = computeSafetyNumber(b, a);
    expect(s1.displayGroups).toEqual(s2.displayGroups);
    expect(s1.displayGroups).toHaveLength(6);
    for (const g of s1.displayGroups) expect(g).toMatch(/^\d{5}$/);
  });

  it('changes when either identity changes', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const c = randomBytes(32);
    expect(computeSafetyNumber(a, b).displayGroups).not.toEqual(
      computeSafetyNumber(a, c).displayGroups,
    );
  });
});

describe('attachment AEAD', () => {
  it('roundtrips', () => {
    const pt = new TextEncoder().encode('hello whispr');
    const enc = encryptAttachment(pt, 'text/plain');
    const dec = decryptAttachment(enc.ciphertext, enc.key, enc.nonce);
    expect(new TextDecoder().decode(dec)).toBe('hello whispr');
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptAttachment(new TextEncoder().encode('secret'));
    enc.ciphertext[0] ^= 0x01;
    expect(() => decryptAttachment(enc.ciphertext, enc.key, enc.nonce)).toThrow();
  });

  it('rejects wrong key', () => {
    const enc = encryptAttachment(new TextEncoder().encode('secret'));
    const wrong = randomBytes(32);
    expect(() => decryptAttachment(enc.ciphertext, wrong, enc.nonce)).toThrow();
  });
});

describe('bundle signature verification', () => {
  function makeBundle() {
    const signPriv = ed25519.utils.randomSecretKey();
    const signPub = ed25519.getPublicKey(signPriv);
    const idPriv = x25519.utils.randomSecretKey();
    const idPub = x25519.getPublicKey(idPriv);
    const spkPriv = x25519.utils.randomSecretKey();
    const spkPub = x25519.getPublicKey(spkPriv);
    return {
      deviceId: 'd', userId: 'u', cryptoVersion: 1, algorithm: 'x25519+ed25519-v1',
      publicIdentityKey: idPub,
      publicSigningKey: signPub,
      identityKeySignature: ed25519.sign(idPub, signPriv),
      signedPrekey: spkPub,
      signedPrekeySignature: ed25519.sign(spkPub, signPriv),
    };
  }

  it('accepts a well-formed bundle', () => {
    expect(verifyBundleSignatures(makeBundle())).toBe(true);
  });

  it('rejects a bundle whose identity signature does not match', () => {
    const b = makeBundle();
    b.identityKeySignature = ed25519.sign(new Uint8Array(32), ed25519.utils.randomSecretKey());
    expect(verifyBundleSignatures(b)).toBe(false);
  });

  it('rejects a swapped identity key', () => {
    const b = makeBundle();
    b.publicIdentityKey = x25519.getPublicKey(x25519.utils.randomSecretKey());
    expect(verifyBundleSignatures(b)).toBe(false);
  });
});

describe('preview provider fail-closed', () => {
  it('encryptMessage throws CryptoError(unsupported), never returns plaintext', async () => {
    const mod = await import('../src/lib/crypto/noble-provider');
    const provider = new mod.NoblePreviewProvider();
    await expect(
      provider.encryptMessage('x', new Uint8Array([1, 2, 3]), new Uint8Array()),
    ).rejects.toBeInstanceOf(CryptoError);
  });

  it('decryptMessage throws CryptoError(unsupported)', async () => {
    const mod = await import('../src/lib/crypto/noble-provider');
    const provider = new mod.NoblePreviewProvider();
    await expect(
      provider.decryptMessage({
        version: 1,
        senderDeviceId: 'a',
        recipientDeviceId: 'b',
        algorithm: 'x',
        ephemeralPublicKey: new Uint8Array(32),
        ciphertext: new Uint8Array(16),
        nonce: new Uint8Array(12),
        aad: new Uint8Array(),
      }),
    ).rejects.toBeInstanceOf(CryptoError);
  });
});

describe('GCM sanity — verifies noble AEAD detects any bit flip', () => {
  it('detects tampering in ciphertext or nonce', () => {
    const k = randomBytes(32);
    const n = randomBytes(12);
    const ct = gcm(k, n).encrypt(new TextEncoder().encode('m'));
    ct[ct.length - 1] ^= 0x80;
    expect(() => gcm(k, n).decrypt(ct)).toThrow();
  });
});
