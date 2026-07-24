/**
 * Whispr — privacy snapshot.
 *
 * Returns a plain-English breakdown of exactly what Whispr stores about the
 * authenticated user. Used by the /privacy dashboard so the user can verify —
 * not just trust — the "minimal metadata" claim.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPrivacySnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [
      { data: profile },
      { data: priv },
      { data: devices },
      { data: sessions },
      { count: conversationCount },
      { count: messageCount },
      { count: contactCount },
      { count: blockCount },
      { data: usernames },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, bio, avatar_url, discoverable, created_at")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("account_private")
        .select("user_id, recovery_email, phone_number, status, created_at, privacy_preferences")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("devices")
        .select("id, name, platform, status, created_at, last_active_at")
        .eq("user_id", userId)
        .is("revoked_at", null),
      supabase
        .from("sessions")
        .select("id, user_agent, location_hint, started_at, last_seen_at")
        .eq("user_id", userId)
        .is("revoked_at", null),
      supabase
        .from("conversation_members")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("sender_id", userId),
      supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", userId),
      supabase
        .from("blocks")
        .select("*", { count: "exact", head: true })
        .eq("blocker_id", userId),
      supabase
        .from("usernames")
        .select("username, reserved_at, released_at")
        .eq("user_id", userId)
        .is("released_at", null),
    ]);

    return {
      profile,
      privateAccount: priv,
      devices: devices ?? [],
      sessions: sessions ?? [],
      usernames: usernames ?? [],
      counts: {
        conversations: conversationCount ?? 0,
        messagesSent: messageCount ?? 0,
        contacts: contactCount ?? 0,
        blocks: blockCount ?? 0,
      },
    };
  });

export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Record the deletion request inside the privacy_preferences JSON so it's
    // auditable without needing a schema change. An operator process reviews and
    // completes deletion out of band — kept out of the app to prevent accidents.
    const { data: current } = await supabase
      .from("account_private")
      .select("privacy_preferences")
      .eq("user_id", userId)
      .maybeSingle();
    const prefs = (current?.privacy_preferences as Record<string, unknown> | null) ?? {};
    const updated = { ...prefs, deletion_requested_at: new Date().toISOString() };
    const { error } = await supabase
      .from("account_private")
      .update({ privacy_preferences: updated })
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true as const };
  });
