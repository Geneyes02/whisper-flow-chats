
-- Phase 1 crypto foundation
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS public_ed25519_key bytea,
  ADD COLUMN IF NOT EXISTS identity_key_signature bytea,
  ADD COLUMN IF NOT EXISTS crypto_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS device_public_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS local_key_wrap_algo text,
  ADD COLUMN IF NOT EXISTS last_prekey_upload_at timestamptz;

CREATE TABLE IF NOT EXISTS public.one_time_prekeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_id int NOT NULL,
  public_key bytea NOT NULL,
  algorithm text NOT NULL DEFAULT 'x25519',
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, key_id)
);
CREATE INDEX IF NOT EXISTS one_time_prekeys_device_unused_idx
  ON public.one_time_prekeys(device_id) WHERE used_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.one_time_prekeys TO authenticated;
GRANT ALL ON public.one_time_prekeys TO service_role;
ALTER TABLE public.one_time_prekeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own prekeys"
  ON public.one_time_prekeys FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Owner inserts own prekeys"
  ON public.one_time_prekeys FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner marks own prekeys used"
  ON public.one_time_prekeys FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.identity_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  previous_public_identity_key bytea,
  new_public_identity_key bytea NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identity_change_events_user_idx
  ON public.identity_change_events(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.identity_change_events TO authenticated;
GRANT ALL ON public.identity_change_events TO service_role;
ALTER TABLE public.identity_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own identity changes"
  ON public.identity_change_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Owner writes own identity changes"
  ON public.identity_change_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Security-definer: any conversation partner can fetch a public prekey bundle
-- of a peer's active device. Consumes one one-time prekey atomically.
CREATE OR REPLACE FUNCTION public.get_prekey_bundle(target_user uuid)
RETURNS TABLE (
  device_id uuid,
  user_id uuid,
  public_identity_key bytea,
  public_ed25519_key bytea,
  identity_key_signature bytea,
  public_signed_prekey bytea,
  signed_prekey_signature bytea,
  key_algorithm text,
  key_version int,
  crypto_version int,
  one_time_prekey_id uuid,
  one_time_prekey_key_id int,
  one_time_prekey bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  shares_convo boolean;
  d record;
  otp record;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Caller must share a conversation with target_user OR be target_user itself.
  IF caller <> target_user THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.conversation_members m1
      JOIN public.conversation_members m2 ON m2.conversation_id = m1.conversation_id
      WHERE m1.user_id = caller AND m2.user_id = target_user
    ) INTO shares_convo;
    IF NOT shares_convo THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  FOR d IN
    SELECT * FROM public.devices
    WHERE devices.user_id = target_user
      AND devices.revoked_at IS NULL
      AND devices.public_identity_key IS NOT NULL
    ORDER BY devices.registered_at
  LOOP
    -- Consume one available one-time prekey (best effort; may be null).
    SELECT * INTO otp FROM public.one_time_prekeys
      WHERE one_time_prekeys.device_id = d.id
        AND one_time_prekeys.used_at IS NULL
      ORDER BY one_time_prekeys.key_id
      LIMIT 1
      FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
      UPDATE public.one_time_prekeys
        SET used_at = now()
        WHERE id = otp.id;
    END IF;

    device_id := d.id;
    user_id := d.user_id;
    public_identity_key := d.public_identity_key;
    public_ed25519_key := d.public_ed25519_key;
    identity_key_signature := d.identity_key_signature;
    public_signed_prekey := d.public_signed_prekey;
    signed_prekey_signature := d.signed_prekey_signature;
    key_algorithm := d.key_algorithm;
    key_version := d.key_version;
    crypto_version := d.crypto_version;
    one_time_prekey_id := otp.id;
    one_time_prekey_key_id := otp.key_id;
    one_time_prekey := otp.public_key;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.get_prekey_bundle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_prekey_bundle(uuid) TO authenticated;
