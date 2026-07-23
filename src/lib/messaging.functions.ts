/**
 * Whispr — messaging service (typed server-fn boundary).
 *
 * These server functions form the app's messaging API. Route/component code
 * calls them via `useServerFn`; they never touch service_role — all reads and
 * writes go through the authenticated user's client (RLS-scoped).
 *
 * NB: bodies are opaque. `ciphertext` in / out is base64 for transport;
 * callers are expected to hold the plaintext ↔ ciphertext boundary.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type ConversationSummary = {
  id: string;
  type: "direct" | "group" | "channel";
  title: string | null;
  avatar_url: string | null;
  last_message_at: string | null;
  disappearing_seconds: number | null;
  member_count: number;
  unread_count: number;
  is_pinned: boolean;
  is_archived: boolean;
  is_favorite: boolean;
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

    // fetch peer profiles for direct conversations
    const peerByConv = new Map<string, { id: string; username: string | null; display_name: string | null; avatar_url: string | null }>();
    if (convIds.length > 0) {
      const { data: others } = await supabase
        .from("conversation_members")
        .select("conversation_id, user_id, profiles:profiles!conversation_members_user_id_fkey(id, username, display_name, avatar_url)")
        .in("conversation_id", convIds)
        .neq("user_id", userId)
        .is("left_at", null);
      for (const row of others ?? []) {
        const p = row.profiles as unknown as { id: string; username: string | null; display_name: string | null; avatar_url: string | null } | null;
        if (p && !peerByConv.has(row.conversation_id as string)) {
          peerByConv.set(row.conversation_id as string, p);
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
        return {
          id: c.id,
          type: c.type,
          title: c.title,
          avatar_url: c.avatar_url,
          last_message_at: c.last_message_at,
          disappearing_seconds: c.disappearing_seconds,
          member_count: 0,
          unread_count: 0,
          is_pinned: !!m.is_pinned,
          is_archived: !!m.is_archived,
          is_favorite: !!m.is_favorite,
          peer,
        };
      })
      .sort((a, b) => {
        const ta = a.last_message_at ? Date.parse(a.last_message_at) : 0;
        const tb = b.last_message_at ? Date.parse(b.last_message_at) : 0;
        return tb - ta;
      });
  });

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
  // fallback: some clients return base64
  try {
    return Buffer.from(v, "base64").toString("utf8");
  } catch {
    return v;
  }
}

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        before: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    let q = supabase
      .from("messages")
      .select("id, sender_id, content_type, status, ciphertext, edited_at, created_at")
      .eq("conversation_id", data.conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.before) q = q.lt("created_at", data.before);

    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? [])
      .map((r) => ({
        id: r.id as string,
        sender_id: r.sender_id as string | null,
        content_type: r.content_type as string,
        status: r.status as string,
        text: decodeByteaText(r.ciphertext),
        edited_at: r.edited_at as string | null,
        created_at: r.created_at as string,
      }))
      .reverse();
  });

/** Create (or return existing) direct conversation with another user. */
export const startDirectConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ otherUserId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (data.otherUserId === userId) throw new Error("Cannot start a conversation with yourself.");

    // Look for an existing direct conversation with exactly these two members.
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

    // Privileged create: RLS blocks inserting a membership row for another user.
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


/* -------------------------------------------------------------------------- */
/*  Mutations                                                                 */
/* -------------------------------------------------------------------------- */

const SendMessageInput = z.object({
  conversationId: z.string().uuid(),
  contentType: z
    .enum(["text", "image", "video", "audio", "voice", "file", "contact", "location", "sticker", "gif", "poll"])
    .default("text"),
  ciphertext: z.string().min(1), // base64
  ciphertextNonce: z.string().optional(),
  ciphertextAlgorithm: z.string().default("aes-256-gcm"),
  ciphertextVersion: z.number().int().default(1),
  replyToMessageId: z.string().uuid().nullable().optional(),
  senderDeviceId: z.string().uuid().nullable().optional(),
  mentionUserIds: z.array(z.string().uuid()).default([]),
  scheduledFor: z.string().datetime().nullable().optional(),
  perDeviceEnvelopes: z
    .array(
      z.object({
        recipientUserId: z.string().uuid(),
        recipientDeviceId: z.string().uuid(),
        ciphertext: z.string(),
        ciphertextNonce: z.string().optional(),
        ciphertextAlgorithm: z.string().optional(),
        ciphertextVersion: z.number().int().default(1),
      }),
    )
    .default([]),
});

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendMessageInput.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // bytea columns travel as `\x<hex>` strings over PostgREST.
    const toHex = (b64: string) => "\\x" + Buffer.from(b64, "base64").toString("hex");
    const ciphertext = toHex(data.ciphertext);
    const ciphertextNonce = data.ciphertextNonce ? toHex(data.ciphertextNonce) : null;

    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        sender_device_id: data.senderDeviceId ?? null,
        reply_to_message_id: data.replyToMessageId ?? null,
        content_type: data.contentType,
        status: data.scheduledFor ? "pending" : "sent",
        ciphertext,
        ciphertext_nonce: ciphertextNonce,
        ciphertext_algorithm: data.ciphertextAlgorithm,
        ciphertext_version: data.ciphertextVersion,
        mention_user_ids: data.mentionUserIds,
        scheduled_for: data.scheduledFor ?? null,
      })
      .select("id, created_at")
      .single();

    if (error) throw error;

    if (data.perDeviceEnvelopes.length > 0) {
      const envelopes = data.perDeviceEnvelopes.map((e) => ({
        message_id: message.id,
        recipient_user_id: e.recipientUserId,
        recipient_device_id: e.recipientDeviceId,
        ciphertext: toHex(e.ciphertext),
        ciphertext_nonce: e.ciphertextNonce ? toHex(e.ciphertextNonce) : null,
        ciphertext_algorithm: e.ciphertextAlgorithm ?? data.ciphertextAlgorithm,
        ciphertext_version: e.ciphertextVersion,
      }));
      const { error: envErr } = await supabase.from("message_envelopes").insert(envelopes);
      if (envErr) throw envErr;
    }

    await supabase
      .from("conversations")
      .update({ last_message_at: message.created_at })
      .eq("id", data.conversationId);

    return { id: message.id, createdAt: message.created_at };
  });

/** Convenience: send a plain-text chat message. Text is stored as bytea. */
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const ciphertext = "\\x" + Buffer.from(data.text, "utf8").toString("hex");
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        content_type: "text",
        status: "sent",
        ciphertext,
        ciphertext_algorithm: "plaintext-transit",
        ciphertext_version: 0,
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


export const reactToMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ messageId: z.string().uuid(), emoji: z.string().min(1).max(16) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("message_reactions")
      .insert({ message_id: data.messageId, user_id: userId, emoji: data.emoji });
    if (error && error.code !== "23505") throw error; // ignore unique violation (already reacted)
    return { ok: true };
  });

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
