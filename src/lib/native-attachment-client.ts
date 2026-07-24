import { supabase } from "@/integrations/supabase/client";
import { fromBase64Url, toBase64Url, utf8 } from "./crypto/encoding";
import { createNativeEncryptedAttachmentUpload, signNativeEncryptedAttachment } from "./native-attachments.functions";
import { encodeNativePayload, type NativeAttachmentPayload } from "./native-message-payload";
import { sendNativeMlsMessage } from "./native-mls-client";

const MAX_NATIVE_ATTACHMENT_BYTES = 64 * 1024 * 1024;

async function importAesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages);
}

async function encryptBytes(plaintext: Uint8Array, aad: Uint8Array): Promise<{
  ciphertext: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
}> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await importAesKey(key, ["encrypt"]);
  const copy = new Uint8Array(plaintext.byteLength);
  copy.set(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    cryptoKey,
    copy,
  );
  return { ciphertext: new Uint8Array(encrypted), key, nonce };
}

async function decryptBytes(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key, ["decrypt"]);
  const copy = new Uint8Array(ciphertext.byteLength);
  copy.set(ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    cryptoKey,
    copy,
  );
  return new Uint8Array(plaintext);
}

export async function sendNativeEncryptedAttachment(input: {
  conversationId: string;
  targetUserId: string;
  file: File;
  caption?: string;
}): Promise<{ messageId: string; payload: NativeAttachmentPayload }> {
  if (input.file.size <= 0 || input.file.size > MAX_NATIVE_ATTACHMENT_BYTES) {
    throw new Error("Encrypted attachment must be between 1 byte and 64 MiB");
  }

  const messageId = crypto.randomUUID();
  const attachmentAad = utf8.encode(
    `whispr-attachment-v1:${input.conversationId}:${messageId}`,
  );
  const plaintext = new Uint8Array(await input.file.arrayBuffer());
  const encrypted = await encryptBytes(plaintext, attachmentAad);

  const upload = await createNativeEncryptedAttachmentUpload({
    data: {
      conversationId: input.conversationId,
      ciphertextSize: encrypted.ciphertext.byteLength,
    },
  });

  const blob = new Blob([encrypted.ciphertext], { type: "application/octet-stream" });
  const { error: uploadError } = await supabase.storage
    .from("chat-media")
    .uploadToSignedUrl(upload.storagePath, upload.token, blob, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const payload: NativeAttachmentPayload = {
    v: 1,
    type: "attachment",
    attachment: {
      storagePath: upload.storagePath,
      keyB64Url: toBase64Url(encrypted.key),
      nonceB64Url: toBase64Url(encrypted.nonce),
      aadB64Url: toBase64Url(attachmentAad),
      filename: input.file.name || "attachment",
      mimeType: input.file.type || "application/octet-stream",
      originalSize: input.file.size,
      ciphertextSize: encrypted.ciphertext.byteLength,
      ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
    },
  };

  await sendNativeMlsMessage({
    conversationId: input.conversationId,
    targetUserId: input.targetUserId,
    plaintext: encodeNativePayload(payload),
    messageId,
  });

  return { messageId, payload };
}

export async function downloadNativeEncryptedAttachment(input: {
  conversationId: string;
  payload: NativeAttachmentPayload;
}): Promise<Blob> {
  const { attachment } = input.payload;
  const signed = await signNativeEncryptedAttachment({
    data: { conversationId: input.conversationId, storagePath: attachment.storagePath },
  });
  const response = await fetch(signed.signedUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Encrypted attachment download failed (${response.status})`);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (ciphertext.byteLength !== attachment.ciphertextSize) {
    throw new Error("Encrypted attachment size mismatch");
  }
  const plaintext = await decryptBytes(
    ciphertext,
    fromBase64Url(attachment.keyB64Url),
    fromBase64Url(attachment.nonceB64Url),
    fromBase64Url(attachment.aadB64Url),
  );
  if (plaintext.byteLength !== attachment.originalSize) {
    throw new Error("Decrypted attachment size mismatch");
  }
  return new Blob([plaintext], { type: attachment.mimeType || "application/octet-stream" });
}
