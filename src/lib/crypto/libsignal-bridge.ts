/**
 * NativeMlsBridgeProvider — protocol-neutral TypeScript proxy to the Rust
 * crypto host over Tauri IPC.
 *
 * Private keys and MLS group state never enter JavaScript. This file only
 * converts the Rust host's public/ciphertext wire structs into Whispr's
 * application-facing CryptoProvider types.
 */

import {
  CryptoError,
  type Bytes,
  type CryptoCapabilities,
  type CryptoErrorCode,
  type CryptoProvider,
  type DeviceIdentity,
  type EncryptedEnvelope,
  type PrekeyBundle,
  type SafetyNumber,
} from "./types";
import { fromBase64Url, toBase64Url } from "./encoding";

type TauriGlobal = { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as TauriGlobal;
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

type RawDeviceIdentity = {
  device_id: string;
  registration_id: number | null;
  identity_public_key: string;
  created_at_ms: number;
};

type RawOneTimePrekey = { key_id: number; public_key: string };

type RawPrekeyBundle = {
  device_id: string;
  registration_id: number | null;
  identity_public_key: string;
  signed_prekey_id: number;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  one_time_prekeys: RawOneTimePrekey[];
};

type RawEncryptedEnvelope = {
  version: number;
  backend: string;
  protocol_id: string;
  protocol_version: number;
  sender_device_id: string;
  recipient_device_id: string;
  conversation_id: string;
  message_id: string;
  counter: number;
  ciphertext: string;
  aad: string;
  kind: "prekey" | "whisper";
};

type RawSafetyNumber = {
  digits: string;
  fingerprint: string;
  qr_payload: string;
};

type RawWireError = { code?: string; message?: string };

const NATIVE_ALGORITHM = "mls-openmls-v1";

const KNOWN_CODES = new Set<CryptoErrorCode>([
  "no_identity",
  "no_session",
  "bad_ciphertext",
  "identity_mismatch",
  "unsupported",
  "storage_locked",
  "storage_corrupt",
  "device_revoked",
  "invalid_bundle",
  "internal",
]);

function wireError(err: unknown, command: string): CryptoError {
  if (err instanceof CryptoError) return err;
  if (err && typeof err === "object") {
    const raw = err as RawWireError;
    const code =
      raw.code && KNOWN_CODES.has(raw.code as CryptoErrorCode)
        ? (raw.code as CryptoErrorCode)
        : "internal";
    return new CryptoError(raw.message || `Native crypto command failed: ${command}`, code);
  }
  return new CryptoError(`Native crypto command failed: ${command}`, "internal");
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new CryptoError(`Tauri IPC not available; cannot invoke ${cmd}`, "unsupported");
  }
  try {
    const tauriModuleId = "@tauri-apps/api/core";
    // Runtime-only import: the browser build must not resolve desktop modules.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ tauriModuleId);
    return (await mod.invoke(cmd, args)) as T;
  } catch (err) {
    throw wireError(err, cmd);
  }
}

function hydrateIdentity(raw: RawDeviceIdentity): DeviceIdentity {
  const signing = fromBase64Url(raw.identity_public_key);
  return {
    deviceId: raw.device_id,
    devicePublicId: raw.device_id,
    cryptoVersion: 1,
    algorithm: NATIVE_ALGORITHM,
    // MLS uses the Ed25519 credential signing key as the durable public
    // identity in Whispr's native profile. Keep both aliases identical so
    // older profile/settings components can render without owning protocol logic.
    publicIdentityKey: signing,
    publicSigningKey: signing,
    identityKeySignature: new Uint8Array(0),
    createdAt: raw.created_at_ms,
  };
}

function rawBundle(bundle: PrekeyBundle): RawPrekeyBundle {
  if (!bundle.oneTimePrekey) {
    throw new CryptoError("MLS KeyPackage missing from peer bundle", "invalid_bundle");
  }
  return {
    device_id: bundle.deviceId,
    registration_id: null,
    identity_public_key: toBase64Url(bundle.publicSigningKey),
    signed_prekey_id: 0,
    signed_prekey_public: "",
    signed_prekey_signature: "",
    one_time_prekeys: [
      {
        key_id: bundle.oneTimePrekeyKeyId ?? 1,
        public_key: toBase64Url(bundle.oneTimePrekey),
      },
    ],
  };
}

function hydrateEnvelope(raw: RawEncryptedEnvelope): EncryptedEnvelope {
  return {
    version: raw.version,
    senderDeviceId: raw.sender_device_id,
    recipientDeviceId: raw.recipient_device_id,
    algorithm: raw.protocol_id,
    ephemeralPublicKey: new Uint8Array(0),
    ciphertext: fromBase64Url(raw.ciphertext),
    nonce: new Uint8Array(0),
    aad: fromBase64Url(raw.aad),
    backend: raw.backend,
    protocolId: raw.protocol_id,
    protocolVersion: raw.protocol_version,
    conversationId: raw.conversation_id,
    messageId: raw.message_id,
    counter: raw.counter,
    kind: raw.kind,
  };
}

