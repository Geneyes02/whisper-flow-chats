/**
 * CryptoProvider interface — Whispr's protocol-agnostic E2EE contract.
 *
 * The rest of the app depends ONLY on this interface. Concrete providers
 * (noble-preview today; official libsignal / MLS tomorrow) plug in behind it.
 * Swapping the provider must never require touching UI or messaging code.
 *
 * SECURITY INVARIANTS:
 *   - Private key material NEVER crosses this interface toward the network.
 *   - Server functions receive only opaque ciphertext + public bundles.
 *   - There is NO plaintext fallback. Failure is a hard error, not a downgrade.
 */

export type Bytes = Uint8Array;

export interface DeviceIdentity {
  deviceId: string;               // server-issued UUID
  devicePublicId: string;         // short opaque id for QR sharing
  cryptoVersion: number;          // schema/algorithm migration version
  algorithm: string;              // e.g. 'x25519+ed25519-v1'
  publicIdentityKey: Bytes;       // X25519 (encryption)
  publicSigningKey: Bytes;        // Ed25519 (signing)
  identityKeySignature: Bytes;    // Ed25519 sig over publicIdentityKey
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

export interface EncryptedEnvelope {
  version: number;                // envelope schema version
  senderDeviceId: string;
  recipientDeviceId: string;
  algorithm: string;
  ephemeralPublicKey: Bytes;      // sender's ephemeral X25519 pk
  ciphertext: Bytes;              // AEAD ciphertext (includes tag)
  nonce: Bytes;
  aad: Bytes;                     // bound: sender+recipient+device ids
  oneTimePrekeyKeyId?: number;    // which recipient OTPK was consumed
}

export interface SafetyNumber {
  displayGroups: string[];        // e.g. ["12345","67890",...]
  qrPayload: string;              // base64url of both parties' identity keys
}

/**
 * Provider capabilities. UI reads this to decide which surfaces to expose.
 */
export interface CryptoCapabilities {
  name: string;                   // e.g. 'noble-preview-v1', 'libsignal-wasm'
  supportsOneOnOne: boolean;
  supportsGroups: boolean;        // MLS
  supportsCalls: boolean;         // SFrame
  supportsAttachments: boolean;
  audited: boolean;               // ONLY true when reviewed
}

/**
 * The interface. Implementations MUST fail-closed on any error path.
 */
export interface CryptoProvider {
  readonly capabilities: CryptoCapabilities;

  /** Create + persist a fresh device identity in encrypted local storage. */
  createIdentity(): Promise<DeviceIdentity>;

  /** Load the persisted identity for this device, if any. */
  loadIdentity(): Promise<DeviceIdentity | null>;

  /** Build a publishable prekey bundle. Rotates the signed prekey if stale. */
  publishPrekeyBundle(count?: number): Promise<{
    identity: DeviceIdentity;
    signedPrekey: Bytes;
    signedPrekeySignature: Bytes;
    oneTimePrekeys: Array<{ keyId: number; publicKey: Bytes }>;
  }>;

  /** Establish a session to a recipient device from a fetched bundle. */
  establishSession(bundle: PrekeyBundle): Promise<void>;

  /** Encrypt a plaintext string for a specific recipient device. */
  encryptMessage(
    recipientDeviceId: string,
    plaintext: Bytes,
    aad: Bytes,
  ): Promise<EncryptedEnvelope>;

  /** Decrypt an inbound envelope. Throws on any authentication failure. */
  decryptMessage(envelope: EncryptedEnvelope): Promise<Bytes>;

  /** Rotate the current session with a peer device. */
  rotateSession(recipientDeviceId: string): Promise<void>;

  /**
   * Verify a peer's public identity out-of-band. Produces a safety number.
   * Both sides must see the SAME display groups.
   */
  verifyIdentity(peerPublicIdentityKey: Bytes): Promise<SafetyNumber>;

  /** Revoke and wipe this device's local key material. */
  revokeDevice(): Promise<void>;
}

/** Thrown on any auth/decryption failure. Never swallowed. */
export class CryptoError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'no_identity'
      | 'no_session'
      | 'bad_ciphertext'
      | 'identity_mismatch'
      | 'unsupported'
      | 'storage_locked'
      | 'invalid_bundle',
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
