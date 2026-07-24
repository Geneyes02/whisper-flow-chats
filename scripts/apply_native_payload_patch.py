from pathlib import Path


def replace_once(src: str, old: str, new: str) -> str:
    count = src.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match, found {count}: {old[:120]!r}")
    return src.replace(old, new, 1)


p = Path("src/lib/native-mls-client.ts")
s = p.read_text()

if 'from "./native-message-payload"' not in s:
    s = replace_once(
        s,
        'import { storeNativeHistoryMessage } from "./native-local-history";\n',
        'import { storeNativeHistoryMessage } from "./native-local-history";\n'
        'import { decodeNativePayload, payloadPreview, type NativeMessagePayload } from "./native-message-payload";\n',
    )

if "messageId?: string;" not in s:
    s = replace_once(
        s,
        '''export async function sendNativeMlsMessage(input: {
  conversationId: string;
  targetUserId: string;
  plaintext: Uint8Array;
}): Promise<{''',
        '''export async function sendNativeMlsMessage(input: {
  conversationId: string;
  targetUserId: string;
  plaintext: Uint8Array;
  messageId?: string;
}): Promise<{''',
    )

if "input.messageId ?? crypto.randomUUID()" not in s:
    s = replace_once(
        s,
        '  const messageId = crypto.randomUUID();\n',
        '  const messageId = input.messageId ?? crypto.randomUUID();\n',
    )

if "const sentPayload = decodeNativePayload(input.plaintext);" not in s:
    s = replace_once(
        s,
        '''  await storeNativeHistoryMessage({
    conversationId: input.conversationId,
    messageId,
    payload: {
      text: utf8.decode(input.plaintext),''',
        '''  const sentPayload = decodeNativePayload(input.plaintext);
  await storeNativeHistoryMessage({
    conversationId: input.conversationId,
    messageId,
    payload: {
      text: payloadPreview(sentPayload),
      nativePayload: sentPayload,''',
    )

if "payload: NativeMessagePayload;" not in s:
    s = replace_once(
        s,
        '''export interface DecryptedNativeMessage {
  envelopeId: string;
  messageId: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  plaintext: Uint8Array;
  createdAt: string;
}''',
        '''export interface DecryptedNativeMessage {
  envelopeId: string;
  messageId: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  plaintext: Uint8Array;
  payload: NativeMessagePayload;
  createdAt: string;
}''',
    )

if "const decodedPayload = decodeNativePayload(plaintext);" not in s:
    s = replace_once(
        s,
        '''      const plaintext = await provider.decryptMessage(wireToEnvelope(row.envelope));
      await storeNativeHistoryMessage({
        conversationId: row.conversation_id,
        messageId: row.message_id,
        payload: {
          text: utf8.decode(plaintext),''',
        '''      const plaintext = await provider.decryptMessage(wireToEnvelope(row.envelope));
      const decodedPayload = decodeNativePayload(plaintext);
      await storeNativeHistoryMessage({
        conversationId: row.conversation_id,
        messageId: row.message_id,
        payload: {
          text: payloadPreview(decodedPayload),
          nativePayload: decodedPayload,''',
    )

if "payload: decodedPayload," not in s:
    s = replace_once(
        s,
        '''        senderDeviceId: row.sender_device_id,
        plaintext,
        createdAt: row.created_at,''',
        '''        senderDeviceId: row.sender_device_id,
        plaintext,
        payload: decodedPayload,
        createdAt: row.created_at,''',
    )

p.write_text(s)

h = Path("src/lib/native-local-history.ts")
t = h.read_text()
if 'NativeMessagePayload' not in t:
    t = replace_once(
        t,
        'import { CryptoError } from "./crypto/types";\n',
        'import { CryptoError } from "./crypto/types";\n'
        'import type { NativeMessagePayload } from "./native-message-payload";\n',
    )
    t = replace_once(
        t,
        '''  text: string;
  senderUserId: string;''',
        '''  text: string;
  nativePayload?: NativeMessagePayload;
  senderUserId: string;''',
    )
h.write_text(t)

# TypeScript 5.7+/DOM WebCrypto requires ArrayBuffer-backed BufferSources.
# Always copy into owned ArrayBuffers so SharedArrayBuffer-like views cannot
# cross the crypto or Blob boundaries.
a = Path("src/lib/native-attachment-client.ts")
u = a.read_text()
if "function toOwnedArrayBuffer" not in u:
    u = replace_once(
        u,
        'const MAX_NATIVE_ATTACHMENT_BYTES = 64 * 1024 * 1024;\n',
        '''const MAX_NATIVE_ATTACHMENT_BYTES = 64 * 1024 * 1024;

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
''',
    )

u = u.replace(
    'return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages);',
    'return crypto.subtle.importKey("raw", toOwnedArrayBuffer(raw), { name: "AES-GCM" }, false, usages);',
)
u = u.replace(
    '{ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },',
    '{ name: "AES-GCM", iv: toOwnedArrayBuffer(nonce), additionalData: toOwnedArrayBuffer(aad), tagLength: 128 },',
)
u = u.replace(
    'const blob = new Blob([encrypted.ciphertext], { type: "application/octet-stream" });',
    'const blob = new Blob([toOwnedArrayBuffer(encrypted.ciphertext)], { type: "application/octet-stream" });',
)
u = u.replace(
    'return new Blob([plaintext], { type: attachment.mimeType || "application/octet-stream" });',
    'return new Blob([toOwnedArrayBuffer(plaintext)], { type: attachment.mimeType || "application/octet-stream" });',
)
a.write_text(u)

f = Path("src/lib/native-attachments.functions.ts")
v = f.read_text()
if 'import type { SupabaseClient } from "@supabase/supabase-js";' not in v:
    v = replace_once(
        v,
        'import { z } from "zod";\n',
        'import { z } from "zod";\n'
        'import type { SupabaseClient } from "@supabase/supabase-js";\n'
        'import type { Database } from "@/integrations/supabase/types";\n',
    )

old_sig = '''async function requireConversationMember(
  supabase: Parameters<Parameters<typeof createServerFn>[0]>[0] extends never ? never : any,
  conversationId: string,
  userId: string,
): Promise<void> {'''
new_sig = '''async function requireConversationMember(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  userId: string,
): Promise<void> {'''
if old_sig in v:
    v = replace_once(v, old_sig, new_sig)
f.write_text(v)
