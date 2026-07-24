/**
 * Whispr — messaging service (typed server-fn boundary).
 *
 * Route/component code calls these via `useServerFn`. RLS is enforced through
 * the authenticated user's client; privileged inserts (e.g. adding a peer to a
 * new direct conversation) use supabaseAdmin only when strictly necessary.
 *
 * Bodies are stored as opaque `bytea` so a future E2EE swap requires no schema
 * change. The current transit label is "plaintext-transit" — encrypted in
 * transit (TLS) and at rest (DB), not yet client-side E2EE.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Encode UTF-8 string to Postgres `bytea` wire format (`\x<hex>`). */
function textToBytea(s: string): string {
  return "\\x" + Buffer.from(s, "utf8").toString("hex");
}

/** Decode a Postgres bytea (\x<hex> or raw string) into a UTF-8 string. */
function decodeByteaText(v: unknown): string {
  if (typeof v !== "string") return "";
  if (v.startsWith("\\x")) {
    try {
      return Buffer.from(v.slice(2), "hex").toString("utf8");
    } catch {
      return "";
    }
  }
  try {
    return Buffer.from(v, "base64").toString("utf8");
  } catch {
    return v;
  }
}

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type Attachment = {
  id: string;
  storage_path: string;
  mime_hint: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  size_bytes: number | null;
};

export type ReactionAgg = { emoji: string; count: number; mine: boolean };

export type ChatMessage = {
  id: string;
  sender_id: string | null;
  content_type: string;
  status: string;
  text: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  is_pinned: boolean;
  reply_to_message_id: string | null;
  reply_to?: { id: string; text: string; sender_id: string | null } | null;
  forwarded_from_message_id: string | null;
  reactions: ReactionAgg[];
  attachments: Attachment[];
};

/* -------------------------------------------------------------------------- */
/*  Queries                                                                   */
/* -------------------------------------------------------------------------- */

