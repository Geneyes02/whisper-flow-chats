/**
 * Slice 2B — client-side substitution detection.
 *
 * assertConsumedKeyPackageIntegrity() is the transport-layer sanity guard
 * that runs on every consume before the bytes reach the native MLS decoder.
 * Its only job: reject a server response where the returned bytes do not
 * hash to the declared key_package_hash.
 *
 * This does NOT replace credential-signature validation performed by
 * OpenMLS on the native side. It is a cheap, independent check so tampered
 * bytes never even reach the MLS decoder.
 */

import { describe, expect, it } from 'vitest';
import { assertConsumedKeyPackageIntegrity } from '@/lib/mls-directory.functions';

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('assertConsumedKeyPackageIntegrity', () => {
  it('accepts a bundle whose bytes hash to the declared hash', async () => {
    const bytes = new TextEncoder().encode('honest-keypackage-payload');
    const b64 = bytesToB64(bytes);
    const hash = await sha256Hex(bytes);
    await expect(
      assertConsumedKeyPackageIntegrity({ key_package_hash: hash, key_package_b64: b64 }),
    ).resolves.toBeUndefined();
  });

  it('rejects a bundle whose bytes do not hash to the declared hash', async () => {
    const bytes = new TextEncoder().encode('substituted-payload');
    const b64 = bytesToB64(bytes);
    // Deliberately wrong hash
    const wrongHash = '0'.repeat(64);
    await expect(
      assertConsumedKeyPackageIntegrity({ key_package_hash: wrongHash, key_package_b64: b64 }),
    ).rejects.toThrow(/key_package_substitution_detected/);
  });

  it('rejects when only the last byte is flipped', async () => {
    const original = new TextEncoder().encode('nearly-identical-payload');
    const declaredHash = await sha256Hex(original);
    const tampered = new Uint8Array(original);
    tampered[tampered.length - 1] ^= 0x01;
    const b64 = bytesToB64(tampered);
    await expect(
      assertConsumedKeyPackageIntegrity({ key_package_hash: declaredHash, key_package_b64: b64 }),
    ).rejects.toThrow(/key_package_substitution_detected/);
  });

  it('rejects an empty payload against a non-empty declared hash', async () => {
    const empty = new Uint8Array(0);
    const declaredHash = await sha256Hex(new TextEncoder().encode('anything-else'));
    await expect(
      assertConsumedKeyPackageIntegrity({
        key_package_hash: declaredHash,
        key_package_b64: bytesToB64(empty),
      }),
    ).rejects.toThrow(/key_package_substitution_detected/);
  });
});
