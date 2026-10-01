-- Created with Supabase CLI2.118.0. AFTER genuine UTILTS persistence only.
-- Requires42609+44958 source-owned Z06F expectations and lock-order forward.
-- Same publicOID/ACL; original03807 scope/precision/role/replay owner preserved.
BEGIN;
CREATE OR REPLACE FUNCTION public.gridex_persist_utilts_consumption_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_raw_payload text,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;item jsonb;rules jsonb;hash text;committed boolean;mark text;result jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF source.id IS NULL OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.message_code IS DISTINCT FROM p_message_code
  OR source.direction IS DISTINCT FROM 'inbound' OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.raw_payload IS DISTINCT FROM p_raw_payload OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 PERFORM gridex_utilts_binding.require_current_esco_storage_v1(p_company_id,p_environment,p_source_message_id,p_transactions);
 p_transactions:=gridex_utilts_binding.preserve_committed_projection_v1(p_company_id,p_environment,p_source_message_id,p_transactions);
 hash:=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex');mark:=CASE WHEN left(source.raw_payload,3)='UNA' THEN substring(source.raw_payload,6,1) ELSE '.' END;
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  SELECT EXISTS(SELECT FROM gridex_utilts_binding.receipts r JOIN public.ediel_ack_transaction_results a ON a.source_message_id=r.source_message_id
   WHERE r.source_message_id=source.id AND r.company_id=p_company_id AND r.environment=p_environment AND r.raw_hash=hash
    AND a.company_id=p_company_id AND a.environment=p_environment AND a.source_transaction_id=item->>'transactionId'
    AND a.disposition IS NOT DISTINCT FROM item->>'disposition' AND a.planned_response_type IS NOT DISTINCT FROM item->>'responseType'
    AND ((a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak') OR (a.disposition<>'accepted' AND a.finalized_at IS NOT NULL))) INTO committed;
  -- Authentic committed V1/V2 replay is validated by the retained owner below;
  -- these new rules cannot rewrite a prior final ACK/contract interpretation.
  IF committed THEN CONTINUE; END IF;
  PERFORM gridex_received_sources.require_utilts_transaction_v1(p_company_id,source.id,item->>'transactionId',item->>'disposition',item->>'responseType',item->'issueCodes');
  IF item->>'disposition'<>'accepted' THEN CONTINUE; END IF;
  PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,source.id);
  PERFORM gridex_ediel_source_rules.require_v1(p_company_id,source.id);
  rules:=gridex_utilts_binding.decimal_rules_v1(gridex_utilts_binding.wire_tokens_v1(source.raw_payload),item->>'transactionId',mark);
  IF rules IS NULL OR jsonb_array_length(rules->'guide')<>0 OR jsonb_array_length(rules->'functional')<>0 THEN RAISE EXCEPTION 'utilts_source_decimal_or_unit_rules_failed' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 result:=gridex_utilts_binding.persist_consumption_before_precision_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_raw_payload,p_transactions);
 -- The observer independently reads actual immutable private accepted history.
 -- Caller disposition/result booleans cannot qualify a reading observation.
 -- The existing owner retains its source row lock; the observer's late graph
 -- lock was removed by44958 and other busy source rows use SKIP LOCKED.
 PERFORM gridex_received_reading_expectations.consider_utilts_source_v1(p_company_id,p_environment,p_source_message_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;
COMMIT;
