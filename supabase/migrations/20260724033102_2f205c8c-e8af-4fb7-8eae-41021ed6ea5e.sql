-- =============================================================================
-- Slice 2B — MLS KeyPackage directory
-- =============================================================================
-- Public wire form only. No private key material EVER lives here.
--
-- Two tables:
--   1. mls_key_packages           — active pool per device
--   2. mls_key_package_consumption_log — permanent replay-protection ledger
--
-- Three RPCs:
--   - publish_mls_key_packages(bundles jsonb)  — owner publishes
--   - consume_mls_key_package(target_user, target_device)  — peer consumes ONE
--   - mls_key_package_directory_status(device_id) — owner queries remaining
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Active pool
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mls_key_packages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id            uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  ciphersuite_tag      text NOT NULL,
  -- SHA-256 hex of key_package_tls (the PUBLIC wire bytes). Globally unique
  -- so any republish or cross-device duplicate is rejected atomically.
  key_package_hash     text NOT NULL UNIQUE,
  -- TLS-encoded MLS KeyPackage (public form). Not the KeyPackageBundle —
  -- bundles carry private init/encryption material and are keychain-only.
  key_package_tls      bytea NOT NULL,
  -- Credential identity in the KeyPackage. Must match devices.device_public_id
  -- on publish (device binding).
  credential_identity  bytea NOT NULL,
  expires_at           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mls_key_packages_device_idx
  ON public.mls_key_packages(device_id);
CREATE INDEX IF NOT EXISTS mls_key_packages_user_idx
  ON public.mls_key_packages(user_id);

-- Owner may read the active pool for their own devices (to know what's still
-- valid). Peers use consume_mls_key_package instead, never direct SELECT.
GRANT SELECT ON public.mls_key_packages TO authenticated;
GRANT ALL ON public.mls_key_packages TO service_role;
ALTER TABLE public.mls_key_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own MLS KeyPackages"
  ON public.mls_key_packages FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Publishing goes through the RPC (device-binding + hash-collision checks).
-- No direct INSERT/UPDATE/DELETE from authenticated.