export const listMyConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: memberships, error } = await supabase
      .from("conversation_members")
      .select(
        `
        conversation_id,
        is_pinned,
        is_archived,
        is_favorite,
        muted_until,
        last_read_message_id,
        conversations!inner (
          id, type, title, avatar_url, last_message_at, disappearing_seconds, deleted_at
        )
      `,
      )
      .eq("user_id", userId)
      .is("left_at", null);

    if (error) throw error;

    const active = (memberships ?? []).filter(
      (m) => m.conversations && (m.conversations as unknown as { deleted_at: string | null }).deleted_at === null,
    );

    const convIds = active.map((m) => (m.conversations as unknown as { id: string }).id);

    // peer profiles for direct chats + all members for group chats
    const peerByConv = new Map<string, { id: string; username: string | null; display_name: string | null; avatar_url: string | null }>();
    const membersByConv = new Map<string, Array<{ id: string; display_name: string | null; username: string | null; avatar_url: string | null }>>();
    if (convIds.length > 0) {
      const { data: others } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id, profiles:profiles!conversation_members_user_id_fkey(id, username, display_name, avatar_url)")
        .in("conversation_id", convIds)
        .is("left_at", null);
      for (const row of others ?? []) {
        const cid = row.conversation_id as string;
        const p = row.profiles as unknown as { id: string; username: string | null; display_name: string | null; avatar_url: string | null } | null;
        if (!p) continue;
        if (!membersByConv.has(cid)) membersByConv.set(cid, []);
        membersByConv.get(cid)!.push(p);
        if ((row.user_id as string) !== userId && !peerByConv.has(cid)) {
          peerByConv.set(cid, p);
        }
      }
    }

    // last-message preview + unread count
    const previewByConv = new Map<string, { text: string; sender_id: string | null; created_at: string; id: string }>();
    const unreadByConv = new Map<string, number>();

    if (convIds.length > 0) {
      const { data: recent } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, ciphertext, created_at, deleted_at")
        .in("conversation_id", convIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(convIds.length * 6);
      for (const r of recent ?? []) {
        const cid = r.conversation_id as string;
        if (!previewByConv.has(cid)) {
          previewByConv.set(cid, {
            id: r.id as string,
            text: decodeByteaText(r.ciphertext),
            sender_id: r.sender_id as string | null,
            created_at: r.created_at as string,
          });
        }
      }

      // unread = messages after last_read from other senders
      for (const m of active) {
        const cid = (m.conversations as unknown as { id: string }).id;
        const lastRead = (m as { last_read_message_id: string | null }).last_read_message_id;
        if (!lastRead) {
          // count all non-mine
          const { count } = await supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", cid)
            .is("deleted_at", null)
            .neq("sender_id", userId);
          if (count) unreadByConv.set(cid, count);
        } else {
          const { data: lr } = await supabase
            .from("messages")
            .select("created_at")
            .eq("id", lastRead)
            .maybeSingle();
          if (lr?.created_at) {
            const { count } = await supabase
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("conversation_id", cid)
              .is("deleted_at", null)
              .neq("sender_id", userId)
              .gt("created_at", lr.created_at as string);
            if (count) unreadByConv.set(cid, count);
          }
        }
      }
    }

    return active
      .map((m) => {
        const c = m.conversations as unknown as {
          id: string;
          type: "direct" | "group" | "channel";
          title: string | null;
          avatar_url: string | null;
          last_message_at: string | null;
          disappearing_seconds: number | null;
        };
        const peer = peerByConv.get(c.id) ?? null;
        const members = membersByConv.get(c.id) ?? [];
        const preview = previewByConv.get(c.id) ?? null;
        return {
          id: c.id,
          type: c.type,
          title: c.title,
          avatar_url: c.avatar_url,
          last_message_at: c.last_message_at,
          disappearing_seconds: c.disappearing_seconds,
          member_count: members.length,
          members,
          unread_count: unreadByConv.get(c.id) ?? 0,
          is_pinned: !!m.is_pinned,
          is_archived: !!m.is_archived,
          is_favorite: !!m.is_favorite,
          muted_until: (m as { muted_until: string | null }).muted_until,
          peer,
          preview,
        };
      })
      .sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        const ta = a.last_message_at ? Date.parse(a.last_message_at) : 0;
        const tb = b.last_message_at ? Date.parse(b.last_message_at) : 0;
        return tb - ta;
      });
  });

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        before: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(80),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<ChatMessage[]> => {
    const { supabase, userId } = context;

    let q = supabase
      .from("messages")
      .select(
        "id, sender_id, content_type, status, ciphertext, edited_at, deleted_at, created_at, is_pinned, reply_to_message_id, forwarded_from_message_id",
      )
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.before) q = q.lt("created_at", data.before);
    const { data: rows, error } = await q;
    if (error) throw error;

    const list = (rows ?? []).slice().reverse();
    const ids = list.map((r) => r.id as string);
    if (ids.length === 0) return [];

    // reactions + reply previews + attachments in parallel
    const [reactionsRes, replyRes, attachRes] = await Promise.all([
      supabase.from("message_reactions").select("message_id, user_id, emoji").in("message_id", ids),
      (() => {
        const replyIds = list
          .map((r) => r.reply_to_message_id as string | null)
          .filter((x): x is string => !!x);
        if (replyIds.length === 0) return Promise.resolve({ data: [] as Array<{ id: string; sender_id: string | null; ciphertext: string | null }> });
        return supabase.from("messages").select("id, sender_id, ciphertext").in("id", replyIds);
      })(),
      supabase
        .from("message_attachments")
        .select("id, message_id, storage_path, mime_hint, width, height, duration_seconds, size_bytes")
        .in("message_id", ids),
    ]);

    const reactionsByMsg = new Map<string, ReactionAgg[]>();
    for (const r of (reactionsRes.data ?? []) as Array<{ message_id: string; user_id: string; emoji: string }>) {
      const arr = reactionsByMsg.get(r.message_id) ?? [];
      const existing = arr.find((a) => a.emoji === r.emoji);
      if (existing) {
        existing.count += 1;
        if (r.user_id === userId) existing.mine = true;
      } else {
        arr.push({ emoji: r.emoji, count: 1, mine: r.user_id === userId });
      }
      reactionsByMsg.set(r.message_id, arr);
    }

    const replyById = new Map<string, { id: string; text: string; sender_id: string | null }>();
    for (const r of (replyRes.data ?? []) as Array<{ id: string; sender_id: string | null; ciphertext: string | null }>) {
      replyById.set(r.id, { id: r.id, text: decodeByteaText(r.ciphertext), sender_id: r.sender_id });
    }

    const attachByMsg = new Map<string, Attachment[]>();
    for (const a of (attachRes.data ?? []) as Array<Attachment & { message_id: string }>) {
      const arr = attachByMsg.get(a.message_id) ?? [];
      arr.push({
        id: a.id,
        storage_path: a.storage_path,
        mime_hint: a.mime_hint,
        width: a.width,
        height: a.height,
        duration_seconds: a.duration_seconds,
        size_bytes: a.size_bytes,
      });
      attachByMsg.set(a.message_id, arr);
    }

    return list.map((r) => {
      const rid = r.id as string;
      const deleted = (r.deleted_at as string | null) !== null;
      return {
        id: rid,
        sender_id: r.sender_id as string | null,
        content_type: r.content_type as string,
        status: r.status as string,
        text: deleted ? "" : decodeByteaText(r.ciphertext),
        edited_at: r.edited_at as string | null,
        deleted_at: r.deleted_at as string | null,
        created_at: r.created_at as string,
        is_pinned: !!r.is_pinned,
        reply_to_message_id: (r.reply_to_message_id as string | null) ?? null,
        reply_to: r.reply_to_message_id
          ? replyById.get(r.reply_to_message_id as string) ?? null
          : null,
        forwarded_from_message_id: (r.forwarded_from_message_id as string | null) ?? null,
        reactions: reactionsByMsg.get(rid) ?? [],
        attachments: attachByMsg.get(rid) ?? [],
      };
    });
  });

