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

    return (memberships ?? [])
      .filter((m) => m.conversations && (m.conversations as unknown as { deleted_at: string | null }).deleted_at === null)
      .map((m): ConversationSummary => {
        const c = m.conversations as unknown as {
          id: string;
          type: "direct" | "group" | "channel";
          title: string | null;
          avatar_url: string | null;
          last_message_at: string | null;
          disappearing_seconds: number | null;
        };
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
        };
      });
  });

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
      .select("id, sender_id, content_type, status, ciphertext, ciphertext_nonce, ciphertext_algorithm, has_attachments, reply_to_message_id, edited_at, created_at")
      .eq("conversation_id", data.conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.before) q = q.lt("created_at", data.before);

    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
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
