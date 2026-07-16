/**
 * Whispr — communities & channels service.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMyCommunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("community_members")
      .select(
        `is_owner, joined_at,
         community:communities!inner ( id, slug, name, description, avatar_url, banner_url, visibility, member_count )`,
      )
      .eq("user_id", userId)
      .is("left_at", null)
      .is("banned_at", null);
    if (error) throw error;
    return data ?? [];
  });

export const discoverPublicCommunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().max(64).optional(), limit: z.number().int().min(1).max(50).default(20) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    let q = supabase
      .from("communities")
      .select("id, slug, name, description, avatar_url, banner_url, member_count, visibility")
      .eq("visibility", "public")
      .is("deleted_at", null)
      .order("member_count", { ascending: false })
      .limit(data.limit);
    if (data.query) q = q.ilike("name", `%${data.query}%`);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const createCommunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z.string().min(3).max(48).regex(/^[a-z0-9-]+$/),
        name: z.string().min(1).max(64),
        description: z.string().max(500).optional(),
        visibility: z.enum(["public", "private", "invite_only"]).default("private"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: community, error } = await supabase
      .from("communities")
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        visibility: data.visibility,
        created_by: userId,
      })
      .select("id, slug")
      .single();
    if (error) throw error;

    await supabase.from("community_members").insert({
      community_id: community.id,
      user_id: userId,
      is_owner: true,
    });

    // seed default role
    await supabase.from("community_roles").insert({
      community_id: community.id,
      name: "member",
      is_default: true,
      permissions: { post: true, react: true, invite: false },
    });

    return community;
  });

export const listChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ communityId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("channels")
      .select("id, slug, name, kind, description, position, conversation_id, is_private")
      .eq("community_id", data.communityId)
      .is("deleted_at", null)
      .order("position", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });
