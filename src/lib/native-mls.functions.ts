/**
 * Server-only boundaries for Whispr's native MLS client.
 *
 * These functions accept public device material and already-encrypted MLS
 * envelopes only. There is deliberately no plaintext message field anywhere
 * in this module.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const b64 = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[A-Za-z0-9+/=_-]+$/);

function b64ToPgHex(input: string): string {
  const bytes = Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return "\\x" + bytes.toString("hex");
}

type RpcResult = { data: unknown; error: { message: string } | null };
type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult>;
};

function rpcClient(value: unknown): RpcClient {
  return value as RpcClient;
}

const Platform = z.enum(["ios", "android", "macos", "windows", "linux"]);

export const registerMlsNativeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        deviceId: z.string().uuid(),
        name: z.string().min(1).max(80),
        platform: Platform,
        publicSigningKey: b64,
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const publicKey = b64ToPgHex(data.publicSigningKey);

    const { data: existing, error: lookupError } = await supabase
      .from("devices")
      .select("id, user_id")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    if (existing) {
      if (existing.user_id !== userId) throw new Error("device id is owned by another user");
      const { error } = await supabase
        .from("devices")
        .update({
          name: data.name,
          platform: data.platform,
          status: "active",
          revoked_at: null,
          public_identity_key: publicKey,
          public_ed25519_key: publicKey,
          key_algorithm: "mls-openmls-v1",
          crypto_version: 1,
          device_public_id: data.deviceId,
          local_key_wrap_algo: "os-keychain/openmls-provider-v1",
          last_active_at: new Date().toISOString(),
        })
        .eq("id", data.deviceId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("devices").insert({
        id: data.deviceId,
        user_id: userId,
        name: data.name,
        platform: data.platform,
        status: "active",
        public_identity_key: publicKey,
        public_ed25519_key: publicKey,
        key_algorithm: "mls-openmls-v1",
        key_version: 1,
        crypto_version: 1,
        device_public_id: data.deviceId,
        local_key_wrap_algo: "os-keychain/openmls-provider-v1",
        registered_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    }

    return { id: data.deviceId, device_public_id: data.deviceId, userId };
  });

type MlsDeviceDirectoryRow = {
  device_id: string;
  user_id: string;
  device_public_id: string | null;
  public_ed25519_key_hex: string;
};

export const getMlsDeviceIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ deviceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await rpcClient(context.supabase).rpc("get_mls_device_identity", {
      target_device: data.deviceId,
    });
    if (error) throw new Error(error.message);
    const row = (rows as MlsDeviceDirectoryRow[] | null)?.[0];
    if (!row) throw new Error("MLS device identity not found");
    return row;
  });

export const listMlsRecipientDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await rpcClient(context.supabase).rpc(
      "list_mls_recipient_devices",
      { target_user: data.targetUserId },
    );
    if (error) throw new Error(error.message);
    return (rows ?? []) as MlsDeviceDirectoryRow[];
  });

const NativeEnvelope = z.object({
  version: z.number().int().positive(),
  backend: z.string().min(1).max(80),
  protocol_id: z.literal("whispr-mls-v1"),
  protocol_version: z.literal(1),
  sender_device_id: z.string().uuid(),
  recipient_device_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  counter: z.number().int().nonnegative(),
  ciphertext: z
    .string()
    .min(1)
    .max(24 * 1024 * 1024),
  aad: z
    .string()
    .min(1)
    .max(128 * 1024),
  kind: z.enum(["prekey", "whisper"]),
});
export type NativeEnvelopeWire = z.infer<typeof NativeEnvelope>;

const RecipientEnvelope = z.object({
  recipient_user_id: z.string().uuid(),
  recipient_device_id: z.string().uuid(),
  envelope: NativeEnvelope,
});
export type RecipientEnvelopeWire = z.infer<typeof RecipientEnvelope>;

export const sendEncryptedMlsMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        messageId: z.string().uuid(),
        conversationId: z.string().uuid(),
        senderDeviceId: z.string().uuid(),
        envelopes: z.array(RecipientEnvelope).min(1).max(64),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: messageId, error } = await rpcClient(context.supabase).rpc("send_mls_message", {
      p_message_id: data.messageId,
      p_conversation_id: data.conversationId,
      p_sender_device_id: data.senderDeviceId,
      p_envelopes: data.envelopes,
    });
    if (error) throw new Error(error.message);
    return { messageId: String(messageId ?? data.messageId) };
  });

export const getPendingMlsEnvelopes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        deviceId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await rpcClient(context.supabase).rpc(
      "get_pending_mls_envelopes",
      { p_device_id: data.deviceId, p_limit: data.limit ?? 100 },
    );
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      envelope_id: string;
      message_id: string;
      conversation_id: string;
      sender_user_id: string;
      sender_device_id: string;
      envelope: NativeEnvelopeWire;
      created_at: string;
    }>;
  });

export const ackMlsEnvelope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ envelopeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await rpcClient(context.supabase).rpc("ack_mls_envelope", {
      p_envelope_id: data.envelopeId,
    });
    if (error) throw new Error(error.message);
    return { ok: Boolean(ok) };
  });
