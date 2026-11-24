-- Correct the protected E66 billing projection without changing existing source
-- contracts, completion fingerprints or completed billing rows.
DO $precondition$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure(
  'gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)'))
  IS DISTINCT FROM '5436275fd48f4e748d9fed8ce42618cd'
 THEN RAISE EXCEPTION 'e66_scoped_billing_predecessor_changed'; END IF;
END
$precondition$;

CREATE OR REPLACE FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v1(p_company_id uuid,p_source_message_id uuid,p_actor_id uuid,p_expected_contracts jsonb)
RETURNS public.billing_underlays LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE v_transaction text; v_contract jsonb; v_context jsonb; v_contracts jsonb:='[]'; v_total numeric:=0; v_ordinal jsonb;
 v_result public.billing_underlays%rowtype; v_source public.ediel_messages%rowtype;
 v_sent_range tstzrange; v_scoped_total numeric; v_start timestamptz; v_end timestamptz;
 v_contribution_count integer:=0; v_scoped_count integer; v_scope jsonb; v_ordinals jsonb;
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
  v_contribution_count:=v_contribution_count+jsonb_array_length(v_contract->'billingContributionOrdinals');
  FOR v_ordinal IN SELECT value FROM jsonb_array_elements(v_contract->'billingContributionOrdinals') LOOP
   v_total:=v_total+(v_contract->'observations'->((v_ordinal#>>'{}')::integer)->>'quantity')::numeric;
  END LOOP;
  v_contracts:=v_contracts||jsonb_build_array(v_contract);
 END LOOP;
 IF v_context IS NULL THEN RAISE EXCEPTION 'utilts_consumption_billing_missing' USING ERRCODE='P0U01'; END IF;
 IF jsonb_typeof(p_expected_contracts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 IF (SELECT jsonb_agg(e.value ORDER BY e.value->>'transactionId') FROM jsonb_array_elements(p_expected_contracts) e) IS DISTINCT FROM v_contracts THEN
  RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 -- Metering retains the entire physical source. A request's financial
 -- contribution may use only whole original observations inside its sent E73.
 IF v_source.message_code='E66' AND v_source.grid_owner_data_request_id::text=v_context->>'sourceRequestId' THEN
  v_sent_range:=gridex_utilts_binding.e73_sent_request_range_v1(
    p_company_id,v_source.grid_owner_data_request_id,v_source.environment);
 END IF;
 IF v_sent_range IS NOT NULL THEN
  WITH contributions AS (
   SELECT c.value->>'transactionId' AS transaction_id, i.value::text::integer AS ordinal,
    c.value->'observations'->(i.value::text::integer) AS observation
   FROM jsonb_array_elements(v_contracts) c
   CROSS JOIN LATERAL jsonb_array_elements(c.value->'billingContributionOrdinals') i
  ), scoped AS MATERIALIZED (
   SELECT transaction_id,ordinal,(observation->>'quantity')::numeric AS quantity,
    (observation->>'periodStart')::timestamptz AS period_start,
    (observation->>'periodEnd')::timestamptz AS period_end
   FROM contributions
   WHERE (observation->>'periodStart')::timestamptz>=lower(v_sent_range)
     AND (observation->>'periodEnd')::timestamptz<=upper(v_sent_range)
  )
  SELECT sum(quantity),count(*),min(period_start),max(period_end),
   jsonb_agg(jsonb_build_array(transaction_id,ordinal) ORDER BY transaction_id,ordinal)
  INTO v_scoped_total,v_scoped_count,v_start,v_end,v_ordinals FROM scoped;
  IF v_scoped_count=0 THEN
   RAISE EXCEPTION 'e66_billing_no_whole_requested_observation' USING ERRCODE='P0U01';
  END IF;
  IF v_scoped_count<>v_contribution_count OR v_start IS DISTINCT FROM (v_context->>'periodStart')::timestamptz
    OR v_end IS DISTINCT FROM (v_context->>'periodEnd')::timestamptz THEN
   v_scope:=jsonb_build_object('requestedFrom',lower(v_sent_range),'requestedUntil',upper(v_sent_range),
    'periodStart',v_start,'periodEnd',v_end,'contributors',v_ordinals);
   v_total:=v_scoped_total;
   v_context:=v_context||jsonb_build_object('month',extract(month FROM v_end)::integer,'year',extract(year FROM v_end)::integer);
  END IF;
 END IF;
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
   OR v_result.payload->'consumptionContracts' IS DISTINCT FROM v_contracts
   OR v_result.payload->'e73BillingScope' IS DISTINCT FROM v_scope THEN
   RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01'; END IF;
  RETURN v_result;
 END IF;
 INSERT INTO public.billing_underlays(company_id,customer_id,site_id,customer_site_id,metering_point_id,source_request_id,grid_owner_id,underlay_month,underlay_year,
  status,total_kwh,currency,source_system,payload,readiness_status,readiness_issues,created_by,updated_by,received_at,
  source_meter_value_count)
 VALUES(p_company_id,(v_context->>'customerId')::uuid,(v_context->>'siteId')::uuid,(v_context->>'customerSiteId')::uuid,(v_context->>'meteringPointId')::uuid,(v_context->>'sourceRequestId')::uuid,
  (v_context->>'gridOwnerId')::uuid,(v_context->>'month')::integer,(v_context->>'year')::integer,v_context->>'status',v_total,v_context->>'currency',v_context->>'sourceSystem',
  jsonb_build_object('edielMessageId',p_source_message_id,'consumptionContracts',v_contracts,'tenant',jsonb_build_object('company_id',p_company_id,'issues','[]'::jsonb))
    || CASE WHEN v_scope IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('e73BillingScope',v_scope) END,
  'not_checked','[]'::jsonb,p_actor_id,p_actor_id,now(),
  CASE WHEN v_scope IS NOT NULL THEN v_scoped_count END) RETURNING * INTO v_result;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION gridex_e66_intake.bound_underlay_fingerprint_v1(p_company uuid,p_source uuid,p_underlay uuid)
RETURNS text LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to((jsonb_build_array(
   b.id,b.company_id,b.customer_id,b.site_id,b.customer_site_id,b.metering_point_id,b.grid_owner_id,
   b.source_request_id,b.underlay_year,b.underlay_month,b.total_kwh,b.currency,b.source_system,
   b.payload->'edielMessageId',b.payload->'consumptionContracts'
 ) || CASE WHEN b.payload ? 'e73BillingScope'
   THEN jsonb_build_array(b.payload->'e73BillingScope')
   ELSE '[]'::jsonb END)::text,'UTF8')),'hex')
 FROM public.billing_underlays b
 WHERE b.id=p_underlay AND b.company_id=p_company AND b.source_system='ediel_utilts'
   AND b.payload->>'edielMessageId'=p_source::text
 FOR SHARE OF b
$$;
