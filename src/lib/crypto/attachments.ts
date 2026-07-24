/**
 * Attachment encryption (Phase 3 groundwork, real today).
 *
 * Per-attachment random 256-bit key, AES-256-GCM. Storage receives only
 * ciphertext + tag + nonce. The key is intended to travel INSIDE the E2EE
 * message envelope (Phase 2), never stored beside the blob.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';

export interface EncryptedAttachment {
  ciphertext: Uint8Array; // includes GCM tag
  nonce: Uint8Array;      // 12 bytes
  key: Uint8Array;        // 32 bytes — belongs in the message envelope
  algorithm: 'aes-256-gcm';
  size: number;           // plaintext byte length
  mimeType?: string;
}

export function encryptAttachment(
  plaintext: Uint8Array,
  mimeType?: string,
): EncryptedAttachment {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  return { ciphertext, nonce, key, algorithm: 'aes-256-gcm', size: plaintext.length, mimeType };
}

export function decryptAttachment(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  return gcm(key, nonce).decrypt(ciphertext);
}
