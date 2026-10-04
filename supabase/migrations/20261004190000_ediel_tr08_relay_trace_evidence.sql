-- TR-08 (owner decision 2026-10-04): relay TLS is proven only by a persisted,
-- hash-bound read-back of a test message from an operator-owned mailbox.
-- `allRelayHopsVerified=true` in a transport-exception TLS source is no longer
-- accepted as a self-reported flag: it must name a verified trace of the same
-- company/environment recorded within 30 days. No trace is seeded here.
BEGIN;
CREATE SCHEMA gridex_relay_trace;
REVOKE ALL ON SCHEMA gridex_relay_trace FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_relay_trace.observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN('test','production')),
 probe_id text NOT NULL CHECK(length(probe_id) BETWEEN 8 AND 200),
 original bytea NOT NULL CHECK(octet_length(original) BETWEEN 1 AND 262144),
 original_sha256 text NOT NULL CHECK(original_sha256~'^[a-f0-9]{64}$'),
 verdict jsonb NOT NULL CHECK(jsonb_typeof(verdict)='object'),
 verified boolean NOT NULL,
 recorded_by uuid NOT NULL REFERENCES auth.users(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,environment,original_sha256),
 CHECK(original_sha256=encode(sha256(original),'hex')),
 CHECK(verdict->>'rawHeadersSha256' IS NOT DISTINCT FROM original_sha256),
 CHECK(verdict->>'schema' IS NOT DISTINCT FROM 'gridex_relay_trace_v1'),
 CHECK(verdict->>'probeId' IS NOT DISTINCT FROM probe_id),
 CHECK(verified=(verdict->>'verified' IS NOT DISTINCT FROM 'true')));
ALTER TABLE gridex_relay_trace.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_relay_trace.observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_relay_trace.observations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_relay_trace.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'relay_trace_evidence_immutable';END$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_relay_trace.observations FOR EACH ROW EXECUTE FUNCTION gridex_relay_trace.immutable_v1();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_relay_trace.observations FOR EACH STATEMENT EXECUTE FUNCTION gridex_relay_trace.immutable_v1();

-- Received header values of the original, unfolded, in chronological order
-- (headers are prepended, so the last one in the block is the first hop).
CREATE FUNCTION gridex_relay_trace.received_v1(o bytea) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
WITH b AS (SELECT split_part(regexp_replace(replace(convert_from(o,'UTF8'),E'\r\n',E'\n'),E'\n[ \t]+',' ','g'),E'\n\n',1) block),
 r AS (SELECT m[1] v,row_number() OVER () n FROM b,regexp_matches(b.block,'^received:[ \t]*(.*)$','gin') m)
SELECT coalesce(array_agg(v ORDER BY n DESC),'{}') FROM r$$;

-- A verified verdict must be consistent with the stored original, re-checked
-- here rather than trusted: same hop count, the own-submission hop is received
-- by a declared own host, every relay hop's Received header independently shows
-- TLS (RFC 3848 *S transmission type or TLS 1.2/1.3) and no SSL/TLS<1.2 marker,
-- the probe header is present, SPF passed and no failure reason is listed.
CREATE FUNCTION gridex_relay_trace.consistent_v1(o bytea,probe text,v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
SELECT v->>'verified'='true'
 AND jsonb_array_length(v->'hops')=cardinality(gridex_relay_trace.received_v1(o))
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(v->'hops') h
  WHERE (h->>'index')::int<>ALL(SELECT generate_series(0,cardinality(gridex_relay_trace.received_v1(o))-1))
   OR (h->>'role'='own_submission' AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(v->'ownHosts') own
     WHERE lower(substring((gridex_relay_trace.received_v1(o))[(h->>'index')::int+1] from '(?i)\mby\s+([^\s;()]+)')) ~ ('(^|\.)'||regexp_replace(own,'([.\\+*?^$()\[\]{}|-])','\\\1','g')||'\.?$')))
   OR (h->>'role'='relay' AND ((gridex_relay_trace.received_v1(o))[(h->>'index')::int+1] !~* '(\mwith\s+(ESMTPS|ESMTPSA|UTF8SMTPS|UTF8SMTPSA|LMTPS|LMTPSA)\M|TLS\s*v?\s*1[._][23]|version=TLS1_[23])'
     OR (gridex_relay_trace.received_v1(o))[(h->>'index')::int+1] ~* '(SSLv[23]|TLS\s*v?\s*1[._][01]|version=TLS1_[01]|TLSv1([^._0-9]|$))')))
 AND position(lower('x-gridex-relay-probe: '||probe) IN lower(convert_from(o,'UTF8')))>0
 AND jsonb_typeof(v->'hops')='array' AND jsonb_typeof(v->'reasons')='array' AND jsonb_array_length(v->'reasons')=0
 AND v->>'spf'='pass' AND v->>'allRelayHopsTls'='true'
 AND (SELECT count(*) FROM jsonb_array_elements(v->'hops') h WHERE h->>'role'='own_submission')=1
 AND (SELECT count(*) FROM jsonb_array_elements(v->'hops') h WHERE h->>'role'='relay')>=1
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(v->'hops') h WHERE h->>'role'='relay' AND (h->>'tls' IS DISTINCT FROM 'true' OR h->>'weakTls' IS DISTINCT FROM 'false'))
 AND (v->>'relayHopCount')::int=(SELECT count(*) FROM jsonb_array_elements(v->'hops') h WHERE h->>'role'='relay')$$;

