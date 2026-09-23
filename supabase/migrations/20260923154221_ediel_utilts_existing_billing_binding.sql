-- A successful insert can precede request completion. Such retries may reuse
-- only the row bearing the original business projection and contributors.
-- Workflow status, readiness annotations and audit actors remain mutable.
BEGIN;
CREATE OR REPLACE FUNCTION public.gridex_consume_utilts_billing_v1(p_company_id uuid,p_source_message_id uuid,p_actor_id uuid,p_expected_contracts jsonb)
RETURNS public.billing_underlays LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE v_transaction text; v_contract jsonb; v_context jsonb; v_contracts jsonb:='[]'; v_total numeric:=0; v_ordinal jsonb;
 v_result public.billing_underlays%rowtype; v_source public.ediel_messages%rowtype;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source_message_id AND s.company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-billing|'||p_company_id::text||'|'||p_source_message_id::text,0));
 FOR v_transaction IN SELECT a.source_transaction_id FROM public.ediel_ack_transaction_results a
  WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=v_source.environment
  AND a.disposition='accepted' AND a.persistence_status='persisted' ORDER BY a.source_transaction_id LOOP
  v_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,p_source_message_id,v_transaction);
  IF v_contract#>>'{billing,capability}' IS DISTINCT FROM 'write' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  IF v_context IS NULL THEN v_context:=v_contract->'billing';
  ELSIF v_context IS DISTINCT FROM v_contract->'billing' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  FOR v_ordinal IN SELECT value FROM jsonb_array_elements(v_contract->'billingContributionOrdinals') LOOP
   v_total:=v_total+(v_contract->'observations'->((v_ordinal#>>'{}')::integer)->>'quantity')::numeric;
  END LOOP;
  v_contracts:=v_contracts||jsonb_build_array(v_contract);
 END LOOP;
 IF v_context IS NULL THEN RAISE EXCEPTION 'utilts_consumption_billing_missing' USING ERRCODE='P0U01'; END IF;
 IF jsonb_typeof(p_expected_contracts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 IF (SELECT jsonb_agg(e.value ORDER BY e.value->>'transactionId') FROM jsonb_array_elements(p_expected_contracts) e) IS DISTINCT FROM v_contracts THEN
  RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 PERFORM gridex_utilts_binding.lock_attribution_v1(p_company_id,v_context,true);
 SELECT b.* INTO v_result FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.source_system='ediel_utilts'
  AND b.payload->>'edielMessageId'=p_source_message_id::text ORDER BY b.created_at,b.id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF v_result.customer_id::text IS DISTINCT FROM v_context->>'customerId' OR v_result.site_id::text IS DISTINCT FROM v_context->>'siteId'
   OR v_result.customer_site_id::text IS DISTINCT FROM v_context->>'customerSiteId'
   OR v_result.metering_point_id::text IS DISTINCT FROM v_context->>'meteringPointId' OR v_result.grid_owner_id::text IS DISTINCT FROM v_context->>'gridOwnerId'
   OR v_result.source_request_id::text IS DISTINCT FROM v_context->>'sourceRequestId' OR v_result.total_kwh IS DISTINCT FROM v_total
   OR v_result.underlay_month IS DISTINCT FROM (v_context->>'month')::integer
   OR v_result.underlay_year IS DISTINCT FROM (v_context->>'year')::integer
   OR v_result.currency IS DISTINCT FROM v_context->>'currency'
   OR v_result.payload->'consumptionContracts' IS DISTINCT FROM v_contracts THEN
   RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01'; END IF;
  RETURN v_result;
 END IF;
 INSERT INTO public.billing_underlays(company_id,customer_id,site_id,customer_site_id,metering_point_id,source_request_id,grid_owner_id,underlay_month,underlay_year,
  status,total_kwh,currency,source_system,payload,readiness_status,readiness_issues,created_by,updated_by,received_at)
 VALUES(p_company_id,(v_context->>'customerId')::uuid,(v_context->>'siteId')::uuid,(v_context->>'customerSiteId')::uuid,(v_context->>'meteringPointId')::uuid,(v_context->>'sourceRequestId')::uuid,
  (v_context->>'gridOwnerId')::uuid,(v_context->>'month')::integer,(v_context->>'year')::integer,v_context->>'status',v_total,v_context->>'currency',v_context->>'sourceSystem',
  jsonb_build_object('edielMessageId',p_source_message_id,'consumptionContracts',v_contracts,'tenant',jsonb_build_object('company_id',p_company_id,'issues','[]'::jsonb)),
  'not_checked','[]'::jsonb,p_actor_id,p_actor_id,now()) RETURNING * INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
