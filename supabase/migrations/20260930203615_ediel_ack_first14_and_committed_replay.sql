BEGIN;
-- T§16 first14 logical UCI projection; global candidate qualification remains
-- ahead of expected company. Same-prefix originals are ambiguous.
CREATE OR REPLACE FUNCTION gridex_ack_authority.source_match_v1(a jsonb,s jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF a IS NULL OR s IS NULL OR a->'sender' IS DISTINCT FROM s->'receiver' OR a->'receiver' IS DISTINCT FROM s->'sender'
  OR a->>'environment' IS DISTINCT FROM s->>'environment' OR a->>'app' IS DISTINCT FROM s->>'app' THEN RETURN false; END IF;
 IF a->>'family'='CONTRL' THEN
  RETURN s->>'family'<>'CONTRL' AND a->>'uciRef'=left(s->>'interchange',14) AND a->'uciSender'=s->'sender' AND a->'uciReceiver'=s->'receiver'
   AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a->'ucm','[]')) x WHERE x<>s->>'unhRef');
 END IF;
 IF nullif(a->>'legalSender','') IS NULL OR nullif(a->>'legalReceiver','') IS NULL
  OR a->>'legalSender' IS DISTINCT FROM s->>'legalReceiver' OR a->>'legalReceiver' IS DISTINCT FROM s->>'legalSender' THEN RETURN false; END IF;
 IF a->>'family'='APERAK' AND a#>>'{type,2}'='96A' AND a#>>'{type,4}'='E2SE6A' THEN
  RETURN s->>'family'='PRODAT' AND jsonb_array_length(coalesce(a#>'{refs,ACW}','[]'))=1 AND a#>>'{refs,ACW,0}'=s->>'document'
   AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a#>'{refs,LI}','[]')) x WHERE NOT coalesce(s#>'{refs,LI}','[]') ? x);
 ELSIF (a->>'family'='APERAK' AND a#>>'{type,2}'='04A' AND a#>>'{type,4}'='E5SE5A') OR (a->>'family'='UTILTS' AND a->>'code'='ERR') THEN
  IF (s->>'family'='UTILTS' AND s->>'code'<>'ERR') IS NOT TRUE THEN RETURN false; END IF;
  IF a->>'family'='APERAK' THEN
   RETURN a->>'docCode'=s->>'code' AND a->>'docRef'=s->>'document'
    AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a#>'{refs,ACW}','[]')) x WHERE NOT coalesce(s->'ide','[]') ? x);
  ELSE RETURN coalesce(a#>ARRAY['refs',s->>'code'],'[]') ? (s->>'document')
    AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(a#>'{refs,TN}','[]')) x WHERE NOT coalesce(s->'ide','[]') ? x); END IF;
 END IF;
 RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE gridex_ack_authority.applied_receipts(
 ack_message_id uuid PRIMARY KEY REFERENCES gridex_ack_authority.source_correlations(ack_message_id),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gridex_ack_authority.applied_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ack_authority.applied_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ack_authority.applied_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_ack_authority.applied_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ack_authority.applied_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_ack_authority.read_committed_v1(p_company uuid,p_environment text,p_ack uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c gridex_ack_authority.source_correlations%rowtype;ack public.ediel_messages%rowtype;source public.ediel_messages%rowtype;captured gridex_received_sources.sources%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;r gridex_ack_authority.applied_receipts%rowtype;
BEGIN
 IF p_company IS NULL OR p_environment IS NULL OR p_environment NOT IN('test','production') OR p_ack IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'ack_execution_scope_required' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM gridex_ack_authority.source_correlations WHERE ack_message_id=p_ack;
 IF c.ack_message_id IS NULL THEN RETURN NULL;END IF;
 IF c.company_id IS DISTINCT FROM p_company OR c.environment IS DISTINCT FROM p_environment THEN RAISE EXCEPTION 'ack_immutable_correlation_conflict' USING ERRCODE='23514';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor AND u.user_status='active' FOR SHARE;
 IF NOT FOUND OR NOT (coalesce(public.gridex_actor_has_company_permission(p_actor,p_company,'communication.read'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor,p_company,'communication.write'),false)) THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501';END IF;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p_company AND cm.user_id=p_actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ack_execution_actor_unqualified' USING ERRCODE='42501';END IF;
 -- Same source→ACK order as actual apply/recovery. Existing receipt never
 -- reselects today's role, guide, tenant or global candidate universe.
 SELECT * INTO source FROM public.ediel_messages WHERE id=c.source_message_id FOR SHARE;
 SELECT * INTO ack FROM public.ediel_messages WHERE id=c.ack_message_id FOR SHARE;
 SELECT * INTO captured FROM gridex_received_sources.sources WHERE source_message_id=c.ack_message_id;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments WHERE id=c.canonical_assessment_id;
 IF source.id IS NULL OR ack.id IS NULL OR source.company_id IS DISTINCT FROM c.company_id OR source.environment IS DISTINCT FROM c.environment OR source.direction IS DISTINCT FROM 'outbound'
  OR source.immutable_rendered_at IS NULL OR source.message_sent_at IS NULL OR c.source_payload_hash IS DISTINCT FROM source.immutable_payload_hash OR c.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
  OR ack.company_id IS DISTINCT FROM c.company_id OR ack.environment IS DISTINCT FROM c.environment OR ack.direction IS DISTINCT FROM 'inbound' OR ack.message_family IS DISTINCT FROM c.ack_family
  OR c.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') OR captured.company_id IS DISTINCT FROM c.company_id OR captured.environment IS DISTINCT FROM c.environment
  OR captured.payload_hash IS DISTINCT FROM c.ack_payload_hash OR captured.raw_payload IS DISTINCT FROM ack.raw_payload OR captured.received_context IS NULL
  OR canonical.id IS NULL OR canonical.company_id IS DISTINCT FROM c.company_id OR canonical.environment IS DISTINCT FROM c.environment OR canonical.source_message_id IS DISTINCT FROM ack.id OR canonical.source_payload_hash IS DISTINCT FROM c.ack_payload_hash
  OR canonical.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR canonical.facts_hash IS DISTINCT FROM encode(sha256(convert_to(canonical.facts_text,'UTF8')),'hex')
  OR canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
 THEN RAISE EXCEPTION 'ack_immutable_correlation_conflict' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM gridex_ack_authority.applied_receipts WHERE ack_message_id=c.ack_message_id;
 IF r.ack_message_id IS NOT NULL THEN
  IF r.result#>>'{sourceMessage,id}' IS DISTINCT FROM c.source_message_id::text OR r.result#>>'{sourceMessage,company_id}' IS DISTINCT FROM c.company_id::text OR r.result#>>'{sourceMessage,environment}' IS DISTINCT FROM c.environment
   OR r.result#>>'{sourceMessage,raw_payload}' IS DISTINCT FROM source.raw_payload OR r.result->>'outcome' IS DISTINCT FROM c.ack_outcome OR r.result->>'scope' IS DISTINCT FROM c.ack_scope OR r.result->'scopeOutcomes' IS DISTINCT FROM c.scope_outcomes THEN RAISE EXCEPTION 'ack_immutable_receipt_conflict';END IF;
  RETURN jsonb_build_object('kind','exact_receipt','ackPayloadHash',c.ack_payload_hash,'ackFamily',c.ack_family,'ackMessageId',ack.id,'sourceMessageId',source.id,'companyId',c.company_id,'environment',c.environment,'result',r.result);
 END IF;
 -- Historic ownscope proof is genuine, but the historic aggregate result was
 -- not recorded. Do not backfill an invented summary from current statuses.
 RETURN jsonb_build_object('kind','legacy_diagnostic','ackPayloadHash',c.ack_payload_hash,'ackFamily',c.ack_family,'ackMessageId',ack.id,'sourceMessageId',source.id,'companyId',c.company_id,'environment',c.environment,'outcome',c.ack_outcome,'scope',c.ack_scope,'scopeOutcomes',c.scope_outcomes,'summaryUnavailable',true);
END $$;
CREATE FUNCTION public.gridex_read_committed_inbound_ack_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'ack_source_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ack_authority.read_committed_v1(p_company_id,p_environment,p_ack_message_id,p_actor_user_id);
END $$;
ALTER FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) RENAME TO apply_before_committed_replay_v1;
CREATE FUNCTION gridex_ack_authority.apply_v1(p_company_id uuid,p_environment text,p_ack_message_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior jsonb;result jsonb;
BEGIN
 -- Serialize with the existing actual apply candidate/row lock before the
 -- replay read, so concurrent same ACK callbacks cannot reapply a receipt.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 prior:=gridex_ack_authority.read_committed_v1(p_company_id,p_environment,p_ack_message_id,p_actor_user_id);
 IF prior IS NOT NULL THEN
  IF prior->>'sourceMessageId' IS DISTINCT FROM p_source_message_id::text THEN RAISE EXCEPTION 'ack_immutable_correlation_conflict';END IF;
  IF prior->>'kind'='exact_receipt' THEN RETURN prior->'result'||jsonb_build_object('idempotent',true);END IF;
  RETURN prior;
 END IF;
 result:=gridex_ack_authority.apply_before_committed_replay_v1(p_company_id,p_environment,p_ack_message_id,p_source_message_id,p_actor_user_id);
 INSERT INTO gridex_ack_authority.applied_receipts(ack_message_id,result) VALUES(p_ack_message_id,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ack_authority.read_committed_v1(uuid,text,uuid,uuid),gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid),gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ack_authority.read_committed_v1(uuid,text,uuid,uuid),gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_read_committed_inbound_ack_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_committed_inbound_ack_v1(uuid,text,uuid,uuid) TO service_role;
COMMIT;
