import { utf8 } from "./crypto/encoding";

export type NativeTextPayload = {
  v: 1;
  type: "text";
  text: string;
};

export type NativeAttachmentPayload = {
  v: 1;
  type: "attachment";
  attachment: {
    storagePath: string;
    keyB64Url: string;
    nonceB64Url: string;
    aadB64Url: string;
    filename: string;
    mimeType: string;
    originalSize: number;
    ciphertextSize: number;
    caption?: string;
  };
};

export type NativeMessagePayload = NativeTextPayload | NativeAttachmentPayload;

const PREFIX = "WHISPR1:";

export function encodeNativePayload(payload: NativeMessagePayload): Uint8Array {
  return utf8.encode(PREFIX + JSON.stringify(payload));
}

export function encodeNativeText(text: string): Uint8Array {
  return encodeNativePayload({ v: 1, type: "text", text });
}

export function decodeNativePayload(bytes: Uint8Array): NativeMessagePayload {
  const raw = utf8.decode(bytes);
  if (!raw.startsWith(PREFIX)) {
    // Backward-compatible path for direct-message ciphertext created before
    // structured payloads landed. It is still MLS-authenticated plaintext.
    return { v: 1, type: "text", text: raw };
  }
  const parsed = JSON.parse(raw.slice(PREFIX.length)) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid Whispr native payload");
  const value = parsed as Partial<NativeMessagePayload> & { v?: unknown; type?: unknown };
  if (value.v !== 1) throw new Error("Unsupported Whispr native payload version");
  if (value.type === "text") {
    const text = (value as Partial<NativeTextPayload>).text;
    if (typeof text !== "string") throw new Error("Invalid Whispr text payload");
    return { v: 1, type: "text", text };
  }
  if (value.type === "attachment") {
    const attachment = (value as Partial<NativeAttachmentPayload>).attachment;
    if (!attachment || typeof attachment !== "object") throw new Error("Invalid attachment payload");
    const a = attachment as NativeAttachmentPayload["attachment"];
    for (const field of ["storagePath", "keyB64Url", "nonceB64Url", "aadB64Url", "filename", "mimeType"] as const) {
      if (typeof a[field] !== "string" || a[field].length === 0) {
        throw new Error(`Invalid encrypted attachment field: ${field}`);
      }
    }
    if (!Number.isSafeInteger(a.originalSize) || a.originalSize < 0) throw new Error("Invalid original size");
    if (!Number.isSafeInteger(a.ciphertextSize) || a.ciphertextSize <= 0) throw new Error("Invalid ciphertext size");
    if (a.caption !== undefined && typeof a.caption !== "string") throw new Error("Invalid attachment caption");
    return { v: 1, type: "attachment", attachment: { ...a } };
  }
  throw new Error("Unknown Whispr native payload type");
}

export function payloadPreview(payload: NativeMessagePayload): string {
  if (payload.type === "text") return payload.text;
  const caption = payload.attachment.caption?.trim();
  return caption
    ? `${caption}\n[Encrypted attachment: ${payload.attachment.filename}]`
    : `[Encrypted attachment: ${payload.attachment.filename}]`;
}