/** Create (or return existing) direct conversation with another user. */
export const startDirectConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ otherUserId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (data.otherUserId === userId) throw new Error("Cannot start a conversation with yourself.");

    const { data: mine } = await supabase
      .from("conversation_members")
      .select("conversation_id, conversations!inner(type, deleted_at)")
      .eq("user_id", userId)
      .is("left_at", null);
    const myDirect = (mine ?? [])
      .filter((m) => {
        const c = m.conversations as unknown as { type: string; deleted_at: string | null };
        return c.type === "direct" && c.deleted_at === null;
      })
      .map((m) => m.conversation_id as string);

    if (myDirect.length > 0) {
      const { data: theirs } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", data.otherUserId)
        .in("conversation_id", myDirect)
        .is("left_at", null);
      const existing = theirs?.[0]?.conversation_id as string | undefined;
      if (existing) return { id: existing, created: false };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .insert({ type: "direct", created_by: userId })
      .select("id")
      .single();
    if (convErr) throw convErr;
    const { error: memErr } = await supabaseAdmin.from("conversation_members").insert([
      { conversation_id: conv.id, user_id: userId, role: "member" },
      { conversation_id: conv.id, user_id: data.otherUserId, role: "member" },
    ]);
    if (memErr) throw memErr;
    return { id: conv.id as string, created: true };
  });

export const createGroupConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(80),
        memberIds: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: conv, error } = await supabaseAdmin
      .from("conversations")
      .insert({ type: "group", title: data.title, created_by: userId })
      .select("id")
      .single();
    if (error) throw error;

    const unique = Array.from(new Set([userId, ...data.memberIds]));
    const rows = unique.map((uid) => ({
      conversation_id: conv.id as string,
      user_id: uid,
      role: (uid === userId ? "owner" : "member") as "owner" | "member",
    }));
    const { error: memErr } = await supabaseAdmin.from("conversation_members").insert(rows);
    if (memErr) throw memErr;
    return { id: conv.id as string };
  });

/* -------------------------------------------------------------------------- */
/*  Mutations                                                                 */
/* -------------------------------------------------------------------------- */

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().min(1).max(4000),
        replyToMessageId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        content_type: "text",
        status: "sent",
        ciphertext: textToBytea(data.text),
        ciphertext_algorithm: "plaintext-transit",
        ciphertext_version: 0,
        reply_to_message_id: data.replyToMessageId ?? null,
      })
      .select("id, created_at")
      .single();
    if (error) throw error;
    await supabase
      .from("conversations")
      .update({ last_message_at: message.created_at })
      .eq("id", data.conversationId);
    return { id: message.id as string, createdAt: message.created_at as string };
  });

