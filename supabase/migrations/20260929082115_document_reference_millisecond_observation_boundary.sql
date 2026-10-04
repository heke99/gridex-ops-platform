-- The Storage readback starts only after the committed begin RPC returns, but
-- JavaScript records whole milliseconds while PostgreSQL records microseconds.
-- The same millisecond can otherwise fail as a pre-attempt observation. Compare
-- at the observation clock's precision; retain the completed/start ordering,
-- bounded future, source/actor scope, append-only outcome and separate witness.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_received_sources.observe_document_reference_v1(p_company_id uuid,p_environment text,p_attempt_id uuid,p_actor_user_id uuid,p_observation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_received_sources.document_reference_attempts%rowtype; o gridex_received_sources.document_reference_outcomes%rowtype;
 current_facts jsonb; observed jsonb:=p_observation; started timestamptz; completed timestamptz;
BEGIN
 PERFORM gridex_received_sources.document_reference_actor_v1(p_company_id,p_actor_user_id);
 SELECT * INTO a FROM gridex_received_sources.document_reference_attempts WHERE id=p_attempt_id AND company_id=p_company_id AND environment=p_environment AND actor_user_id=p_actor_user_id AND created_xid<>pg_current_xact_id();
 IF a.id IS NULL THEN RAISE EXCEPTION 'document_attempt_not_committed' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(observed) IS DISTINCT FROM 'object' OR octet_length(observed::text)>8192
 OR NOT observed ?& ARRAY['status','startedAt','completedAt','byteCount']
 OR EXISTS(SELECT FROM jsonb_object_keys(observed) k WHERE k NOT IN ('status','reason','startedAt','completedAt','byteCount','sha256'))
 OR observed->>'status' IS NULL OR observed->>'status' NOT IN ('verified_at_observation','unavailable')
 OR jsonb_typeof(observed->'byteCount') IS DISTINCT FROM 'number' OR observed->>'byteCount' !~ '^[0-9]+$'
 OR (observed->>'byteCount')::numeric>9007199254740991
 OR ((observed->>'byteCount')::numeric>2097152 AND observed->>'reason' IS DISTINCT FROM 'oversize') THEN RAISE EXCEPTION 'invalid_document_observation' USING ERRCODE='23514'; END IF;
 IF observed->>'startedAt' IS NOT NULL OR observed->>'completedAt' IS NOT NULL THEN
 started:=(observed->>'startedAt')::timestamptz;completed:=(observed->>'completedAt')::timestamptz;
 IF started IS NULL OR completed IS NULL OR NOT isfinite(started) OR NOT isfinite(completed) OR completed<started OR started<date_trunc('milliseconds',a.recorded_at) OR completed>clock_timestamp()+interval '1 second'
 THEN RAISE EXCEPTION 'invalid_document_observation_time' USING ERRCODE='23514'; END IF;
 END IF;
 IF observed->>'status'='verified_at_observation' AND (started IS NULL OR completed-started>interval '10 seconds' OR observed->>'sha256' IS DISTINCT FROM a.facts#>>'{document,document_sha256}' OR observed ? 'reason' OR a.facts->'eligible'<>'true'::jsonb)
 THEN RAISE EXCEPTION 'invalid_document_verified_observation' USING ERRCODE='23514'; END IF;
 IF observed->>'status'='unavailable' AND (observed ? 'sha256' OR observed->>'reason' IS NULL OR observed->>'reason' NOT IN ('ineligible_document','oversize','timeout','hash_mismatch','storage_error','unresolved_link'))
 THEN RAISE EXCEPTION 'invalid_document_unavailable_observation' USING ERRCODE='23514'; END IF;
 BEGIN current_facts:=gridex_received_sources.document_reference_facts_v1(p_company_id,p_environment,a.source_message_id,a.document_id);
 EXCEPTION WHEN insufficient_privilege THEN current_facts:=NULL; END;
 IF current_facts IS DISTINCT FROM a.facts THEN observed:=observed||jsonb_build_object('status','unavailable','reason','graph_changed'); END IF;
 INSERT INTO gridex_received_sources.document_reference_outcomes(attempt_id,company_id,environment,status,observation,facts_hash)
 VALUES(a.id,a.company_id,a.environment,observed->>'status',observed,encode(sha256(convert_to(observed::text,'UTF8')),'hex')) RETURNING * INTO o;
 RETURN jsonb_build_object('attemptId',a.id,'outcomeId',o.id,'factsHash',o.facts_hash,'status',o.status);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.observe_document_reference_v1(uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.observe_document_reference_v1(uuid,text,uuid,uuid,jsonb) TO service_role;
COMMIT;
