-- EDIEL03.01: prospective owner-qualified LOCAL TEST only, no seed or new grant.
-- Not activation. Qualification requires Main's measured installation/build manifest.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $preimage$
BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolbypassrls)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_ediel_transport.mutate_v1(jsonb)'::regprocedure)
 IS DISTINCT FROM 'ab45d6af1a9f6bbc1aa520adf1bfbdfd3c4bd2c4dd90cd4f647f9d75dff14f22'
 THEN RAISE EXCEPTION 'local_wait_source_or_owner_mismatch' USING ERRCODE='55000';END IF;
END $preimage$;
CREATE SCHEMA gridex_ediel_local_wait;
REVOKE ALL ON SCHEMA gridex_ediel_local_wait FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA gridex_ediel_local_wait REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA gridex_ediel_local_wait REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_local_wait.database_identity_v1() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT s.system_identifier::text||':'||d.oid::text||':'||d.datname
 FROM pg_catalog.pg_control_system() s CROSS JOIN pg_catalog.pg_database d WHERE d.datname=current_database()
$$;
CREATE TABLE gridex_ediel_local_wait.installations_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),database_identity text NOT NULL,
 qualification_sha256 text NOT NULL CHECK(qualification_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz
);
CREATE UNLOGGED TABLE gridex_ediel_local_wait.runtimes_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),installation_id uuid NOT NULL REFERENCES gridex_ediel_local_wait.installations_v1(id),
 database_identity text NOT NULL,postmaster_started_at timestamptz NOT NULL,
 -- SHA256(UTF8(trim(actual server .next/BUILD_ID))), not source commit SHA.
 build_sha256 text NOT NULL CHECK(build_sha256 ~ '^[0-9a-f]{64}$'),
 smtp_endpoint jsonb NOT NULL CHECK(jsonb_typeof(smtp_endpoint)='object'),
 smtp_endpoint_sha256 text NOT NULL CHECK(smtp_endpoint_sha256 ~ '^[0-9a-f]{64}$'),
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL CHECK(valid_until>valid_from),revoked_at timestamptz
);
CREATE TABLE gridex_ediel_local_wait.policies_v1(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),installation_id uuid NOT NULL REFERENCES gridex_ediel_local_wait.installations_v1(id),
 -- A permanent table cannot FK to UNLOGGED. Every use resolves the exact runtime.
 runtime_id uuid NOT NULL,company_id uuid NOT NULL REFERENCES public.companies(id),
 snapshot_id uuid NOT NULL REFERENCES public.ediel_configuration_snapshots(id),snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{64}$'),
 outbox_id uuid NOT NULL UNIQUE REFERENCES public.ediel_outbox(id),message_id uuid NOT NULL UNIQUE REFERENCES public.ediel_messages(id),
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 original_hash text NOT NULL CHECK(original_hash ~ '^[0-9a-f]{64}$'),route_id uuid NOT NULL,
 policy_version text NOT NULL DEFAULT 'local-test-4xx-v1' CHECK(policy_version='local-test-4xx-v1'),
 delay_seconds integer NOT NULL DEFAULT 60 CHECK(delay_seconds BETWEEN 1 AND 3600),
 -- A prospective two-attempt cap, never an increment/reset of any old job budget.
 attempt_limit integer NOT NULL DEFAULT 2 CHECK(attempt_limit=2),
 deadline timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz
);
CREATE TABLE gridex_ediel_local_wait.waits_v1(
 attempt_id uuid PRIMARY KEY REFERENCES gridex_ediel_transport.attempts(id),
 policy_id uuid NOT NULL REFERENCES gridex_ediel_local_wait.policies_v1(id),
 smtp_code integer NOT NULL CHECK(smtp_code BETWEEN 400 AND 499),
 observed_at timestamptz NOT NULL,not_before timestamptz NOT NULL,deadline timestamptz NOT NULL,
 consumed_at timestamptz,CHECK(not_before>observed_at AND deadline>not_before)
);
CREATE FUNCTION gridex_ediel_local_wait.immutable_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'local_wait_history_delete_denied' USING ERRCODE='55000';END IF;
 IF TG_TABLE_NAME='waits_v1' THEN
  IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
   OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
   RAISE EXCEPTION 'local_wait_observation_immutable' USING ERRCODE='55000';END IF;
 ELSE
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
   OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
   RAISE EXCEPTION 'local_wait_origin_immutable' USING ERRCODE='55000';END IF;
 END IF;
 RETURN NEW;