export const editMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ messageId: z.string().uuid(), text: z.string().min(1).max(4000) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("messages")
      .update({
        ciphertext: textToBytea(data.text),
        edited_at: new Date().toISOString(),
      })
      .eq("id", data.messageId)
      .eq("sender_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.messageId)
      .eq("sender_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const forwardMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sourceMessageId: z.string().uuid(),
        targetConversationId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: src, error: e1 } = await supabase
      .from("messages")
      .select("id, conversation_id, ciphertext, content_type")
      .eq("id", data.sourceMessageId)
      .maybeSingle();
    if (e1) throw e1;
    if (!src) throw new Error("Source message not found");

    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.targetConversationId,
        sender_id: userId,
        content_type: src.content_type as "text" | "image" | "video" | "audio" | "voice" | "file" | "gif" | "sticker",
        status: "sent",
        ciphertext: src.ciphertext as string,
        ciphertext_algorithm: "plaintext-transit",
        ciphertext_version: 0,
        forwarded_from_message_id: src.id as string,
        forwarded_from_conversation_id: src.conversation_id as string,
      })
      .select("id, created_at")
      .single();
    if (error) throw error;
    await supabase
      .from("conversations")
      .update({ last_message_at: message.created_at })
      .eq("id", data.targetConversationId);
    return { id: message.id as string };
  });

export const setMessagePinned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ messageId: z.string().uuid(), pinned: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("messages")
      .update({ is_pinned: data.pinned })
      .eq("id", data.messageId);
    if (error) throw error;
    return { ok: true };
  });

export const toggleReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ messageId: z.string().uuid(), emoji: z.string().min(1).max(16) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("message_reactions")
      .select("id")
      .eq("message_id", data.messageId)
      .eq("user_id", userId)
      .eq("emoji", data.emoji)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase.from("message_reactions").delete().eq("id", existing.id);
      if (error) throw error;
      return { reacted: false };
    }
    const { error } = await supabase
      .from("message_reactions")
      .insert({ message_id: data.messageId, user_id: userId, emoji: data.emoji });
    if (error && error.code !== "23505") throw error;
    return { reacted: true };
  });

/** Deprecated shim retained for backwards compatibility. */
export const reactToMessage = toggleReaction;

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversationId: z.string().uuid(), lastMessageId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_members")
      .update({ last_read_message_id: data.lastMessageId })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const setConversationPinned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversationId: z.string().uuid(), pinned: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_members")
      .update({ is_pinned: data.pinned })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const setConversationMuted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        mutedUntil: z.string().datetime().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_members")
      .update({ muted_until: data.mutedUntil })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const leaveConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("conversation_members")
      .update({ left_at: new Date().toISOString() })
      .eq("conversation_id", data.conversationId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*  Search                                                                    */
/* -------------------------------------------------------------------------- */

export const searchMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid().optional(),
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(30),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    // fetch a candidate set (recent, RLS-scoped) and filter by decoded text.
    let q = supabase
      .from("messages")
      .select("id, conversation_id, sender_id, ciphertext, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(400);
    if (data.conversationId) q = q.eq("conversation_id", data.conversationId);
    const { data: rows, error } = await q;
    if (error) throw error;
    const needle = data.query.toLowerCase();
    return (rows ?? [])
      .map((r) => ({
        id: r.id as string,
        conversation_id: r.conversation_id as string,
        sender_id: r.sender_id as string | null,
        text: decodeByteaText(r.ciphertext),
        created_at: r.created_at as string,
      }))
      .filter((m) => m.text.toLowerCase().includes(needle))
      .slice(0, data.limit);
  });

/* -------------------------------------------------------------------------- */
/*  Attachments                                                               */
/* -------------------------------------------------------------------------- */

export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        filename: z.string().min(1).max(200),
        contentType: z.string().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    // path: <conv>/<random>/<filename> — matches storage RLS split_part(name,'/',1)
    const safe = data.filename.replace(/[^\w.\-]+/g, "_");
    const path = `${data.conversationId}/${crypto.randomUUID()}/${safe}`;
    const { data: signed, error } = await supabase.storage
      .from("chat-media")
      .createSignedUploadUrl(path);
    if (error) throw error;
    return { path, token: signed.token, signedUrl: signed.signedUrl, contentType: data.contentType ?? null };
  });

