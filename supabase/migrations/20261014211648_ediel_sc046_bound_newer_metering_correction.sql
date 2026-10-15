-- SC046: authenticate a strict newer bound quantity revision; no applied history edits.
-- Exact predecessor from genuine PR807 F clean catalog: 8a6ad238; SOURCE only.
-- Preserve target OID, owner, ACL, ABI, settings and all unchanged helper guards.
DO $migration$
DECLARE target oid:='public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure;
 before_metadata jsonb;after_metadata jsonb;before_helpers jsonb;after_helpers jsonb;
 old_body text;old_definition text;new_definition text;installed_body text;
 new_body text:=$body$
DECLARE v_contract jsonb; v_attribution jsonb; v_observation jsonb; v_key text; v_payload jsonb; v_result public.metering_values%rowtype;
 -- SC046 authentic newer correction declarations.
 sc046_own public.meter_reading_series%rowtype; sc046_pre public.meter_reading_series%rowtype;
 sc046_old public.meter_reading_series%rowtype; sc046_hop public.meter_reading_series%rowtype;
 sc046_graph text; sc046_graph_after text; sc046_cohort jsonb; sc046_sources uuid[]; sc046_sources_after uuid[];
 sc046_contract jsonb; sc046_old_contract jsonb; sc046_old_observation jsonb; sc046_old_payload jsonb;
 sc046_candidates uuid[]; sc046_seen uuid[]; sc046_origin_id uuid; sc046_source uuid;
 sc046_time timestamptz; sc046_old_time timestamptz; sc046_previous_time timestamptz;
 sc046_count bigint; sc046_ordinal integer; sc046_field text; sc046_id uuid;
 sc046_old_result public.metering_values%rowtype; sc046_current_count bigint;

