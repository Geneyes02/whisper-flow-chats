/**
 * Server-fn wrappers for the Slice 2B MLS KeyPackage directory.
 *
 * All three RPCs are DEFINER on the DB side; these fns run under the
 * caller's Supabase bearer, so auth.uid() inside the RPC is the calling
 * user. No admin/service-role usage.
 *
 * Client-side substitution detection (`assertConsumedKeyPackageIntegrity`)
 * lives here so the messaging path can call it inline after every consume.
 */

import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// publish_mls_key_packages
// ---------------------------------------------------------------------------

const PublishBundle = z.object({
  device_id: z.string().uuid(),
  ciphersuite_tag: z.string().min(1),
  key_package_hash: z.string().regex(/^[0-9a-f]{64}$/),
  key_package_b64: z.string().min(1),
  credential_identity_b64: z.string().min(1),
  expires_at: z.string(),
});
export type PublishBundle = z.infer<typeof PublishBundle>;

export const publishMlsKeyPackages = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bundles: PublishBundle[] }) =>
    z.object({ bundles: z.array(PublishBundle).min(1).max(200) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      'publish_mls_key_packages',
      { bundles: data.bundles as never },
    );
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ key_package_hash: string; status: string }>;
  });

// ---------------------------------------------------------------------------
// consume_mls_key_package
// ---------------------------------------------------------------------------

export const consumeMlsKeyPackage = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { targetUser: string; targetDevice?: string }) =>
    z
      .object({
        targetUser: z.string().uuid(),
        targetDevice: z.string().uuid().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      'consume_mls_key_package',
      {
        target_user: data.targetUser,
        target_device: data.targetDevice ?? undefined,
      },
    );

    if (error) throw new Error(error.message);
    const row = (rows ?? [])[0] as
      | {
          key_package_hash: string;
          ciphersuite_tag: string;
          key_package_b64: string;
          device_id: string;
          user_id: string;
          remaining: number;
        }
      | undefined;
    if (!row) throw new Error('consume_mls_key_package returned no row');
    return row;
  });

// ---------------------------------------------------------------------------
// mls_key_package_directory_status
// ---------------------------------------------------------------------------

export const getMlsDirectoryStatus = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { deviceId: string }) =>
    z.object({ deviceId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      'mls_key_package_directory_status',
      { target_device: data.deviceId },
    );
    if (error) throw new Error(error.message);
    const row = (rows ?? [])[0] as
      | { remaining: number; oldest_expires_at: string | null; newest_created_at: string | null }
      | undefined;
    return row ?? { remaining: 0, oldest_expires_at: null, newest_created_at: null };
  });

// ---------------------------------------------------------------------------
// Client-side substitution detection
// ---------------------------------------------------------------------------

/**
 * Recomputes SHA-256 over the consumed KeyPackage bytes and asserts it
 * matches the hash the server returned. Any server-side substitution of
 * `key_package_b64` (different bytes than the hash they claim) trips this
 * check before the messaging layer ever hands the material to OpenMLS.
 *
 * This does NOT replace the credential-signature check performed by
 * OpenMLS on the native side — that is the primary defense. This is a
 * cheap, transport-layer sanity guard so tampered bytes never reach the
 * MLS decoder in the first place.
 */
export async function assertConsumedKeyPackageIntegrity(row: {
  key_package_hash: string;
  key_package_b64: string;
}): Promise<void> {
  const bytes = base64ToBytes(row.key_package_b64);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (hex !== row.key_package_hash) {
    throw new Error(
      'key_package_substitution_detected: server-returned bytes do not match declared hash',
    );
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