END $$;
DO $tables$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['installations_v1','runtimes_v1','policies_v1','waits_v1'] LOOP
  EXECUTE format('ALTER TABLE gridex_ediel_local_wait.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON gridex_ediel_local_wait.%I FROM PUBLIC,anon,authenticated,service_role',n);
  EXECUTE format('CREATE TRIGGER immutable_origin BEFORE UPDATE OR DELETE ON gridex_ediel_local_wait.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_local_wait.immutable_v1()',n);
 END LOOP;
END $tables$;
CREATE FUNCTION gridex_ediel_local_wait.policy_due_v1(p_observed timestamptz,p_delay integer,p_deadline timestamptz) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE due timestamptz;
BEGIN
 IF p_observed IS NULL OR NOT isfinite(p_observed) OR p_delay IS NULL OR p_delay NOT BETWEEN 1 AND 3600
 OR p_deadline IS NULL OR NOT isfinite(p_deadline) THEN RAISE EXCEPTION 'local_wait_policy_invalid' USING ERRCODE='22023';END IF;
 due:=p_observed+make_interval(secs=>p_delay);
 IF due>=p_deadline THEN RAISE EXCEPTION 'local_wait_deadline_exhausted' USING ERRCODE='22023';END IF;
 RETURN due;
END $$;
-- Exact nonsecret transporter tuple. Literal loopback only: no DNS/proxy
-- substitution. The app supplies public CA-set hash, never credentials/tokens.
CREATE FUNCTION gridex_ediel_local_wait.smtp_endpoint_sha256_v1(e jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE fingerprint text;
BEGIN
 IF e IS NULL OR jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(e))<>11
 OR EXISTS(SELECT FROM jsonb_object_keys(e) k WHERE k NOT IN('version','provider','host','port','secure','requireTLS','rejectUnauthorized','minVersion','servername','caTrustSha256','fingerprint'))
 OR e->'version' IS DISTINCT FROM '1'::jsonb OR e->>'provider' IS DISTINCT FROM 'strato'
 OR (e->>'host' IN('127.0.0.1','::1')) IS NOT TRUE OR jsonb_typeof(e->'port') IS DISTINCT FROM 'number'
 OR (e->>'port' ~ '^[1-9][0-9]{0,4}$') IS NOT TRUE
 OR (e->'secure' IN('true'::jsonb,'false'::jsonb)) IS NOT TRUE
 OR e->'requireTLS' IS DISTINCT FROM 'true'::jsonb OR e->'rejectUnauthorized' IS DISTINCT FROM 'true'::jsonb
 OR e->>'minVersion' IS DISTINCT FROM 'TLSv1.2' OR e->'servername' IS DISTINCT FROM 'null'::jsonb
 OR (e->>'caTrustSha256' ~ '^[0-9a-f]{64}$') IS NOT TRUE
 OR (e->>'fingerprint' ~ '^[0-9a-f]{64}$') IS NOT TRUE THEN RETURN NULL;END IF;
 IF (e->>'port')::integer NOT BETWEEN 1 AND 65535 THEN RETURN NULL;END IF;
 fingerprint:=encode(sha256(convert_to(concat_ws(E'\n','local-smtp-endpoint-v1',e->>'provider',e->>'host',e->>'port',e->>'secure',e->>'requireTLS',e->>'rejectUnauthorized',e->>'minVersion','no-servername',e->>'caTrustSha256'),'UTF8')),'hex');
 RETURN CASE WHEN fingerprint=e->>'fingerprint' THEN fingerprint ELSE NULL END;
