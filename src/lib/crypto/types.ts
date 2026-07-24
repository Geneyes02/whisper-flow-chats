/**
 * CryptoProvider interface — Whispr's protocol-agnostic E2EE contract.
 *
 * The browser preview provider and the native OpenMLS provider both implement
 * this interface. Browser messaging deliberately remains fail-closed.
 */

export type Bytes = Uint8Array;

export interface DeviceIdentity {
  deviceId: string;
  devicePublicId: string;
  cryptoVersion: number;
  algorithm: string;
  publicIdentityKey: Bytes;
  publicSigningKey: Bytes;
  identityKeySignature: Bytes;
  createdAt: number;
}

export interface PrekeyBundle {
  deviceId: string;
  userId: string;
  cryptoVersion: number;
  algorithm: string;
  publicIdentityKey: Bytes;
  publicSigningKey: Bytes;
  identityKeySignature: Bytes;
  signedPrekey: Bytes;
  signedPrekeySignature: Bytes;
  oneTimePrekey?: Bytes;
  oneTimePrekeyId?: string;
  oneTimePrekeyKeyId?: number;
}

/**
 * Backend-independent encrypted envelope.
 *
 * The fields through `oneTimePrekeyKeyId` preserve compatibility with the
 * original preview provider. Native MLS additionally fills the versioned
 * protocol/routing fields. No caller may infer security merely from the
 * presence of these fields; capability state comes from the provider.
 */
export interface EncryptedEnvelope {
  version: number;
  senderDeviceId: string;
  recipientDeviceId: string;
  algorithm: string;
  ciphertext: Bytes;
  aad: Bytes;

  /** Legacy/pre-MLS fields. Empty for the MLS provider. */
  ephemeralPublicKey: Bytes;
  nonce: Bytes;
  oneTimePrekeyKeyId?: number;

  /** Native versioned protocol metadata. */
  backend?: string;
  protocolId?: string;
  protocolVersion?: number;
  conversationId?: string;
  messageId?: string;
  counter?: number;
  kind?: "prekey" | "whisper";
}

export interface SafetyNumber {
  displayGroups: string[];
  qrPayload: string;
}

export interface CryptoCapabilities {
  name: string;
  supportsOneOnOne: boolean;
  supportsGroups: boolean;
  supportsCalls: boolean;
  supportsAttachments: boolean;
  audited: boolean;
}

export interface CryptoProvider {
  readonly capabilities: CryptoCapabilities;

  createIdentity(): Promise<DeviceIdentity>;
  loadIdentity(): Promise<DeviceIdentity | null>;
  publishPrekeyBundle(count?: number): Promise<{
    identity: DeviceIdentity;
    signedPrekey: Bytes;
    signedPrekeySignature: Bytes;
    oneTimePrekeys: Array<{ keyId: number; publicKey: Bytes }>;
  }>;
  establishSession(bundle: PrekeyBundle): Promise<void>;
  encryptMessage(
    recipientDeviceId: string,
    plaintext: Bytes,
    aad: Bytes,
  ): Promise<EncryptedEnvelope>;
  decryptMessage(envelope: EncryptedEnvelope): Promise<Bytes>;
  rotateSession(recipientDeviceId: string): Promise<void>;
  verifyIdentity(peerPublicIdentityKey: Bytes): Promise<SafetyNumber>;
  revokeDevice(): Promise<void>;
}

export type CryptoErrorCode =
  | "no_identity"
  | "no_session"
  | "bad_ciphertext"
  | "identity_mismatch"
  | "unsupported"
  | "storage_locked"
  | "storage_corrupt"
  | "device_revoked"
  | "invalid_bundle"
  | "internal";

/** Thrown on any authentication/decryption/provider failure. Never swallowed. */
export class CryptoError extends Error {
  constructor(
    message: string,
    public readonly code: CryptoErrorCode,
  ) {
    super(message);
    this.name = "CryptoError";
  }
}
