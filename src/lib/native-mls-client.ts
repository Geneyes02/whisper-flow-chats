/**
 * Native-only MLS messaging orchestration.
 *
 * Plaintext enters this module only as Uint8Array and is passed directly to
 * the native crypto host. Server functions receive only public key material
 * or encrypted envelopes.
 */

import { getCryptoProvider, detectRuntime } from "./crypto/provider-registry";
import { CryptoError, type EncryptedEnvelope, type PrekeyBundle } from "./crypto/types";
import { storeNativeHistoryMessage } from "./native-local-history";
import { fromBase64, fromPgHex, toBase64, toBase64Url, utf8 } from "./crypto/encoding";
import {
  assertConsumedKeyPackageIntegrity,
  consumeMlsKeyPackage,
  getMlsDirectoryStatus,
  publishMlsKeyPackages,
} from "./mls-directory.functions";
import {
  ackMlsEnvelope,
  getMlsDeviceIdentity,
  getPendingMlsEnvelopes,
  listMlsRecipientDevices,
  registerMlsNativeDevice,
  sendEncryptedMlsMessage,
  type NativeEnvelopeWire,
  type RecipientEnvelopeWire,
} from "./native-mls.functions";

const REPLENISH_THRESHOLD = 10;
const REPLENISH_TARGET = 50;
const KEYPACKAGE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const PEER_ID_CACHE_PREFIX = "whispr:mls-peer-identity:";

function requireNativeRuntime(): void {
  if (detectRuntime() !== "tauri") {
    throw new CryptoError(
      "Native MLS messaging is only available in the Whispr desktop/mobile client.",
      "unsupported",
    );
  }
}

function detectNativePlatform(): "macos" | "windows" | "linux" {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS/i.test(ua)) return "macos";
  return "linux";
}

function nativeDeviceName(): string {
  const platform = detectNativePlatform();
  if (platform === "macos") return "Whispr for macOS";
  if (platform === "windows") return "Whispr for Windows";
  return "Whispr for Linux";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function peerCacheGet(deviceId: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(PEER_ID_CACHE_PREFIX + deviceId);
}

function peerCacheSet(deviceId: string, publicKeyHex: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PEER_ID_CACHE_PREFIX + deviceId, publicKeyHex.toLowerCase());
}

async function verifyAndCachePeerIdentity(deviceId: string): Promise<{
  userId: string;
  publicSigningKey: Uint8Array;
}> {
  const row = await getMlsDeviceIdentity({ data: { deviceId } });
  if (row.device_id !== deviceId) {
    throw new CryptoError("Peer device identity response mismatch", "identity_mismatch");
  }

  const keyHex = row.public_ed25519_key_hex.toLowerCase();
  const previous = peerCacheGet(deviceId)?.toLowerCase() ?? null;
  if (previous && previous !== keyHex) {
    throw new CryptoError(
      "Peer device identity changed. Verify the contact before continuing.",
      "identity_mismatch",
    );
  }
  peerCacheSet(deviceId, keyHex);

  return {
    userId: row.user_id,
    publicSigningKey: fromPgHex(keyHex),
  };
}

export async function ensureNativeMlsDevice(): Promise<{
  deviceId: string;
  userId: string;
  publicSigningKey: Uint8Array;
}> {
  requireNativeRuntime();
  const provider = getCryptoProvider();
  let identity = await provider.loadIdentity();
  if (!identity) identity = await provider.createIdentity();

  const registration = await registerMlsNativeDevice({
    data: {
      deviceId: identity.deviceId,
      name: nativeDeviceName(),
      platform: detectNativePlatform(),
      publicSigningKey: toBase64(identity.publicSigningKey),
    },
  });

  const status = await getMlsDirectoryStatus({ data: { deviceId: identity.deviceId } });
  if (status.remaining < REPLENISH_THRESHOLD) {
    const count = Math.max(1, REPLENISH_TARGET - status.remaining);
    const bundle = await provider.publishPrekeyBundle(count);
    const expiresAt = new Date(Date.now() + KEYPACKAGE_LIFETIME_MS).toISOString();
    const credentialIdentity = toBase64(utf8.encode(identity.deviceId));
    const publish = await Promise.all(
      bundle.oneTimePrekeys.map(async (keyPackage) => ({
        device_id: identity.deviceId,
        ciphersuite_tag: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
        key_package_hash: await sha256Hex(keyPackage.publicKey),
        key_package_b64: toBase64(keyPackage.publicKey),
        credential_identity_b64: credentialIdentity,
        expires_at: expiresAt,
      })),
    );
    await publishMlsKeyPackages({ data: { bundles: publish } });
  }

  return {
    deviceId: identity.deviceId,
    userId: registration.userId,
    publicSigningKey: identity.publicSigningKey,
  };
}

