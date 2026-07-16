/**
 * Whispr — contacts, blocks, and username search.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMyContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("contacts")
      .select(
        `id, nickname, is_favorite, created_at,
         profile:profiles!contacts_contact_user_id_fkey (
           id, username, display_name, avatar_url, status_emoji, status_text
         )`,
      )
      .eq("owner_id", userId)
      .order("is_favorite", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const addContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ contactUserId: z.string().uuid(), nickname: z.string().max(64).optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("contacts")
      .insert({ owner_id: userId, contact_user_id: data.contactUserId, nickname: data.nickname ?? null });
    if (error && error.code !== "23505") throw error;
    return { ok: true };
  });

export const removeContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ contactUserId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("owner_id", userId)
      .eq("contact_user_id", data.contactUserId);
    if (error) throw error;
    return { ok: true };
  });

export const blockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), reason: z.string().max(280).optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("blocks")
      .insert({ blocker_id: userId, blocked_id: data.userId, reason: data.reason ?? null });
    if (error && error.code !== "23505") throw error;
    return { ok: true };
  });

export const unblockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker_id", userId)
      .eq("blocked_id", data.userId);
    if (error) throw error;
    return { ok: true };
  });

export const searchUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().min(1).max(64), limit: z.number().int().min(1).max(50).default(20) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const like = `%${data.query.replaceAll("%", "\\%")}%`;
    const { data: rows, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, is_verified")
      .or(`username.ilike.${like},display_name.ilike.${like}`)
      .eq("discoverable", true)
      .is("deleted_at", null)
      .limit(data.limit);
    if (error) throw error;
    return rows ?? [];
  });
