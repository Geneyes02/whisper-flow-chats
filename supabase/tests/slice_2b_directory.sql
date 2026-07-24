-- =============================================================================
-- Slice 2B — MLS KeyPackage directory integration tests
-- =============================================================================
-- Runs against a fresh Postgres in the `slice-2b-directory` GH Actions job.
-- The job applies every migration under supabase/migrations/ in filename
-- order, then executes this file. Any RAISE fails the job.
--
-- We DO NOT use pgTAP; the assertions here are plain RAISE EXCEPTION on
-- failure, so any deviation from expected behavior fails immediately with
-- a readable message.
--
-- auth.uid() is simulated by SET LOCAL "request.jwt.claim.sub" per test.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: two users, one device each, real KeyPackages substituted with
-- deterministic bytes. The tests never invoke real MLS; the directory is
-- protocol-agnostic re: the opaque wire bytes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alice uuid := '11111111-1111-1111-1111-111111111111';
  bob   uuid := '22222222-2222-2222-2222-222222222222';
BEGIN
  -- Create the two users directly in auth.users (bypasses gotrue for tests).
  INSERT INTO auth.users (id, email, encrypted_password, aud, role, instance_id, created_at, updated_at)
    VALUES
      (alice, 'alice@test.local', '', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
      (bob,   'bob@test.local',   '', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())
    ON CONFLICT (id) DO NOTHING;
END $$;

-- Alice's device A1
INSERT INTO public.devices
  (id, user_id, name, platform, status, key_algorithm, key_version,
   public_identity_key, device_public_id, registered_at)
VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'Alice A1', 'macos', 'active', 'mls-1', 1,
   decode('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'hex'),
   'alice-a1-devpub', now());

-- Bob's device B1
INSERT INTO public.devices
  (id, user_id, name, platform, status, key_algorithm, key_version,
   public_identity_key, device_public_id, registered_at)
VALUES
  ('bbbbbbb1-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'Bob B1', 'macos', 'active', 'mls-1', 1,
   decode('b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1', 'hex'),
   'bob-b1-devpub', now());

-- Helper: build a bundle for a given (device, credential_identity_text, seed).
CREATE OR REPLACE FUNCTION test_bundle(
  dev_id uuid,
  cred_identity_text text,
  seed text,
  expires_at_offset interval DEFAULT interval '30 days'
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  kp_bytes bytea := convert_to('KP-' || seed || '-' || dev_id::text, 'UTF8');
  cred_bytes bytea := convert_to(cred_identity_text, 'UTF8');
  h text := encode(digest(kp_bytes, 'sha256'), 'hex');
BEGIN
  RETURN jsonb_build_object(
    'device_id', dev_id,
    'ciphersuite_tag', 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
    'key_package_hash', h,
    'key_package_b64', encode(kp_bytes, 'base64'),
    'credential_identity_b64', encode(cred_bytes, 'base64'),
    'expires_at', (now() + expires_at_offset)::text
  );
END $$;

CREATE OR REPLACE FUNCTION assert(cond boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT cond THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', msg;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- T1: Valid authorized publication + retrieval
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE
  results record;
  count_accepted int := 0;
BEGIN
  FOR results IN
    SELECT * FROM publish_mls_key_packages(
      jsonb_build_array(
        test_bundle('aaaaaaa1-0000-0000-0000-000000000001', 'alice-a1-devpub', 'kp1'),
        test_bundle('aaaaaaa1-0000-0000-0000-000000000001', 'alice-a1-devpub', 'kp2'),
        test_bundle('aaaaaaa1-0000-0000-0000-000000000001', 'alice-a1-devpub', 'kp3')
      )
    )
  LOOP
    IF results.status = 'accepted' THEN count_accepted := count_accepted + 1; END IF;
  END LOOP;
  PERFORM assert(count_accepted = 3, 'T1: expected 3 accepted, got ' || count_accepted);
END $$;

SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE
  row record;
BEGIN
  SELECT * INTO row FROM consume_mls_key_package(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL);
  PERFORM assert(row.remaining = 2, 'T1: expected 2 remaining after 1 consume, got ' || row.remaining);
  PERFORM assert(row.device_id = 'aaaaaaa1-0000-0000-0000-000000000001', 'T1: wrong device_id');
END $$;

-- ---------------------------------------------------------------------------
-- T2: Wrong device binding (credential_identity != device.device_public_id)
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE r record; found_binding_error boolean := false;
BEGIN
  FOR r IN
    SELECT * FROM publish_mls_key_packages(
      jsonb_build_array(
        test_bundle('aaaaaaa1-0000-0000-0000-000000000001', 'WRONG-IDENTITY', 'kp-badbind')
      )
    )
  LOOP
    IF r.status = 'device_binding_mismatch' THEN found_binding_error := true; END IF;
  END LOOP;
  PERFORM assert(found_binding_error, 'T2: expected device_binding_mismatch');
END $$;

-- ---------------------------------------------------------------------------
-- T3: Revoked device rejection (both publish and consume)
-- ---------------------------------------------------------------------------
INSERT INTO public.devices
  (id, user_id, name, platform, status, key_algorithm, key_version,
   public_identity_key, device_public_id, registered_at, revoked_at)
VALUES
  ('aaaaaaa1-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'Alice A0 (revoked)', 'macos', 'revoked', 'mls-1', 1,
   decode('deaddeaddeaddeaddeaddeaddeaddead', 'hex'),
   'alice-a0-devpub', now(), now());

SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE r record; found boolean := false;
BEGIN
  FOR r IN
    SELECT * FROM publish_mls_key_packages(
      jsonb_build_array(
        test_bundle('aaaaaaa1-0000-0000-0000-000000000002', 'alice-a0-devpub', 'kp-rev')
      )
    )
  LOOP
    IF r.status = 'device_revoked' THEN found := true; END IF;
  END LOOP;
  PERFORM assert(found, 'T3: expected device_revoked on publish to revoked device');
END $$;

SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM consume_mls_key_package(
      '11111111-1111-1111-1111-111111111111'::uuid,
      'aaaaaaa1-0000-0000-0000-000000000002'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%device_revoked%' OR SQLERRM LIKE '%no_key_packages%' THEN ok := true;
    ELSE RAISE; END IF;
  END;
  PERFORM assert(ok, 'T3: expected error consuming revoked device');
END $$;

-- ---------------------------------------------------------------------------
-- T4: Same KeyPackage consumed twice — second attempt cannot resurrect
-- ---------------------------------------------------------------------------
-- After T1's consume, the KP row is deleted AND logged. A publish of the
-- SAME hash must return already_consumed.
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE
  consumed_hash text;
  r record;
  found_already boolean := false;
BEGIN
  SELECT key_package_hash INTO consumed_hash
    FROM mls_key_package_consumption_log LIMIT 1;
  PERFORM assert(consumed_hash IS NOT NULL, 'T4: setup — no consumption logged');

  -- Rebuild the exact same bundle the caller "already published" (deterministic bytes)
  -- Actually simpler: try to re-insert the SAME bytes by reconstructing kp1 and see.
  FOR r IN
    SELECT * FROM publish_mls_key_packages(
      jsonb_build_array(
        test_bundle('aaaaaaa1-0000-0000-0000-000000000001', 'alice-a1-devpub', 'kp1')
      )
    )
  LOOP
    IF r.status = 'already_consumed' THEN found_already := true; END IF;
  END LOOP;
  PERFORM assert(found_already,
    'T4: republishing a consumed KeyPackage must be rejected as already_consumed');
END $$;

-- ---------------------------------------------------------------------------
-- T5: Concurrent consumers — exactly one succeeds per KeyPackage
-- ---------------------------------------------------------------------------
-- We can't spawn real concurrent sessions inside a single-transaction test,
-- but FOR UPDATE SKIP LOCKED + DELETE guarantees atomicity. We assert the
-- invariant it protects: N consumes on M available KPs consume min(N,M)
-- unique hashes.
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE
  before_count int;
  after_count int;
  hash1 text; hash2 text;
BEGIN
  SELECT count(*) INTO before_count FROM public.mls_key_packages
    WHERE device_id = 'aaaaaaa1-0000-0000-0000-000000000001';
  PERFORM assert(before_count = 2, 'T5 setup: expected 2 KPs remaining');

  SELECT key_package_hash INTO hash1 FROM consume_mls_key_package(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL);
  SELECT key_package_hash INTO hash2 FROM consume_mls_key_package(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL);

  PERFORM assert(hash1 <> hash2, 'T5: two consumes produced the same hash');

  SELECT count(*) INTO after_count FROM public.mls_key_packages
    WHERE device_id = 'aaaaaaa1-0000-0000-0000-000000000001';
  PERFORM assert(after_count = 0, 'T5: expected 0 remaining after 2 consumes');
END $$;

-- ---------------------------------------------------------------------------
-- T6: Server substitution — hash/bytes mismatch on publish is rejected
-- ---------------------------------------------------------------------------
-- Client-side substitution detection is asserted separately in the TS
-- unit test (see test/mls-substitution.test.ts). Here we assert the
-- server refuses a bundle whose declared hash doesn't equal
-- sha256(key_package_b64) — which prevents a malicious client from
-- publishing bytes that later verify against a hash it controls.
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE
  bad jsonb;
  r record;
  found boolean := false;
BEGIN
  bad := jsonb_build_object(
    'device_id', 'aaaaaaa1-0000-0000-0000-000000000001',
    'ciphersuite_tag', 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
    -- deliberately wrong hash
    'key_package_hash', repeat('0', 64),
    'key_package_b64', encode(convert_to('substituted-bytes', 'UTF8'), 'base64'),
    'credential_identity_b64', encode(convert_to('alice-a1-devpub', 'UTF8'), 'base64'),
    'expires_at', (now() + interval '30 days')::text
  );
  FOR r IN SELECT * FROM publish_mls_key_packages(jsonb_build_array(bad)) LOOP
    IF r.status = 'malformed' THEN found := true; END IF;
  END LOOP;
  PERFORM assert(found, 'T6: expected malformed on hash/bytes mismatch');
END $$;

-- ---------------------------------------------------------------------------
-- T7: Replay after local consumption — server rejects even if local
--     bounded consumed-hash history has evicted the entry
-- ---------------------------------------------------------------------------
-- Reasserted via T4 (already_consumed is the mechanism). Additionally: the
-- consumption log has NO retention window in this migration; assert row
-- count grows monotonically with consumes.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM mls_key_package_consumption_log;
  PERFORM assert(n >= 3, 'T7: expected >=3 consumption-log rows, got ' || n);
END $$;

-- ---------------------------------------------------------------------------
-- T8: Exhaustion → replenishment integration
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM consume_mls_key_package(
      '11111111-1111-1111-1111-111111111111'::uuid, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%no_key_packages%' THEN ok := true; ELSE RAISE; END IF;
  END;
  PERFORM assert(ok, 'T8: expected no_key_packages when pool empty');
END $$;

-- Alice replenishes.
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE r record; accepted int := 0;
BEGIN
  FOR r IN
    SELECT * FROM publish_mls_key_packages(
      jsonb_build_array(
        test_bundle('aaaaaaa1-0000-0000-0000-000000000001', 'alice-a1-devpub', 'kp-refill-1'),
        test_bundle('aaaaaaa1-0000-0000-0000-000000000001', 'alice-a1-devpub', 'kp-refill-2')
      )
    )
  LOOP
    IF r.status = 'accepted' THEN accepted := accepted + 1; END IF;
  END LOOP;
  PERFORM assert(accepted = 2, 'T8: expected 2 replenishment KPs accepted');
END $$;

-- Bob can now consume again.
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM consume_mls_key_package(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL);
  PERFORM assert(r.remaining = 1, 'T8: expected 1 remaining after post-replenish consume');
END $$;

-- ---------------------------------------------------------------------------
-- T9: Malformed public KeyPackage (missing field) is rejected
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE r record; found boolean := false;
BEGIN
  FOR r IN SELECT * FROM publish_mls_key_packages(
    jsonb_build_array(jsonb_build_object('device_id', 'aaaaaaa1-0000-0000-0000-000000000001'))
  ) LOOP
    IF r.status = 'malformed' THEN found := true; END IF;
  END LOOP;
  PERFORM assert(found, 'T9: expected malformed on missing fields');
END $$;

-- ---------------------------------------------------------------------------
-- T10: No private KeyPackage material ever appears in mls_key_packages
-- ---------------------------------------------------------------------------
-- Schema-level guard: assert the table has no column that could carry
-- private material (init_secret, encryption_secret, leaf_secret,
-- signature_private_key, key_package_bundle).
DO $$
DECLARE forbidden text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO forbidden
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'mls_key_packages'
    AND column_name ~* '(private|secret|bundle|init_key|leaf_secret|encryption_secret)';
  IF forbidden IS NOT NULL THEN
    RAISE EXCEPTION 'T10: forbidden private-flavored columns present: %', forbidden;
  END IF;
END $$;

-- Also assert the payload column is bytea (opaque) — not jsonb/text (which
-- would suggest structured/inspectable material).
DO $$
DECLARE t text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mls_key_packages'
      AND column_name = 'key_package_tls';
  PERFORM assert(t = 'bytea', 'T10: key_package_tls must be bytea, got ' || t);
END $$;

-- ---------------------------------------------------------------------------
-- Cleanup helpers (leave data intact for CI log inspection; ROLLBACK below)
-- ---------------------------------------------------------------------------
DROP FUNCTION test_bundle(uuid, text, text, interval);
DROP FUNCTION assert(boolean, text);

ROLLBACK;
