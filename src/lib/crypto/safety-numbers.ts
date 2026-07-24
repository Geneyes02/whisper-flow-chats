/**
 * Safety-number derivation, deterministic and symmetric between peers.
 *
 * Not a Signal-format fingerprint (that comes with libsignal). This is a
 * stable HKDF-based short digest of the two identity keys, rendered as
 * 6 five-digit groups. Both peers produce the same value.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { toBase64, utf8 } from './encoding';

export function computeSafetyNumber(
  aIdentity: Uint8Array,
  bIdentity: Uint8Array,
): { displayGroups: string[]; qrPayload: string } {
  // Canonicalize order so both sides derive the same number.
  const [first, second] =
    lexCompare(aIdentity, bIdentity) < 0
      ? [aIdentity, bIdentity]
      : [bIdentity, aIdentity];

  const material = new Uint8Array(first.length + second.length);
  material.set(first, 0);
  material.set(second, first.length);

  const digest = hkdf(
    sha256,
    material,
    utf8.encode('whispr.safety-number.v1'),
    utf8.encode('display'),
    30,
  );

  // 6 groups of 5 decimal digits each.
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) {
    const slice = digest.slice(i * 5, i * 5 + 5);
    let n = 0n;
    for (let j = 0; j < slice.length; j++) n = (n << 8n) | BigInt(slice[j]!);
    groups.push((n % 100000n).toString().padStart(5, '0'));
  }

  const qrPayload = toBase64(material);
  return { displayGroups: groups, qrPayload };
}

function lexCompare(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}
