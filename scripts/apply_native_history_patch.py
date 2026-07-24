from pathlib import Path


def replace_once(src: str, old: str, new: str) -> str:
    count = src.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match, found {count}: {old[:120]!r}")
    return src.replace(old, new, 1)


native = Path("src/lib/native-mls-client.ts")
nt = native.read_text()
nt = replace_once(
    nt,
    'import { CryptoError, type EncryptedEnvelope, type PrekeyBundle } from "./crypto/types";\n',
    'import { CryptoError, type EncryptedEnvelope, type PrekeyBundle } from "./crypto/types";\n'
    'import { storeNativeHistoryMessage } from "./native-local-history";\n',
)

nt = replace_once(
    nt,
    '''  await sendEncryptedMlsMessage({
    data: {
      messageId,
      conversationId: input.conversationId,
      senderDeviceId: local.deviceId,
      envelopes,
    },
  });

  return {
''',
    '''  await sendEncryptedMlsMessage({
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
''',
)

nt = replace_once(
    nt,
    '''      const plaintext = await provider.decryptMessage(wireToEnvelope(row.envelope));
      await ackMlsEnvelope({ data: { envelopeId: row.envelope_id } });
      messages.push({
''',
    '''      const plaintext = await provider.decryptMessage(wireToEnvelope(row.envelope));
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
''',
)
native.write_text(nt)

app = Path("src/routes/_authenticated/app.tsx")
text = app.read_text()
text = replace_once(
    text,
    'import { receiveNativeMlsMessages, sendNativeMlsMessage } from "@/lib/native-mls-client";\n',
    'import { receiveNativeMlsMessages, sendNativeMlsMessage } from "@/lib/native-mls-client";\n'
    'import { loadNativeHistory } from "@/lib/native-local-history";\n',
)

anchor = '''  // Native direct-chat inbox. The native receive function only ACKs messages
  // after authenticated MLS decryption. Other-conversation rows stay pending.
  useEffect(() => {
'''
insert = '''  useEffect(() => {
    if (!isNativeDirect) return;
    let cancelled = false;
    void loadNativeHistory(conversation.id)
      .then((history) => {
        if (cancelled || history.length === 0) return;
        setNativeTextByMessageId((previous) => {
          const next = { ...previous };
          for (const entry of history) next[entry.messageId] = entry.payload.text;
          return next;
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setNativeSecurityError(
            error instanceof Error ? error.message : "Encrypted local history could not be opened",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.id, isNativeDirect]);

  // Native direct-chat inbox. The native receive function only ACKs messages
  // after authenticated MLS decryption. Other-conversation rows stay pending.
  useEffect(() => {
'''
text = replace_once(text, anchor, insert)
app.write_text(text)
