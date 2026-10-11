-- SC-046 / U-04: an older data version that arrives after a newer one is
-- stored as non-current history by 20261003150200 and still gets a positive
-- APERAK, but the persistence result did not say so and both bound sinks
-- consumed it: the metering sink raised utilts_consumption_existing_metering_conflict
-- (before the positive ACK, leaving the source permanently retryable) and the
-- source-keyed billing sink could add a second underlay for the same point and
-- month. The persisted result now carries versionState, and both consumers skip
-- a late-older-history transaction: no metering write, no billing contribution
-- or underlay, and no exception. Bodies are the latest supabase/schema.sql
-- definitions; signatures, SECURITY and search_path are unchanged, so the
-- existing grants are preserved by CREATE OR REPLACE.
BEGIN;

-- Stable classification of one persisted transaction. A late older version is
-- the only series stored with version_no>1, no superseded predecessor and not
-- current (persist_series_v2 U-04 branch). A normally superseded series keeps
-- its original 'current' classification, so a replay bills identically.
CREATE FUNCTION gridex_utilts_binding.transaction_version_state_v1(p_company uuid, p_source uuid, p_transaction text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
 SELECT CASE WHEN s.is_current IS FALSE AND s.version_no>1 AND s.supersedes_series_id IS NULL THEN 'late_older_history' ELSE 'current' END
 FROM public.ediel_ack_transaction_results a
 JOIN public.meter_reading_series s ON s.id=a.persisted_series_id AND s.company_id=a.company_id
 WHERE a.company_id=p_company AND a.source_message_id=p_source AND a.source_transaction_id=p_transaction AND a.persistence_status='persisted'
$$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.transaction_version_state_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.gridex_persist_utilts_consumption_v1(p_company_id uuid, p_environment text, p_source_message_id uuid, p_message_code text, p_raw_payload text, p_transactions jsonb, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE source public.ediel_messages%rowtype;result jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN
  RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 -- Match the existing owner lock prefix. Concurrent deny/revocation commits
 -- are observed before invocation; later revocations wait for this transaction.
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF source.id IS NULL OR source.environment IS DISTINCT FROM p_environment OR source.direction IS DISTINCT FROM 'inbound'
  OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
  OR source.raw_payload IS DISTINCT FROM p_raw_payload THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_user_id);
 -- Same check applies to immutable replay: history cannot be disclosed or used
 -- for new sink/ACK effects after this operator's current grant was revoked.
 result:=gridex_utilts_binding.persist_consumption_before_actor_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_raw_payload,p_transactions);
 -- SC-046: every persisted row states whether its stored series is current
 -- data or late older history, so bound sinks never consume the latter.
 SELECT coalesce(jsonb_agg(CASE WHEN e.r->>'persistenceStatus'='persisted'
   THEN e.r||jsonb_build_object('versionState',gridex_utilts_binding.transaction_version_state_v1(p_company_id,p_source_message_id,e.r->>'transactionId'))
   ELSE e.r END ORDER BY e.o),'[]'::jsonb)
  INTO result FROM jsonb_array_elements(result) WITH ORDINALITY e(r,o);
 -- The preserved owner may wait on its source/advisory locks. Expiry during
 -- that wait rejects the result and rolls back every mutation in this call.
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_user_id);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.gridex_consume_utilts_billing_v1(p_company_id uuid, p_source_message_id uuid, p_actor_id uuid, p_expected_contracts jsonb) RETURNS public.billing_underlays
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE v_transaction text; v_contract jsonb; v_context jsonb; v_contracts jsonb:='[]'; v_total numeric:=0; v_ordinal jsonb;
 v_result public.billing_underlays%rowtype; v_source public.ediel_messages%rowtype; v_late_older boolean:=false;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source_message_id AND s.company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-billing|'||p_company_id::text||'|'||p_source_message_id::text,0));
 FOR v_transaction IN SELECT a.source_transaction_id FROM public.ediel_ack_transaction_results a
  WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=v_source.environment
  AND a.disposition='accepted' AND a.persistence_status='persisted' ORDER BY a.source_transaction_id LOOP
  -- SC-046: late older history is never a billing contribution.
  IF gridex_utilts_binding.transaction_version_state_v1(p_company_id,p_source_message_id,v_transaction)='late_older_history' THEN
   v_late_older:=true; CONTINUE; END IF;
  v_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,p_source_message_id,v_transaction);
  IF v_contract#>>'{billing,capability}' IS DISTINCT FROM 'write' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  IF v_context IS NULL THEN v_context:=v_contract->'billing';
  ELSIF v_context IS DISTINCT FROM v_contract->'billing' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  FOR v_ordinal IN SELECT value FROM jsonb_array_elements(v_contract->'billingContributionOrdinals') LOOP
   v_total:=v_total+(v_contract->'observations'->((v_ordinal#>>'{}')::integer)->>'quantity')::numeric;
  END LOOP;
  v_contracts:=v_contracts||jsonb_build_array(v_contract);
 END LOOP;
 -- SC-046: a source holding only late older history creates no underlay.
 IF v_context IS NULL AND v_late_older THEN RETURN NULL; END IF;
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

CREATE OR REPLACE FUNCTION public.gridex_consume_utilts_metering_v1(p_company_id uuid, p_source_message_id uuid, p_transaction_id text, p_observation_ordinal integer, p_actor_id uuid, p_expected_contract jsonb) RETURNS public.metering_values
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE v_contract jsonb; v_attribution jsonb; v_observation jsonb; v_key text; v_payload jsonb; v_result public.metering_values%rowtype;
BEGIN
 -- SC-046: late older history never writes or conflicts with current metering.
 IF gridex_utilts_binding.transaction_version_state_v1(p_company_id,p_source_message_id,p_transaction_id)='late_older_history' THEN RETURN NULL; END IF;
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
 -- Lock and compare before the legacy equal-value branch can add lineage.
 SELECT m.* INTO v_result FROM public.metering_values m WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
  ORDER BY m.created_at DESC,m.id DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  PERFORM gridex_utilts_binding.check_metering_result_v1(v_result,v_payload,v_contract->>'environment');
 END IF;
 SELECT * INTO v_result FROM public.gridex_ingest_metering_value_atomic(v_payload);
 -- Recheck the returned row too: any legacy writer racing an absent key must
 -- roll back its source link on conflict in this same transaction.
 PERFORM gridex_utilts_binding.check_metering_result_v1(v_result,v_payload,v_contract->>'environment');
 RETURN v_result;
END $$;

COMMIT;
