-- Native Whispr MLS message relay.
--
-- The database receives ONLY versioned encrypted envelope JSON plus routing
-- metadata. No function in this migration accepts a plaintext message body.

CREATE OR REPLACE FUNCTION public.get_mls_device_identity(target_device uuid)
RETURNS TABLE (
  device_id uuid,
  user_id uuid,
  device_public_id text,
  public_ed25519_key_hex text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  target_user uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT d.user_id
    INTO target_user
    FROM public.devices d
   WHERE d.id = target_device
     AND d.status = 'active'
     AND d.revoked_at IS NULL
     AND d.public_ed25519_key IS NOT NULL;

  IF target_user IS NULL THEN
    RAISE EXCEPTION 'active MLS device not found';
  END IF;

  IF target_user <> caller AND NOT EXISTS (
    SELECT 1
      FROM public.conversation_members mine
      JOIN public.conversation_members theirs
        ON theirs.conversation_id = mine.conversation_id
     WHERE mine.user_id = caller
       AND mine.left_at IS NULL
       AND theirs.user_id = target_user
       AND theirs.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'device identity not authorized';
  END IF;

  RETURN QUERY
    SELECT d.id,
           d.user_id,
           d.device_public_id,
           encode(d.public_ed25519_key, 'hex')
      FROM public.devices d
     WHERE d.id = target_device
       AND d.status = 'active'
       AND d.revoked_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mls_device_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mls_device_identity(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.list_mls_recipient_devices(target_user uuid)
RETURNS TABLE (
  device_id uuid,
  user_id uuid,
  device_public_id text,
  public_ed25519_key_hex text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF target_user <> caller AND NOT EXISTS (
    SELECT 1
      FROM public.conversation_members mine
      JOIN public.conversation_members theirs
        ON theirs.conversation_id = mine.conversation_id
     WHERE mine.user_id = caller
       AND mine.left_at IS NULL
       AND theirs.user_id = target_user
       AND theirs.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'recipient device discovery not authorized';
  END IF;

  RETURN QUERY
    SELECT d.id,
           d.user_id,
           d.device_public_id,
           encode(d.public_ed25519_key, 'hex')
      FROM public.devices d
     WHERE d.user_id = target_user
       AND d.status = 'active'
       AND d.revoked_at IS NULL
       AND d.key_algorithm = 'mls-openmls-v1'
       AND d.public_ed25519_key IS NOT NULL
     ORDER BY d.registered_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_mls_recipient_devices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_mls_recipient_devices(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.send_mls_message(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sender_device_id uuid,
  p_envelopes jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  env jsonb;
  recipient_user uuid;
  recipient_device uuid;
  envelope jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF jsonb_typeof(p_envelopes) <> 'array'
     OR jsonb_array_length(p_envelopes) < 1
     OR jsonb_array_length(p_envelopes) > 64 THEN
    RAISE EXCEPTION 'invalid encrypted envelope batch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members cm
     WHERE cm.conversation_id = p_conversation_id
       AND cm.user_id = caller
       AND cm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'sender is not an active conversation member';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
     WHERE d.id = p_sender_device_id
       AND d.user_id = caller
       AND d.status = 'active'
       AND d.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'sender device is not active or not owned by caller';
  END IF;

  IF EXISTS (SELECT 1 FROM public.messages m WHERE m.id = p_message_id) THEN
    RAISE EXCEPTION 'message id already exists';
  END IF;

  -- Validate the entire batch BEFORE inserting the message so failures are
  -- atomic and never leave a half-routed message behind.
  FOR env IN SELECT value FROM jsonb_array_elements(p_envelopes)
  LOOP
    BEGIN
      recipient_user := (env ->> 'recipient_user_id')::uuid;
      recipient_device := (env ->> 'recipient_device_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid recipient routing metadata';
    END;

    envelope := env -> 'envelope';
    IF envelope IS NULL OR jsonb_typeof(envelope) <> 'object' THEN
      RAISE EXCEPTION 'encrypted envelope must be a JSON object';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.conversation_members cm
       WHERE cm.conversation_id = p_conversation_id
         AND cm.user_id = recipient_user
         AND cm.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'recipient is not an active conversation member';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.devices d
       WHERE d.id = recipient_device
         AND d.user_id = recipient_user
         AND d.status = 'active'
         AND d.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'recipient device is not active or does not match user';
    END IF;

    IF envelope ->> 'protocol_id' <> 'whispr-mls-v1'
       OR COALESCE((envelope ->> 'protocol_version')::int, 0) <> 1
       OR envelope ->> 'sender_device_id' <> p_sender_device_id::text
       OR envelope ->> 'recipient_device_id' <> recipient_device::text
       OR envelope ->> 'conversation_id' <> p_conversation_id::text
       OR envelope ->> 'message_id' <> p_message_id::text
       OR COALESCE(envelope ->> 'ciphertext', '') = '' THEN
      RAISE EXCEPTION 'encrypted envelope routing/protocol binding mismatch';
    END IF;

    IF octet_length(envelope::text) > 24 * 1024 * 1024 THEN
      RAISE EXCEPTION 'encrypted envelope too large';
    END IF;
  END LOOP;

  INSERT INTO public.messages (
    id,
    conversation_id,
    sender_id,
    sender_device_id,
    ciphertext_algorithm,
    ciphertext_version
  ) VALUES (
    p_message_id,
    p_conversation_id,
    caller,
    p_sender_device_id,
    'whispr-mls-v1',
    2
  );

  FOR env IN SELECT value FROM jsonb_array_elements(p_envelopes)
  LOOP
    recipient_user := (env ->> 'recipient_user_id')::uuid;
    recipient_device := (env ->> 'recipient_device_id')::uuid;
    envelope := env -> 'envelope';

    INSERT INTO public.message_envelopes (
      message_id,
      recipient_device_id,
      recipient_user_id,
      ciphertext,
      ciphertext_algorithm,
      ciphertext_version
    ) VALUES (
      p_message_id,
      recipient_device,
      recipient_user,
      envelope::text,
      'whispr-mls-v1',
      2
    );
  END LOOP;

  UPDATE public.conversations
     SET last_message_at = now(), updated_at = now()
   WHERE id = p_conversation_id;

  RETURN p_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_mls_message(uuid, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_mls_message(uuid, uuid, uuid, jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_pending_mls_envelopes(
  p_device_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  envelope_id uuid,
  message_id uuid,
  conversation_id uuid,
  sender_user_id uuid,
  sender_device_id uuid,
  envelope jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  bounded_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
     WHERE d.id = p_device_id
       AND d.user_id = caller
       AND d.status = 'active'
       AND d.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'recipient device is not active or not owned by caller';
  END IF;

  RETURN QUERY
    SELECT e.id,
           m.id,
           m.conversation_id,
           m.sender_id,
           m.sender_device_id,
           e.ciphertext::jsonb,
           e.created_at
      FROM public.message_envelopes e
      JOIN public.messages m ON m.id = e.message_id
     WHERE e.recipient_device_id = p_device_id
       AND e.recipient_user_id = caller
       AND e.ciphertext_algorithm = 'whispr-mls-v1'
       AND e.delivered_at IS NULL
       AND m.deleted_at IS NULL
     ORDER BY e.created_at ASC
     LIMIT bounded_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_mls_envelopes(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_mls_envelopes(uuid, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.ack_mls_envelope(p_envelope_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  UPDATE public.message_envelopes e
     SET delivered_at = COALESCE(e.delivered_at, now())
   WHERE e.id = p_envelope_id
     AND e.recipient_user_id = caller
     AND e.ciphertext_algorithm = 'whispr-mls-v1';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.ack_mls_envelope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ack_mls_envelope(uuid) TO authenticated;
