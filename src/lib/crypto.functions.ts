/**
 * Server functions for Phase 1 crypto: device registration, prekey
 * publishing, bundle fetch, identity change events, revocation.
 *
 * Private keys are NEVER accepted here. Any handler receiving a suspicious
 * payload rejects it. All bytea columns are stored as Postgres hex.
 */

import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

// --- helpers ------------------------------------------------------------

const bytesB64 = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9+/=_-]+$/, 'must be base64');

function b64ToPgHex(b64: string): string {
  const bin = Buffer.from(b64, 'base64');
  return '\\x' + bin.toString('hex');
}

// --- registerDevice ------------------------------------------------------

export const registerDevice = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().min(1).max(80),
        platform: z.enum(['ios', 'android', 'web', 'macos', 'windows', 'linux']),
        publicIdentityKey: bytesB64,
        publicSigningKey: bytesB64,
        identityKeySignature: bytesB64,
        algorithm: z.string().min(1).max(64),
        cryptoVersion: z.number().int().positive(),
        devicePublicId: z.string().min(6).max(64),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: row, error } = await supabase
      .from('devices')
      .insert({
        user_id: userId,
        name: data.name,
        platform: data.platform,
        status: 'active',
        public_identity_key: b64ToPgHex(data.publicIdentityKey),
        public_ed25519_key: b64ToPgHex(data.publicSigningKey),
        identity_key_signature: b64ToPgHex(data.identityKeySignature),
        key_algorithm: data.algorithm,
        key_version: 1,
        crypto_version: data.cryptoVersion,
        device_public_id: data.devicePublicId,
        local_key_wrap_algo: 'aes-256-gcm/hkdf-sha256',
        registered_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      })
      .select('id, device_public_id, registered_at')
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// --- publishPrekeys ------------------------------------------------------

export const publishPrekeys = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        deviceId: z.string().uuid(),
        signedPrekey: bytesB64,
        signedPrekeySignature: bytesB64,
        oneTimePrekeys: z
          .array(
            z.object({
              keyId: z.number().int().positive(),
              publicKey: bytesB64,
            }),
          )
          .min(0)
          .max(200),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Update signed prekey on the device (owner-scoped by RLS).
    const { error: upErr } = await supabase
      .from('devices')
      .update({
        public_signed_prekey: b64ToPgHex(data.signedPrekey),
        signed_prekey_signature: b64ToPgHex(data.signedPrekeySignature),
        last_prekey_upload_at: new Date().toISOString(),
      })
      .eq('id', data.deviceId)
      .eq('user_id', userId);
    if (upErr) throw new Error(upErr.message);

    if (data.oneTimePrekeys.length > 0) {
      const { error: insErr } = await supabase.from('one_time_prekeys').insert(
        data.oneTimePrekeys.map((k) => ({
          device_id: data.deviceId,
          user_id: userId,
          key_id: k.keyId,
          public_key: b64ToPgHex(k.publicKey),
          algorithm: 'x25519',
        })),
      );
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true, uploaded: data.oneTimePrekeys.length };
  });

// --- fetchPrekeyBundle ---------------------------------------------------

export const fetchPrekeyBundle = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ targetUserId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc('get_prekey_bundle', {
      target_user: data.targetUserId,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// --- recordIdentityChange -----------------------------------------------

export const recordIdentityChange = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        deviceId: z.string().uuid(),
        previousPublicIdentityKey: bytesB64.nullable().optional(),
        newPublicIdentityKey: bytesB64,
        reason: z.string().max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from('identity_change_events').insert({
      user_id: userId,
      device_id: data.deviceId,
      previous_public_identity_key: data.previousPublicIdentityKey
        ? b64ToPgHex(data.previousPublicIdentityKey)
        : null,
      new_public_identity_key: b64ToPgHex(data.newPublicIdentityKey),
      reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- listMyDevices -------------------------------------------------------

export const listMyDevices = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from('devices')
      .select(
        'id, name, platform, status, key_algorithm, crypto_version, device_public_id, registered_at, last_active_at, revoked_at, last_prekey_upload_at, public_identity_key',
      )
      .eq('user_id', userId)
      .order('registered_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// --- revokeDevice --------------------------------------------------------

export const revokeDeviceServer = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ deviceId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from('devices')
      .update({ revoked_at: new Date().toISOString(), status: 'revoked' })
      .eq('id', data.deviceId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
