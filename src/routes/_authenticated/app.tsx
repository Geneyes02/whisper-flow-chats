import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { detectRuntime } from "@/lib/crypto/provider-registry";
import { utf8 } from "@/lib/crypto/encoding";
import { receiveNativeMlsMessages, sendNativeMlsMessage } from "@/lib/native-mls-client";
import { loadNativeHistory } from "@/lib/native-local-history";
import { getMe } from "@/lib/profile.functions";
import { searchUsers } from "@/lib/contacts.functions";
import {
  createGroupConversation,
  createUploadUrl,
  deleteMessage as deleteMessageFn,
  editMessage as editMessageFn,
  listMessages,
  listMyConversations,
  markConversationRead,
  sendChatMessage,
  sendMediaMessage,
  setConversationMuted,
  setConversationPinned,
  setMessagePinned,
  signAttachment,
  startDirectConversation,
  toggleReaction,
  type ChatMessage,
} from "@/lib/messaging.functions";

export const Route = createFileRoute("/_authenticated/app")({
  component: ChatApp,
  head: () => ({
    meta: [
      { title: "Chats — Whispr" },
      { name: "description", content: "Real-time private messaging on Whispr." },
    ],
  }),
});

type Conversation = Awaited<ReturnType<typeof listMyConversations>>[number];

const QUICK_EMOJI = ["❤️", "👍", "😂", "🔥", "🎉", "😮"];