CREATE FUNCTION gridex_relay_trace.record_v1(c uuid,env text,actor uuid,o bytea,v jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE id uuid;
BEGIN
 PERFORM gridex_transport_exception.actor_v1(c,actor,'communication.write');
 IF v->>'verified'='true' AND gridex_relay_trace.consistent_v1(o,v->>'probeId',v) IS NOT TRUE THEN
  RAISE EXCEPTION 'relay_trace_verdict_inconsistent';END IF;
 INSERT INTO gridex_relay_trace.observations(company_id,environment,probe_id,original,original_sha256,verdict,verified,recorded_by)
 VALUES(c,env,v->>'probeId',o,encode(sha256(o),'hex'),v,v->>'verified'='true',actor) RETURNING observations.id INTO id;
 RETURN id;
END$$;
CREATE FUNCTION public.ediel_record_relay_trace_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_original bytea,p_verdict jsonb) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
SELECT gridex_relay_trace.record_v1(p_company_id,p_environment,p_actor_user_id,p_original,p_verdict)$$;
REVOKE ALL ON FUNCTION gridex_relay_trace.received_v1(bytea),gridex_relay_trace.consistent_v1(bytea,text,jsonb),gridex_relay_trace.record_v1(uuid,text,uuid,bytea,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_record_relay_trace_v1(uuid,text,uuid,bytea,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_record_relay_trace_v1(uuid,text,uuid,bytea,jsonb) TO service_role;

CREATE FUNCTION public.ediel_read_relay_trace_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_relay_trace.observations%rowtype;
BEGIN
 PERFORM gridex_transport_exception.actor_v1(p_company_id,p_actor_user_id,'communication.write');
 SELECT * INTO r FROM gridex_relay_trace.observations WHERE company_id=p_company_id AND environment=p_environment ORDER BY recorded_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',r.id,'rawHeaders',convert_from(r.original,'UTF8'),'originalSha256',r.original_sha256,'probeId',r.probe_id,
  'ownHosts',r.verdict->'ownHosts','recordedAt',r.recorded_at,'verified',r.verified);
END$$;
REVOKE ALL ON FUNCTION public.ediel_read_relay_trace_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_relay_trace_v1(uuid,text,uuid) TO service_role;

-- Bind the transport-exception TLS flag to persisted evidence.
CREATE FUNCTION gridex_relay_trace.require_for_approval_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tls jsonb:=NEW.source_facts->'tls';
BEGIN
 IF tls->>'allRelayHopsVerified'='true' AND NOT EXISTS(SELECT FROM gridex_relay_trace.observations o
   WHERE o.company_id=NEW.company_id AND o.environment=NEW.environment AND o.verified
    AND o.original_sha256=tls->>'relayTraceSha256'
    AND o.recorded_at<=clock_timestamp() AND o.recorded_at>clock_timestamp()-interval '30 days')
 THEN RAISE EXCEPTION 'transport_relay_trace_evidence_required';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION gridex_relay_trace.require_for_approval_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER relay_trace_required BEFORE INSERT ON gridex_transport_exception.approvals FOR EACH ROW EXECUTE FUNCTION gridex_relay_trace.require_for_approval_v1();
COMMIT;
