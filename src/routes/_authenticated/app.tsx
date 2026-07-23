import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/profile.functions";
import { searchUsers } from "@/lib/contacts.functions";
import {
  listMessages,
  listMyConversations,
  sendChatMessage,
  startDirectConversation,
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
type Message = Awaited<ReturnType<typeof listMessages>>[number];

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
      await qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  useEffect(() => {
    const uid = me.data?.profile?.id;
    if (!uid) return;
    const ch = supabase
      .channel(`user:${uid}:conversations`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => qc.invalidateQueries({ queryKey: ["conversations"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me.data?.profile?.id, qc]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const active: Conversation | null =
    (convos.data ?? []).find((c) => c.id === activeId) ?? null;

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
      <header className="glass sticky top-0 z-20 flex items-center justify-between px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md avatar-gradient text-[11px]">W</span>
          Whispr
        </Link>
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
        <aside className="flex min-h-0 flex-col border-r border-white/5 bg-black/20 backdrop-blur-xl">
          <div className="p-3">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people or chats"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-transparent focus:ring-focus"
              />
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                const title =
                  c.title ??
                  c.peer?.display_name ??
                  (c.peer?.username ? `@${c.peer.username}` : "Direct message");
                const isActive = activeId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setActiveId(c.id)}
                      className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all ${
                        isActive
                          ? "bg-white/[0.06] shadow-inner"
                          : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <Avatar
                        name={title}
                        url={c.avatar_url ?? c.peer?.avatar_url ?? null}
                        seed={c.peer?.id ?? c.id}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium">{title}</p>
                          <span className="shrink-0 text-[10px] text-muted-foreground/70">
                            {formatWhen(c.last_message_at)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.last_message_at ? "Tap to open" : "No messages yet"}
                        </p>
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
    </div>
  );
}

/* ---------------- empty state ---------------- */

function EmptyState() {
  return (
    <div className="fade-in flex flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl avatar-gradient shadow-lg shadow-electric/20">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">Your conversations, in one calm place</h2>
        <p className="mx-auto mt-2 text-sm text-muted-foreground">
          Pick a chat from the sidebar, or search for someone by name or <span className="text-foreground">@username</span> to start a new one.
        </p>
      </div>
    </div>
  );
}

/* ---------------- chat pane ---------------- */

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

  const key = ["messages", conversation.id] as const;

  const messages = useQuery({
    queryKey: key,
    queryFn: () => fetchMessages({ data: { conversationId: conversation.id, limit: 100 } }),
  });

  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversation.id]);

  useEffect(() => {
    const ch = supabase
      .channel(`conv:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: key });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversation.id, qc]);

  const sendMut = useMutation({
    mutationFn: (body: string) =>
      send({ data: { conversationId: conversation.id, text: body } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const title = useMemo(
    () =>
      conversation.title ??
      conversation.peer?.display_name ??
      (conversation.peer?.username ? `@${conversation.peer.username}` : "Direct message"),
    [conversation],
  );

  function submit() {
    const body = text.trim();
    if (!body || sendMut.isPending) return;
    sendMut.mutate(body);
  }

  // Group messages into runs by sender for cleaner spacing
  const grouped = useMemo(() => {
    const msgs = messages.data ?? [];
    return msgs.map((m, i) => {
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      const sameAsPrev = prev?.sender_id === m.sender_id;
      const sameAsNext = next?.sender_id === m.sender_id;
      return { m, sameAsPrev, sameAsNext };
    });
  }, [messages.data]);

  return (
    <div className="fade-in flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="glass flex items-center gap-3 border-b border-white/5 px-5 py-3">
        <Avatar
          name={title}
          url={conversation.avatar_url ?? conversation.peer?.avatar_url ?? null}
          seed={conversation.peer?.id ?? conversation.id}
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
            {conversation.type === "direct" ? "Direct message" : conversation.type}
          </p>
        </div>
      </div>

      {/* messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {messages.isLoading && (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        )}
        {messages.data?.length === 0 && (
          <div className="fade-in mx-auto mt-16 max-w-sm text-center">
            <p className="text-sm text-muted-foreground">
              This is the start of your conversation with{" "}
              <span className="text-foreground">{title}</span>.
            </p>
          </div>
        )}
        <ul className="mx-auto flex max-w-3xl flex-col">
          {grouped.map(({ m, sameAsPrev, sameAsNext }) => (
            <MessageBubble
              key={m.id}
              message={m}
              mine={m.sender_id === currentUserId}
              sameAsPrev={sameAsPrev}
              sameAsNext={sameAsNext}
            />
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div className="border-t border-white/5 bg-black/20 px-3 py-3 backdrop-blur-xl md:px-6 md:py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 pl-3 transition-all focus-within:ring-focus"
        >
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={`Message ${title}`}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="submit"
            disabled={!text.trim() || sendMut.isPending}
            aria-label="Send"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-electric text-electric-foreground shadow-lg shadow-electric/30 transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4z" />
            </svg>
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground/60">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
}

/* ---------------- bubble ---------------- */

function MessageBubble({
  message,
  mine,
  sameAsPrev,
  sameAsNext,
}: {
  message: Message;
  mine: boolean;
  sameAsPrev: boolean;
  sameAsNext: boolean;
}) {
  const topRadius = sameAsPrev ? "rounded-t-md" : "rounded-t-2xl";
  const bottomRadius = sameAsNext ? "rounded-b-md" : "rounded-b-2xl";
  const spacing = sameAsPrev ? "mt-0.5" : "mt-3";

  return (
    <li className={`bubble-in flex ${mine ? "justify-end" : "justify-start"} ${spacing}`}>
      <div
        className={[
          "max-w-[78%] px-3.5 py-2 text-[14px] leading-relaxed",
          topRadius,
          bottomRadius,
          mine
            ? "bg-electric text-electric-foreground rounded-r-md shadow-lg shadow-electric/20"
            : "bg-white/[0.06] text-foreground rounded-l-md",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        {!sameAsNext && (
          <p
            className={`mt-1 text-[10px] ${
              mine ? "text-electric-foreground/70" : "text-muted-foreground"
            }`}
          >
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>
    </li>
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
