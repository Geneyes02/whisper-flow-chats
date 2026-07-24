/**
 * NoblePreviewProvider — Phase 1 crypto provider.
 *
 * WHAT'S REAL (shippable today):
 *   - X25519 identity keypair per device (encryption)
 *   - Ed25519 signing keypair per device (long-lived, signs identity + prekeys)
 *   - Signed prekey + rotation
 *   - One-time prekey pool
 *   - Encrypted local persistence (see local-store.ts)
 *   - Deterministic safety numbers + QR payload
 *   - Device revocation wipes local key material
 *
 * WHAT'S DELIBERATELY NOT IMPLEMENTED HERE:
 *   - X3DH + Double Ratchet sessions
 *   - Message encrypt/decrypt
 *
 * Reason: the user directive forbids substituting a homemade Signal protocol.
 * `establishSession/encryptMessage/decryptMessage/rotateSession` therefore
 * fail-closed with CryptoError('unsupported'). The messaging layer surfaces
 * this as "E2EE session unavailable — please wait for the libsignal
 * integration" and refuses to fall back to plaintext.
 *
 * When libsignal (or an audited MLS-1:1 mode) lands, a new provider
 * implements the full interface and swaps in without any callers changing.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import {
  CryptoError,
  type CryptoCapabilities,
  type CryptoProvider,
  type DeviceIdentity,
  type EncryptedEnvelope,
  type PrekeyBundle,
  type SafetyNumber,
} from './types';
import { LocalStore } from './local-store';
import { computeSafetyNumber } from './safety-numbers';
import { utf8 } from './encoding';

const ALGO = 'x25519+ed25519-v1';
const CRYPTO_VERSION = 1;

interface StoredIdentity {
  deviceId: string;
  devicePublicId: string;
  algorithm: string;
  cryptoVersion: number;
  publicIdentityKey: string;    // base64
  privateIdentityKey: string;   // base64  (X25519 secret; NEVER leaves this device)
  publicSigningKey: string;     // base64
  privateSigningKey: string;    // base64  (Ed25519 seed; NEVER leaves this device)
  identityKeySignature: string; // base64
  createdAt: number;
}

interface StoredSignedPrekey {
  keyId: number;
  publicKey: string;   // base64
  privateKey: string;  // base64
  signature: string;   // base64
  createdAt: number;
}

interface StoredOneTimePrekey {
  keyId: number;
  publicKey: string;
  privateKey: string;
  createdAt: number;
}

const K_IDENTITY = 'identity';
const K_SPK     = 'signed-prekey';
const K_OTPKS   = 'one-time-prekeys';

import { toBase64, fromBase64 } from './encoding';

async function loadStoredIdentity(): Promise<StoredIdentity | null> {
  return LocalStore.getJSON<StoredIdentity>(K_IDENTITY);
}

export class NoblePreviewProvider implements CryptoProvider {
  readonly capabilities: CryptoCapabilities = {
    name: 'noble-preview-v1',
    supportsOneOnOne: false, // fail-closed until libsignal ships
    supportsGroups: false,
    supportsCalls: false,
    supportsAttachments: true, // handled by attachments.ts, not sessions
    audited: false,
  };

  async createIdentity(): Promise<DeviceIdentity> {
    const existing = await loadStoredIdentity();
    if (existing) return this.hydrate(existing);

    const idPriv = x25519.utils.randomSecretKey();
    const idPub = x25519.getPublicKey(idPriv);
    const signPriv = ed25519.utils.randomSecretKey();
    const signPub = ed25519.getPublicKey(signPriv);
    const idKeySig = ed25519.sign(idPub, signPriv);

    // Server issues UUIDs; until we round-trip, generate a client id that is
    // replaced on first successful registration.
    const deviceId = crypto.randomUUID();
    const devicePublicId = toBase64(randomBytes(9)).replace(/[+/=]/g, '');

    const stored: StoredIdentity = {
      deviceId,
      devicePublicId,
      algorithm: ALGO,
      cryptoVersion: CRYPTO_VERSION,
      publicIdentityKey: toBase64(idPub),
      privateIdentityKey: toBase64(idPriv),
      publicSigningKey: toBase64(signPub),
      privateSigningKey: toBase64(signPriv),
      identityKeySignature: toBase64(idKeySig),
      createdAt: Date.now(),
    };
    await LocalStore.setJSON(K_IDENTITY, stored);
    return this.hydrate(stored);
  }

  async loadIdentity(): Promise<DeviceIdentity | null> {
    const s = await loadStoredIdentity();
    return s ? this.hydrate(s) : null;
  }

  /** Called by messaging layer once the server assigns a real device UUID. */
  async bindServerDeviceId(serverDeviceId: string): Promise<void> {
    const s = await loadStoredIdentity();
    if (!s) throw new CryptoError('no identity', 'no_identity');
    s.deviceId = serverDeviceId;
    await LocalStore.setJSON(K_IDENTITY, s);
  }

  async publishPrekeyBundle(count = 25) {
    const identity = await this.loadIdentity();
    if (!identity) throw new CryptoError('no identity', 'no_identity');

    // Rotate signed prekey if older than 7 days.
    const raw = await LocalStore.getJSON<StoredSignedPrekey>(K_SPK);
    const s = await loadStoredIdentity();
    if (!s) throw new CryptoError('no identity', 'no_identity');
    const signPriv = fromBase64(s.privateSigningKey);

    let spk: StoredSignedPrekey;
    const week = 7 * 24 * 3600 * 1000;
    if (!raw || Date.now() - raw.createdAt > week) {
      const priv = x25519.utils.randomSecretKey();
      const pub = x25519.getPublicKey(priv);
      spk = {
        keyId: (raw?.keyId ?? 0) + 1,
        publicKey: toBase64(pub),
        privateKey: toBase64(priv),
        signature: toBase64(ed25519.sign(pub, signPriv)),
        createdAt: Date.now(),
      };
      await LocalStore.setJSON(K_SPK, spk);
    } else {
      spk = raw;
    }

    const otpks =
      (await LocalStore.getJSON<StoredOneTimePrekey[]>(K_OTPKS)) ?? [];
    const nextId = (otpks[otpks.length - 1]?.keyId ?? 0) + 1;
    const fresh: StoredOneTimePrekey[] = [];
    for (let i = 0; i < count; i++) {
      const priv = x25519.utils.randomSecretKey();
      fresh.push({
        keyId: nextId + i,
        publicKey: toBase64(x25519.getPublicKey(priv)),
        privateKey: toBase64(priv),
        createdAt: Date.now(),
      });
    }
    await LocalStore.setJSON(K_OTPKS, [...otpks, ...fresh]);

    return {
      identity,
      signedPrekey: fromBase64(spk.publicKey),
      signedPrekeySignature: fromBase64(spk.signature),
      oneTimePrekeys: fresh.map((k) => ({
        keyId: k.keyId,
        publicKey: fromBase64(k.publicKey),
      })),
    };
  }

  async establishSession(_bundle: PrekeyBundle): Promise<void> {
    throw new CryptoError(
      'E2EE session establishment requires libsignal; preview provider does not implement a substitute protocol.',
      'unsupported',
    );
  }

  async encryptMessage(
    _recipientDeviceId: string,
    _plaintext: Uint8Array,
    _aad: Uint8Array,
  ): Promise<EncryptedEnvelope> {
    throw new CryptoError(
      'Encryption unavailable in preview provider (no plaintext fallback).',
      'unsupported',
    );
  }

  async decryptMessage(_envelope: EncryptedEnvelope): Promise<Uint8Array> {
    throw new CryptoError(
      'Decryption unavailable in preview provider.',
      'unsupported',
    );
  }

  async rotateSession(_recipientDeviceId: string): Promise<void> {
    throw new CryptoError('Sessions not implemented in preview.', 'unsupported');
  }

  async verifyIdentity(peerPublicIdentityKey: Uint8Array): Promise<SafetyNumber> {
    const me = await this.loadIdentity();
    if (!me) throw new CryptoError('no identity', 'no_identity');
    return computeSafetyNumber(me.publicIdentityKey, peerPublicIdentityKey);
  }

  async revokeDevice(): Promise<void> {
    await LocalStore.wipe();
  }

  private hydrate(s: StoredIdentity): DeviceIdentity {
    return {
      deviceId: s.deviceId,
      devicePublicId: s.devicePublicId,
      algorithm: s.algorithm,
      cryptoVersion: s.cryptoVersion,
      publicIdentityKey: fromBase64(s.publicIdentityKey),
      publicSigningKey: fromBase64(s.publicSigningKey),
      identityKeySignature: fromBase64(s.identityKeySignature),
      createdAt: s.createdAt,
    };
  }
}

let _singleton: NoblePreviewProvider | null = null;
export function getCryptoProvider(): NoblePreviewProvider {
  if (!_singleton) _singleton = new NoblePreviewProvider();
  return _singleton;
}

/** Verify the identity-key signature published in a peer bundle. */
export function verifyBundleSignatures(bundle: PrekeyBundle): boolean {
  try {
    const idOk = ed25519.verify(
      bundle.identityKeySignature,
      bundle.publicIdentityKey,
      bundle.publicSigningKey,
    );
    const spkOk = ed25519.verify(
      bundle.signedPrekeySignature,
      bundle.signedPrekey,
      bundle.publicSigningKey,
    );
    return idOk && spkOk;
  } catch {
    return false;
  }
}

export { utf8 };
