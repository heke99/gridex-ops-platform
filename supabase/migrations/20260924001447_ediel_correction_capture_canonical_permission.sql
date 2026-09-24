-- Created by Supabase CLI 2.101.0. Published source-capture history is immutable.
-- Use the existing canonical high-risk communication capability. No new
-- permission, alias, role grant, test-only fallback or semantic authority.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_received_sources.capture_correction_concern_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; captured gridex_received_sources.correction_concerns%rowtype; observation jsonb; body jsonb;
BEGIN
 IF p_company_id IS NULL OR p_source_message_id IS NULL OR p_actor_user_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production')
 OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.companies WHERE id=p_company_id AND coalesce(is_active,true)
  AND coalesce(status,'active') NOT IN ('archived','suspended','pending_deletion','deleted','deleted_test_only','inactive','paused','closed'))
 THEN RAISE EXCEPTION 'correction_capture_actor_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id
  AND company_id=p_company_id AND environment=p_environment;
 IF NOT FOUND OR src.origin<>'database_insert' OR src.message_code IS DISTINCT FROM 'Z05' OR src.source_received_at IS NULL
 OR src.raw_payload IS NULL OR octet_length(src.raw_payload)>2097152 OR src.payload_hash IS NULL
 OR src.payload_hash IS DISTINCT FROM encode(sha256(convert_to(src.raw_payload,'UTF8')),'hex')
 OR NOT coalesce(src.received_context @> jsonb_build_object('version',1,'contextOrigin','database_insert',
  'sourceMessageId',src.source_message_id,'companyId',src.company_id,'environment',src.environment,'messageCode','Z05','payloadHash',src.payload_hash),false)
 OR (src.received_context->>'sourceReceivedAt')::timestamptz IS DISTINCT FROM src.source_received_at
 OR (src.received_context->>'capturedAt') IS NULL
 OR NOT isfinite((src.received_context->>'capturedAt')::timestamptz)
 OR (src.received_context->>'capturedAt')::timestamptz>src.captured_at
 THEN RAISE EXCEPTION 'correction_sealed_original_unavailable' USING ERRCODE='23514'; END IF;
 -- This is observational registration, not canonical review. Unsupported or
 -- malformed sealed Z05s remain visible as wildcard concerns, never exclusions.
 observation:=gridex_received_sources.correction_wire_observation_v1(src.raw_payload);
 body:=jsonb_build_object('version',1,'owner','sealed-z05-concern-v1','sourceMessageId',src.source_message_id,
  'sourcePayloadHash',src.payload_hash,'sourceReceivedAt',src.source_received_at,'sourceCapturedAt',src.captured_at,
  'scope',jsonb_build_object('companyId',src.company_id,'environment',src.environment,'customerId',NULL,'supplyPeriodId',NULL,
   'objectId',observation->'objectId','identityAgency',observation->'identityAgency',
   'legalSender',observation->'legalSender','legalReceiver',observation->'legalReceiver'),
  'oldStop',observation->'oldStop','proposedStop',observation->'proposedStop',
  'observedSourceStop',observation->'observedSourceStop','caseReference',observation->'caseReference',
  'candidateTarget',NULL,'disposition','unreviewed','provenance',jsonb_build_object('channel','sealed_inbound_original','authentication','unknown'),
  'retention',jsonb_build_object('sourceCategory','edifact_raw_payloads','coverage','not_established','documentBytes','unavailable'));
 INSERT INTO gridex_received_sources.correction_concerns(source_message_id,company_id,environment,source_payload_hash,actor_user_id,
  source_received_at,source_captured_at,facts,facts_hash)
 VALUES(src.source_message_id,src.company_id,src.environment,src.payload_hash,p_actor_user_id,src.source_received_at,src.captured_at,
  body,encode(sha256(convert_to(body::text,'UTF8')),'hex')) ON CONFLICT(source_message_id,rule_version) DO NOTHING;
 SELECT * INTO STRICT captured FROM gridex_received_sources.correction_concerns WHERE source_message_id=src.source_message_id AND rule_version='sealed-z05-concern-v1';
 IF captured.facts IS DISTINCT FROM body THEN RAISE EXCEPTION 'correction_original_facts_changed' USING ERRCODE='23514'; END IF;
 RETURN gridex_received_sources.correction_receipt_v1(captured);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.capture_correction_concern_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.capture_correction_concern_v1(uuid,text,uuid,uuid) TO service_role;
COMMIT;
