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

s = replace_once(
    s,
    '  const messageId = crypto.randomUUID();\n',
    '  const messageId = input.messageId ?? crypto.randomUUID();\n',
)

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
