/**
 * Whispr — profile & identity service.
 *
 * Handles: read own profile + private account, update public profile,
 * claim/change username, look up users by username, register/list devices,
 * list active sessions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ---------------------------------- Profile ---------------------------------- */

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: priv }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("account_private").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    return { profile, private: priv, roles: (roles ?? []).map((r) => r.role) };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        display_name: z.string().min(1).max(64).optional(),
        avatar_url: z.string().url().nullable().optional(),
        banner_url: z.string().url().nullable().optional(),
        bio: z.string().max(240).nullable().optional(),
        status_text: z.string().max(64).nullable().optional(),
        status_emoji: z.string().max(8).nullable().optional(),
        discoverable: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("profiles").update(data).eq("id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const claimUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        username: z
          .string()
          .min(3)
          .max(24)
          .regex(/^[a-zA-Z0-9_.]+$/, "Only letters, numbers, dots and underscores"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const uname = data.username.toLowerCase();

    // Best-effort: rely on citext unique constraint on profiles.username.
    const { error } = await supabase
      .from("profiles")
      .update({ username: uname })
      .eq("id", userId);
    if (error) {
      if (error.code === "23505") return { ok: false as const, reason: "taken" as const };
      throw error;
    }
    await supabase.from("usernames").insert({ username: uname, user_id: userId }).select();
    return { ok: true as const };
  });

export const lookupProfileByUsername = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ username: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, bio, status_text, status_emoji, is_verified")
      .eq("username", data.username.toLowerCase())
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return profile;
  });

/* ---------------------------------- Devices ---------------------------------- */

export const listMyDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("devices")
      .select("id, name, platform, status, last_active_at, fingerprint, key_algorithm, key_version, registered_at")
      .eq("user_id", userId)
      .order("last_active_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  });

export const registerDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(64),
        platform: z.enum(["ios", "android", "macos", "windows", "linux", "web"]),
        publicIdentityKey: z.string().optional(), // base64
        publicSignedPrekey: z.string().optional(),
        signedPrekeySignature: z.string().optional(),
        keyAlgorithm: z.string().optional(),
        fingerprint: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const toHex = (b64?: string) => (b64 ? "\\x" + Buffer.from(b64, "base64").toString("hex") : null);
    const { data: row, error } = await supabase
      .from("devices")
      .insert({
        user_id: userId,
        name: data.name,
        platform: data.platform,
        status: "active",
        public_identity_key: toHex(data.publicIdentityKey),
        public_signed_prekey: toHex(data.publicSignedPrekey),
        signed_prekey_signature: toHex(data.signedPrekeySignature),
        key_algorithm: data.keyAlgorithm ?? "curve25519",
        fingerprint: data.fingerprint ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id };
  });

export const revokeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ deviceId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("devices")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", data.deviceId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

/* --------------------------------- Sessions --------------------------------- */

export const listMySessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("sessions")
      .select("id, device_id, user_agent, location_hint, started_at, last_seen_at, revoked_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("last_seen_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const revokeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