END $$;
-- Owner-only measured installation writer. No service/client RPC or environment flag.
-- The qualification hash binds the externally verified LOCAL resource/build manifest;
-- database identity and current boot are verified again inside the same transaction.
CREATE FUNCTION gridex_ediel_local_wait.qualify_installation_v1(p_database_identity text,p_postmaster timestamptz,p_qualification_hash text,p_build_hash text,p_until timestamptz,p_smtp_endpoint jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE iid uuid;rid uuid;t timestamptz:=clock_timestamp();
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'local_wait_owner_required' USING ERRCODE='42501';END IF;
 IF p_database_identity IS DISTINCT FROM gridex_ediel_local_wait.database_identity_v1()
 OR p_postmaster IS DISTINCT FROM pg_postmaster_start_time()
 OR p_qualification_hash IS NULL OR p_qualification_hash !~ '^[0-9a-f]{64}$'
 OR p_build_hash IS NULL OR p_build_hash !~ '^[0-9a-f]{64}$'
 OR gridex_ediel_local_wait.smtp_endpoint_sha256_v1(p_smtp_endpoint) IS NULL
 OR p_until IS NULL OR NOT isfinite(p_until) OR p_until<=t OR p_until>t+interval '2 hours'
 THEN RAISE EXCEPTION 'local_wait_installation_qualification_mismatch' USING ERRCODE='23514';END IF;
 INSERT INTO gridex_ediel_local_wait.installations_v1(database_identity,qualification_sha256) VALUES(p_database_identity,p_qualification_hash) RETURNING id INTO iid;
 INSERT INTO gridex_ediel_local_wait.runtimes_v1(installation_id,database_identity,postmaster_started_at,build_sha256,smtp_endpoint,smtp_endpoint_sha256,valid_from,valid_until)
 VALUES(iid,p_database_identity,p_postmaster,p_build_hash,p_smtp_endpoint,gridex_ediel_local_wait.smtp_endpoint_sha256_v1(p_smtp_endpoint),t,p_until) RETURNING id INTO rid;
 RETURN jsonb_build_object('installationId',iid,'runtimeId',rid,'expiresAt',p_until);
END $$;
CREATE FUNCTION gridex_ediel_local_wait.require_policy_v1(p_message_id uuid,p_actor uuid,p_server_build_sha256 text DEFAULT NULL,p_require_build boolean DEFAULT false,p_server_smtp_endpoint jsonb DEFAULT NULL) RETURNS gridex_ediel_local_wait.policies_v1
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE p gridex_ediel_local_wait.policies_v1%rowtype;i gridex_ediel_local_wait.installations_v1%rowtype;
 r gridex_ediel_local_wait.runtimes_v1%rowtype;m public.ediel_messages%rowtype;s public.ediel_messages%rowtype;
 o public.ediel_outbox%rowtype;snap public.ediel_configuration_snapshots%rowtype;t timestamptz;
BEGIN
 SELECT * INTO STRICT p FROM gridex_ediel_local_wait.policies_v1 WHERE message_id=p_message_id FOR SHARE;
 SELECT * INTO STRICT i FROM gridex_ediel_local_wait.installations_v1 WHERE id=p.installation_id FOR SHARE;
 SELECT * INTO STRICT r FROM gridex_ediel_local_wait.runtimes_v1 WHERE id=p.runtime_id AND installation_id=p.installation_id FOR SHARE;
 IF p_require_build IS TRUE AND (p_server_build_sha256 IS NULL OR p_server_build_sha256 !~ '^[0-9a-f]{64}$'
 OR p_server_build_sha256 IS DISTINCT FROM r.build_sha256) THEN
  RAISE EXCEPTION 'local_wait_build_identity_mismatch' USING ERRCODE='55000';END IF;
 IF p_require_build IS TRUE AND (p_server_smtp_endpoint IS DISTINCT FROM r.smtp_endpoint
 OR gridex_ediel_local_wait.smtp_endpoint_sha256_v1(p_server_smtp_endpoint) IS DISTINCT FROM r.smtp_endpoint_sha256) THEN
  RAISE EXCEPTION 'local_wait_smtp_endpoint_mismatch' USING ERRCODE='55000';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p.message_id FOR SHARE;
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE id=p.source_message_id FOR SHARE;
 SELECT * INTO STRICT o FROM public.ediel_outbox WHERE id=p.outbox_id FOR SHARE;
 SELECT * INTO STRICT snap FROM public.ediel_configuration_snapshots WHERE id=p.snapshot_id AND company_id=p.company_id FOR SHARE;
 PERFORM 1 FROM public.companies c WHERE c.id=p.company_id AND c.status='active' AND c.is_active AND c.is_paused IS FALSE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'local_wait_company_ineligible' USING ERRCODE='42501';END IF;
 -- The existing reader owns current source/actor/endpoint authority, not this policy.
 PERFORM gridex_ediel_technical_ack.read_persisted_contrl_v2(p.company_id,'test',p.message_id,p_actor,'send');
 IF NOT EXISTS(SELECT FROM public.canonical_tenant_operation_decision(p.company_id,'ediel.test.process') d WHERE d.allowed)
 THEN RAISE EXCEPTION 'local_wait_canonical_denied' USING ERRCODE='42501';END IF;
 t:=clock_timestamp();
 IF p.revoked_at IS NOT NULL OR i.revoked_at IS NOT NULL OR r.revoked_at IS NOT NULL
 OR i.database_identity IS DISTINCT FROM gridex_ediel_local_wait.database_identity_v1()
 OR r.database_identity IS DISTINCT FROM i.database_identity OR r.postmaster_started_at IS DISTINCT FROM pg_postmaster_start_time()
 OR t<r.valid_from OR t>=r.valid_until OR t>=p.deadline
 OR snap.configuration_hash IS DISTINCT FROM p.snapshot_hash
 OR EXISTS(SELECT FROM public.ediel_configuration_snapshots x WHERE x.company_id=p.company_id AND x.snapshot_version>snap.snapshot_version)
 OR m.company_id IS DISTINCT FROM p.company_id OR m.environment IS DISTINCT FROM 'test' OR m.direction IS DISTINCT FROM 'outbound'
 OR m.message_family IS DISTINCT FROM 'CONTRL' OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM p.original_hash
 OR encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') IS DISTINCT FROM p.original_hash OR m.communication_route_id IS DISTINCT FROM p.route_id
 OR s.direction IS DISTINCT FROM 'inbound' OR s.environment IS DISTINCT FROM 'test'
 OR (s.company_id IS NOT NULL AND s.company_id IS DISTINCT FROM p.company_id)
 OR encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') IS DISTINCT FROM p.source_hash
 OR o.company_id IS DISTINCT FROM p.company_id OR o.environment IS DISTINCT FROM 'test' OR o.ediel_message_id IS DISTINCT FROM p.message_id
 OR o.source_message_id IS DISTINCT FROM p.source_message_id
 THEN RAISE EXCEPTION 'local_wait_binding_not_current' USING ERRCODE='55000';END IF;
 RETURN p;
END $$;
-- Normal qualification is a separate owner operation, never api_client.execute
-- authority. It can bind only a genuinely existing, sealed, unsent technical ACK.
CREATE FUNCTION gridex_ediel_local_wait.bind_outbox_v1(p_runtime_id uuid,p_outbox_id uuid,p_snapshot_id uuid,p_actor uuid,p_deadline timestamptz,p_delay integer DEFAULT 60) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE r gridex_ediel_local_wait.runtimes_v1%rowtype;o public.ediel_outbox%rowtype;
 m public.ediel_messages%rowtype;s public.ediel_messages%rowtype;snap public.ediel_configuration_snapshots%rowtype;
 basis jsonb;pid uuid;p gridex_ediel_local_wait.policies_v1%rowtype;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'local_wait_owner_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 SELECT * INTO STRICT r FROM gridex_ediel_local_wait.runtimes_v1 WHERE id=p_runtime_id FOR SHARE;
 SELECT * INTO STRICT o FROM public.ediel_outbox WHERE id=p_outbox_id FOR UPDATE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=o.ediel_message_id FOR SHARE;
 basis:=gridex_ediel_technical_ack.read_persisted_contrl_v2(o.company_id,'test',m.id,p_actor,'send');
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE id=(basis#>>'{technicalSyntaxAckEvidence,sourceMessageId}')::uuid FOR SHARE;
 SELECT * INTO STRICT snap FROM public.ediel_configuration_snapshots WHERE id=p_snapshot_id AND company_id=o.company_id FOR SHARE;
 PERFORM gridex_ediel_local_wait.policy_due_v1(clock_timestamp(),p_delay,p_deadline);
 IF o.environment IS DISTINCT FROM 'test' OR m.environment IS DISTINCT FROM 'test' OR m.message_family IS DISTINCT FROM 'CONTRL'
 OR o.status NOT IN('prepared','queued') OR o.source_message_id IS DISTINCT FROM s.id
 OR o.attempts<>0 OR o.send_attempt_count<>0 OR o.current_send_attempt_id IS NOT NULL OR o.locked_at IS NOT NULL
 OR EXISTS(SELECT FROM gridex_ediel_transport.attempts WHERE message_id=m.id)
 OR p_deadline>r.valid_until OR m.communication_route_id IS NULL
 THEN RAISE EXCEPTION 'local_wait_fresh_owned_outbox_required' USING ERRCODE='55000';END IF;
 INSERT INTO gridex_ediel_local_wait.policies_v1(installation_id,runtime_id,company_id,snapshot_id,snapshot_hash,outbox_id,message_id,source_message_id,source_hash,original_hash,route_id,delay_seconds,deadline)
 VALUES(r.installation_id,r.id,o.company_id,snap.id,snap.configuration_hash,o.id,m.id,s.id,encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex'),m.immutable_payload_hash,m.communication_route_id,p_delay,p_deadline) RETURNING id INTO pid;
 p:=gridex_ediel_local_wait.require_policy_v1(m.id,p_actor);
 RETURN pid;
END $$;
CREATE FUNCTION gridex_ediel_local_wait.outbox_fence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p gridex_ediel_local_wait.policies_v1%rowtype;w gridex_ediel_local_wait.waits_v1%rowtype;t timestamptz;
BEGIN
 SELECT * INTO p FROM gridex_ediel_local_wait.policies_v1 WHERE outbox_id=OLD.id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
 OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.ediel_message_id IS DISTINCT FROM OLD.ediel_message_id
 OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
 OR NEW.attempts<OLD.attempts OR NEW.send_attempt_count<OLD.send_attempt_count
 THEN RAISE EXCEPTION 'local_wait_outbox_lineage_or_counter_change' USING ERRCODE='55000';END IF;
 IF NEW.status='sending' THEN
  -- Broad actorless worker claims are not a LOCAL retry entry.
  IF NEW.updated_by IS NULL OR NEW.locked_by IS DISTINCT FROM 'ediel-outbox-direct-'||NEW.updated_by::text
  THEN RETURN NULL;END IF;
  SELECT * INTO w FROM gridex_ediel_local_wait.waits_v1 WHERE policy_id=p.id AND consumed_at IS NULL ORDER BY observed_at DESC LIMIT 1;
  -- Before due: suppress the row update itself, including lease and counters.
  t:=clock_timestamp();IF FOUND AND t<w.not_before THEN RETURN NULL;END IF;
  p:=gridex_ediel_local_wait.require_policy_v1(OLD.ediel_message_id,NEW.updated_by);
  IF NEW.attempts>p.attempt_limit OR NEW.send_attempt_count>p.attempt_limit THEN RAISE EXCEPTION 'local_wait_attempt_budget_exhausted' USING ERRCODE='55000';END IF;
  IF OLD.status<>'sending' AND (OLD.status NOT IN('prepared','queued') OR NEW.attempts<>OLD.attempts+1 OR NEW.send_attempt_count<>OLD.send_attempt_count+1)
  THEN RAISE EXCEPTION 'local_wait_claim_increment_invalid' USING ERRCODE='55000';END IF;
  IF OLD.status='sending' AND (NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.send_attempt_count IS DISTINCT FROM OLD.send_attempt_count
   OR NEW.current_send_attempt_id IS DISTINCT FROM OLD.current_send_attempt_id OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
   OR NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN
   RAISE EXCEPTION 'local_wait_claim_lease_immutable' USING ERRCODE='55000';END IF;
 ELSIF NEW.attempts<>OLD.attempts OR NEW.send_attempt_count<>OLD.send_attempt_count THEN
  RAISE EXCEPTION 'local_wait_unclaimed_attempt_increment' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_local_wait_outbox_fence BEFORE UPDATE ON public.ediel_outbox FOR EACH ROW EXECUTE FUNCTION gridex_ediel_local_wait.outbox_fence_v1();

-- Exact existing 465 delegate body; original signature/OID/ACL retained below.
CREATE FUNCTION gridex_ediel_local_wait.delegate_transport_v1(p_input jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$DECLARE r jsonb;BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();r:=gridex_ediel_transport.mutate_before_duplicate_protocol_v1(p_input);IF p_input->>'action' IN('prepare','enter') AND r->>'proceed'='true' THEN PERFORM gridex_ediel_duplicate_responses.require_transport_v1((p_input->>'companyId')::uuid,(p_input->>'messageId')::uuid,(p_input->>'actorUserId')::uuid);END IF;RETURN r;END$$;
CREATE OR REPLACE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p gridex_ediel_local_wait.policies_v1%rowtype;w gridex_ediel_local_wait.waits_v1%rowtype;
 a gridex_ediel_transport.attempts%rowtype;r gridex_ediel_transport.reservations%rowtype;
 o public.ediel_outbox%rowtype;result jsonb;action text:=p_input->>'action';mid uuid:=(p_input->>'messageId')::uuid;
 actor uuid:=(p_input->>'actorUserId')::uuid;aid uuid:=(p_input->>'attemptId')::uuid;
 code integer;due timestamptz;resume boolean:=false;
BEGIN
 -- Absence never opts production or an unconfigured test source into this policy.
 IF NOT EXISTS(SELECT FROM gridex_ediel_local_wait.policies_v1 WHERE message_id=mid) THEN
  RETURN gridex_ediel_local_wait.delegate_transport_v1(p_input);
 END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF action='observe' THEN
  -- New LOCAL qualification expiring during SMTP must not erase the old
  -- journal's actual observation. Only new retry eligibility is withheld.
  result:=gridex_ediel_local_wait.delegate_transport_v1(p_input);
  BEGIN
   p:=gridex_ediel_local_wait.require_policy_v1(mid,actor,p_input->>'serverBuildSha256',action IN('prepare','enter'),p_input->'serverSmtpEndpoint');
  EXCEPTION WHEN OTHERS THEN
   RETURN result||jsonb_build_object('localTestWaitDenied',SQLSTATE);
  END;
 ELSE
  p:=gridex_ediel_local_wait.require_policy_v1(mid,actor,p_input->>'serverBuildSha256',action IN('prepare','enter'),p_input->'serverSmtpEndpoint');
 END IF;
 IF p_input->>'companyId' IS DISTINCT FROM p.company_id::text OR p_input->>'environment' IS DISTINCT FROM 'test'
 THEN RAISE EXCEPTION 'local_wait_transport_scope_mismatch' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT o FROM public.ediel_outbox WHERE id=p.outbox_id FOR UPDATE;
 IF action='prepare' THEN
  IF p_input#>>'{owner,kind}' IS DISTINCT FROM 'worker' OR p_input#>>'{owner,outboxId}' IS DISTINCT FROM o.id::text
   OR p_input#>>'{owner,sendAttemptId}' IS DISTINCT FROM o.current_send_attempt_id::text
   OR p_input#>>'{owner,workerId}' IS DISTINCT FROM o.locked_by
   OR o.status<>'sending' OR o.attempts>p.attempt_limit OR o.send_attempt_count>p.attempt_limit
  THEN RAISE EXCEPTION 'local_wait_claim_owner_mismatch' USING ERRCODE='55000';END IF;
  IF p_input#>'{binding,localSmtpEndpoint}' IS DISTINCT FROM p_input->'serverSmtpEndpoint' THEN
   RAISE EXCEPTION 'local_wait_smtp_audit_binding_mismatch' USING ERRCODE='55000';END IF;
  SELECT * INTO r FROM gridex_ediel_transport.reservations WHERE message_id=mid FOR UPDATE;
  IF FOUND AND r.state='observed' THEN
   SELECT * INTO w FROM gridex_ediel_local_wait.waits_v1 WHERE attempt_id=r.attempt_id AND policy_id=p.id FOR UPDATE;
   IF FOUND AND w.consumed_at IS NULL THEN
    SELECT * INTO STRICT a FROM gridex_ediel_transport.attempts WHERE id=w.attempt_id FOR SHARE;
    IF clock_timestamp()<w.not_before OR clock_timestamp()>=w.deadline OR w.deadline IS DISTINCT FROM p.deadline
     OR a.classification IS DISTINCT FROM 'explicit_negative' OR a.entered_at IS NULL
     OR a.provider_result#>>'{error,responseCode}' IS DISTINCT FROM w.smtp_code::text
     OR a.message_id IS DISTINCT FROM mid OR a.company_id IS DISTINCT FROM p.company_id OR a.environment IS DISTINCT FROM 'test'
     OR a.observed_at IS DISTINCT FROM w.observed_at
     OR (SELECT jsonb_object_agg(k,a.binding->k) FROM unnest(ARRAY['originalHash','payloadHash','payloadLength','routeId','from','to','encoding','mimeMode','sourceRulePackEvidence','technicalSyntaxAckEvidence','localSmtpEndpoint']) k)
        IS DISTINCT FROM
        (SELECT jsonb_object_agg(k,(p_input->'binding')->k) FROM unnest(ARRAY['originalHash','payloadHash','payloadLength','routeId','from','to','encoding','mimeMode','sourceRulePackEvidence','technicalSyntaxAckEvidence','localSmtpEndpoint']) k)
    THEN RAISE EXCEPTION 'local_wait_retry_not_authorized' USING ERRCODE='55000';END IF;
    -- Releasing only this proven definite-refusal cursor and creating the new
    -- attempt are ONE transaction. Any old source/route guard denial rolls back.
    UPDATE gridex_ediel_transport.reservations SET state='released' WHERE message_id=mid AND attempt_id=w.attempt_id AND state='observed';
    resume:=true;
   END IF;
  END IF;
 END IF;
 IF action='enter' THEN
  SELECT * INTO STRICT a FROM gridex_ediel_transport.attempts WHERE id=aid AND message_id=mid AND company_id=p.company_id FOR SHARE;
  IF a.binding->'localSmtpEndpoint' IS DISTINCT FROM p_input->'serverSmtpEndpoint' THEN
   RAISE EXCEPTION 'local_wait_smtp_audit_binding_mismatch' USING ERRCODE='55000';END IF;
 END IF;
 IF action IS DISTINCT FROM 'observe' THEN
  result:=gridex_ediel_local_wait.delegate_transport_v1(p_input);
  -- Recheck after all waits inside the unmodified canonical/source owner.
  p:=gridex_ediel_local_wait.require_policy_v1(mid,actor,p_input->>'serverBuildSha256',action IN('prepare','enter'),p_input->'serverSmtpEndpoint');
 END IF;
 IF resume THEN
  IF result->>'proceed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'local_wait_retry_prepare_denied' USING ERRCODE='55000';END IF;
  UPDATE gridex_ediel_local_wait.waits_v1 SET consumed_at=clock_timestamp() WHERE attempt_id=w.attempt_id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'local_wait_retry_already_consumed' USING ERRCODE='55000';END IF;
 END IF;
 IF action='observe' AND result->>'classification'='explicit_negative' THEN
  SELECT * INTO STRICT a FROM gridex_ediel_transport.attempts WHERE id=aid AND message_id=mid AND company_id=p.company_id AND environment='test' FOR SHARE;
  -- The journal is the authority: never infer a 4xx from an Error.message.
  IF jsonb_typeof(a.provider_result#>'{error,responseCode}')='number'
    AND a.provider_result#>>'{error,responseCode}' ~ '^4[0-9][0-9]$'
    AND NOT (a.provider_result ? 'accepted') AND NOT (a.provider_result ? 'rejected')
    AND a.entered_at IS NOT NULL AND a.observed_at IS NOT NULL
    AND a.observed_at+make_interval(secs=>p.delay_seconds)<p.deadline AND o.attempts<p.attempt_limit AND o.send_attempt_count<p.attempt_limit
    AND a.owner->>'kind'='worker' AND a.owner->>'outboxId'=o.id::text
    AND a.owner->>'sendAttemptId'=o.current_send_attempt_id::text AND a.owner->>'workerId'=o.locked_by THEN
   code:=(a.provider_result#>>'{error,responseCode}')::integer;
   due:=gridex_ediel_local_wait.policy_due_v1(a.observed_at,p.delay_seconds,p.deadline);
   INSERT INTO gridex_ediel_local_wait.waits_v1(attempt_id,policy_id,smtp_code,observed_at,not_before,deadline)
   VALUES(a.id,p.id,code,a.observed_at,due,p.deadline) ON CONFLICT(attempt_id) DO NOTHING;
   SELECT * INTO STRICT w FROM gridex_ediel_local_wait.waits_v1 WHERE attempt_id=a.id FOR SHARE;
   IF w.policy_id<>p.id OR w.smtp_code<>code OR w.observed_at IS DISTINCT FROM a.observed_at
    OR w.not_before IS DISTINCT FROM due OR w.deadline IS DISTINCT FROM p.deadline OR w.consumed_at IS NOT NULL
   THEN RAISE EXCEPTION 'local_wait_observation_changed' USING ERRCODE='55000';END IF;
   IF o.status='sending' THEN
    UPDATE public.ediel_outbox SET status='queued',locked_at=NULL,locked_by=NULL,
      last_error='ediel_local_test_retry_wait',updated_at=clock_timestamp()
    WHERE id=o.id AND status='sending' AND current_send_attempt_id=o.current_send_attempt_id AND locked_by=o.locked_by;
    IF NOT FOUND THEN RAISE EXCEPTION 'local_wait_observation_lease_lost' USING ERRCODE='55000';END IF;
   ELSIF o.status<>'queued' OR o.last_error IS DISTINCT FROM 'ediel_local_test_retry_wait' THEN
    RAISE EXCEPTION 'local_wait_observation_projection_changed' USING ERRCODE='55000';
   END IF;
   result:=result||jsonb_build_object('localTestWait',jsonb_build_object(
    'version',1,'policyVersion',p.policy_version,'companyId',p.company_id,'messageId',mid,'attemptId',aid,'outboxId',o.id,
    'environment','test','smtpCode',code,'observedAt',w.observed_at,'notBefore',w.not_before,'deadline',w.deadline,'delaySeconds',p.delay_seconds));
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_local_wait FROM PUBLIC,anon,authenticated,service_role;
-- Existing transport signature/OID/grants are preserved by CREATE OR REPLACE.
-- No public/client/service privilege or production readiness is added.
COMMIT;
