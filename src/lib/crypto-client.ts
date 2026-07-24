/**
 * Client-side device lifecycle: create identity, register with server,
 * publish/replenish prekeys, detect identity changes, revoke.
 *
 * Never call any of these from server code.
 */

import { getCryptoProvider, verifyBundleSignatures } from './crypto/noble-provider';
import { CryptoError, type PrekeyBundle } from './crypto/types';
import { toBase64, fromMaybeBytea } from './crypto/encoding';
import {
  registerDevice,
  publishPrekeys,
  fetchPrekeyBundle,
  recordIdentityChange,
  revokeDeviceServer,
} from './crypto.functions';

const PLATFORM: 'web' = 'web';

function detectDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Whispr Web';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'Whispr on iPhone';
  if (/iPad/.test(ua)) return 'Whispr on iPad';
  if (/Android/.test(ua)) return 'Whispr on Android';
  if (/Mac/.test(ua)) return 'Whispr on Mac';
  if (/Windows/.test(ua)) return 'Whispr on Windows';
  return 'Whispr Web';
}

/** Ensure a device identity exists locally and is registered server-side. */
export async function ensureRegisteredDevice(): Promise<{
  deviceId: string;
  devicePublicId: string;
}> {
  const provider = getCryptoProvider();
  let identity = await provider.loadIdentity();
  if (!identity) identity = await provider.createIdentity();

  // If the local deviceId is not a real UUID we haven't registered yet.
  const isUuid = /^[0-9a-f-]{36}$/i.test(identity.deviceId);
  if (isUuid) {
    // Try a lightweight ownership check by publishing prekeys; if it fails
    // because the device does not exist for us, re-register.
    try {
      await refreshPrekeys(identity.deviceId);
      return { deviceId: identity.deviceId, devicePublicId: identity.devicePublicId };
    } catch {
      // fall through to registration
    }
  }

  const registered = await registerDevice({
    data: {
      name: detectDeviceName(),
      platform: PLATFORM,
      publicIdentityKey: toBase64(identity.publicIdentityKey),
      publicSigningKey: toBase64(identity.publicSigningKey),
      identityKeySignature: toBase64(identity.identityKeySignature),
      algorithm: identity.algorithm,
      cryptoVersion: identity.cryptoVersion,
      devicePublicId: identity.devicePublicId,
    },
  });

  await provider.bindServerDeviceId(registered.id);
  await refreshPrekeys(registered.id, 25);
  return { deviceId: registered.id, devicePublicId: registered.device_public_id ?? identity.devicePublicId };
}

export async function refreshPrekeys(deviceId: string, count = 10): Promise<void> {
  const provider = getCryptoProvider();
  const bundle = await provider.publishPrekeyBundle(count);
  await publishPrekeys({
    data: {
      deviceId,
      signedPrekey: toBase64(bundle.signedPrekey),
      signedPrekeySignature: toBase64(bundle.signedPrekeySignature),
      oneTimePrekeys: bundle.oneTimePrekeys.map((k) => ({
        keyId: k.keyId,
        publicKey: toBase64(k.publicKey),
      })),
    },
  });
}

/** Fetch and validate a peer's bundles. Detects identity changes vs local cache. */
export async function fetchAndVerifyPeerBundles(
  targetUserId: string,
): Promise<{ bundles: PrekeyBundle[]; identityChanged: boolean }> {
  const rows = (await fetchPrekeyBundle({ data: { targetUserId } })) as Array<{
    device_id: string;
    user_id: string;
    public_identity_key: string | Uint8Array;
    public_ed25519_key: string | Uint8Array;
    identity_key_signature: string | Uint8Array;
    public_signed_prekey: string | Uint8Array;
    signed_prekey_signature: string | Uint8Array;
    key_algorithm: string;
    key_version: number;
    crypto_version: number;
    one_time_prekey_id: string | null;
    one_time_prekey_key_id: number | null;
    one_time_prekey: string | Uint8Array | null;
  }>;

  const bundles: PrekeyBundle[] = [];
  for (const r of rows) {
    const pid = fromMaybeBytea(r.public_identity_key);
    const psk = fromMaybeBytea(r.public_ed25519_key);
    const isig = fromMaybeBytea(r.identity_key_signature);
    const spk = fromMaybeBytea(r.public_signed_prekey);
    const spkSig = fromMaybeBytea(r.signed_prekey_signature);
    if (!pid || !psk || !isig || !spk || !spkSig) continue;
    const b: PrekeyBundle = {
      deviceId: r.device_id,
      userId: r.user_id,
      cryptoVersion: r.crypto_version,
      algorithm: r.key_algorithm,
      publicIdentityKey: pid,
      publicSigningKey: psk,
      identityKeySignature: isig,
      signedPrekey: spk,
      signedPrekeySignature: spkSig,
      oneTimePrekey: fromMaybeBytea(r.one_time_prekey) ?? undefined,
      oneTimePrekeyId: r.one_time_prekey_id ?? undefined,
      oneTimePrekeyKeyId: r.one_time_prekey_key_id ?? undefined,
    };
    if (!verifyBundleSignatures(b)) {
      throw new CryptoError(
        `invalid signature on bundle for device ${b.deviceId}`,
        'invalid_bundle',
      );
    }
    bundles.push(b);
  }

  // Identity-change detection: compare against per-peer identity cache.
  const cache = readCache(targetUserId);
  let identityChanged = false;
  const newCache: Record<string, string> = {};
  for (const b of bundles) {
    const b64 = toBase64(b.publicIdentityKey);
    newCache[b.deviceId] = b64;
    const prior = cache[b.deviceId];
    if (prior && prior !== b64) identityChanged = true;
  }
  writeCache(targetUserId, newCache);

  return { bundles, identityChanged };
}

function readCache(userId: string): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem('whispr:peer-ids:' + userId) ?? '{}');
  } catch {
    return {};
  }
}
function writeCache(userId: string, v: Record<string, string>) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('whispr:peer-ids:' + userId, JSON.stringify(v));
}

export async function revokeThisDeviceEverywhere(deviceId: string): Promise<void> {
  await revokeDeviceServer({ data: { deviceId } });
  await getCryptoProvider().revokeDevice();
}

export async function reportIdentityRotation(
  deviceId: string,
  previous: Uint8Array | null,
  next: Uint8Array,
  reason?: string,
): Promise<void> {
  await recordIdentityChange({
    data: {
      deviceId,
      previousPublicIdentityKey: previous ? toBase64(previous) : undefined,
      newPublicIdentityKey: toBase64(next),
      reason,
    },
  });
}