-- ---------------------------------------------------------------------------
-- Permanent replay-protection ledger
-- ---------------------------------------------------------------------------
-- The bounded 10,000-entry consumed-hash history on the OWNER device is a
-- fast local guard. Permanent replay defense lives HERE: even if the owner
-- forgets a hash, the server refuses to re-consume it forever.
CREATE TABLE IF NOT EXISTS public.mls_key_package_consumption_log (
  key_package_hash    text PRIMARY KEY,
  owner_user_id       uuid NOT NULL,
  owner_device_id     uuid NOT NULL,
  consumer_user_id    uuid NOT NULL,
  ciphersuite_tag     text NOT NULL,
  consumed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mls_kp_consumption_owner_device_idx
  ON public.mls_key_package_consumption_log(owner_device_id, consumed_at DESC);

GRANT ALL ON public.mls_key_package_consumption_log TO service_role;
ALTER TABLE public.mls_key_package_consumption_log ENABLE ROW LEVEL SECURITY;
-- No authenticated policy at all: RPC-only access via SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- RPC: publish_mls_key_packages
-- ---------------------------------------------------------------------------
-- bundles JSONB shape:
--   [{ "device_id": uuid,
--      "ciphersuite_tag": text,
--      "key_package_hash": text,          -- sha256 hex of key_package_b64
--      "key_package_b64": text,           -- base64 of TLS-encoded KeyPackage
--      "credential_identity_b64": text,   -- base64 of credential identity
--      "expires_at": timestamptz }]
--
-- Returns per-bundle status so the client can distinguish "accepted" vs
-- "already consumed" vs "duplicate" vs "device binding mismatch".
CREATE OR REPLACE FUNCTION public.publish_mls_key_packages(bundles jsonb)
RETURNS TABLE (
  key_package_hash text,
  status text  -- 'accepted' | 'already_consumed' | 'duplicate' | 'device_binding_mismatch' | 'device_revoked' | 'not_owner' | 'expired' | 'malformed'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  b jsonb;
  dev record;
  kp_bytes bytea;
  cred_bytes bytea;
  computed_hash text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  FOR b IN SELECT * FROM jsonb_array_elements(bundles) LOOP
    -- Malformed guard
    IF b ? 'device_id' = false
       OR b ? 'ciphersuite_tag' = false
       OR b ? 'key_package_hash' = false
       OR b ? 'key_package_b64' = false
       OR b ? 'credential_identity_b64' = false
       OR b ? 'expires_at' = false THEN
      key_package_hash := coalesce(b->>'key_package_hash', '<unknown>');
      status := 'malformed';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Look up device the KeyPackage claims to belong to.
    SELECT * INTO dev FROM public.devices
      WHERE id = (b->>'device_id')::uuid;
    IF NOT FOUND THEN
      key_package_hash := b->>'key_package_hash';
      status := 'not_owner';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Caller must own the device.
    IF dev.user_id <> caller THEN
      key_package_hash := b->>'key_package_hash';
      status := 'not_owner';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Revoked devices cannot publish new KeyPackages.
    IF dev.revoked_at IS NOT NULL THEN
      key_package_hash := b->>'key_package_hash';
      status := 'device_revoked';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Expiry sanity: must not already be in the past.
    IF (b->>'expires_at')::timestamptz <= now() THEN
      key_package_hash := b->>'key_package_hash';
      status := 'expired';
      RETURN NEXT;
      CONTINUE;
    END IF;

    kp_bytes := decode(b->>'key_package_b64', 'base64');
    cred_bytes := decode(b->>'credential_identity_b64', 'base64');

    -- Recompute hash server-side; reject client-supplied hash if mismatched.
    computed_hash := encode(digest(kp_bytes, 'sha256'), 'hex');
    IF computed_hash <> b->>'key_package_hash' THEN
      key_package_hash := b->>'key_package_hash';
      status := 'malformed';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Device binding: credential identity in the KeyPackage MUST equal
    -- the device's device_public_id. Prevents cross-device substitution
    -- at publish time.
    IF dev.device_public_id IS NULL
       OR convert_from(cred_bytes, 'UTF8') <> dev.device_public_id THEN
      key_package_hash := b->>'key_package_hash';
      status := 'device_binding_mismatch';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Permanent replay guard: if this exact hash was ever consumed, refuse
    -- to reinsert it into the active pool.
    IF EXISTS (SELECT 1 FROM public.mls_key_package_consumption_log l
               WHERE l.key_package_hash = computed_hash) THEN
      key_package_hash := computed_hash;
      status := 'already_consumed';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.mls_key_packages
        (user_id, device_id, ciphersuite_tag, key_package_hash,
         key_package_tls, credential_identity, expires_at)
      VALUES
        (caller, dev.id, b->>'ciphersuite_tag', computed_hash,
         kp_bytes, cred_bytes, (b->>'expires_at')::timestamptz);
      key_package_hash := computed_hash;
      status := 'accepted';
    EXCEPTION WHEN unique_violation THEN
      key_package_hash := computed_hash;
      status := 'duplicate';
    END;

    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_mls_key_packages(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_mls_key_packages(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: consume_mls_key_package
-- ---------------------------------------------------------------------------
-- Atomic, one-time consumption. Uses FOR UPDATE SKIP LOCKED so two concurrent
-- consumers can never receive the same KeyPackage. Deletes the consumed row
-- from the active pool and records it in the permanent ledger.
CREATE OR REPLACE FUNCTION public.consume_mls_key_package(
  target_user   uuid,
  target_device uuid DEFAULT NULL
)
RETURNS TABLE (
  key_package_hash text,
  ciphersuite_tag  text,
  key_package_b64  text,
  device_id        uuid,
  user_id          uuid,
  remaining        int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  dev record;
  chosen record;
  remaining_count int;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Resolve the device: either explicit target_device, or oldest active
  -- non-revoked device for target_user.
  IF target_device IS NOT NULL THEN
    SELECT * INTO dev FROM public.devices d
      WHERE d.id = target_device AND d.user_id = target_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'device_not_found';
    END IF;
  ELSE
    SELECT * INTO dev FROM public.devices d
      WHERE d.user_id = target_user
        AND d.revoked_at IS NULL
        AND d.public_identity_key IS NOT NULL
      ORDER BY d.registered_at
      LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_active_device';
    END IF;
  END IF;

  IF dev.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked';
  END IF;

  -- Atomic single-row pick + delete. Two callers racing on the same device
  -- receive different rows (or one gets no_key_packages).
  SELECT * INTO chosen
  FROM public.mls_key_packages k
  WHERE k.device_id = dev.id
    AND k.expires_at > now()
  ORDER BY k.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_key_packages';
  END IF;

  DELETE FROM public.mls_key_packages WHERE id = chosen.id;

  -- Permanent ledger insert. Distinct from the source table, so it survives
  -- pool deletion and provides replay defense beyond the bounded local list.
  INSERT INTO public.mls_key_package_consumption_log
    (key_package_hash, owner_user_id, owner_device_id, consumer_user_id, ciphersuite_tag)
  VALUES
    (chosen.key_package_hash, dev.user_id, dev.id, caller, chosen.ciphersuite_tag);

  SELECT count(*) INTO remaining_count
    FROM public.mls_key_packages k
    WHERE k.device_id = dev.id AND k.expires_at > now();

  key_package_hash := chosen.key_package_hash;
  ciphersuite_tag  := chosen.ciphersuite_tag;
  key_package_b64  := encode(chosen.key_package_tls, 'base64');
  device_id        := dev.id;
  user_id          := dev.user_id;
  remaining        := remaining_count;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_mls_key_package(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_mls_key_package(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: mls_key_package_directory_status
-- ---------------------------------------------------------------------------
-- Owner-only. Lets the client decide when to replenish.
CREATE OR REPLACE FUNCTION public.mls_key_package_directory_status(target_device uuid)
RETURNS TABLE (
  remaining int,
  oldest_expires_at timestamptz,
  newest_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  owner uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT user_id INTO owner FROM public.devices WHERE id = target_device;
  IF owner IS NULL OR owner <> caller THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  SELECT count(*)::int,
         min(expires_at),
         max(created_at)
    INTO remaining, oldest_expires_at, newest_created_at
    FROM public.mls_key_packages
    WHERE device_id = target_device
      AND expires_at > now();
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.mls_key_package_directory_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mls_key_package_directory_status(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- pgcrypto is required for digest().
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;