BEGIN
 -- Match the unchanged canonical persistence table-lock order FIRST.
 -- This prevents a writer holding its source/graph while a sink holds an
 -- older source and waits for that writer. No table lock is upgraded later.
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 -- SC046 source locks precede the storage graph, which precedes ACK/series
 -- SHARE locks. Preliminary reads confer no authority. The identity spelling
 -- is copied from persist_series_v2, including raw date strings and defaults.
 SELECT h.* INTO sc046_pre FROM public.ediel_ack_transaction_results a
 JOIN public.meter_reading_series h ON h.id=a.persisted_series_id
 WHERE a.company_id=p_company_id AND a.source_message_id=p_source_message_id AND a.source_transaction_id=p_transaction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_not_accepted' USING ERRCODE='P0U01'; END IF;
 sc046_cohort:=jsonb_build_array(p_company_id::text,sc046_pre.series_kind,sc046_pre.message_code,
  coalesce(sc046_pre.external_metering_point_id,''),coalesce(sc046_pre.grid_area_id,''),
  sc046_pre.period_start,sc046_pre.period_end,sc046_pre.resolution,coalesce(sc046_pre.product_id,''));
 SELECT concat_ws('|',p_company_id::text,o.environment,coalesce(sc046_pre.raw_transaction->>'seriesKind','actual'),
  o.message_code,coalesce(sc046_pre.raw_transaction->>'externalMeteringPointId',''),coalesce(sc046_pre.raw_transaction->>'gridAreaId',''),
  coalesce(sc046_pre.raw_transaction->>'periodStart',''),coalesce(sc046_pre.raw_transaction->>'periodEnd',''),
  coalesce(sc046_pre.raw_transaction->>'resolution','UNKNOWN'),coalesce(sc046_pre.raw_transaction->>'productId','')) INTO sc046_graph FROM public.ediel_messages o WHERE o.id=p_source_message_id;
 v_attribution:=sc046_pre.raw_transaction#>'{consumptionContract,metering}';
 v_observation:=sc046_pre.raw_transaction#>'{consumptionContract,observations}'->p_observation_ordinal;
 v_key:=concat_ws('|',p_company_id::text,v_attribution->>'meteringPointId',v_observation->>'periodStart',v_observation->>'periodEnd',
  coalesce(v_observation->>'registerCode','default-register'),coalesce(v_observation->>'productCode','default-product'),v_observation->>'direction',v_observation->>'unit');
 SELECT (SELECT array_agg(DISTINCT source_id ORDER BY source_id) FROM (
   SELECT p_source_message_id AS source_id
   UNION SELECT h.source_ediel_message_id FROM public.meter_reading_series h WHERE jsonb_build_array(h.company_id::text,h.series_kind,h.message_code,coalesce(h.external_metering_point_id,''),
    coalesce(h.grid_area_id,''),h.period_start,h.period_end,h.resolution,coalesce(h.product_id,''))=sc046_cohort
   UNION SELECT m.source_ediel_message_id FROM public.metering_values m WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
   UNION SELECT l.source_ediel_message_id FROM public.metering_value_sources l JOIN public.metering_values m ON m.id=l.metering_value_id AND m.company_id=l.company_id
    WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
  ) sources WHERE source_id IS NOT NULL) INTO sc046_sources;
 PERFORM 1 FROM public.ediel_messages o WHERE o.id=ANY(sc046_sources) ORDER BY o.id FOR SHARE;
 IF sc046_graph IS NULL THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(sc046_graph,0));
 -- Recheck all preliminary bindings after both source and graph waits. New
 -- source membership requires a retry; never acquire a new source row below.
 SELECT h.* INTO sc046_own FROM public.ediel_ack_transaction_results a
 JOIN public.meter_reading_series h ON h.id=a.persisted_series_id
 WHERE a.company_id=p_company_id AND a.source_message_id=p_source_message_id AND a.source_transaction_id=p_transaction_id;
 IF NOT FOUND OR sc046_own.id IS DISTINCT FROM sc046_pre.id
  OR (to_jsonb(sc046_own)-'is_current') IS DISTINCT FROM (to_jsonb(sc046_pre)-'is_current') THEN
  RAISE EXCEPTION 'utilts_consumption_graph_changed_retry' USING ERRCODE='P0U01'; END IF;
 SELECT concat_ws('|',p_company_id::text,o.environment,coalesce(sc046_pre.raw_transaction->>'seriesKind','actual'),
  o.message_code,coalesce(sc046_pre.raw_transaction->>'externalMeteringPointId',''),coalesce(sc046_pre.raw_transaction->>'gridAreaId',''),
  coalesce(sc046_pre.raw_transaction->>'periodStart',''),coalesce(sc046_pre.raw_transaction->>'periodEnd',''),
  coalesce(sc046_pre.raw_transaction->>'resolution','UNKNOWN'),coalesce(sc046_pre.raw_transaction->>'productId','')) INTO sc046_graph_after FROM public.ediel_messages o WHERE o.id=p_source_message_id;
 SELECT (SELECT array_agg(DISTINCT source_id ORDER BY source_id) FROM (
   SELECT p_source_message_id AS source_id
   UNION SELECT h.source_ediel_message_id FROM public.meter_reading_series h WHERE jsonb_build_array(h.company_id::text,h.series_kind,h.message_code,coalesce(h.external_metering_point_id,''),
    coalesce(h.grid_area_id,''),h.period_start,h.period_end,h.resolution,coalesce(h.product_id,''))=sc046_cohort
   UNION SELECT m.source_ediel_message_id FROM public.metering_values m WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
   UNION SELECT l.source_ediel_message_id FROM public.metering_value_sources l JOIN public.metering_values m ON m.id=l.metering_value_id AND m.company_id=l.company_id
    WHERE m.company_id=p_company_id AND m.canonical_dedupe_key=v_key AND m.is_current
  ) sources WHERE source_id IS NOT NULL) INTO sc046_sources_after;
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
   RAISE EXCEPTION 'utilts_consumption_stale_version' USING ERRCODE='P0U01'; END IF;
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
 RETURN v_result;
