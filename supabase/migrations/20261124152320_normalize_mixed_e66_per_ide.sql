CREATE FUNCTION gridex_e66_intake.meter_source_probe_v1(
  p_company_id uuid,p_source_message_id uuid,p_transaction_id text,p_observation_ordinal integer
) RETURNS TABLE(series_row public.meter_reading_series,graph_key text,cohort_key jsonb,source_ids uuid[])
LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog' SET TimeZone TO 'UTC' AS $$
DECLARE v_attribution jsonb;v_observation jsonb;v_key text;
BEGIN
 SELECT h.* INTO series_row FROM public.ediel_ack_transaction_results a
 JOIN public.meter_reading_series h ON h.id=a.persisted_series_id
 WHERE a.company_id=p_company_id AND a.source_message_id=p_source_message_id AND a.source_transaction_id=p_transaction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_not_accepted' USING ERRCODE='P0U01'; END IF;
 cohort_key:=jsonb_build_array(p_company_id::text,series_row.series_kind,series_row.message_code,
  coalesce(series_row.external_metering_point_id,''),coalesce(series_row.grid_area_id,''),
  series_row.period_start,series_row.period_end,series_row.resolution,coalesce(series_row.product_id,''));
 SELECT concat_ws('|',p_company_id::text,o.environment,coalesce(series_row.raw_transaction->>'seriesKind','actual'),
  o.message_code,coalesce(series_row.raw_transaction->>'externalMeteringPointId',''),coalesce(series_row.raw_transaction->>'gridAreaId',''),
  coalesce(series_row.raw_transaction->>'periodStart',''),coalesce(series_row.raw_transaction->>'periodEnd',''),
  coalesce(series_row.raw_transaction->>'resolution','UNKNOWN'),coalesce(series_row.raw_transaction->>'productId','')) INTO graph_key FROM public.ediel_messages o WHERE o.id=p_source_message_id;
 v_attribution:=series_row.raw_transaction#>'{consumptionContract,metering}';
 v_observation:=series_row.raw_transaction#>'{consumptionContract,observations}'->p_observation_ordinal;
 v_key:=concat_ws('|',p_company_id::text,v_attribution->>'meteringPointId',v_observation->>'periodStart',v_observation->>'periodEnd',
  coalesce(v_observation->>'registerCode','default-register'),coalesce(v_observation->>'productCode','default-product'),v_observation->>'direction',v_observation->>'unit');
 SELECT (SELECT array_agg(DISTINCT source_id ORDER BY source_id) FROM (
   SELECT p_source_message_id AS source_id
   UNION SELECT h.source_ediel_message_id FROM public.meter_reading_series h WHERE jsonb_build_array(h.company_id::text,h.series_kind,h.message_code,coalesce(h.external_metering_point_id,''),
    coalesce(h.grid_area_id,''),h.period_start,h.period_end,h.resolution,coalesce(h.product_id,''))=cohort_key
   UNION SELECT m.source_ediel_message_id FROM public.metering_values m WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
   UNION SELECT l.source_ediel_message_id FROM public.metering_value_sources l JOIN public.metering_values m ON m.id=l.metering_value_id AND m.company_id=l.company_id
    WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
  ) sources WHERE source_id IS NOT NULL) INTO source_ids;
 RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.meter_source_probe_v1(uuid,uuid,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_e66_intake.consume_owned_e66_meter_scoped_v1(p_company_id uuid, p_source_message_id uuid, p_transaction_id text, p_observation_ordinal integer, p_actor_id uuid, p_expected_contract jsonb,p_prelocked_sources uuid[]) RETURNS public.metering_values
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE v_contract jsonb; v_attribution jsonb; v_observation jsonb; v_key text; v_payload jsonb; v_result public.metering_values%rowtype;
 -- SC046 authentic newer correction declarations.
 sc046_own public.meter_reading_series%rowtype; sc046_pre public.meter_reading_series%rowtype;
 sc046_old public.meter_reading_series%rowtype; sc046_hop public.meter_reading_series%rowtype;
 probe_before record; probe_after record;
 sc046_graph text; sc046_graph_after text; sc046_cohort jsonb; sc046_sources uuid[]; sc046_sources_after uuid[];
 sc046_contract jsonb; sc046_old_contract jsonb; sc046_old_observation jsonb; sc046_old_payload jsonb;
 sc046_candidates uuid[]; sc046_seen uuid[]; sc046_origin_id uuid; sc046_source uuid;
 historical_application boolean := false;
 sc046_time timestamptz; sc046_old_time timestamptz; sc046_previous_time timestamptz;
 sc046_count bigint; sc046_ordinal integer; sc046_field text; sc046_id uuid;
 sc046_old_result public.metering_values%rowtype; sc046_current_count bigint;

BEGIN
 -- Match the unchanged canonical persistence table-lock order FIRST.
 -- This prevents a writer holding its source/graph while a sink holds an
 -- older source and waits for that writer. No table lock is upgraded later.
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);
 -- SC046 source locks precede the storage graph, which precedes ACK/series
 -- SHARE locks. Preliminary reads confer no authority. The identity spelling
 -- is copied from persist_series_v2, including raw date strings and defaults.
 SELECT * INTO STRICT probe_before FROM gridex_e66_intake.meter_source_probe_v1(
  p_company_id,p_source_message_id,p_transaction_id,p_observation_ordinal);
 sc046_pre:=probe_before.series_row;
 sc046_cohort:=probe_before.cohort_key;
 sc046_graph:=probe_before.graph_key;
 sc046_sources:=probe_before.source_ids;
 IF p_prelocked_sources IS NOT NULL AND sc046_sources IS DISTINCT FROM p_prelocked_sources THEN
  RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='40001';
 END IF;
 PERFORM 1 FROM public.ediel_messages o WHERE o.id=ANY(sc046_sources) ORDER BY o.id FOR SHARE;
 IF sc046_graph IS NULL THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(sc046_graph,0));
 -- Recheck all preliminary bindings after both source and graph waits. New
 -- source membership requires a retry; never acquire a new source row below.
 SELECT * INTO STRICT probe_after FROM gridex_e66_intake.meter_source_probe_v1(
  p_company_id,p_source_message_id,p_transaction_id,p_observation_ordinal);
 sc046_own:=probe_after.series_row;
 IF sc046_own.id IS DISTINCT FROM sc046_pre.id
  OR (to_jsonb(sc046_own)-'is_current') IS DISTINCT FROM (to_jsonb(sc046_pre)-'is_current') THEN
  RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='P0U01'; END IF;
 sc046_graph_after:=probe_after.graph_key;
 sc046_sources_after:=probe_after.source_ids;
 IF sc046_graph_after IS DISTINCT FROM sc046_graph OR sc046_sources_after IS DISTINCT FROM sc046_sources THEN
  RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='P0U01'; END IF;
 -- Immutable late-history birth cannot be promoted with a mutable current bit.
 IF sc046_own.version_no>1 AND sc046_own.supersedes_series_id IS NULL THEN
  RAISE EXCEPTION 'utilts_consumption_late_history' USING ERRCODE='P0U01'; END IF;
 v_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,p_source_message_id,p_transaction_id);
 IF p_expected_contract IS DISTINCT FROM v_contract THEN RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 v_attribution:=v_contract->'metering';
 IF p_observation_ordinal IS NULL OR p_observation_ordinal<0 OR p_observation_ordinal>=jsonb_array_length(v_contract->'observations') THEN
  RAISE EXCEPTION 'utilts_consumption_observation_missing' USING ERRCODE='P0U01'; END IF;
 v_observation:=v_contract->'observations'->p_observation_ordinal;
 -- Check complete same-cohort candidates, without filtering invalid origins
 -- out of existence. Mutable current flags never hide a strictly later birth.
 sc046_time:=coalesce(sc046_own.latest_update_date,sc046_own.registration_date);
 FOR sc046_hop IN SELECT h.* FROM public.meter_reading_series h WHERE jsonb_build_array(h.company_id::text,h.series_kind,h.message_code,coalesce(h.external_metering_point_id,''),
    coalesce(h.grid_area_id,''),h.period_start,h.period_end,h.resolution,coalesce(h.product_id,''))=sc046_cohort AND (EXISTS(SELECT FROM public.ediel_messages o WHERE o.id=h.source_ediel_message_id AND o.environment=v_contract->>'environment') OR EXISTS(SELECT FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=h.source_ediel_message_id AND r.environment=v_contract->>'environment') OR EXISTS(SELECT FROM gridex_utilts_binding.contracts c WHERE c.series_id=h.id AND c.environment=v_contract->>'environment') OR NOT EXISTS(SELECT FROM public.ediel_messages o WHERE o.id=h.source_ediel_message_id)) ORDER BY h.id FOR SHARE LOOP
  IF sc046_hop.source_ediel_message_id IS NULL OR NOT (sc046_hop.source_ediel_message_id=ANY(sc046_sources)) THEN
   RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='P0U01'; END IF;
  sc046_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,sc046_hop.source_ediel_message_id,sc046_hop.source_transaction_reference);
  IF NOT EXISTS(SELECT FROM public.ediel_messages o JOIN public.ediel_ack_transaction_results a ON a.source_message_id=o.id
    JOIN gridex_utilts_binding.contracts c ON c.series_id=a.persisted_series_id
    WHERE o.id=sc046_hop.source_ediel_message_id AND o.company_id=p_company_id AND o.environment=v_contract->>'environment'
     AND o.direction='inbound' AND o.message_family='UTILTS' AND o.message_code=sc046_own.message_code
     AND a.company_id=p_company_id AND a.environment=o.environment AND a.source_transaction_id=sc046_hop.source_transaction_reference
     AND a.persisted_series_id=sc046_hop.id AND a.disposition='accepted' AND a.persistence_status='persisted'
     AND a.planned_response_type='positive_aperak' AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
     AND c.company_id=p_company_id AND c.environment=o.environment AND c.source_message_id=o.id
     AND c.transaction_id=a.source_transaction_id AND c.contract=sc046_contract)
   OR sc046_hop.raw_transaction->>'transactionId' IS DISTINCT FROM sc046_hop.source_transaction_reference
   OR sc046_hop.raw_transaction->'consumptionContract' IS DISTINCT FROM sc046_contract
   OR sc046_hop.immutable_hash IS DISTINCT FROM encode(sha256(convert_to(sc046_hop.raw_transaction::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;
  BEGIN
   IF sc046_hop.registration_date IS DISTINCT FROM nullif(sc046_hop.raw_transaction->>'registrationDate','')::timestamptz
    OR sc046_hop.latest_update_date IS DISTINCT FROM nullif(sc046_hop.raw_transaction->>'latestUpdateDate','')::timestamptz THEN
    RAISE EXCEPTION 'utilts_consumption_correction_time_invalid' USING ERRCODE='P0U01'; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'utilts_consumption_correction_time_invalid' USING ERRCODE='P0U01'; END;
  IF sc046_hop.id<>sc046_own.id AND sc046_hop.version_no>1 AND sc046_hop.supersedes_series_id IS NOT NULL
   AND coalesce(sc046_hop.latest_update_date,sc046_hop.registration_date)>sc046_time THEN
   historical_application := true; END IF;
 END LOOP;
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
 IF historical_application THEN
  RETURN gridex_utilts_binding.replay_metering_application_v1(
    p_company_id,p_source_message_id,v_contract,p_observation_ordinal,v_key);
 END IF;
 -- Lock and compare before the legacy equal-value branch can add lineage.
 SELECT m.* INTO v_result FROM public.metering_values m WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
  ORDER BY m.created_at DESC,m.id DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  BEGIN
   PERFORM gridex_utilts_binding.check_metering_result_v1(v_result,v_payload,v_contract->>'environment');
  EXCEPTION WHEN SQLSTATE 'P0U01' THEN
   -- Only a quantity difference may request correction. Environment, identity,
   -- normalized corruption and every other original error retain their checks.
   IF SQLERRM IS DISTINCT FROM 'utilts_consumption_existing_metering_conflict'
    OR v_result.value_kwh IS NOT DISTINCT FROM (v_payload->>'value_kwh')::numeric THEN RAISE; END IF;
   sc046_old_result:=v_result;
   SELECT count(*) INTO sc046_current_count FROM public.metering_values m
    WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current;
   IF sc046_current_count<>1 THEN RAISE EXCEPTION 'utilts_consumption_existing_metering_conflict' USING ERRCODE='P0U01'; END IF;
   IF v_result.source_ediel_message_id IS NULL OR NOT (v_result.source_ediel_message_id=ANY(sc046_sources)) THEN
    RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='P0U01'; END IF;
   SELECT h.* INTO sc046_old FROM public.ediel_ack_transaction_results a JOIN public.meter_reading_series h ON h.id=a.persisted_series_id
    WHERE a.company_id=p_company_id AND a.source_message_id=v_result.source_ediel_message_id
     AND a.source_transaction_id=v_result.source_transaction_reference;
   IF NOT FOUND OR sc046_old.source_ediel_message_id IS DISTINCT FROM v_result.source_ediel_message_id
    OR sc046_old.source_transaction_reference IS DISTINCT FROM v_result.source_transaction_reference
    OR jsonb_build_array(sc046_old.company_id::text,sc046_old.series_kind,sc046_old.message_code,coalesce(sc046_old.external_metering_point_id,''),
    coalesce(sc046_old.grid_area_id,''),sc046_old.period_start,sc046_old.period_end,sc046_old.resolution,coalesce(sc046_old.product_id,'')) IS DISTINCT FROM sc046_cohort THEN
    RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;
  IF sc046_old.source_ediel_message_id IS NULL OR NOT (sc046_old.source_ediel_message_id=ANY(sc046_sources)) THEN
   RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='P0U01'; END IF;
  sc046_old_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,sc046_old.source_ediel_message_id,sc046_old.source_transaction_reference);
  IF NOT EXISTS(SELECT FROM public.ediel_messages o JOIN public.ediel_ack_transaction_results a ON a.source_message_id=o.id
    JOIN gridex_utilts_binding.contracts c ON c.series_id=a.persisted_series_id
    WHERE o.id=sc046_old.source_ediel_message_id AND o.company_id=p_company_id AND o.environment=sc046_old_contract->>'environment'
     AND o.direction='inbound' AND o.message_family='UTILTS' AND o.message_code=sc046_own.message_code
     AND a.company_id=p_company_id AND a.environment=o.environment AND a.source_transaction_id=sc046_old.source_transaction_reference
     AND a.persisted_series_id=sc046_old.id AND a.disposition='accepted' AND a.persistence_status='persisted'
     AND a.planned_response_type='positive_aperak' AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
     AND c.company_id=p_company_id AND c.environment=o.environment AND c.source_message_id=o.id
     AND c.transaction_id=a.source_transaction_id AND c.contract=sc046_old_contract)
   OR sc046_old.raw_transaction->>'transactionId' IS DISTINCT FROM sc046_old.source_transaction_reference
   OR sc046_old.raw_transaction->'consumptionContract' IS DISTINCT FROM sc046_old_contract
   OR sc046_old.immutable_hash IS DISTINCT FROM encode(sha256(convert_to(sc046_old.raw_transaction::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;
  BEGIN
   IF sc046_old.registration_date IS DISTINCT FROM nullif(sc046_old.raw_transaction->>'registrationDate','')::timestamptz
    OR sc046_old.latest_update_date IS DISTINCT FROM nullif(sc046_old.raw_transaction->>'latestUpdateDate','')::timestamptz THEN
    RAISE EXCEPTION 'utilts_consumption_correction_time_invalid' USING ERRCODE='P0U01'; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'utilts_consumption_correction_time_invalid' USING ERRCODE='P0U01'; END;
   SELECT count(*),min(ordinality::integer)-1 INTO sc046_count,sc046_ordinal
    FROM jsonb_array_elements(sc046_old_contract->'observations') WITH ORDINALITY observations(o,ordinality)
    WHERE concat_ws('|',p_company_id::text,sc046_old_contract#>>'{metering,meteringPointId}',o->>'periodStart',o->>'periodEnd',
     coalesce(o->>'registerCode','default-register'),coalesce(o->>'productCode','default-product'),o->>'direction',o->>'unit')=v_key;
   IF sc046_count<>1 OR sc046_old_contract#>>'{metering,capability}' IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;
   sc046_old_observation:=sc046_old_contract->'observations'->sc046_ordinal;
   PERFORM gridex_utilts_binding.lock_attribution_v1(p_company_id,sc046_old_contract->'metering',false);
 sc046_old_payload:=jsonb_build_object('company_id',p_company_id,'customer_id',(sc046_old_contract->'metering')->'customerId','site_id',(sc046_old_contract->'metering')->'siteId','customer_site_id',(sc046_old_contract->'metering')->'customerSiteId',
  'metering_point_id',(sc046_old_contract->'metering')->'meteringPointId','grid_owner_id',(sc046_old_contract->'metering')->'gridOwnerId','source_request_id',(sc046_old_contract->'metering')->'sourceRequestId',
  'period_start',sc046_old_observation->'periodStart','period_end',sc046_old_observation->'periodEnd','read_at',sc046_old_observation->'readAt','resolution',sc046_old_observation->'resolution',
  'value_kwh',sc046_old_observation->'quantity','quality_code',sc046_old_observation->'quality','reading_type',sc046_old_observation->'readingType','direction',sc046_old_observation->'direction','unit',sc046_old_observation->'unit',
  'register_code',sc046_old_observation->'registerCode','product_code',sc046_old_observation->'productCode','facility_id',sc046_old_observation->'externalPoint','grid_area',sc046_old_observation->'gridArea',
  'source_line_reference',sc046_old_observation->'sourceLineReference','source_system',sc046_old_contract->'sourceType','source_ediel_message_id',sc046_old.source_ediel_message_id,
  'source_transaction_reference',sc046_old.source_transaction_reference,'created_by',p_actor_id,'canonical_dedupe_key',v_key,
  'raw_payload',jsonb_build_object('consumptionContract',sc046_old_contract,'sourceOrdinal',sc046_old_observation->'sourceOrdinal','edielMessageId',sc046_old.source_ediel_message_id));
   -- Revalidate old rows against their OWN protected contract in the incoming
   -- environment, not raw_payload or incoming quantity. Preserve all original
   -- meter/normalized/timestamp/identity/environment corruption refusals.
   PERFORM gridex_utilts_binding.check_metering_result_v1(sc046_old_result,sc046_old_payload,v_contract->>'environment');
   IF (v_payload-ARRAY['value_kwh','source_ediel_message_id','source_transaction_reference','source_line_reference','created_by','raw_payload'])
    IS DISTINCT FROM (sc046_old_payload-ARRAY['value_kwh','source_ediel_message_id','source_transaction_reference','source_line_reference','created_by','raw_payload']) THEN
    RAISE EXCEPTION 'utilts_consumption_existing_metering_conflict' USING ERRCODE='P0U01'; END IF;
   sc046_old_time:=coalesce(sc046_old.latest_update_date,sc046_old.registration_date);
   IF sc046_time IS NULL OR sc046_old_time IS NULL OR sc046_time<=sc046_old_time
    OR sc046_own.is_current IS DISTINCT FROM true OR sc046_own.version_no<=1
    OR sc046_own.supersedes_series_id IS NULL OR sc046_own.source_ediel_message_id IS DISTINCT FROM p_source_message_id
    OR sc046_own.source_transaction_reference IS DISTINCT FROM p_transaction_id THEN
    RAISE EXCEPTION 'utilts_consumption_correction_not_newer' USING ERRCODE='P0U01'; END IF;
   SELECT array_agg(h.id ORDER BY h.id) INTO sc046_candidates FROM public.meter_reading_series h
    WHERE jsonb_build_array(h.company_id::text,h.series_kind,h.message_code,coalesce(h.external_metering_point_id,''),
    coalesce(h.grid_area_id,''),h.period_start,h.period_end,h.resolution,coalesce(h.product_id,''))=sc046_cohort AND h.is_current AND (EXISTS(SELECT FROM public.ediel_messages o WHERE o.id=h.source_ediel_message_id AND o.environment=v_contract->>'environment') OR EXISTS(SELECT FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=h.source_ediel_message_id AND r.environment=v_contract->>'environment') OR EXISTS(SELECT FROM gridex_utilts_binding.contracts c WHERE c.series_id=h.id AND c.environment=v_contract->>'environment') OR NOT EXISTS(SELECT FROM public.ediel_messages o WHERE o.id=h.source_ediel_message_id));
   IF sc046_candidates IS DISTINCT FROM ARRAY[sc046_own.id] THEN
    RAISE EXCEPTION 'utilts_consumption_correction_head_ambiguous' USING ERRCODE='P0U01'; END IF;
   -- Authenticate every predecessor, including equal-content intermediate
   -- versions whose business row retains the first source as primary origin.
   sc046_hop:=sc046_own;sc046_seen:=ARRAY[sc046_own.id];sc046_previous_time:=sc046_time;
   LOOP
    sc046_id:=sc046_hop.supersedes_series_id;
    IF sc046_id IS NULL OR sc046_id=ANY(sc046_seen) THEN
     RAISE EXCEPTION 'utilts_consumption_correction_ancestry_invalid' USING ERRCODE='P0U01'; END IF;
    sc046_seen:=array_append(sc046_seen,sc046_id);
    SELECT h.* INTO sc046_pre FROM public.meter_reading_series h WHERE h.id=sc046_id FOR SHARE;
    IF NOT FOUND OR sc046_pre.version_no<>sc046_hop.version_no-1
     OR jsonb_build_array(sc046_pre.company_id::text,sc046_pre.series_kind,sc046_pre.message_code,coalesce(sc046_pre.external_metering_point_id,''),
    coalesce(sc046_pre.grid_area_id,''),sc046_pre.period_start,sc046_pre.period_end,sc046_pre.resolution,coalesce(sc046_pre.product_id,'')) IS DISTINCT FROM sc046_cohort THEN
     RAISE EXCEPTION 'utilts_consumption_correction_ancestry_invalid' USING ERRCODE='P0U01'; END IF;
    sc046_hop:=sc046_pre;
  IF sc046_hop.source_ediel_message_id IS NULL OR NOT (sc046_hop.source_ediel_message_id=ANY(sc046_sources)) THEN
   RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='P0U01'; END IF;
  sc046_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,sc046_hop.source_ediel_message_id,sc046_hop.source_transaction_reference);
  IF NOT EXISTS(SELECT FROM public.ediel_messages o JOIN public.ediel_ack_transaction_results a ON a.source_message_id=o.id
    JOIN gridex_utilts_binding.contracts c ON c.series_id=a.persisted_series_id
    WHERE o.id=sc046_hop.source_ediel_message_id AND o.company_id=p_company_id AND o.environment=v_contract->>'environment'
     AND o.direction='inbound' AND o.message_family='UTILTS' AND o.message_code=sc046_own.message_code
     AND a.company_id=p_company_id AND a.environment=o.environment AND a.source_transaction_id=sc046_hop.source_transaction_reference
     AND a.persisted_series_id=sc046_hop.id AND a.disposition='accepted' AND a.persistence_status='persisted'
     AND a.planned_response_type='positive_aperak' AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
     AND c.company_id=p_company_id AND c.environment=o.environment AND c.source_message_id=o.id
     AND c.transaction_id=a.source_transaction_id AND c.contract=sc046_contract)
   OR sc046_hop.raw_transaction->>'transactionId' IS DISTINCT FROM sc046_hop.source_transaction_reference
   OR sc046_hop.raw_transaction->'consumptionContract' IS DISTINCT FROM sc046_contract
   OR sc046_hop.immutable_hash IS DISTINCT FROM encode(sha256(convert_to(sc046_hop.raw_transaction::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION 'utilts_consumption_correction_binding_invalid' USING ERRCODE='P0U01'; END IF;
  BEGIN
   IF sc046_hop.registration_date IS DISTINCT FROM nullif(sc046_hop.raw_transaction->>'registrationDate','')::timestamptz
    OR sc046_hop.latest_update_date IS DISTINCT FROM nullif(sc046_hop.raw_transaction->>'latestUpdateDate','')::timestamptz THEN
    RAISE EXCEPTION 'utilts_consumption_correction_time_invalid' USING ERRCODE='P0U01'; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'utilts_consumption_correction_time_invalid' USING ERRCODE='P0U01'; END;
    IF coalesce(sc046_hop.latest_update_date,sc046_hop.registration_date) IS NULL
     OR coalesce(sc046_hop.latest_update_date,sc046_hop.registration_date)>sc046_previous_time
     OR sc046_time<=coalesce(sc046_hop.latest_update_date,sc046_hop.registration_date) THEN
     RAISE EXCEPTION 'utilts_consumption_correction_not_newer' USING ERRCODE='P0U01'; END IF;
    sc046_previous_time:=coalesce(sc046_hop.latest_update_date,sc046_hop.registration_date);
    EXIT WHEN sc046_hop.id=sc046_old.id;
   END LOOP;
  END;
 END IF;
 SELECT * INTO v_result FROM public.gridex_ingest_metering_value_atomic(v_payload);
 -- Recheck the returned row too: any legacy writer racing an absent key must
 -- roll back its source link on conflict in this same transaction.
 PERFORM gridex_utilts_binding.check_metering_result_v1(v_result,v_payload,v_contract->>'environment');
 PERFORM gridex_utilts_binding.record_metering_application_v1(
     v_result,v_contract,p_observation_ordinal,p_source_message_id);
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION gridex_e66_intake.consume_owned_e66_meter_scoped_v1(uuid,uuid,text,integer,uuid,jsonb,uuid[])
 FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_e66_intake.consume_owned_e66_meter_v1(p_company_id uuid, p_source_message_id uuid, p_transaction_id text, p_observation_ordinal integer, p_actor_id uuid, p_expected_contract jsonb) RETURNS public.metering_values
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET "TimeZone" TO 'UTC'
    AS $$
BEGIN
 RETURN gridex_e66_intake.consume_owned_e66_meter_scoped_v1(
  p_company_id,p_source_message_id,p_transaction_id,p_observation_ordinal,p_actor_id,p_expected_contract,NULL);
END
$$;

-- Read a current canonical application receipt and source link for one mixed IDE observation.
-- Equal values can share a physical row while retaining independently qualified source links.
CREATE FUNCTION gridex_e66_metering_stage.current_mixed_application_v1(
  p_company uuid,p_environment text,p_source uuid,p_transaction text,p_ordinal integer,
  p_metering_id uuid,p_contract jsonb
) RETURNS uuid
LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $$
 SELECT n.id
 FROM gridex_utilts_binding.metering_application_receipts r
 JOIN public.metering_values m ON (m.company_id,m.id)=(r.company_id,r.value_id)
 JOIN public.normalized_metering_values n
   ON (n.company_id,n.id,n.source_metering_value_id)=(r.company_id,r.normalized_id,r.value_id)
 JOIN public.metering_value_sources l
   ON (l.id,l.company_id,l.metering_value_id,l.normalized_metering_value_id,
       l.source_ediel_message_id,l.source_transaction_reference)
   =(r.source_link_id,r.company_id,r.value_id,r.normalized_id,r.source_message_id,r.transaction_id)
 WHERE (r.company_id,r.environment,r.source_message_id,r.transaction_id,r.observation_ordinal,r.value_id)
   =(p_company,p_environment,p_source,p_transaction,p_ordinal,p_metering_id)
 AND p_contract->>'transactionId'=p_transaction AND p_contract->>'environment'=p_environment
 AND l.source_line_reference IS NOT DISTINCT FROM p_contract->'observations'->p_ordinal->>'sourceLineReference'
 AND r.contract_hash=sha256(convert_to(p_contract::text,'UTF8'))
 AND r.value_hash=gridex_utilts_binding.application_value_hash_v1(m)
 AND r.normalized_hash=gridex_utilts_binding.application_normalized_hash_v1(n)
 AND m.is_current AND m.revision_status='current' AND n.revision_status='current'
$$;
REVOKE ALL ON FUNCTION gridex_e66_metering_stage.current_mixed_application_v1(uuid,text,uuid,text,integer,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_e66_metering_stage.mixed_jobs (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  observation_count integer NOT NULL CHECK (observation_count > 0),
  next_ordinal integer NOT NULL DEFAULT 0 CHECK (next_ordinal BETWEEN 0 AND observation_count),
  PRIMARY KEY (source_id, transaction_id),
  FOREIGN KEY (source_id, transaction_id)
    REFERENCES gridex_e66_intake.mixed_accepted_transactions (source_id, transaction_id)
);

CREATE TABLE gridex_e66_metering_stage.mixed_effects (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  metering_id uuid NOT NULL,
  normalized_id uuid NOT NULL,
  PRIMARY KEY (source_id, transaction_id, ordinal),
  FOREIGN KEY (source_id, transaction_id)
    REFERENCES gridex_e66_metering_stage.mixed_jobs (source_id, transaction_id)
);

CREATE TABLE gridex_e66_metering_stage.mixed_chunk_receipts (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  start_ordinal integer NOT NULL CHECK (start_ordinal >= 0),
  actor_id uuid NOT NULL,
  requested_limit integer NOT NULL CHECK (requested_limit BETWEEN 1 AND 8),
  next_ordinal integer NOT NULL,
  CHECK (next_ordinal > start_ordinal AND next_ordinal - start_ordinal <= requested_limit),
  PRIMARY KEY (source_id, transaction_id, start_ordinal),
  FOREIGN KEY (source_id, transaction_id)
    REFERENCES gridex_e66_metering_stage.mixed_jobs (source_id, transaction_id)
);

REVOKE ALL ON gridex_e66_metering_stage.mixed_jobs, gridex_e66_metering_stage.mixed_effects,
 gridex_e66_metering_stage.mixed_chunk_receipts FROM PUBLIC, anon, authenticated, service_role;

-- Isolated worker only. No production caller or readiness transition.
CREATE FUNCTION gridex_e66_metering_stage.consume_mixed_chunk_v1(
 p_company uuid, p_environment text, p_mailbox uuid, p_source uuid, p_actor uuid,
 p_transaction text, p_next integer, p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
DECLARE
 work gridex_e66_intake.work;
 job gridex_e66_metering_stage.mixed_jobs;
 receipt gridex_e66_metering_stage.mixed_chunk_receipts;
 owned_contract jsonb;
 saved public.metering_values;
 normalized_id uuid;
 stop_ordinal integer;
 target_ordinal integer;
 expected_by_ordinal jsonb;
 all_sources uuid[];
 locked_source_count integer;
 expected_sources uuid[];
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 8 OR p_next IS NULL OR p_next < 0 THEN
   RAISE EXCEPTION 'mixed_stage_invalid_chunk' USING ERRCODE='22023';
 END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO STRICT work FROM gridex_e66_intake.work w
 WHERE (w.source_id,w.company_id,w.environment,w.mailbox_id)=(p_source,p_company,p_environment,p_mailbox)
 FOR UPDATE;
 IF work.phase <> 'mixed_qualified' OR work.lease_token IS NOT NULL
   OR gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'hold_qualification_unverified'
   OR NOT EXISTS (
     SELECT FROM public.ediel_messages m WHERE m.id=p_source AND m.company_id=p_company
       AND m.environment=p_environment AND m.grid_owner_data_request_id IS NULL
   ) OR EXISTS (
     SELECT FROM gridex_e66_intake.matched_request_basis b WHERE b.source_id=p_source
   ) THEN
   RAISE EXCEPTION 'mixed_stage_work_unavailable' USING ERRCODE='55000';
 END IF;

 -- This lookup creates no source-row lock. The canonical consumer compares this
 -- exact value against the authoritative contract after its sorted source locks.
 SELECT c.contract INTO owned_contract
 FROM gridex_e66_intake.mixed_accepted_transactions t
   JOIN gridex_utilts_binding.contracts c ON
     (c.source_message_id,c.company_id,c.environment,c.transaction_id,c.series_id,c.contract_hash)
     =(t.source_id,p_company,p_environment,t.transaction_id,t.series_id,t.contract_hash)
   JOIN gridex_utilts_binding.receipts r ON
     (r.source_message_id,r.company_id,r.environment,r.raw_hash)=(t.source_id,p_company,p_environment,work.payload_sha256)
   WHERE (t.source_id,t.transaction_id)=(p_source,p_transaction)
     AND c.contract_hash=encode(sha256(convert_to(c.contract::text,'UTF8')),'hex')
     AND c.contract#>>'{metering,sourceRequestId}' IS NULL
     AND c.contract#>>'{billing,sourceRequestId}' IS NULL
     AND jsonb_array_length(c.contract->'observations')>0
     AND r.membership->>t.transaction_index=t.transaction_id;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'mixed_stage_child_unavailable' USING ERRCODE='55000';
 END IF;

 INSERT INTO gridex_e66_metering_stage.mixed_jobs(source_id,transaction_id,observation_count)
 VALUES(p_source,p_transaction,jsonb_array_length(owned_contract->'observations'))
 ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT job FROM gridex_e66_metering_stage.mixed_jobs j
 WHERE (j.source_id,j.transaction_id)=(p_source,p_transaction) FOR UPDATE;
 SELECT * INTO receipt FROM gridex_e66_metering_stage.mixed_chunk_receipts r
 WHERE (r.source_id,r.transaction_id,r.start_ordinal)=(p_source,p_transaction,p_next);
 IF FOUND THEN
   IF (receipt.actor_id,receipt.requested_limit) IS DISTINCT FROM (p_actor,p_limit) THEN
     RAISE EXCEPTION 'mixed_stage_replay_changed' USING ERRCODE='55000';
   END IF;
   RETURN jsonb_build_object('transactionId',p_transaction,'nextOrdinal',receipt.next_ordinal,'replayed',true);
 END IF;
 IF job.next_ordinal <> p_next OR p_next >= job.observation_count
   OR job.observation_count IS DISTINCT FROM jsonb_array_length(owned_contract->'observations') THEN
   RAISE EXCEPTION 'mixed_stage_cursor_stale' USING ERRCODE='55000';
 END IF;

 stop_ordinal := least(p_next+p_limit,job.observation_count);
 -- Snapshot each ordinal separately, then lock the complete sorted union
 -- before any canonical consumer may lock a single source message.
 WITH ordinal_probe AS MATERIALIZED (
   SELECT i.ordinal, probe.source_ids
   FROM generate_series(p_next,stop_ordinal-1) AS i(ordinal)
   CROSS JOIN LATERAL gridex_e66_intake.meter_source_probe_v1(
     p_company,p_source,p_transaction,i.ordinal) probe
 )
 SELECT (SELECT jsonb_object_agg(ordinal,to_jsonb(source_ids)) FROM ordinal_probe),
   array_agg(DISTINCT source_id ORDER BY source_id)
 INTO expected_by_ordinal,all_sources
 FROM ordinal_probe CROSS JOIN LATERAL unnest(source_ids) AS s(source_id);
 PERFORM m.id FROM public.ediel_messages m
 WHERE m.id=ANY(all_sources) ORDER BY m.id FOR SHARE;
 GET DIAGNOSTICS locked_source_count=ROW_COUNT;
 IF locked_source_count IS DISTINCT FROM cardinality(all_sources) OR EXISTS (
   SELECT FROM generate_series(p_next,stop_ordinal-1) AS i(ordinal)
   CROSS JOIN LATERAL gridex_e66_intake.meter_source_probe_v1(
     p_company,p_source,p_transaction,i.ordinal) AS probe
   WHERE to_jsonb(probe.source_ids) IS DISTINCT FROM expected_by_ordinal->i.ordinal::text
 ) THEN
   RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='40001';
 END IF;

 FOR target_ordinal IN p_next..stop_ordinal-1 LOOP
   expected_sources := ARRAY(
     SELECT item::uuid FROM jsonb_array_elements_text(expected_by_ordinal->target_ordinal::text) AS s(item)
   );
   SELECT * INTO STRICT saved FROM gridex_e66_intake.consume_owned_e66_meter_scoped_v1(
     p_company,p_source,p_transaction,target_ordinal,p_actor,owned_contract,expected_sources);
   normalized_id := gridex_e66_metering_stage.current_mixed_application_v1(
     p_company,p_environment,p_source,p_transaction,target_ordinal,saved.id,owned_contract);
   IF normalized_id IS NULL THEN
     RAISE EXCEPTION 'mixed_stage_application_receipt_unavailable' USING ERRCODE='55000';
   END IF;
   INSERT INTO gridex_e66_metering_stage.mixed_effects VALUES
     (p_source,p_transaction,target_ordinal,saved.id,normalized_id);
 END LOOP;
 UPDATE gridex_e66_metering_stage.mixed_jobs SET next_ordinal=stop_ordinal
 WHERE (source_id,transaction_id)=(p_source,p_transaction);
 INSERT INTO gridex_e66_metering_stage.mixed_chunk_receipts VALUES
   (p_source,p_transaction,p_next,p_actor,p_limit,stop_ordinal);
 RETURN jsonb_build_object('transactionId',p_transaction,'nextOrdinal',stop_ordinal,'replayed',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_metering_stage.consume_mixed_chunk_v1(uuid,text,uuid,uuid,uuid,text,integer,integer)
 FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_e66_metering_stage.mixed_normalization_receipts (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  actor_id uuid NOT NULL,
  contract_hash text NOT NULL,
  ordered_effects jsonb NOT NULL CHECK (
    jsonb_typeof(ordered_effects) = 'array' AND jsonb_array_length(ordered_effects) > 0
  ),
  PRIMARY KEY (source_id, transaction_id),
  FOREIGN KEY (source_id, transaction_id)
    REFERENCES gridex_e66_metering_stage.mixed_jobs (source_id, transaction_id)
);
REVOKE ALL ON gridex_e66_metering_stage.mixed_normalization_receipts
 FROM PUBLIC, anon, authenticated, service_role;

-- Seals a completed normalization checkpoint for readiness evaluation.
-- Neither billing eligibility nor acknowledgment authority follows from this receipt.
CREATE FUNCTION gridex_e66_metering_stage.seal_mixed_normalization_v1(
 p_company uuid, p_environment text, p_mailbox uuid, p_source uuid, p_actor uuid,
 p_transaction text
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
DECLARE
 work gridex_e66_intake.work;
 job gridex_e66_metering_stage.mixed_jobs;
 prior gridex_e66_metering_stage.mixed_normalization_receipts;
 owned_contract jsonb;
 contract_hash text;
 effects jsonb;
BEGIN
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO STRICT work FROM gridex_e66_intake.work w
 WHERE (w.source_id,w.company_id,w.environment,w.mailbox_id)=(p_source,p_company,p_environment,p_mailbox)
 FOR UPDATE;
 IF work.phase <> 'mixed_qualified' OR work.lease_token IS NOT NULL
   OR gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'hold_qualification_unverified'
   OR NOT EXISTS (
     SELECT FROM public.ediel_messages m WHERE m.id=p_source AND m.company_id=p_company
       AND m.environment=p_environment AND m.grid_owner_data_request_id IS NULL
   ) OR EXISTS (
     SELECT FROM gridex_e66_intake.matched_request_basis b WHERE b.source_id=p_source
   ) THEN
   RAISE EXCEPTION 'mixed_normalization_work_unavailable' USING ERRCODE='55000';
 END IF;

 owned_contract:=gridex_utilts_binding.stored_contract_v1(p_company,p_source,p_transaction);
 SELECT c.contract_hash INTO contract_hash
 FROM gridex_e66_intake.mixed_accepted_transactions t
 JOIN gridex_utilts_binding.contracts c ON
   (c.source_message_id,c.company_id,c.environment,c.transaction_id,c.series_id,c.contract_hash)
   =(t.source_id,p_company,p_environment,t.transaction_id,t.series_id,t.contract_hash)
 JOIN gridex_utilts_binding.receipts r ON
   (r.source_message_id,r.company_id,r.environment,r.raw_hash)=(t.source_id,p_company,p_environment,work.payload_sha256)
 WHERE (t.source_id,t.transaction_id)=(p_source,p_transaction)
   AND c.contract=owned_contract AND r.membership->>t.transaction_index=t.transaction_id
   AND c.contract_hash=encode(sha256(convert_to(c.contract::text,'UTF8')),'hex')
   AND c.contract#>>'{metering,sourceRequestId}' IS NULL
   AND c.contract#>>'{billing,sourceRequestId}' IS NULL;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'mixed_normalization_child_unavailable' USING ERRCODE='55000';
 END IF;
 SELECT * INTO job FROM gridex_e66_metering_stage.mixed_jobs j
 WHERE (j.source_id,j.transaction_id)=(p_source,p_transaction) FOR UPDATE;
 IF NOT FOUND OR job.next_ordinal<>job.observation_count
   OR job.observation_count IS DISTINCT FROM jsonb_array_length(owned_contract->'observations') THEN
   RAISE EXCEPTION 'mixed_normalization_incomplete' USING ERRCODE='55000';
 END IF;

 SELECT jsonb_agg(jsonb_build_object('ordinal',e.ordinal,'meteringId',e.metering_id,
                    'normalizedId',e.normalized_id) ORDER BY e.ordinal)
 INTO effects
 FROM gridex_e66_metering_stage.mixed_effects e
 WHERE (e.source_id,e.transaction_id)=(p_source,p_transaction)
   AND e.ordinal<job.observation_count
   AND gridex_e66_metering_stage.current_mixed_application_v1(
     p_company,p_environment,p_source,p_transaction,e.ordinal,e.metering_id,owned_contract
   )=e.normalized_id;
 IF jsonb_array_length(effects) IS DISTINCT FROM job.observation_count THEN
   RAISE EXCEPTION 'mixed_normalization_effect_unavailable' USING ERRCODE='55000';
 END IF;

 SELECT * INTO prior FROM gridex_e66_metering_stage.mixed_normalization_receipts r
 WHERE (r.source_id,r.transaction_id)=(p_source,p_transaction);
 IF FOUND THEN
   IF (prior.actor_id,prior.contract_hash,prior.ordered_effects) IS DISTINCT FROM (p_actor,contract_hash,effects) THEN
     RAISE EXCEPTION 'mixed_normalization_replay_changed' USING ERRCODE='55000';
   END IF;
   RETURN jsonb_build_object('transactionId',p_transaction,'effects',effects,'replayed',true);
 END IF;
 INSERT INTO gridex_e66_metering_stage.mixed_normalization_receipts VALUES
   (p_source,p_transaction,p_actor,contract_hash,effects);
 RETURN jsonb_build_object('transactionId',p_transaction,'effects',effects,'replayed',false);
END
$$;
REVOKE ALL ON FUNCTION gridex_e66_metering_stage.seal_mixed_normalization_v1(uuid,text,uuid,uuid,uuid,text)
 FROM PUBLIC, anon, authenticated, service_role;