function dehydrateEnvelope(envelope: EncryptedEnvelope): RawEncryptedEnvelope {
  if (!envelope.backend || !envelope.protocolId || envelope.protocolVersion == null) {
    throw new CryptoError("Envelope is not a native versioned MLS envelope", "bad_ciphertext");
  }
  return {
    version: envelope.version,
    backend: envelope.backend,
    protocol_id: envelope.protocolId,
    protocol_version: envelope.protocolVersion,
    sender_device_id: envelope.senderDeviceId,
    recipient_device_id: envelope.recipientDeviceId,
    conversation_id: envelope.conversationId ?? "",
    message_id: envelope.messageId ?? "",
    counter: envelope.counter ?? 0,
    ciphertext: toBase64Url(envelope.ciphertext),
    aad: toBase64Url(envelope.aad),
    kind: envelope.kind ?? "whisper",
  };
}

export class NativeMlsBridgeProvider implements CryptoProvider {
  readonly capabilities: CryptoCapabilities = {
    name: "openmls-native-v1",
    // Flipped to true only after the native messaging CI gates pass.
    supportsOneOnOne: false,
    supportsGroups: false,
    supportsCalls: false,
    supportsAttachments: true,
    audited: false,
  };

  constructor() {
    if (!isTauriRuntime()) {
      throw new CryptoError("NativeMlsBridgeProvider requires a Tauri runtime", "unsupported");
    }
  }

  async createIdentity(): Promise<DeviceIdentity> {
    return hydrateIdentity(await tauriInvoke<RawDeviceIdentity>("whispr_crypto_create_identity"));
  }

  async loadIdentity(): Promise<DeviceIdentity | null> {
    const raw = await tauriInvoke<RawDeviceIdentity | null>("whispr_crypto_load_identity");
    return raw ? hydrateIdentity(raw) : null;
  }

  async publishPrekeyBundle(count = 50): Promise<{
    identity: DeviceIdentity;
    signedPrekey: Bytes;
    signedPrekeySignature: Bytes;
    oneTimePrekeys: Array<{ keyId: number; publicKey: Bytes }>;
  }> {
    const raw = await tauriInvoke<RawPrekeyBundle>("whispr_crypto_publish_prekeys", { count });
    const identity = (await this.loadIdentity()) ?? (await this.createIdentity());
    return {
      identity,
      signedPrekey: raw.signed_prekey_public
        ? fromBase64Url(raw.signed_prekey_public)
        : new Uint8Array(0),
      signedPrekeySignature: raw.signed_prekey_signature
        ? fromBase64Url(raw.signed_prekey_signature)
        : new Uint8Array(0),
      oneTimePrekeys: raw.one_time_prekeys.map((keyPackage) => ({
        keyId: keyPackage.key_id,
        publicKey: fromBase64Url(keyPackage.public_key),
      })),
    };
  }

  async establishSession(bundle: PrekeyBundle): Promise<void> {
    await tauriInvoke("whispr_crypto_establish_session", { bundle: rawBundle(bundle) });
  }

  async encryptMessage(
    recipientDeviceId: string,
    plaintext: Bytes,
    aad: Bytes,
  ): Promise<EncryptedEnvelope> {
    const raw = await tauriInvoke<RawEncryptedEnvelope>("whispr_crypto_encrypt", {
      recipientDeviceId,
      plaintext,
      aad,
    });
    return hydrateEnvelope(raw);
  }

  async decryptMessage(envelope: EncryptedEnvelope): Promise<Bytes> {
    return new Uint8Array(
      await tauriInvoke<number[]>("whispr_crypto_decrypt", {
        envelope: dehydrateEnvelope(envelope),
      }),
    );
  }

  async rotateSession(recipientDeviceId: string): Promise<void> {
    await tauriInvoke("whispr_crypto_rotate_session", { recipientDeviceId });
  }

  async verifyIdentity(peerPublicIdentityKey: Bytes): Promise<SafetyNumber> {
    const raw = await tauriInvoke<RawSafetyNumber>("whispr_crypto_safety_number", {
      peerIdentityPublicKey: peerPublicIdentityKey,
    });
    return {
      displayGroups: raw.digits.split(/\s+/).filter(Boolean),
      qrPayload: raw.qr_payload,
    };
  }

  async revokeDevice(): Promise<void> {
    await tauriInvoke("whispr_crypto_revoke_device");
  }
}

/** Backwards-compatible export while callers migrate off the old name. */
export const LibsignalBridgeProvider = NativeMlsBridgeProvider;