END $body$;
BEGIN
 SELECT to_jsonb(p)-'prosrc',p.prosrc,pg_get_functiondef(p.oid) INTO before_metadata,old_body,old_definition FROM pg_proc p WHERE p.oid=target;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex') IS DISTINCT FROM '8a6ad23846ee6af5ed96ffa0aa22318359b70d1075b9cac6fcea12299acae85e'
  OR old_body='' OR (length(old_definition)-length(replace(old_definition,old_body,'')))/length(old_body)<>1 THEN
  RAISE EXCEPTION 'utilts_correction_predecessor_conflict' USING ERRCODE='P0U01'; END IF;
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) INTO before_helpers FROM pg_proc p
  WHERE p.oid IN (SELECT signature::regprocedure FROM (VALUES
  ('gridex_utilts_binding.lock_storage_graph_v1()','45c36aada059e89c7d4327816b8af76b8a8fd390b03d9bef16c03c4ed31e3976'),
  ('gridex_utilts_binding.check_metering_result_v1(public.metering_values,jsonb,text)','e0dae3670484c486c544e67cb848f19335112c8034b820a6371e7ec0ae73e10a'),
  ('gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)','0e74bd2f78c2d81c06cd8216d96f31a362204cf4f2aa61e3d651179d78cdeae9'),
  ('gridex_utilts_binding.lock_attribution_v1(uuid,jsonb,boolean)','168ef9b1ef2d6f903174061619e4f2a1c2542ea04754405808b37d735f7f99de'),
  ('public.gridex_ingest_metering_value_atomic(jsonb)','a5806ee9dce67d299e1e06cb4eb47f19a90710c9a9760f35aa071fb7c70b5f9f')) expected(signature,sha));
 IF EXISTS(SELECT FROM (VALUES
  ('gridex_utilts_binding.lock_storage_graph_v1()','45c36aada059e89c7d4327816b8af76b8a8fd390b03d9bef16c03c4ed31e3976'),
  ('gridex_utilts_binding.check_metering_result_v1(public.metering_values,jsonb,text)','e0dae3670484c486c544e67cb848f19335112c8034b820a6371e7ec0ae73e10a'),
  ('gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)','0e74bd2f78c2d81c06cd8216d96f31a362204cf4f2aa61e3d651179d78cdeae9'),
  ('gridex_utilts_binding.lock_attribution_v1(uuid,jsonb,boolean)','168ef9b1ef2d6f903174061619e4f2a1c2542ea04754405808b37d735f7f99de'),
  ('public.gridex_ingest_metering_value_atomic(jsonb)','a5806ee9dce67d299e1e06cb4eb47f19a90710c9a9760f35aa071fb7c70b5f9f')) expected(signature,sha) JOIN pg_proc p ON p.oid=expected.signature::regprocedure
  WHERE encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.sha) THEN
  RAISE EXCEPTION 'utilts_correction_helper_predecessor_conflict' USING ERRCODE='P0U01'; END IF;
 new_definition:=replace(old_definition,old_body,new_body);
 EXECUTE new_definition;
 SELECT to_jsonb(p)-'prosrc',p.prosrc INTO after_metadata,installed_body FROM pg_proc p WHERE p.oid=target;
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) INTO after_helpers FROM pg_proc p
  WHERE p.oid IN (SELECT signature::regprocedure FROM (VALUES
  ('gridex_utilts_binding.lock_storage_graph_v1()','45c36aada059e89c7d4327816b8af76b8a8fd390b03d9bef16c03c4ed31e3976'),
  ('gridex_utilts_binding.check_metering_result_v1(public.metering_values,jsonb,text)','e0dae3670484c486c544e67cb848f19335112c8034b820a6371e7ec0ae73e10a'),
  ('gridex_utilts_binding.stored_contract_v1(uuid,uuid,text)','0e74bd2f78c2d81c06cd8216d96f31a362204cf4f2aa61e3d651179d78cdeae9'),
  ('gridex_utilts_binding.lock_attribution_v1(uuid,jsonb,boolean)','168ef9b1ef2d6f903174061619e4f2a1c2542ea04754405808b37d735f7f99de'),
  ('public.gridex_ingest_metering_value_atomic(jsonb)','a5806ee9dce67d299e1e06cb4eb47f19a90710c9a9760f35aa071fb7c70b5f9f')) expected(signature,sha));
 IF before_metadata IS DISTINCT FROM after_metadata OR before_helpers IS DISTINCT FROM after_helpers
  OR installed_body IS DISTINCT FROM new_body
  OR encode(sha256(convert_to(installed_body,'UTF8')),'hex') IS DISTINCT FROM 'd0bafd57804b2fb416927807856590fba46d92fa7d322e1a9a2afb582d7af1ca'
  OR replace(new_definition,new_body,old_body) IS DISTINCT FROM old_definition THEN
  RAISE EXCEPTION 'utilts_correction_metadata_or_inverse_conflict' USING ERRCODE='P0U01'; END IF;
END
$migration$;
