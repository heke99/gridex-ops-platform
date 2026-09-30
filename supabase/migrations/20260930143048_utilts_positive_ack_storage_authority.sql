-- Created by Supabase CLI 2.118.0. Read authority only; no historical backfill.
-- U-14: a runtime-positive preview is never durable storage/send authority.
BEGIN;
CREATE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(
 p_company_id uuid, p_environment text, p_source_message_id uuid,
 p_transaction_id text, p_ack_message_id uuid DEFAULT NULL, p_ack_raw_payload text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE
 source public.ediel_messages%rowtype; ack public.ediel_messages%rowtype;
 receipt gridex_utilts_binding.receipts%rowtype; origin gridex_utilts_binding.receipts%rowtype;
 reservation public.ediel_ack_transaction_results%rowtype;
 series public.meter_reading_series%rowtype; stored gridex_utilts_binding.contracts%rowtype;
 tokens jsonb; ack_tokens jsonb; source_hash text; ack_hash text; document_id text;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_source_message_id IS NULL
 OR nullif(p_transaction_id,'') IS NULL OR (p_ack_message_id IS NULL)<>(p_ack_raw_payload IS NULL) THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01';
 END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF NOT FOUND OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.raw_payload IS NULL THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 source_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=source.id;
 IF NOT FOUND OR receipt.company_id IS DISTINCT FROM p_company_id OR receipt.environment IS DISTINCT FROM p_environment
 OR receipt.raw_hash IS DISTINCT FROM source_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source)
 OR NOT receipt.membership ? p_transaction_id THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='IDE' AND t#>>'{elements,1,0}'='24' AND t#>>'{elements,2,0}'=p_transaction_id)<>1 THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO reservation FROM public.ediel_ack_transaction_results WHERE company_id=p_company_id AND environment=p_environment
  AND source_message_id=source.id AND source_transaction_id=p_transaction_id FOR SHARE;
 IF NOT FOUND OR reservation.disposition IS DISTINCT FROM 'accepted' OR reservation.planned_response_type IS DISTINCT FROM 'positive_aperak'
 OR reservation.persistence_status IS DISTINCT FROM 'persisted' OR reservation.persisted_series_id IS NULL
 OR (reservation.final_response_type IS NOT NULL AND reservation.final_response_type<>'positive_aperak') THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO series FROM public.meter_reading_series WHERE id=reservation.persisted_series_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR series.message_code IS DISTINCT FROM source.message_code OR series.source_transaction_reference IS DISTINCT FROM p_transaction_id
 OR jsonb_typeof(series.raw_transaction) IS DISTINCT FROM 'object'
 OR series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(series.raw_transaction::text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 -- Identical old/late accepted data can legitimately reuse an earlier series.
 -- Its genuine source/contract origin stays authoritative; is_current is not an
 -- acceptance criterion and must not silently reject old-late-positive ACKs.
 SELECT * INTO origin FROM gridex_utilts_binding.receipts WHERE source_message_id=series.source_ediel_message_id;
 SELECT * INTO stored FROM gridex_utilts_binding.contracts WHERE series_id=series.id;
 IF origin.source_message_id IS NULL OR stored.series_id IS NULL OR origin.company_id IS DISTINCT FROM p_company_id
 OR origin.environment IS DISTINCT FROM p_environment OR origin.message_code IS DISTINCT FROM source.message_code
 OR stored.company_id IS DISTINCT FROM p_company_id OR stored.environment IS DISTINCT FROM p_environment
 OR stored.source_message_id IS DISTINCT FROM origin.source_message_id OR stored.transaction_id IS DISTINCT FROM p_transaction_id
 OR stored.contract_version NOT IN (1,2) OR stored.contract->>'version' IS DISTINCT FROM stored.contract_version::text
 OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false)
 OR stored.contract_hash IS DISTINCT FROM encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex')
 OR stored.contract IS DISTINCT FROM series.raw_transaction->'consumptionContract' THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 IF p_ack_message_id IS NOT NULL THEN
  SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
  IF NOT FOUND OR ack.direction<>'outbound' OR ack.message_family<>'APERAK' OR ack.related_message_id IS DISTINCT FROM source.id
  OR ack.raw_payload IS DISTINCT FROM p_ack_raw_payload OR reservation.final_response_type IS DISTINCT FROM 'positive_aperak'
  OR reservation.response_message_id IS DISTINCT FROM ack.id OR reservation.finalized_at IS NULL THEN
   RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
  ack_tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
  SELECT t#>>'{elements,2,0}' INTO document_id FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
  IF ack_tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='UNH'
    AND t#>>'{elements,2,0}'='APERAK' AND t#>>'{elements,2,2}'='04A' AND t#>>'{elements,2,4}'='E5SE5A')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='312')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW')<>1
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND t#>>'{elements,1,1}'=p_transaction_id)
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM')<>1
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM' AND t#>>'{elements,1,1}'=document_id) THEN
   RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
  ack_hash:=encode(digest(convert_to(ack.raw_payload,'UTF8'),'sha256'),'hex');
 END IF;
 RETURN jsonb_build_object('authorityVersion',1,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',source.id,
  'transactionId',p_transaction_id,'sourceRawHash',source_hash,'ackMessageId',p_ack_message_id,'ackRawHash',ack_hash);
END $$;
REVOKE ALL ON FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(uuid,text,uuid,text,uuid,text) TO service_role;
COMMIT;