async function establishWithPeerDevice(
  targetUserId: string,
  targetDeviceId: string,
): Promise<void> {
  const provider = getCryptoProvider();
  const consumed = await consumeMlsKeyPackage({
    data: { targetUser: targetUserId, targetDevice: targetDeviceId },
  });
  await assertConsumedKeyPackageIntegrity(consumed);

  if (consumed.device_id !== targetDeviceId || consumed.user_id !== targetUserId) {
    throw new CryptoError("Consumed KeyPackage routing mismatch", "identity_mismatch");
  }

  const peer = await verifyAndCachePeerIdentity(targetDeviceId);
  if (peer.userId !== targetUserId) {
    throw new CryptoError("Peer device owner mismatch", "identity_mismatch");
  }

  const keyPackage = fromBase64(consumed.key_package_b64);
  const prekeyBundle: PrekeyBundle = {
    deviceId: targetDeviceId,
    userId: targetUserId,
    cryptoVersion: 1,
    algorithm: "mls-openmls-v1",
    publicIdentityKey: peer.publicSigningKey,
    publicSigningKey: peer.publicSigningKey,
    identityKeySignature: new Uint8Array(0),
    signedPrekey: new Uint8Array(0),
    signedPrekeySignature: new Uint8Array(0),
    oneTimePrekey: keyPackage,
    oneTimePrekeyKeyId: 1,
  };
  await provider.establishSession(prekeyBundle);
}

function envelopeToWire(envelope: EncryptedEnvelope): NativeEnvelopeWire {
  if (
    envelope.protocolId !== "whispr-mls-v1" ||
    envelope.protocolVersion !== 1 ||
    !envelope.backend ||
    !envelope.conversationId ||
    !envelope.messageId ||
    !envelope.kind
  ) {
    throw new CryptoError("Native MLS envelope metadata incomplete", "internal");
  }
  return {
    version: envelope.version,
    backend: envelope.backend,
    protocol_id: "whispr-mls-v1",
    protocol_version: 1,
    sender_device_id: envelope.senderDeviceId,
    recipient_device_id: envelope.recipientDeviceId,
    conversation_id: envelope.conversationId,
    message_id: envelope.messageId,
    counter: envelope.counter ?? 0,
    ciphertext: toBase64Url(envelope.ciphertext),
    aad: toBase64Url(envelope.aad),
    kind: envelope.kind,
  };
}

function wireToEnvelope(wire: NativeEnvelopeWire): EncryptedEnvelope {
  return {
    version: wire.version,
    backend: wire.backend,
    protocolId: wire.protocol_id,
    protocolVersion: wire.protocol_version,
    senderDeviceId: wire.sender_device_id,
    recipientDeviceId: wire.recipient_device_id,
    conversationId: wire.conversation_id,
    messageId: wire.message_id,
    counter: wire.counter,
    kind: wire.kind,
    algorithm: wire.protocol_id,
    ephemeralPublicKey: new Uint8Array(0),
    ciphertext: fromBase64UrlCompat(wire.ciphertext),
    nonce: new Uint8Array(0),
    aad: fromBase64UrlCompat(wire.aad),
  };
}

function fromBase64UrlCompat(value: string): Uint8Array {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(standard + "=".repeat((4 - (standard.length % 4)) % 4));
}

type DeviceTarget = {
  deviceId: string;
  userId: string;
};

