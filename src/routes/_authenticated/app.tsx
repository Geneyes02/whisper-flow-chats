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

  // Realtime: when any of my conversations get a new message, refresh the list
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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <Link to="/" className="text-base font-semibold tracking-tight">
          Whispr
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">
            Encrypted in transit &amp; at rest — end-to-end encryption coming in a follow-up
          </span>
          <Link
            to="/_authenticated/settings"
            className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent"
          >
            Settings
          </Link>
          <button
            onClick={signOut}
            className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr]">
        {/* Sidebar */}
        <aside className="flex min-h-0 flex-col border-r border-border">
          <div className="border-b border-border p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search @username or name…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            {query.trim().length >= 2 && (
              <div className="mt-2 rounded-md border border-border">
                {results.isLoading && (
                  <p className="p-3 text-xs text-muted-foreground">Searching…</p>
                )}
                {results.data?.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">No users found.</p>
                )}
                <ul className="divide-y divide-border">
                  {(results.data ?? [])
                    .filter((u) => u.id !== me.data?.profile?.id)
                    .map((u) => (
                      <li key={u.id}>
                        <button
                          disabled={openDirect.isPending}
                          onClick={() => openDirect.mutate(u.id)}
                          className="flex w-full items-center gap-3 p-2 text-left hover:bg-accent"
                        >
                          <Avatar name={u.display_name ?? u.username ?? "?"} url={u.avatar_url} />
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

          <div className="min-h-0 flex-1 overflow-y-auto">
            {convos.isLoading && (
              <p className="p-4 text-sm text-muted-foreground">Loading conversations…</p>
            )}
            {convos.data?.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No conversations yet. Search for a user above to start chatting.
              </p>
            )}
            <ul>
              {(convos.data ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left hover:bg-accent ${
                      activeId === c.id ? "bg-accent" : ""
                    }`}
                  >
                    <Avatar
                      name={
                        c.title ??
                        c.peer?.display_name ??
                        c.peer?.username ??
                        (c.type === "direct" ? "?" : "#")
                      }
                      url={c.avatar_url ?? c.peer?.avatar_url ?? null}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.title ??
                          c.peer?.display_name ??
                          (c.peer?.username ? `@${c.peer.username}` : "Direct message")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.last_message_at
                          ? new Date(c.last_message_at).toLocaleString()
                          : "No messages yet"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Main pane */}
        <section className="flex min-h-0 flex-col">
          {active ? (
            <ChatPane
              conversation={active}
              currentUserId={me.data?.profile?.id ?? ""}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div>
                <h2 className="text-lg font-semibold">Select a conversation</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Or search for a user to start a new one.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length]);

  // Realtime for this conversation
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

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Avatar
          name={title}
          url={conversation.avatar_url ?? conversation.peer?.avatar_url ?? null}
        />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {conversation.type === "direct" ? "Direct message" : conversation.type}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.isLoading && (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        )}
        {messages.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Say hello.</p>
        )}
        <ul className="flex flex-col gap-2">
          {(messages.data ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} mine={m.sender_id === currentUserId} />
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body || sendMut.isPending) return;
          sendMut.mutate(body);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message…"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          autoFocus
        />
        <button
          type="submit"
          disabled={!text.trim() || sendMut.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </>
  );
}

function MessageBubble({ message, mine }: { message: Message; mine: boolean }) {
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
          mine
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <p className={`mt-1 text-[10px] ${mine ? "opacity-70" : "text-muted-foreground"}`}>
          {new Date(message.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </li>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  return url ? (
    <img
      src={url}
      alt={name}
      className="h-9 w-9 rounded-full object-cover"
    />
  ) : (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
      {initial}
    </div>
  );
}