/* ---------------- helpers ---------------- */

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dayDiff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (dayDiff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  const dayDiff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (dayDiff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/* ---------------- root ---------------- */

function ChatApp() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const fetchMe = useServerFn(getMe);
  const fetchConvos = useServerFn(listMyConversations);
  const search = useServerFn(searchUsers);
  const startDirect = useServerFn(startDirectConversation);

  const me = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const convos = useQuery({
    queryKey: ["conversations"],
    queryFn: () => fetchConvos(),
    refetchOnWindowFocus: true,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => search({ data: { query, limit: 10 } }),
    enabled: query.trim().length >= 2,
  });

  const openDirect = useMutation({
    mutationFn: (otherUserId: string) => startDirect({ data: { otherUserId } }),
    onSuccess: async ({ id }) => {
      setActiveId(id);
      setQuery("");
      setSidebarOpen(false);
      await qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  // realtime: global conversation refresh
  useEffect(() => {
    const uid = me.data?.profile?.id;
    if (!uid) return;
    const invalidate = () => qc.invalidateQueries({ queryKey: ["conversations"] });
    const ch = supabase
      .channel(`user:${uid}:convos`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, invalidate)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members" },
        invalidate,
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me.data?.profile?.id, qc]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  const active: Conversation | null = (convos.data ?? []).find((c) => c.id === activeId) ?? null;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* ambient */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/3 h-[420px] w-[720px] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--electric) 22%, transparent), transparent)",
        }}
      />

      {/* topbar */}
      <header className="glass sticky top-0 z-30 flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Chats"
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] transition hover:bg-white/[0.06] md:hidden"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-md avatar-gradient text-[11px]">
              W
            </span>
            Whispr
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted-foreground md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
            Encrypted in transit &amp; at rest
          </span>
          <Link
            to="/settings"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs transition-colors hover:bg-white/[0.06]"
          >
            Settings
          </Link>
          <button
            onClick={signOut}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs transition-colors hover:bg-white/[0.06]"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="relative grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_1fr]">
        {/* Sidebar */}
        <aside
          className={`${sidebarOpen ? "flex" : "hidden"} absolute inset-0 z-20 min-h-0 flex-col border-r border-white/5 bg-black/60 backdrop-blur-2xl md:relative md:z-auto md:flex md:bg-black/20`}
        >
          <div className="p-3">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-transparent focus:ring-focus"
              />
            </div>

            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setShowNewGroup(true)}
                className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium transition hover:bg-white/[0.06]"
              >
                + New group
              </button>
            </div>

            {query.trim().length >= 2 && (
              <div className="rise-in mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/40">
                {results.isLoading && (
                  <p className="p-3 text-xs text-muted-foreground">Searching…</p>
                )}
                {results.data?.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">No users found.</p>
                )}
                <ul>
                  {(results.data ?? [])
                    .filter((u) => u.id !== me.data?.profile?.id)
                    .map((u) => (
                      <li key={u.id}>
                        <button
                          disabled={openDirect.isPending}
                          onClick={() => openDirect.mutate(u.id)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                        >
                          <Avatar
                            name={u.display_name ?? u.username ?? "?"}
                            url={u.avatar_url}
                            seed={u.id}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm">
                              {u.display_name ?? u.username ?? "Unknown"}
                            </p>
                            {u.username && (
                              <p className="truncate text-xs text-muted-foreground">
                                @{u.username}
                              </p>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {convos.isLoading && (
              <div className="space-y-2 p-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-3">
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/5" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-white/5" />
                      <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/5" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {convos.data?.length === 0 && (
              <div className="mx-2 mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center">
                <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full avatar-gradient">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium">No chats yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Search above to find someone and say hello.
                </p>
              </div>
            )}
            <ul className="space-y-0.5">
              {(convos.data ?? []).map((c) => {
                const title = conversationTitle(c);
                const isActive = activeId === c.id;
                const muted = c.muted_until && Date.parse(c.muted_until) > Date.now();
                const previewText = c.preview
                  ? c.preview.sender_id === me.data?.profile?.id
                    ? `You: ${c.preview.text || "sent a message"}`
                    : c.preview.text || "…"
                  : "No messages yet";
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setActiveId(c.id);
                        setSidebarOpen(false);
                      }}
                      className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all ${
                        isActive ? "bg-white/[0.06] shadow-inner" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <Avatar
                        name={title}
                        url={c.avatar_url ?? c.peer?.avatar_url ?? null}
                        seed={c.peer?.id ?? c.id}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                            {c.is_pinned && (
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className="shrink-0 text-muted-foreground"
                              >
                                <path d="M12 2 8 6v6l-4 3v2h6v5h4v-5h6v-2l-4-3V6z" />
                              </svg>
                            )}
                            <span className="truncate">{title}</span>
                            {muted && (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="shrink-0 text-muted-foreground/70"
                              >
                                <path d="M3 3l18 18M6 8v6l-3 2h12M15 5a4 4 0 0 1 4 4v3" />
                              </svg>
                            )}
                          </p>
                          <span className="shrink-0 text-[10px] text-muted-foreground/70">
                            {formatWhen(c.last_message_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-muted-foreground">{previewText}</p>
                          {c.unread_count > 0 && (
                            <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-electric px-1 text-[10px] font-semibold text-electric-foreground">
                              {c.unread_count > 99 ? "99+" : c.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* Main pane */}
        <section className="flex min-h-0 flex-col">
          {active ? (
            <ChatPane
              key={active.id}
              conversation={active}
              currentUserId={me.data?.profile?.id ?? ""}
            />
          ) : (
            <EmptyState />
          )}
        </section>
      </div>

      {showNewGroup && (
        <NewGroupModal
          onClose={() => setShowNewGroup(false)}
          currentUserId={me.data?.profile?.id ?? ""}
          onCreated={async (id) => {
            setShowNewGroup(false);
            await qc.invalidateQueries({ queryKey: ["conversations"] });
            setActiveId(id);
          }}
        />
      )}
    </div>
  );
}

function conversationTitle(c: Conversation): string {
  if (c.title) return c.title;
  if (c.peer?.display_name) return c.peer.display_name;
  if (c.peer?.username) return `@${c.peer.username}`;
  if (c.type === "group" && c.members.length > 0) {
    return c.members
      .slice(0, 3)
      .map((m) => m.display_name ?? m.username ?? "?")
      .join(", ");
  }
  return "Direct message";
}

/* ---------------- empty state ---------------- */

function EmptyState() {
  return (
    <div className="fade-in hidden flex-1 items-center justify-center p-8 text-center md:flex">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl avatar-gradient shadow-lg shadow-electric/20">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">
          Your conversations, in one calm place
        </h2>
        <p className="mx-auto mt-2 text-sm text-muted-foreground">
          Pick a chat from the sidebar, or search for someone by name or{" "}
          <span className="text-foreground">@username</span> to start a new one.
        </p>
      </div>
    </div>
  );
}

/* ---------------- chat pane ---------------- */

type ReplyContext = { id: string; text: string; sender_id: string | null } | null;

function ChatPane({
  conversation,
  currentUserId,
}: {
  conversation: Conversation;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const fetchMessages = useServerFn(listMessages);
  const send = useServerFn(sendChatMessage);
  const edit = useServerFn(editMessageFn);
  const del = useServerFn(deleteMessageFn);
  const react = useServerFn(toggleReaction);
  const pinToggle = useServerFn(setMessagePinned);
  const markRead = useServerFn(markConversationRead);
  const setPinned = useServerFn(setConversationPinned);
  const setMuted = useServerFn(setConversationMuted);
  const uploadFn = useServerFn(createUploadUrl);
  const sendMedia = useServerFn(sendMediaMessage);

  const key = ["messages", conversation.id] as const;

  const messages = useQuery({
    queryKey: key,
    queryFn: () => fetchMessages({ data: { conversationId: conversation.id, limit: 120 } }),
  });

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyContext>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [typingPeers, setTypingPeers] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [nativeTextByMessageId, setNativeTextByMessageId] = useState<Record<string, string>>({});
  const [nativeSecurityError, setNativeSecurityError] = useState<string | null>(null);
  const isNativeDirect =
    detectRuntime() === "tauri" && conversation.type === "direct" && !!conversation.peer?.id;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversation.id]);

  useEffect(() => {
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

  // Realtime: messages + reactions + attachments + typing broadcast
  useEffect(() => {
    const invalidate = () => qc.invalidateQueries({ queryKey: key });
    const invalidateAll = () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    };
    const ch = supabase
      .channel(`conv:${conversation.id}`, { config: { broadcast: { self: false } } })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        invalidateAll,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_attachments" },
        invalidate,
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { userId: string };
        if (!p?.userId || p.userId === currentUserId) return;
        setTypingPeers((prev) => ({ ...prev, [p.userId]: Date.now() + 4000 }));
      })
      .subscribe();
    typingChannelRef.current = ch;
    return () => {
      typingChannelRef.current = null;
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, qc, currentUserId]);

  // Prune stale typing indicators
  useEffect(() => {
    const t = window.setInterval(() => {
      setTypingPeers((prev) => {
        const now = Date.now();
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev)) if (v > now) next[k] = v;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // Mark read when new tail arrives
  useEffect(() => {
    const list = messages.data;
    if (!list?.length) return;
    const last = list[list.length - 1];
    if (!last) return;
    void markRead({ data: { conversationId: conversation.id, lastMessageId: last.id } });
  }, [messages.data, conversation.id, markRead]);

  const sendMut = useMutation({
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

  const editMut = useMutation({
    mutationFn: (v: { id: string; text: string }) =>
      edit({ data: { messageId: v.id, text: v.text } }),
    onSuccess: () => {
      setEditingId(null);
      setText("");
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { messageId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const reactMut = useMutation({
    mutationFn: (v: { id: string; emoji: string }) =>
      react({ data: { messageId: v.id, emoji: v.emoji } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const pinMut = useMutation({
    mutationFn: (v: { id: string; pinned: boolean }) =>
      pinToggle({ data: { messageId: v.id, pinned: v.pinned } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const pinConvMut = useMutation({
    mutationFn: () =>
      setPinned({ data: { conversationId: conversation.id, pinned: !conversation.is_pinned } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const muteConvMut = useMutation({
    mutationFn: () => {
      const isMuted = conversation.muted_until && Date.parse(conversation.muted_until) > Date.now();
      const until = isMuted ? null : new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString();
      return setMuted({
        data: { conversationId: conversation.id, mutedUntil: until },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const title = useMemo(() => conversationTitle(conversation), [conversation]);
  const senderNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of conversation.members) {
      m.set(mem.id, mem.display_name ?? mem.username ?? "Unknown");
    }
    return m;
  }, [conversation.members]);

  function submit() {
    const body = text.trim();
    if (!body) return;
    if (editingId) {
      editMut.mutate({ id: editingId, text: body });
      return;
    }
    if (sendMut.isPending) return;
    sendMut.mutate(body);
  }

  function startReply(m: ChatMessage) {
    setEditingId(null);
    setReplyTo({ id: m.id, text: m.text, sender_id: m.sender_id });
    inputRef.current?.focus();
  }

  function startEdit(m: ChatMessage) {
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

  function cancelEdit() {
    setEditingId(null);
    setText("");
  }

  const broadcastTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2500) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: currentUserId },
    });
  }, [currentUserId]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (isNativeDirect) {
        setNativeSecurityError(
          "Encrypted attachments are not enabled yet. Whispr will not upload this file through the plaintext media path.",
        );
        return;
      }
      const usable = Array.from(files).slice(0, 6);
      setUploading(true);
      try {
        const uploaded: Array<{
          storagePath: string;
          mime: string;
          width?: number;
          height?: number;
          sizeBytes: number;
        }> = [];
        for (const f of usable) {
          if (f.size > 25 * 1024 * 1024) {
            alert(`${f.name} is too large (max 25MB).`);
            continue;
          }
          const info = await uploadFn({
            data: {
              conversationId: conversation.id,
              filename: f.name,
              contentType: f.type || "application/octet-stream",
            },
          });
          const { error } = await supabase.storage
            .from("chat-media")
            .uploadToSignedUrl(info.path, info.token, f, {
              contentType: f.type || undefined,
            });
          if (error) {
            alert(`Upload failed: ${error.message}`);
            continue;
          }
          const dims = await imageDims(f);
          uploaded.push({
            storagePath: info.path,
            mime: f.type || "application/octet-stream",
            sizeBytes: f.size,
            ...(dims ?? {}),
          });
        }
        if (uploaded.length > 0) {
          const looksImage = uploaded.every((u) => u.mime.startsWith("image/"));
          await sendMedia({
            data: {
              conversationId: conversation.id,
              text: text.trim() || undefined,
              replyToMessageId: replyTo?.id ?? null,
              attachments: uploaded,
              contentType: looksImage ? "image" : "file",
            },
          });
          setText("");
          setReplyTo(null);
          qc.invalidateQueries({ queryKey: key });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        }
      } finally {
        setUploading(false);
      }
    },
    [conversation.id, uploadFn, sendMedia, text, replyTo, qc, key, isNativeDirect],
  );

  // Group by day + sender-run
  const displayMessages = useMemo(
    () =>
      (messages.data ?? []).map((message) => {
        const nativeText = nativeTextByMessageId[message.id];
        return nativeText === undefined ? message : { ...message, text: nativeText };
      }),
    [messages.data, nativeTextByMessageId],
  );

  const grouped = useMemo(() => {
    const msgs = displayMessages;
    const out: Array<
      | { kind: "day"; iso: string; label: string }
      | { kind: "msg"; m: ChatMessage; sameAsPrev: boolean; sameAsNext: boolean; showName: boolean }
    > = [];
    let prevDay = "";
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]!;
      const day = new Date(m.created_at).toDateString();
      if (day !== prevDay) {
        out.push({ kind: "day", iso: m.created_at, label: formatDayLabel(m.created_at) });
        prevDay = day;
      }
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      const prevSameDay = prev && new Date(prev.created_at).toDateString() === day;
      const nextSameDay = next && new Date(next.created_at).toDateString() === day;
      const sameAsPrev = !!prev && prevSameDay && prev.sender_id === m.sender_id;
      const sameAsNext = !!next && nextSameDay && next.sender_id === m.sender_id;
      const showName =
        conversation.type !== "direct" && !sameAsPrev && m.sender_id !== currentUserId;
      out.push({ kind: "msg", m, sameAsPrev, sameAsNext, showName });
    }
    return out;
  }, [displayMessages, conversation.type, currentUserId]);

  const pinnedMsg = useMemo(
    () => displayMessages.find((m) => m.is_pinned && !m.deleted_at),
    [displayMessages],
  );

  const typingNames = Object.keys(typingPeers)
    .map((uid) => senderNameById.get(uid))
    .filter((x): x is string => !!x);

  const isMuted = !!(conversation.muted_until && Date.parse(conversation.muted_until) > Date.now());

  return (
    <div
      className="fade-in flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void handleFiles(e.dataTransfer.files);
      }}
    >
      {/* header */}
      <div className="glass flex items-center gap-3 border-b border-white/5 px-4 py-3 md:px-5">
        <Avatar
          name={title}
          url={conversation.avatar_url ?? conversation.peer?.avatar_url ?? null}
          seed={conversation.peer?.id ?? conversation.id}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
            {typingNames.length > 0
              ? `${typingNames.slice(0, 2).join(", ")} typing…`
              : conversation.type === "direct"
                ? "Direct message"
                : `${conversation.member_count} members`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <HeaderIconButton
            active={conversation.is_pinned}
            onClick={() => pinConvMut.mutate()}
            label={conversation.is_pinned ? "Unpin chat" : "Pin chat"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2 8 6v6l-4 3v2h6v5h4v-5h6v-2l-4-3V6z" />
            </svg>
          </HeaderIconButton>
          <HeaderIconButton
            active={isMuted}
            onClick={() => muteConvMut.mutate()}
            label={isMuted ? "Unmute" : "Mute 8 h"}
          >
            {isMuted ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3l18 18M6 8v6l-3 2h12M15 5a4 4 0 0 1 4 4v3" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 17h5l-1.4-1.4A7 7 0 0 1 17 11V8a5 5 0 0 0-10 0v3a7 7 0 0 1-1.6 4.6L4 17h5m6 0v1a3 3 0 0 1-6 0v-1" />
              </svg>
            )}
          </HeaderIconButton>
        </div>
      </div>

      {nativeSecurityError && (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-200 md:px-5">
          {nativeSecurityError}
        </div>
      )}

      {/* pinned banner */}
      {pinnedMsg && (
        <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-4 py-2 md:px-5">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-electric"
          >
            <path d="M12 2 8 6v6l-4 3v2h6v5h4v-5h6v-2l-4-3V6z" />
          </svg>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            <span className="text-foreground/80">Pinned:</span> {pinnedMsg.text || "(media)"}
          </p>
          <button
            onClick={() => pinMut.mutate({ id: pinnedMsg.id, pinned: false })}
            className="text-[11px] text-muted-foreground transition hover:text-foreground"
          >
            Unpin
          </button>
        </div>
      )}

      {/* messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 md:px-8">
        {messages.isLoading && <p className="text-sm text-muted-foreground">Loading messages…</p>}
        {messages.data?.length === 0 && (
          <div className="fade-in mx-auto mt-16 max-w-sm text-center">
            <p className="text-sm text-muted-foreground">
              This is the start of your conversation with{" "}
              <span className="text-foreground">{title}</span>.
            </p>
          </div>
        )}
        <ul className="mx-auto flex max-w-3xl flex-col">
          {grouped.map((row) =>
            row.kind === "day" ? (
              <li key={`d-${row.iso}`} className="my-3 flex items-center justify-center">
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {row.label}
                </span>
              </li>
            ) : (
              <MessageRow
                key={row.m.id}
                message={row.m}
                mine={row.m.sender_id === currentUserId}
                sameAsPrev={row.sameAsPrev}
                sameAsNext={row.sameAsNext}
                showName={row.showName}
                senderName={row.m.sender_id ? (senderNameById.get(row.m.sender_id) ?? "") : ""}
                onReply={() => startReply(row.m)}
                onEdit={() => startEdit(row.m)}
                onDelete={() => {
                  if (confirm("Delete this message for everyone?")) deleteMut.mutate(row.m.id);
                }}
                onReact={(emoji) => reactMut.mutate({ id: row.m.id, emoji })}
                onTogglePin={() => pinMut.mutate({ id: row.m.id, pinned: !row.m.is_pinned })}
                onOpenImage={setViewer}
              />
            ),
          )}
        </ul>
        <div ref={bottomRef} />
      </div>

      {/* typing dots */}
      {typingNames.length > 0 && (
        <div className="pointer-events-none mx-auto -mt-4 mb-1 flex max-w-3xl items-center gap-2 px-6 text-[11px] text-muted-foreground">
          <span className="inline-flex gap-0.5">
            <Dot delay={0} />
            <Dot delay={0.15} />
            <Dot delay={0.3} />
          </span>
          {typingNames.slice(0, 2).join(" & ")} typing…
        </div>
      )}

      {/* composer */}
      <div className="border-t border-white/5 bg-black/20 px-3 py-3 backdrop-blur-xl md:px-6 md:py-4">
        {(replyTo || editingId) && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5">
            <span className="h-8 w-0.5 shrink-0 rounded-full bg-electric" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-electric">
                {editingId ? "Editing" : "Replying to"}
                {replyTo?.sender_id && (
                  <span className="text-muted-foreground">
                    {" "}
                    {replyTo.sender_id === currentUserId
                      ? "yourself"
                      : (senderNameById.get(replyTo.sender_id) ?? "")}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {(editingId ? "" : replyTo?.text) || "(media)"}
              </p>
            </div>
            <button
              onClick={() => (editingId ? cancelEdit() : setReplyTo(null))}
              className="text-muted-foreground transition hover:text-foreground"
              aria-label="Cancel"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 pl-2 transition-all focus-within:ring-focus"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="Attach"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40"
          >
            {uploading ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="animate-spin"
              >
                <path d="M21 12a9 9 0 1 1-6.2-8.6" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21 12-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8L14 4.6a3.7 3.7 0 0 1 5.2 5.2L10.5 18.5a1.8 1.8 0 0 1-2.6-2.6L15 8.8" />
              </svg>
            )}
          </button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              broadcastTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape" && editingId) cancelEdit();
            }}
            rows={1}
            placeholder={editingId ? "Edit message" : `Message ${title}`}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="submit"
            disabled={!text.trim() || sendMut.isPending || editMut.isPending}
            aria-label={editingId ? "Save edit" : "Send"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-electric text-electric-foreground shadow-lg shadow-electric/30 transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {editingId ? (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4z" />
              </svg>
            )}
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground/60">
          Enter to send · Shift + Enter for a new line · Drop files to attach
        </p>
      </div>

      {viewer && <ImageViewer path={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

/* ---------------- message row ---------------- */

function MessageRow({
  message,
  mine,
  sameAsPrev,
  sameAsNext,
  showName,
  senderName,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onTogglePin,
  onOpenImage,
}: {
  message: ChatMessage;
  mine: boolean;
  sameAsPrev: boolean;
  sameAsNext: boolean;
  showName: boolean;
  senderName: string;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onTogglePin: () => void;
  onOpenImage: (path: string) => void;
}) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const topRadius = sameAsPrev ? "rounded-t-md" : "rounded-t-2xl";
  const bottomRadius = sameAsNext ? "rounded-b-md" : "rounded-b-2xl";
  const spacing = sameAsPrev ? "mt-0.5" : "mt-3";
  const deleted = !!message.deleted_at;

  const bubbleTone = mine
    ? "bg-electric text-electric-foreground rounded-r-md shadow-lg shadow-electric/20"
    : "bg-white/[0.06] text-foreground rounded-l-md";
  const metaTone = mine ? "text-electric-foreground/70" : "text-muted-foreground";

  return (
    <li
      className={`bubble-in group relative flex ${mine ? "justify-end" : "justify-start"} ${spacing}`}
      onMouseLeave={() => {
        setShowEmoji(false);
        setShowMenu(false);
      }}
    >
      <div className={`flex max-w-[82%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {showName && senderName && (
          <p className="mb-0.5 pl-2 text-[11px] font-medium text-muted-foreground">{senderName}</p>
        )}
        <div className={`relative ${mine ? "flex-row-reverse" : ""} flex items-end gap-1.5`}>
          <div
            className={[
              "px-3.5 py-2 text-[14px] leading-relaxed",
              topRadius,
              bottomRadius,
              deleted ? "bg-white/[0.03] italic text-muted-foreground" : bubbleTone,
            ].join(" ")}
          >
            {message.forwarded_from_message_id && !deleted && (
              <p
                className={`mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider ${metaTone}`}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 17l5-5-5-5M4 18v-2a4 4 0 0 1 4-4h12" />
                </svg>
                Forwarded
              </p>
            )}
            {message.reply_to && !deleted && (
              <div
                className={`mb-1.5 rounded-lg border-l-2 border-white/40 px-2 py-1 text-[12px] ${
                  mine ? "bg-black/10" : "bg-white/[0.05]"
                }`}
              >
                <p className="truncate opacity-80">{message.reply_to.text || "(media)"}</p>
              </div>
            )}
            {deleted ? (
              <p>This message was deleted</p>
            ) : (
              <>
                {message.attachments.length > 0 && (
                  <div
                    className={`mb-1 grid gap-1 ${message.attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
                  >
                    {message.attachments.map((a) => (
                      <AttachmentTile key={a.id} attachment={a} onOpen={onOpenImage} />
                    ))}
                  </div>
                )}
                {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
              </>
            )}
            {!sameAsNext && !deleted && (
              <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${metaTone}`}>
                {message.edited_at && <span className="italic">edited</span>}
                <span>
                  {new Date(message.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </p>
            )}
          </div>

          {/* action strip */}
          {!deleted && (
            <div
              className={`pointer-events-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${
                showEmoji || showMenu ? "opacity-100" : ""
              }`}
            >
              <ActionButton
                label="React"
                onClick={() => {
                  setShowEmoji((v) => !v);
                  setShowMenu(false);
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
                </svg>
              </ActionButton>
              <ActionButton label="Reply" onClick={onReply}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2" />
                </svg>
              </ActionButton>
              <div className="relative">
                <ActionButton
                  label="More"
                  onClick={() => {
                    setShowMenu((v) => !v);
                    setShowEmoji(false);
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="19" cy="12" r="1.5" />
                  </svg>
                </ActionButton>
                {showMenu && (
                  <div
                    className={`absolute top-full z-10 mt-1 w-40 overflow-hidden rounded-xl border border-white/10 bg-black/80 py-1 text-xs backdrop-blur-xl ${mine ? "right-0" : "left-0"}`}
                  >
                    <MenuItem
                      onClick={() => {
                        setShowMenu(false);
                        onTogglePin();
                      }}
                    >
                      {message.is_pinned ? "Unpin" : "Pin"}
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setShowMenu(false);
                        if (message.text) void navigator.clipboard.writeText(message.text);
                      }}
                    >
                      Copy text
                    </MenuItem>
                    {mine && (
                      <>
                        <MenuItem
                          onClick={() => {
                            setShowMenu(false);
                            onEdit();
                          }}
                        >
                          Edit
                        </MenuItem>
                        <MenuItem
                          danger
                          onClick={() => {
                            setShowMenu(false);
                            onDelete();
                          }}
                        >
                          Delete
                        </MenuItem>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* emoji picker */}
          {showEmoji && !deleted && (
            <div
              className={`absolute top-full z-10 mt-1 flex gap-1 rounded-full border border-white/10 bg-black/80 px-2 py-1 shadow-2xl backdrop-blur-xl ${mine ? "right-8" : "left-8"}`}
            >
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    onReact(e);
                    setShowEmoji(false);
                  }}
                  className="text-lg transition-transform hover:scale-125"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* reactions row */}
        {message.reactions.length > 0 && !deleted && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => onReact(r.emoji)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
                  r.mine
                    ? "border-electric/50 bg-electric/15 text-foreground"
                    : "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]"
                }`}
              >
                <span>{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/* ---------------- attachment tile ---------------- */

function AttachmentTile({
  attachment,
  onOpen,
}: {
  attachment: ChatMessage["attachments"][number];
  onOpen: (path: string) => void;
}) {
  const sign = useServerFn(signAttachment);
  const q = useQuery({
    queryKey: ["attach", attachment.storage_path],
    queryFn: () => sign({ data: { path: attachment.storage_path, expiresIn: 600 } }),
    staleTime: 8 * 60 * 1000,
  });

  const isImage = (attachment.mime_hint ?? "").startsWith("image/");

  if (isImage) {
    return (
      <button
        onClick={() => onOpen(attachment.storage_path)}
        className="group/img relative block max-w-[280px] overflow-hidden rounded-lg bg-black/40"
        style={{
          aspectRatio:
            attachment.width && attachment.height
              ? `${attachment.width}/${attachment.height}`
              : "4/3",
        }}
      >
        {q.data?.url ? (
          <img
            src={q.data.url}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover/img:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-white/5" />
        )}
      </button>
    );
  }

  return (
    <a
      href={q.data?.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs transition hover:bg-white/[0.06]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="truncate">{attachment.storage_path.split("/").pop()}</span>
    </a>
  );
}

/* ---------------- image viewer ---------------- */

function ImageViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const sign = useServerFn(signAttachment);
  const q = useQuery({
    queryKey: ["attach", path, "full"],
    queryFn: () => sign({ data: { path, expiresIn: 600 } }),
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur-xl"
      onClick={onClose}
    >
      {q.data?.url && (
        // eslint-disable-next-line jsx-a11y/img-redundant-alt
        <img
          src={q.data.url}
          alt="Attachment"
          className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/60 text-white"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/* ---------------- new group modal ---------------- */

function NewGroupModal({
  onClose,
  currentUserId,
  onCreated,
}: {
  onClose: () => void;
  currentUserId: string;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, { id: string; name: string }>>({});
  const search = useServerFn(searchUsers);
  const create = useServerFn(createGroupConversation);
  const results = useQuery({
    queryKey: ["searchG", q],
    queryFn: () => search({ data: { query: q, limit: 12 } }),
    enabled: q.trim().length >= 2,
  });
  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          title: title.trim(),
          memberIds: Object.keys(selected).filter((id) => id !== currentUserId),
        },
      }),
    onSuccess: ({ id }) => onCreated(id),
  });
  const canCreate = title.trim().length > 0 && Object.keys(selected).length >= 1;

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-xl"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">New group</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Group name"
          className="mb-3 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:ring-focus"
        />
        {Object.keys(selected).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {Object.values(selected).map((s) => (
              <button
                key={s.id}
                onClick={() =>
                  setSelected((prev) => {
                    const n = { ...prev };
                    delete n[s.id];
                    return n;
                  })
                }
                className="flex items-center gap-1 rounded-full border border-electric/40 bg-electric/15 px-2 py-0.5 text-xs"
              >
                {s.name}
                <span className="text-muted-foreground">×</span>
              </button>
            ))}
          </div>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people to add"
          className="mb-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:ring-focus"
        />
        <div className="max-h-56 overflow-y-auto rounded-xl border border-white/5">
          {(results.data ?? [])
            .filter((u) => u.id !== currentUserId)
            .map((u) => {
              const isSel = !!selected[u.id];
              const name = u.display_name ?? u.username ?? "Unknown";
              return (
                <button
                  key={u.id}
                  onClick={() =>
                    setSelected((prev) => {
                      const n = { ...prev };
                      if (isSel) delete n[u.id];
                      else n[u.id] = { id: u.id, name };
                      return n;
                    })
                  }
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition ${
                    isSel ? "bg-electric/10" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <Avatar name={name} url={u.avatar_url} seed={u.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{name}</p>
                    {u.username && (
                      <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
                    )}
                  </div>
                  {isSel && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-electric"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs"
          >
            Cancel
          </button>
          <button
            disabled={!canCreate || createMut.isPending}
            onClick={() => createMut.mutate()}
            className="rounded-lg bg-electric px-3 py-2 text-xs font-medium text-electric-foreground disabled:opacity-50"
          >
            {createMut.isPending ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- small primitives ---------------- */

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1 w-1 animate-bounce rounded-full bg-current"
      style={{ animationDelay: `${delay}s`, animationDuration: "1s" }}
    />
  );
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-black/40 text-muted-foreground backdrop-blur-md transition hover:bg-white/[0.08] hover:text-foreground"
    >
      {children}
    </button>
  );
}

function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left transition hover:bg-white/[0.06] ${
        danger ? "text-red-400" : ""
      }`}
    >
      {children}
    </button>
  );
}

function HeaderIconButton({
  onClick,
  label,
  children,
  active,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition ${
        active
          ? "border-electric/40 bg-electric/15 text-electric"
          : "border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------- avatar ---------------- */

function Avatar({
  name,
  url,
  seed,
  size = "sm",
}: {
  name: string;
  url: string | null;
  seed?: string;
  size?: "sm" | "md";
}) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  const dims = size === "md" ? "h-10 w-10 text-sm" : "h-10 w-10 text-sm";
  const hue = hueFromString(seed ?? name ?? "?");

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`${dims} shrink-0 rounded-full object-cover ring-1 ring-white/10`}
      />
    );
  }
  return (
    <div
      className={`${dims} grid shrink-0 place-items-center rounded-full font-semibold ring-1 ring-white/10`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 40) % 360} 70% 30%))`,
        color: "white",
      }}
    >
      {initial}
    </div>
  );
}

/* ---------------- utils ---------------- */

async function imageDims(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