export const sendMediaMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().max(4000).optional(),
        replyToMessageId: z.string().uuid().nullable().optional(),
        attachments: z
          .array(
            z.object({
              storagePath: z.string(),
              mime: z.string().optional(),
              width: z.number().int().optional(),
              height: z.number().int().optional(),
              sizeBytes: z.number().int().optional(),
              durationSeconds: z.number().int().optional(),
            }),
          )
          .min(1)
          .max(10),
        contentType: z
          .enum(["image", "video", "audio", "voice", "file"])
          .default("image"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        content_type: data.contentType,
        status: "sent",
        ciphertext: textToBytea(data.text ?? ""),
        ciphertext_algorithm: "plaintext-transit",
        ciphertext_version: 0,
        has_attachments: true,
        reply_to_message_id: data.replyToMessageId ?? null,
      })
      .select("id, created_at")
      .single();
    if (error) throw error;

    const rows = data.attachments.map((a) => ({
      message_id: message.id as string,
      storage_bucket: "chat-media",
      storage_path: a.storagePath,
      mime_hint: a.mime ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      size_bytes: a.sizeBytes ?? null,
      duration_seconds: a.durationSeconds ?? null,
    }));
    const { error: aerr } = await supabase.from("message_attachments").insert(rows);
    if (aerr) throw aerr;

    await supabase
      .from("conversations")
      .update({ last_message_at: message.created_at })
      .eq("id", data.conversationId);
    return { id: message.id as string };
  });

export const signAttachment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ path: z.string().min(1), expiresIn: z.number().int().min(60).max(3600).default(600) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: signed, error } = await supabase.storage
      .from("chat-media")
      .createSignedUrl(data.path, data.expiresIn);
    if (error) throw error;
    return { url: signed.signedUrl };
  });

/* -------------------------------------------------------------------------- */
/*  Invites (join a group/channel by short code)                              */
/* -------------------------------------------------------------------------- */

function randomInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        maxUses: z.number().int().min(1).max(10000).nullable().optional(),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    let code = "";
    for (let tries = 0; tries < 5; tries++) {
      code = randomInviteCode();
      const { data: row, error } = await supabase
        .from("conversation_invites")
        .insert({
          conversation_id: data.conversationId,
          code,
          created_by: userId,
          max_uses: data.maxUses ?? null,
          expires_at: data.expiresAt ?? null,
        })
        .select("id, code")
        .single();
      if (!error) return { code: row.code as string };
      if (error.code !== "23505") throw error; // retry only on unique clash
    }
    throw new Error("Could not allocate invite code");
  });

export const joinByInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: z.string().min(4).max(24) }).parse(input))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invite, error } = await supabaseAdmin
      .from("conversation_invites")
      .select("id, conversation_id, max_uses, uses, revoked_at, expires_at")
      .eq("code", data.code)
      .maybeSingle();
    if (error) throw error;
    if (!invite) throw new Error("Invite not found");
    if (invite.revoked_at) throw new Error("Invite revoked");
    if (invite.expires_at && Date.parse(invite.expires_at as string) < Date.now())
      throw new Error("Invite expired");
    if (invite.max_uses && (invite.uses as number) >= (invite.max_uses as number))
      throw new Error("Invite exhausted");

    // membership upsert
    const { data: existing } = await supabaseAdmin
      .from("conversation_members")
      .select("id, left_at")
      .eq("conversation_id", invite.conversation_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      if (existing.left_at) {
        await supabaseAdmin
          .from("conversation_members")
          .update({ left_at: null })
          .eq("id", existing.id);
      }
    } else {
      const { error: memErr } = await supabaseAdmin.from("conversation_members").insert({
        conversation_id: invite.conversation_id,
        user_id: userId,
        role: "member",
      });
      if (memErr) throw memErr;
    }
    await supabaseAdmin
      .from("conversation_invites")
      .update({ uses: (invite.uses as number) + 1 })
      .eq("id", invite.id);
    return { conversationId: invite.conversation_id as string };
  });
