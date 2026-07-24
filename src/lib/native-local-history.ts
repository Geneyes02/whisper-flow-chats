/** Native encrypted local chat history.
 *
 * IndexedDB stores only opaque sealed blobs. The AES-256-GCM key lives in the
 * native OS keychain and is never returned to JavaScript; seal/open happen via
 * Tauri IPC in the Rust crypto host.
 */

import { detectRuntime } from "./crypto/provider-registry";
import { utf8 } from "./crypto/encoding";
import { CryptoError } from "./crypto/types";
import type { NativeMessagePayload } from "./native-message-payload";

const DB_NAME = "whispr-native-history-v1";
const STORE = "messages";
const VERSION = 1;

type HistoryRecord = {
  messageId: string;
  conversationId: string;
  sealed: string;
  createdAt: string;
};

export type NativeHistoryPayload = {
  text: string;
  nativePayload?: NativeMessagePayload;
  senderUserId: string;
  senderDeviceId: string;
  direction: "sent" | "received";
  createdAt: string;
};

function requireNative(): void {
  if (detectRuntime() !== "tauri") {
    throw new CryptoError("Native local history requires the Whispr native client", "unsupported");
  }
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  requireNative();
  const moduleId = "@tauri-apps/api/core";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ moduleId);
  return (await mod.invoke(command, args)) as T;
}

function aad(conversationId: string, messageId: string): Uint8Array {
  return utf8.encode(`whispr-history-v1:${conversationId}:${messageId}`);
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onerror = () => reject(request.error ?? new Error("history database open failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "messageId" });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    tx.onabort = () => reject(tx.error ?? new Error("history transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("history transaction failed"));
    operation(store, resolve, reject);
    tx.oncomplete = () => db.close();
  });
}

export async function storeNativeHistoryMessage(input: {
  conversationId: string;
  messageId: string;
  payload: NativeHistoryPayload;
}): Promise<void> {
  const plaintext = utf8.encode(JSON.stringify(input.payload));
  const sealed = await invoke<string>("whispr_crypto_seal_local", {
    plaintext: Array.from(plaintext),
    aad: Array.from(aad(input.conversationId, input.messageId)),
  });

  const record: HistoryRecord = {
    messageId: input.messageId,
    conversationId: input.conversationId,
    sealed,
    createdAt: input.payload.createdAt,
  };
  await withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("history write failed"));
  });
}

export async function loadNativeHistory(
  conversationId: string,
): Promise<Array<{ messageId: string; payload: NativeHistoryPayload }>> {
  const records = await withStore<HistoryRecord[]>("readonly", (store, resolve, reject) => {
    const request = store.index("conversationId").getAll(IDBKeyRange.only(conversationId));
    request.onsuccess = () => resolve((request.result ?? []) as HistoryRecord[]);
    request.onerror = () => reject(request.error ?? new Error("history read failed"));
  });

  const out: Array<{ messageId: string; payload: NativeHistoryPayload }> = [];
  for (const record of records) {
    try {
      const bytes = new Uint8Array(
        await invoke<number[]>("whispr_crypto_open_local", {
          sealedBlob: record.sealed,
          aad: Array.from(aad(record.conversationId, record.messageId)),
        }),
      );
      const payload = JSON.parse(utf8.decode(bytes)) as NativeHistoryPayload;
      out.push({ messageId: record.messageId, payload });
    } catch {
      // A corrupted or now-unreadable sealed record is skipped rather than
      // replaced with plaintext/fallback data.
    }
  }
  return out.sort((a, b) => a.payload.createdAt.localeCompare(b.payload.createdAt));
}

export async function clearNativeHistory(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("history clear failed"));
    request.onblocked = () => reject(new Error("history clear blocked"));
  });
}
