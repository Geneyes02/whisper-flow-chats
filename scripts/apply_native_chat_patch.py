from pathlib import Path
import re


def replace_once(src: str, old: str, new: str) -> str:
    count = src.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match, found {count}: {old[:100]!r}")
    return src.replace(old, new, 1)


app = Path("src/routes/_authenticated/app.tsx")
text = app.read_text()

text = replace_once(
    text,
    'import { supabase } from "@/integrations/supabase/client";\n',
    'import { supabase } from "@/integrations/supabase/client";\n'
    'import { detectRuntime } from "@/lib/crypto/provider-registry";\n'
    'import { utf8 } from "@/lib/crypto/encoding";\n'
    'import { receiveNativeMlsMessages, sendNativeMlsMessage } from "@/lib/native-mls-client";\n',
)

text = replace_once(
    text,
    "  const [uploading, setUploading] = useState(false);\n",
    "  const [uploading, setUploading] = useState(false);\n"
    "  const [nativeTextByMessageId, setNativeTextByMessageId] = useState<Record<string, string>>({});\n"
    "  const [nativeSecurityError, setNativeSecurityError] = useState<string | null>(null);\n"
    "  const isNativeDirect =\n"
    '    detectRuntime() === "tauri" && conversation.type === "direct" && !!conversation.peer?.id;\n',
)

focus_anchor = """  useEffect(() => {
    inputRef.current?.focus();
  }, [conversation.id]);
"""
receive_effect = focus_anchor + """
  // Native direct-chat inbox. The native receive function only ACKs messages
  // after authenticated MLS decryption. Other-conversation rows stay pending.
  useEffect(() => {
    if (!isNativeDirect) return;
    let cancelled = false;

    const pull = async () => {
      try {
        const result = await receiveNativeMlsMessages(200, conversation.id);
        if (cancelled) return;
        if (result.messages.length > 0) {
          setNativeTextByMessageId((previous) => {
            const next = { ...previous };
            for (const message of result.messages) {
              next[message.messageId] = utf8.decode(message.plaintext);
            }
            return next;
          });
          await qc.invalidateQueries({ queryKey: key });
          await qc.invalidateQueries({ queryKey: ["conversations"] });
        }
        if (result.failures.length > 0) {
          setNativeSecurityError(
            "An encrypted message could not be authenticated. It was not acknowledged.",
          );
        } else {
          setNativeSecurityError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setNativeSecurityError(
            error instanceof Error ? error.message : "Native E2EE receive failed",
          );
        }
      }
    };

    void pull();
    const timer = window.setInterval(() => void pull(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversation.id, isNativeDirect, qc, key]);
"""
text = replace_once(text, focus_anchor, receive_effect)

old_send = """  const sendMut = useMutation({
    mutationFn: (body: string) =>
      send({
        data: {
          conversationId: conversation.id,
          text: body,
          replyToMessageId: replyTo?.id ?? null,
        },
      }),
    onSuccess: () => {
      setText("");
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
"""
new_send = """  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      if (isNativeDirect) {
        const targetUserId = conversation.peer?.id;
        if (!targetUserId) throw new Error("Direct-chat peer is unavailable");
        const result = await sendNativeMlsMessage({
          conversationId: conversation.id,
          targetUserId,
          plaintext: utf8.encode(body),
        });
        return { id: result.messageId, nativeText: body };
      }

      const result = await send({
        data: {
          conversationId: conversation.id,
          text: body,
          replyToMessageId: replyTo?.id ?? null,
        },
      });
      return { id: result.id, nativeText: null };
    },
    onSuccess: (result) => {
      if (result.nativeText) {
        setNativeTextByMessageId((previous) => ({
          ...previous,
          [result.id]: result.nativeText!,
        }));
      }
      setText("");
      setReplyTo(null);
      setNativeSecurityError(null);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => {
      setNativeSecurityError(error instanceof Error ? error.message : "Encrypted send failed");
    },
  });
"""
text = replace_once(text, old_send, new_send)

old_edit = """  function startEdit(m: ChatMessage) {
    setReplyTo(null);
    setEditingId(m.id);
    setText(m.text);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
"""
new_edit = """  function startEdit(m: ChatMessage) {
    if (isNativeDirect) {
      setNativeSecurityError(
        "Editing E2EE messages is disabled until encrypted edit events are implemented.",
      );
      return;
    }
    setReplyTo(null);
    setEditingId(m.id);
    setText(m.text);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
"""
text = replace_once(text, old_edit, new_edit)

files_anchor = """    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
"""
files_new = """    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (isNativeDirect) {
        setNativeSecurityError(
          "Encrypted attachments are not enabled yet. Whispr will not upload this file through the plaintext media path.",
        );
        return;
      }
"""
text = replace_once(text, files_anchor, files_new)

old_deps = "    [conversation.id, uploadFn, sendMedia, text, replyTo, qc, key],"
if old_deps not in text:
    raise SystemExit("upload callback dependency anchor not found")
text = text.replace(
    old_deps,
    "    [conversation.id, uploadFn, sendMedia, text, replyTo, qc, key, isNativeDirect],",
    1,
)

old_grouped = """  const grouped = useMemo(() => {
    const msgs = messages.data ?? [];
"""
new_grouped = """  const displayMessages = useMemo(
    () =>
      (messages.data ?? []).map((message) => {
        const nativeText = nativeTextByMessageId[message.id];
        return nativeText === undefined ? message : { ...message, text: nativeText };
      }),
    [messages.data, nativeTextByMessageId],
  );

  const grouped = useMemo(() => {
    const msgs = displayMessages;
"""
text = replace_once(text, old_grouped, new_grouped)

old_group_dep = "  }, [messages.data, conversation.type, currentUserId]);"
if old_group_dep not in text:
    raise SystemExit("group dependency anchor not found")
text = text.replace(
    old_group_dep,
    "  }, [displayMessages, conversation.type, currentUserId]);",
    1,
)

text = replace_once(
    text,
    """  const pinnedMsg = useMemo(
    () => (messages.data ?? []).find((m) => m.is_pinned && !m.deleted_at),
    [messages.data],
  );
""",
    """  const pinnedMsg = useMemo(
    () => displayMessages.find((m) => m.is_pinned && !m.deleted_at),
    [displayMessages],
  );
""",
)

text = replace_once(
    text,
    """      {/* pinned banner */}
""",
    """      {nativeSecurityError && (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-200 md:px-5">
          {nativeSecurityError}
        </div>
      )}

      {/* pinned banner */}
""",
)

app.write_text(text)

native = Path("src/lib/native-mls-client.ts")
nt = native.read_text()
nt, count = re.subn(
    r"export async function receiveNativeMlsMessages\(limit = 100\): Promise<\{",
    "export async function receiveNativeMlsMessages(\n  limit = 100,\n  conversationId?: string,\n): Promise<{",
    nt,
    count=1,
)
if count != 1:
    raise SystemExit(f"expected receive signature match once, got {count}")
loop = "  for (const row of pending) {\n    try {"
if loop not in nt:
    raise SystemExit("receive loop anchor not found")
nt = nt.replace(
    loop,
    "  for (const row of pending) {\n    if (conversationId && row.conversation_id !== conversationId) continue;\n    try {",
    1,
)
native.write_text(nt)
