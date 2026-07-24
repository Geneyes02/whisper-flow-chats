/**
 * Encrypted local key persistence.
 *
 * Storage layout:
 *   - IndexedDB database: 'whispr-crypto'
 *   - Object store:       'kv'
 *   - Values are wrapped with AES-256-GCM using a key derived from a
 *     per-install passphrase (kept in the DB itself + browser origin).
 *
 * WARNING (documented, not silent): Full at-rest protection against a
 * hostile local attacker requires an OS keychain (native app) or a user
 * passphrase. In-browser storage is bound to the origin. This module gives
 * us an integrity boundary + AEAD wrap; the roadmap moves us to WebAuthn
 * PRF / user passphrase unlock before the "E2EE" label ships publicly.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { utf8, ctEqual } from './encoding';

const DB_NAME = 'whispr-crypto';
const STORE = 'kv';
const MASTER_SALT_KEY = '__master_salt';
const ORIGIN_TAG_KEY = '__origin_tag';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rawGet(key: string): Promise<Uint8Array | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function rawPut(key: string, value: Uint8Array): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function rawDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function rawClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOrCreate(key: string, fn: () => Uint8Array): Promise<Uint8Array> {
  const existing = await rawGet(key);
  if (existing) return existing;
  const created = fn();
  await rawPut(key, created);
  return created;
}

async function deriveWrapKey(): Promise<Uint8Array> {
  const origin =
    (typeof location !== 'undefined' ? location.origin : 'whispr') + '::wrap-v1';
  const originTag = await getOrCreate(ORIGIN_TAG_KEY, () => utf8.encode(origin));
  const salt = await getOrCreate(MASTER_SALT_KEY, () => randomBytes(32));
  return hkdf(sha256, originTag, salt, utf8.encode('whispr.local.wrap.v1'), 32);
}

const AEAD_MAGIC = utf8.encode('WHSPR1'); // 6 bytes

export const LocalStore = {
  async setBytes(key: string, value: Uint8Array): Promise<void> {
    const wrapKey = await deriveWrapKey();
    const nonce = randomBytes(12);
    const aad = new Uint8Array(AEAD_MAGIC.length + key.length);
    aad.set(AEAD_MAGIC);
    aad.set(utf8.encode(key), AEAD_MAGIC.length);
    const ct = gcm(wrapKey, nonce, aad).encrypt(value);
    const out = new Uint8Array(1 + AEAD_MAGIC.length + 12 + ct.length);
    out[0] = 1;
    out.set(AEAD_MAGIC, 1);
    out.set(nonce, 1 + AEAD_MAGIC.length);
    out.set(ct, 1 + AEAD_MAGIC.length + 12);
    await rawPut('v/' + key, out);
  },

  async getBytes(key: string): Promise<Uint8Array | null> {
    const wrapped = await rawGet('v/' + key);
    if (!wrapped) return null;
    if (wrapped[0] !== 1) throw new Error('bad wrap version');
    const magic = wrapped.slice(1, 1 + AEAD_MAGIC.length);
    if (!ctEqual(magic, AEAD_MAGIC)) throw new Error('bad wrap magic');
    const nonce = wrapped.slice(1 + AEAD_MAGIC.length, 1 + AEAD_MAGIC.length + 12);
    const ct = wrapped.slice(1 + AEAD_MAGIC.length + 12);
    const aad = new Uint8Array(AEAD_MAGIC.length + key.length);
    aad.set(AEAD_MAGIC);
    aad.set(utf8.encode(key), AEAD_MAGIC.length);
    const wrapKey = await deriveWrapKey();
    return gcm(wrapKey, nonce, aad).decrypt(ct);
  },

  async setJSON(key: string, value: unknown): Promise<void> {
    await LocalStore.setBytes(key, utf8.encode(JSON.stringify(value)));
  },

  async getJSON<T>(key: string): Promise<T | null> {
    const bytes = await LocalStore.getBytes(key);
    if (!bytes) return null;
    return JSON.parse(utf8.decode(bytes)) as T;
  },

  async delete(key: string): Promise<void> {
    await rawDelete('v/' + key);
  },

  async wipe(): Promise<void> {
    await rawClear();
  },
};
