-- Created by pinned Supabase CLI 2.101.0: migration new ediel_utilts_bound_sink_authority.
-- Forward-only fix round 1: strict shape parity and atomic stored-contract sinks.
BEGIN;

CREATE FUNCTION gridex_utilts_binding.validate_contract_base_v1(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a jsonb; o jsonb; i jsonb; field text; n integer:=0; seen jsonb:='[]'; contribution jsonb;
BEGIN
 IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(c,'version projectionVersion attributionVersion companyId environment messageCode transactionId seriesKind profileKey profileVersion rulePackHash guideRevision interpretation observations metering billing billingContributionOrdinals sourceType'),false)
 OR c->'version' IS DISTINCT FROM '1'::jsonb OR c->>'projectionVersion' IS DISTINCT FROM 'utilts-consumption-v1' OR c->>'attributionVersion' IS DISTINCT FROM 'tenant-match-v1'
 OR c->>'sourceType' IS DISTINCT FROM 'ediel_utilts' OR c->>'environment' NOT IN ('test','production')
 OR jsonb_typeof(c->'observations')<>'array' OR jsonb_typeof(c->'billingContributionOrdinals')<>'array' THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['environment','companyId','messageCode','transactionId','seriesKind','guideRevision'] LOOP
  IF jsonb_typeof(c->field)<>'string' OR nullif(btrim(c->>field),'') IS NULL THEN RETURN false; END IF;
 END LOOP;
 PERFORM (c->>'companyId')::uuid;
 IF EXISTS(SELECT FROM jsonb_each(c) e WHERE e.key IN ('profileKey','profileVersion','rulePackHash') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN RETURN false; END IF;
 i:=c->'interpretation';
 IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(i,'localPeriodStart localPeriodEnd localRegistration resolutionValue resolutionFormat timezoneRaw timezoneFormat offsetMinutes timestampPolicy'),false)
 OR jsonb_typeof(i->'timestampPolicy')<>'string' OR i->>'timestampPolicy' NOT IN ('explicit-offset-v1','no-consumption-v1')
 OR (i->'timezoneFormat'<>'null'::jsonb AND i->>'timezoneFormat'<>'406')
 OR (i->'offsetMinutes'<>'null'::jsonb AND (jsonb_typeof(i->'offsetMinutes')<>'number' OR (i->>'offsetMinutes')::numeric<>trunc((i->>'offsetMinutes')::numeric) OR abs((i->>'offsetMinutes')::numeric)>840)) THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['localPeriodStart','localPeriodEnd','localRegistration','resolutionValue','resolutionFormat','timezoneRaw'] LOOP
  IF jsonb_typeof(i->field) NOT IN ('string','null') THEN RETURN false; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['metering','billing'] LOOP
  a:=c->field;
  IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(a,'capability reason customerId siteId customerSiteId meteringPointId gridOwnerId sourceRequestId'||CASE WHEN field='billing' THEN ' requestScope periodStart periodEnd month year status sourceSystem currency' ELSE '' END),false)
  OR jsonb_typeof(a->'capability')<>'string' OR a->>'capability' NOT IN ('write','skip') OR (a->>'capability'='skip' AND nullif(a->>'reason','') IS NULL)
  OR (a->>'capability'='write' AND (a->>'customerId' IS NULL OR a->'reason'<>'null'::jsonb OR (field='metering' AND a->>'meteringPointId' IS NULL))) THEN RETURN false; END IF;
  IF EXISTS(SELECT FROM jsonb_each(a) e WHERE e.key IN ('customerId','siteId','customerSiteId','meteringPointId','gridOwnerId','sourceRequestId','reason') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN RETURN false; END IF;
  IF field='billing' THEN
   IF a->>'status' IS DISTINCT FROM 'received' OR a->>'sourceSystem' IS DISTINCT FROM 'ediel_utilts' OR a->>'currency' IS DISTINCT FROM 'SEK'
   OR (a->'periodStart'<>'null'::jsonb AND NOT gridex_utilts_binding.absolute_v1(a->'periodStart'))
   OR (a->'periodEnd'<>'null'::jsonb AND NOT gridex_utilts_binding.absolute_v1(a->'periodEnd'))
   OR (a->>'capability'='write' AND (a->>'sourceRequestId' IS NULL OR a->>'requestScope'<>'billing_underlay' OR a->>'periodEnd' IS NULL OR a->>'month' IS NULL OR a->>'year' IS NULL)) THEN RETURN false; END IF;
   IF coalesce(a->>'periodEnd',a->>'periodStart') IS NOT NULL AND
    ((a->>'month')::integer IS DISTINCT FROM extract(month FROM coalesce(a->>'periodEnd',a->>'periodStart')::timestamptz)::integer OR
     (a->>'year')::integer IS DISTINCT FROM extract(year FROM coalesce(a->>'periodEnd',a->>'periodStart')::timestamptz)::integer) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 FOR o IN SELECT value FROM jsonb_array_elements(c->'observations') LOOP
  IF NOT coalesce(gridex_utilts_binding.exact_keys_v1(o,'ordinal sourceOrdinal quantity periodStart periodEnd readAt resolution unit quality readingType direction registerCode productCode sourceLineReference externalPoint gridArea'),false)
  OR o->'ordinal' IS DISTINCT FROM to_jsonb(n) OR jsonb_typeof(o->'sourceOrdinal')<>'number' OR (o->>'sourceOrdinal')::numeric<>trunc((o->>'sourceOrdinal')::numeric)
  OR (o->>'sourceOrdinal')::numeric<0 OR seen @> jsonb_build_array(o->'sourceOrdinal')
  OR jsonb_typeof(o->'quantity')<>'number' OR NOT gridex_utilts_binding.absolute_v1(o->'periodStart') OR NOT gridex_utilts_binding.absolute_v1(o->'periodEnd') OR NOT gridex_utilts_binding.absolute_v1(o->'readAt')
  OR o->>'periodStart'>=o->>'periodEnd' OR o->>'unit' IS DISTINCT FROM 'kWh' OR jsonb_typeof(o->'readingType')<>'string' OR o->>'readingType' NOT IN ('consumption','production','estimated','adjustment')
  OR o->>'direction' IS DISTINCT FROM (CASE WHEN o->>'readingType'='production' THEN 'production' ELSE 'consumption' END) THEN RETURN false; END IF;
  IF EXISTS(SELECT FROM jsonb_each(o) e WHERE e.key IN ('resolution','quality','registerCode','productCode','sourceLineReference','externalPoint','gridArea') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN RETURN false; END IF;
  seen:=seen||jsonb_build_array(o->'sourceOrdinal'); n:=n+1;
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY x),'[]') INTO contribution FROM generate_series(0,n-1) x WHERE c#>>'{billing,capability}'='write';
 IF c->'billingContributionOrdinals' IS DISTINCT FROM contribution THEN RETURN false; END IF;
 IF i->>'timestampPolicy'='no-consumption-v1' AND (n<>0 OR c#>>'{metering,capability}'<>'skip' OR c#>>'{billing,capability}'<>'skip') THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_contract_v1(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE p_contract ALIAS FOR $1; v_billing jsonb:=p_contract->'billing'; v_value jsonb; v_key text; v_observation jsonb;
BEGIN
 IF NOT coalesce(gridex_utilts_binding.validate_contract_base_v1(p_contract),false) THEN RETURN false; END IF;
 IF jsonb_typeof(v_billing->'requestScope') NOT IN ('string','null')
 OR (v_billing->>'capability'='write' AND v_billing->>'requestScope' IS DISTINCT FROM 'billing_underlay') THEN RETURN false; END IF;
 FOREACH v_key IN ARRAY ARRAY['month','year'] LOOP
  v_value:=v_billing->v_key;
  IF v_value<>'null'::jsonb AND (jsonb_typeof(v_value)<>'number' OR (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric)) THEN RETURN false; END IF;
 END LOOP;
 IF (v_billing->>'month')::numeric NOT BETWEEN 1 AND 12 OR (v_billing->>'year')::numeric NOT BETWEEN 1900 AND 9999 THEN RETURN false; END IF;
 -- TypeScript rejects empty/padded strings in all nullable text fields too.
 FOR v_value IN SELECT value FROM jsonb_each(p_contract) UNION ALL SELECT value FROM jsonb_each(p_contract->'interpretation')
  UNION ALL SELECT value FROM jsonb_each(p_contract->'metering') UNION ALL SELECT value FROM jsonb_each(v_billing) LOOP
  IF jsonb_typeof(v_value)='string' AND (nullif(btrim(v_value#>>'{}'),'') IS NULL OR btrim(v_value#>>'{}')<>v_value#>>'{}') THEN RETURN false; END IF;
 END LOOP;
 FOR v_observation IN SELECT value FROM jsonb_array_elements(p_contract->'observations') LOOP
  PERFORM (v_observation->>'quantity')::double precision;
  FOR v_value IN SELECT value FROM jsonb_each(v_observation) LOOP
   IF jsonb_typeof(v_value)='string' AND (nullif(btrim(v_value#>>'{}'),'') IS NULL OR btrim(v_value#>>'{}')<>v_value#>>'{}') THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- Authoritative lookup, never an echoed caller projection or hash. The source
-- and reservation rows are locked until the consuming transaction completes.
CREATE FUNCTION gridex_utilts_binding.stored_contract_v1(p_company uuid,p_source uuid,p_transaction text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_source public.ediel_messages%rowtype; v_receipt gridex_utilts_binding.receipts%rowtype;
 v_ack public.ediel_ack_transaction_results%rowtype; v_series public.meter_reading_series%rowtype;
 v_contract gridex_utilts_binding.contracts%rowtype;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source AND s.company_id=p_company FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT r.* INTO v_receipt FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=p_source AND r.company_id=p_company;
 IF NOT FOUND OR v_receipt.environment IS DISTINCT FROM v_source.environment OR v_receipt.message_code IS DISTINCT FROM v_source.message_code
 OR v_receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(v_source)
 OR v_receipt.raw_hash IS DISTINCT FROM encode(digest(convert_to(v_source.raw_payload,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_consumption_source_binding_invalid' USING ERRCODE='P0U01'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements_text(v_receipt.membership) m(transaction_id) WHERE NOT EXISTS(
  SELECT FROM public.ediel_ack_transaction_results a WHERE a.company_id=p_company AND a.environment=v_source.environment AND a.source_message_id=p_source AND a.source_transaction_id=m.transaction_id))
 OR (SELECT count(*) FROM public.ediel_ack_transaction_results a WHERE a.source_message_id=p_source)<>jsonb_array_length(v_receipt.membership) THEN
  RAISE EXCEPTION 'utilts_consumption_membership_incomplete' USING ERRCODE='P0U01'; END IF;
 SELECT a.* INTO v_ack FROM public.ediel_ack_transaction_results a WHERE a.company_id=p_company AND a.environment=v_source.environment
 AND a.source_message_id=p_source AND a.source_transaction_id=p_transaction FOR SHARE;
 IF NOT FOUND OR v_ack.disposition IS DISTINCT FROM 'accepted' OR v_ack.persistence_status IS DISTINCT FROM 'persisted'
 OR v_ack.planned_response_type IS DISTINCT FROM 'positive_aperak' THEN RAISE EXCEPTION 'utilts_consumption_not_accepted' USING ERRCODE='P0U01'; END IF;
 SELECT s.* INTO v_series FROM public.meter_reading_series s WHERE s.id=v_ack.persisted_series_id AND s.company_id=p_company FOR SHARE;
 IF NOT FOUND OR v_series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(v_series.raw_transaction::text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_consumption_raw_conflict' USING ERRCODE='P0U01'; END IF;
 SELECT c.* INTO v_contract FROM gridex_utilts_binding.contracts c WHERE c.series_id=v_series.id AND c.company_id=p_company;
 IF NOT FOUND OR v_contract.environment IS DISTINCT FROM v_source.environment OR v_contract.transaction_id IS DISTINCT FROM p_transaction
 OR v_contract.contract->>'companyId' IS DISTINCT FROM p_company::text OR v_contract.contract->>'environment' IS DISTINCT FROM v_source.environment
 OR v_contract.contract->>'messageCode' IS DISTINCT FROM v_source.message_code OR v_contract.contract->>'transactionId' IS DISTINCT FROM p_transaction
 OR v_contract.contract_hash IS DISTINCT FROM encode(digest(convert_to(v_contract.contract::text,'UTF8'),'sha256'),'hex')
 OR v_contract.contract IS DISTINCT FROM v_series.raw_transaction->'consumptionContract'
 OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(v_contract.contract),false) THEN
  RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
 RETURN v_contract.contract;
END $$;

-- FOR SHARE blocks non-key ownership changes too; KEY SHARE would be weaker.
-- Both sinks use the same lock order: customer, sites, point, grid owner, request.
CREATE FUNCTION gridex_utilts_binding.lock_attribution_v1(p_company uuid,p_attribution jsonb,p_billing boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_customer uuid:=(p_attribution->>'customerId')::uuid; v_point public.metering_points%rowtype;
 v_site public.customer_sites%rowtype; v_request public.grid_owner_data_requests%rowtype; v_site_id uuid;
BEGIN
 IF p_attribution->>'capability' IS DISTINCT FROM 'write' THEN RAISE EXCEPTION 'utilts_consumption_not_writable' USING ERRCODE='P0U01'; END IF;
 PERFORM 1 FROM public.customers c WHERE c.id=v_customer AND c.company_id=p_company FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_customer_changed' USING ERRCODE='P0U01'; END IF;
 FOR v_site_id IN SELECT DISTINCT x::uuid FROM unnest(ARRAY[p_attribution->>'siteId',p_attribution->>'customerSiteId']) x WHERE x IS NOT NULL ORDER BY 1 LOOP
  SELECT s.* INTO v_site FROM public.customer_sites s WHERE s.id=v_site_id AND s.company_id=p_company FOR SHARE;
  IF NOT FOUND OR v_site.customer_id IS DISTINCT FROM v_customer OR v_site.grid_owner_id::text IS DISTINCT FROM p_attribution->>'gridOwnerId' THEN
   RAISE EXCEPTION 'utilts_consumption_site_ownership_changed' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 IF p_attribution->>'meteringPointId' IS NOT NULL THEN
  SELECT p.* INTO v_point FROM public.metering_points p WHERE p.id=(p_attribution->>'meteringPointId')::uuid AND p.company_id=p_company FOR SHARE;
  IF NOT FOUND OR v_point.customer_id IS DISTINCT FROM v_customer
   OR coalesce(v_point.site_id,v_point.customer_site_id)::text IS DISTINCT FROM p_attribution->>'siteId'
   OR coalesce(v_point.customer_site_id,v_point.site_id)::text IS DISTINCT FROM p_attribution->>'customerSiteId'
   OR v_point.grid_owner_id::text IS DISTINCT FROM p_attribution->>'gridOwnerId' THEN
   RAISE EXCEPTION 'utilts_consumption_point_ownership_changed' USING ERRCODE='P0U01'; END IF;
 END IF;
 IF p_attribution->>'gridOwnerId' IS NOT NULL THEN
  PERFORM 1 FROM public.grid_owners g WHERE g.id=(p_attribution->>'gridOwnerId')::uuid AND g.company_id=p_company FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_grid_owner_changed' USING ERRCODE='P0U01'; END IF;
 END IF;
 IF p_attribution->>'sourceRequestId' IS NOT NULL THEN
  SELECT r.* INTO v_request FROM public.grid_owner_data_requests r WHERE r.id=(p_attribution->>'sourceRequestId')::uuid AND r.company_id=p_company FOR SHARE;
  IF NOT FOUND OR v_request.customer_id IS DISTINCT FROM v_customer OR v_request.site_id::text IS DISTINCT FROM p_attribution->>'siteId'
   OR v_request.metering_point_id::text IS DISTINCT FROM p_attribution->>'meteringPointId'
   OR v_request.grid_owner_id::text IS DISTINCT FROM p_attribution->>'gridOwnerId'
   OR (p_billing AND v_request.request_scope IS DISTINCT FROM 'billing_underlay') THEN
   RAISE EXCEPTION 'utilts_consumption_request_changed' USING ERRCODE='P0U01'; END IF;
 ELSIF p_billing THEN RAISE EXCEPTION 'utilts_consumption_request_missing' USING ERRCODE='P0U01';
 END IF;
END $$;

CREATE FUNCTION public.gridex_consume_utilts_metering_v1(p_company_id uuid,p_source_message_id uuid,p_transaction_id text,p_observation_ordinal integer,p_actor_id uuid,p_expected_contract jsonb)
RETURNS public.metering_values LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE v_contract jsonb; v_attribution jsonb; v_observation jsonb; v_key text; v_payload jsonb; v_result public.metering_values%rowtype;
BEGIN
 v_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,p_source_message_id,p_transaction_id);
 IF p_expected_contract IS DISTINCT FROM v_contract THEN RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 v_attribution:=v_contract->'metering';
 IF p_observation_ordinal IS NULL OR p_observation_ordinal<0 OR p_observation_ordinal>=jsonb_array_length(v_contract->'observations') THEN
  RAISE EXCEPTION 'utilts_consumption_observation_missing' USING ERRCODE='P0U01'; END IF;
 v_observation:=v_contract->'observations'->p_observation_ordinal;
 PERFORM gridex_utilts_binding.lock_attribution_v1(p_company_id,v_attribution,false);
 v_key:=concat_ws('|',p_company_id::text,v_attribution->>'meteringPointId',v_observation->>'periodStart',v_observation->>'periodEnd',
  coalesce(v_observation->>'registerCode','default-register'),coalesce(v_observation->>'productCode','default-product'),v_observation->>'direction',v_observation->>'unit');
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-metering|'||v_key,0));
 v_payload:=jsonb_build_object('company_id',p_company_id,'customer_id',v_attribution->'customerId','site_id',v_attribution->'siteId','customer_site_id',v_attribution->'customerSiteId',
  'metering_point_id',v_attribution->'meteringPointId','grid_owner_id',v_attribution->'gridOwnerId','source_request_id',v_attribution->'sourceRequestId',
  'period_start',v_observation->'periodStart','period_end',v_observation->'periodEnd','read_at',v_observation->'readAt','resolution',v_observation->'resolution',
  'value_kwh',v_observation->'quantity','quality_code',v_observation->'quality','reading_type',v_observation->'readingType','direction',v_observation->'direction','unit',v_observation->'unit',
  'register_code',v_observation->'registerCode','product_code',v_observation->'productCode','facility_id',v_observation->'externalPoint','grid_area',v_observation->'gridArea',
  'source_line_reference',v_observation->'sourceLineReference','source_system',v_contract->'sourceType','source_ediel_message_id',p_source_message_id,
  'source_transaction_reference',p_transaction_id,'created_by',p_actor_id,'canonical_dedupe_key',v_key,
  'raw_payload',jsonb_build_object('consumptionContract',v_contract,'sourceOrdinal',v_observation->'sourceOrdinal','edielMessageId',p_source_message_id));
 SELECT * INTO v_result FROM public.gridex_ingest_metering_value_atomic(v_payload);
 RETURN v_result;
END $$;

CREATE FUNCTION public.gridex_consume_utilts_billing_v1(p_company_id uuid,p_source_message_id uuid,p_actor_id uuid,p_expected_contracts jsonb)
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
   OR v_result.source_request_id::text IS DISTINCT FROM v_context->>'sourceRequestId' OR v_result.total_kwh IS DISTINCT FROM v_total THEN
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

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_utilts_binding FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
