\set ON_ERROR_STOP on

BEGIN;

-- Deterministic actors/devices/conversation for relay authorization tests.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'mallory@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, username) VALUES
  ('11111111-1111-4111-8111-111111111111', 'alice_mls_test'),
  ('22222222-2222-4222-8222-222222222222', 'bob_mls_test'),
  ('33333333-3333-4333-8333-333333333333', 'mallory_mls_test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.devices (
  id, user_id, name, platform, status, key_algorithm,
  public_identity_key, public_ed25519_key, device_public_id
) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'Alice native', 'windows', 'active', 'mls-openmls-v1',
    decode(repeat('11', 32), 'hex'), decode(repeat('11', 32), 'hex'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'Bob native', 'windows', 'active', 'mls-openmls-v1',
    decode(repeat('22', 32), 'hex'), decode(repeat('22', 32), 'hex'),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '33333333-3333-4333-8333-333333333333',
    'Mallory native', 'windows', 'active', 'mls-openmls-v1',
    decode(repeat('33', 32), 'hex'), decode(repeat('33', 32), 'hex'),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversations (id, type, created_by)
VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'direct',
  '11111111-1111-4111-8111-111111111111'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversation_members (conversation_id, user_id)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '22222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- Alice can discover Bob's active MLS device but not Mallory's.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.list_mls_recipient_devices(
    '22222222-2222-4222-8222-222222222222'
  );
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one Bob MLS device, got %', n;
  END IF;

  BEGIN
    PERFORM * FROM public.list_mls_recipient_devices(
      '33333333-3333-4333-8333-333333333333'
    );
    RAISE EXCEPTION 'unauthorized Mallory device discovery unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unauthorized Mallory device discovery unexpectedly succeeded' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- A valid opaque MLS envelope routes atomically to Bob.
SELECT public.send_mls_message(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  jsonb_build_array(
    jsonb_build_object(
      'recipient_user_id', '22222222-2222-4222-8222-222222222222',
      'recipient_device_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'envelope', jsonb_build_object(
        'version', 2,
        'backend', 'openmls-runtime-v1',
        'protocol_id', 'whispr-mls-v1',
        'protocol_version', 1,
        'sender_device_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'recipient_device_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'conversation_id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'message_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'counter', 1,
        'ciphertext', 'T1BBUVVFLU1FUy1DSVBIRVJURVhU',
        'aad', 'QVVUSEVOVElDQVRFRC1ST1VUSU5H',
        'kind', 'prekey'
      )
    )
  )
);

DO $$
DECLARE
  message_ciphertext bytea;
  envelope_ciphertext text;
BEGIN
  SELECT m.ciphertext INTO message_ciphertext
    FROM public.messages m
   WHERE m.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  IF message_ciphertext IS NOT NULL THEN
    RAISE EXCEPTION 'message row must not contain plaintext/ciphertext body';
  END IF;

  SELECT convert_from(e.ciphertext, 'UTF8') INTO envelope_ciphertext
    FROM public.message_envelopes e
   WHERE e.message_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  IF envelope_ciphertext IS NULL OR envelope_ciphertext !~ 'whispr-mls-v1' THEN
    RAISE EXCEPTION 'encrypted per-device envelope not stored';
  END IF;
  IF envelope_ciphertext LIKE '%SERVER-BLINDNESS-PLAINTEXT%' THEN
    RAISE EXCEPTION 'plaintext sentinel leaked into stored envelope';
  END IF;
END;
$$;

-- Server rejects a routing rewrite / unauthorized recipient before any new
-- message row is committed.
DO $$
BEGIN
  BEGIN
    PERFORM public.send_mls_message(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_array(
        jsonb_build_object(
          'recipient_user_id', '33333333-3333-4333-8333-333333333333',
          'recipient_device_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'envelope', jsonb_build_object(
            'version', 2,
            'backend', 'openmls-runtime-v1',
            'protocol_id', 'whispr-mls-v1',
            'protocol_version', 1,
            'sender_device_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'recipient_device_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'conversation_id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            'message_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            'counter', 2,
            'ciphertext', 'T1BBUVVFLUNJUEhFUlRFWFQ',
            'aad', 'QUFE',
            'kind', 'whisper'
          )
        )
      )
    );
    RAISE EXCEPTION 'unauthorized recipient route unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unauthorized recipient route unexpectedly succeeded' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.messages
     WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  ) THEN
    RAISE EXCEPTION 'failed send left a partial message row';
  END IF;
END;
$$;

-- Bob receives exactly one pending envelope. It disappears from the pending
-- queue only after explicit successful-decrypt acknowledgement.
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

DO $$
DECLARE
  pending_count integer;
  envelope_to_ack uuid;
BEGIN
  SELECT count(*)
    INTO pending_count
    FROM public.get_pending_mls_envelopes(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      100
    );
  IF pending_count <> 1 THEN
    RAISE EXCEPTION 'expected one pending MLS envelope, got %', pending_count;
  END IF;

  SELECT envelope_id
    INTO envelope_to_ack
    FROM public.get_pending_mls_envelopes(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      100
    )
    LIMIT 1;
  IF envelope_to_ack IS NULL THEN
    RAISE EXCEPTION 'pending MLS envelope id missing';
  END IF;

  IF NOT public.ack_mls_envelope(envelope_to_ack) THEN
    RAISE EXCEPTION 'ack failed for owned envelope';
  END IF;

  SELECT count(*) INTO pending_count
    FROM public.get_pending_mls_envelopes(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      100
    );
  IF pending_count <> 0 THEN
    RAISE EXCEPTION 'acked envelope remained pending';
  END IF;
END;
$$;

ROLLBACK;
