\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('41111111-1111-4111-8111-111111111111', 'alice-multi@example.test'),
  ('42222222-2222-4222-8222-222222222222', 'bob-multi@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, username) VALUES
  ('41111111-1111-4111-8111-111111111111', 'alice_multi_test'),
  ('42222222-2222-4222-8222-222222222222', 'bob_multi_test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.devices (
  id, user_id, name, platform, status, key_algorithm,
  public_identity_key, public_ed25519_key, device_public_id
) VALUES
  ('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '41111111-1111-4111-8111-111111111111',
   'Alice A1', 'windows', 'active', 'mls-openmls-v1',
   decode(repeat('41',32),'hex'), decode(repeat('41',32),'hex'),
   '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '41111111-1111-4111-8111-111111111111',
   'Alice A2', 'android', 'active', 'mls-openmls-v1',
   decode(repeat('42',32),'hex'), decode(repeat('42',32),'hex'),
   '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '42222222-2222-4222-8222-222222222222',
   'Bob B1', 'windows', 'active', 'mls-openmls-v1',
   decode(repeat('43',32),'hex'), decode(repeat('43',32),'hex'),
   '4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversations (id, type, created_by)
VALUES ('4ddddddd-dddd-4ddd-8ddd-dddddddddddd', 'direct', '41111111-1111-4111-8111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversation_members (conversation_id, user_id)
VALUES
  ('4ddddddd-dddd-4ddd-8ddd-dddddddddddd','41111111-1111-4111-8111-111111111111'),
  ('4ddddddd-dddd-4ddd-8ddd-dddddddddddd','42222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claim.sub', '41111111-1111-4111-8111-111111111111', true);

-- Publish one public package for Alice A2 and prove Alice A1 can consume it
-- through the same atomic directory path used for peer devices.
DO $$
DECLARE
  kp_text text := 'alice-a2-public-keypackage-fixture';
  kp_b64 text;
  kp_hash text;
  credential_b64 text;
  consumed record;
BEGIN
  kp_b64 := encode(convert_to(kp_text, 'UTF8'), 'base64');
  kp_hash := encode(digest(convert_to(kp_text, 'UTF8'), 'sha256'), 'hex');
  credential_b64 := encode(convert_to('4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'UTF8'), 'base64');

  PERFORM * FROM public.publish_mls_key_packages(
    jsonb_build_array(jsonb_build_object(
      'device_id', '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'ciphersuite_tag', 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
      'key_package_hash', kp_hash,
      'key_package_b64', kp_b64,
      'credential_identity_b64', credential_b64,
      'expires_at', (now() + interval '30 days')::text
    ))
  );

  SELECT * INTO consumed
    FROM public.consume_mls_key_package(
      '41111111-1111-4111-8111-111111111111',
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
    );
  IF consumed.device_id <> '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid THEN
    RAISE EXCEPTION 'self-device KeyPackage consume returned wrong device';
  END IF;
  IF consumed.key_package_hash <> kp_hash THEN
    RAISE EXCEPTION 'self-device KeyPackage consume returned wrong hash';
  END IF;

  -- The same one-time package cannot be consumed again.
  BEGIN
    PERFORM * FROM public.consume_mls_key_package(
      '41111111-1111-4111-8111-111111111111',
      '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
    );
    RAISE EXCEPTION 'self-device KeyPackage replay unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'self-device KeyPackage replay unexpectedly succeeded' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- One direct-chat send may fan out opaque, independently addressed envelopes
-- to Bob and Alice's other active device. The current sender device is not a
-- recipient because it already has local plaintext/history.
SELECT public.send_mls_message(
  '4eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '4ddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  jsonb_build_array(
    jsonb_build_object(
      'recipient_user_id', '42222222-2222-4222-8222-222222222222',
      'recipient_device_id', '4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'envelope', jsonb_build_object(
        'version', 2, 'backend', 'openmls-runtime-v1',
        'protocol_id', 'whispr-mls-v1', 'protocol_version', 1,
        'sender_device_id', '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'recipient_device_id', '4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        'conversation_id', '4ddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'message_id', '4eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'counter', 1, 'ciphertext', 'Qk9CLUNJUEhFUlRFWFQ', 'aad', 'QUFE', 'kind', 'prekey'
      )
    ),
    jsonb_build_object(
      'recipient_user_id', '41111111-1111-4111-8111-111111111111',
      'recipient_device_id', '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'envelope', jsonb_build_object(
        'version', 2, 'backend', 'openmls-runtime-v1',
        'protocol_id', 'whispr-mls-v1', 'protocol_version', 1,
        'sender_device_id', '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'recipient_device_id', '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        'conversation_id', '4ddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'message_id', '4eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'counter', 1, 'ciphertext', 'QUxJQ0UtQTItQ0lQSEVSVEVYVA', 'aad', 'QUFE', 'kind', 'prekey'
      )
    )
  )
);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.message_envelopes
   WHERE message_id = '4eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected two encrypted fan-out envelopes, got %', n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.message_envelopes e
     WHERE e.message_id = '4eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
       AND e.recipient_device_id = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) THEN
    RAISE EXCEPTION 'current sender device should not receive a redundant relay envelope';
  END IF;
END;
$$;

ROLLBACK;