async function encryptForTarget(
  target: DeviceTarget,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<RecipientEnvelopeWire> {
  const provider = getCryptoProvider();
  await verifyAndCachePeerIdentity(target.deviceId);

  let encrypted: EncryptedEnvelope;
  try {
    encrypted = await provider.encryptMessage(target.deviceId, plaintext, aad);
  } catch (error) {
    if (!(error instanceof CryptoError) || error.code !== "no_session") throw error;
    await establishWithPeerDevice(target.userId, target.deviceId);
    encrypted = await provider.encryptMessage(target.deviceId, plaintext, aad);
  }

  return {
    recipient_user_id: target.userId,
    recipient_device_id: target.deviceId,
    envelope: envelopeToWire(encrypted),
  };
}

export async function sendNativeMlsMessage(input: {
  conversationId: string;
  targetUserId: string;
  plaintext: Uint8Array;
}): Promise<{
  messageId: string;
  recipientDeviceCount: number;
  syncedOwnDeviceCount: number;
}> {
  requireNativeRuntime();
  const local = await ensureNativeMlsDevice();
  const peerDevices = await listMlsRecipientDevices({ data: { targetUserId: input.targetUserId } });
  if (peerDevices.length === 0) {
    throw new CryptoError("Recipient has no active MLS-capable devices", "no_session");
  }

  const ownDevices = await listMlsRecipientDevices({ data: { targetUserId: local.userId } });
  const targetMap = new Map<string, DeviceTarget>();
  for (const device of peerDevices) {
    targetMap.set(device.device_id, { deviceId: device.device_id, userId: input.targetUserId });
  }
  for (const device of ownDevices) {
    if (device.device_id === local.deviceId) continue;
    targetMap.set(device.device_id, { deviceId: device.device_id, userId: local.userId });
  }

  const messageId = crypto.randomUUID();
  const aad = utf8.encode(
    JSON.stringify({ conversation_id: input.conversationId, message_id: messageId }),
  );
  const envelopes: RecipientEnvelopeWire[] = [];
  for (const target of targetMap.values()) {
    envelopes.push(await encryptForTarget(target, input.plaintext, aad));
  }

  await sendEncryptedMlsMessage({
    data: {
      messageId,
      conversationId: input.conversationId,
      senderDeviceId: local.deviceId,
      envelopes,
    },
  });

  await storeNativeHistoryMessage({
    conversationId: input.conversationId,
    messageId,
    payload: {
      text: utf8.decode(input.plaintext),
      senderUserId: local.userId,
      senderDeviceId: local.deviceId,
      direction: "sent",
      createdAt: new Date().toISOString(),
    },
  });

  return {
    messageId,
    recipientDeviceCount: peerDevices.length,
    syncedOwnDeviceCount: ownDevices.filter((device) => device.device_id !== local.deviceId).length,
  };
}

export interface DecryptedNativeMessage {
  envelopeId: string;
  messageId: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  plaintext: Uint8Array;
  createdAt: string;
}

export interface FailedNativeEnvelope {
  envelopeId: string;
  messageId: string;
  error: unknown;
}

/**
 * Fetch and decrypt pending envelopes for this native device. Envelopes are
 * acknowledged only after successful authenticated decryption.
 */
export async function receiveNativeMlsMessages(
  limit = 100,
  conversationId?: string,
): Promise<{
  messages: DecryptedNativeMessage[];
  failures: FailedNativeEnvelope[];
}> {
  requireNativeRuntime();
  const provider = getCryptoProvider();
  const local = await ensureNativeMlsDevice();
  const pending = await getPendingMlsEnvelopes({ data: { deviceId: local.deviceId, limit } });
  const messages: DecryptedNativeMessage[] = [];
  const failures: FailedNativeEnvelope[] = [];

  for (const row of pending) {
    if (conversationId && row.conversation_id !== conversationId) continue;
    try {
      await verifyAndCachePeerIdentity(row.sender_device_id);
      const plaintext = await provider.decryptMessage(wireToEnvelope(row.envelope));
      await storeNativeHistoryMessage({
        conversationId: row.conversation_id,
        messageId: row.message_id,
        payload: {
          text: utf8.decode(plaintext),
          senderUserId: row.sender_user_id,
          senderDeviceId: row.sender_device_id,
          direction: row.sender_user_id === local.userId ? "sent" : "received",
          createdAt: row.created_at,
        },
      });
      await ackMlsEnvelope({ data: { envelopeId: row.envelope_id } });
      messages.push({
        envelopeId: row.envelope_id,
        messageId: row.message_id,
        conversationId: row.conversation_id,
        senderUserId: row.sender_user_id,
        senderDeviceId: row.sender_device_id,
        plaintext,
        createdAt: row.created_at,
      });
    } catch (error) {
      failures.push({ envelopeId: row.envelope_id, messageId: row.message_id, error });
    }
  }

  return { messages, failures };
}
