-- The Supabase CLI records this migration in the same transaction as this block.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN

DO $guard$
DECLARE p record;
BEGIN
 SELECT proowner,prosecdef,prosrc INTO p FROM pg_proc
  WHERE oid=to_regprocedure('public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM true
   OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'd0bafd57804b2fb416927807856590fba46d92fa7d322e1a9a2afb582d7af1ca' THEN
   RAISE EXCEPTION 'rad48_predecessor_unrecognized';
 END IF;
END
$guard$;

CREATE TABLE gridex_utilts_binding.metering_application_receipts (
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  source_message_id uuid NOT NULL,
  transaction_id text NOT NULL,
  observation_ordinal integer NOT NULL CHECK (observation_ordinal >= 0),
  contract_hash bytea NOT NULL,
  value_id uuid NOT NULL,
  normalized_id uuid NOT NULL,
  source_link_id uuid NOT NULL,
  value_hash bytea NOT NULL,
  normalized_hash bytea NOT NULL,
  PRIMARY KEY (company_id, environment, source_message_id, transaction_id, observation_ordinal)
);
REVOKE ALL ON gridex_utilts_binding.metering_application_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION gridex_utilts_binding.application_value_hash_v1(m public.metering_values) RETURNS bytea
LANGUAGE sql STABLE SET search_path = 'pg_catalog' SET "TimeZone" TO 'UTC'
AS $$ SELECT sha256(convert_to((
  SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(m)) WHERE key = ANY(ARRAY[
    'id','company_id','customer_id','site_id','customer_site_id','metering_point_id','grid_owner_id','source_request_id',
    'source_ediel_message_id','source_transaction_id','source_transaction_reference','source_line_reference','source_system',
    'price_area','resolution','value_kwh','quality_code','reading_type','period_start','period_end','read_at','register_code',
    'product_code','direction','unit','canonical_dedupe_key','previous_value_id','revision_number'
  ]))::text,'UTF8')) $$;

CREATE FUNCTION gridex_utilts_binding.application_normalized_hash_v1(n public.normalized_metering_values) RETURNS bytea
LANGUAGE sql STABLE SET search_path = 'pg_catalog' SET "TimeZone" TO 'UTC'
AS $$ SELECT sha256(convert_to((
  SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(n)) WHERE key = ANY(ARRAY[
    'id','company_id','customer_id','site_id','customer_site_id','metering_point_id',
    'source_metering_value_id','source_message_id','source_transaction_reference','source_line_reference','source_type',
    'facility_id','price_area','grid_area','resolution','quantity_kwh','quality_status','period_start','period_end',
    'register_code','product_code','direction','unit','canonical_dedupe_key','previous_value_id','revision_number'
  ]))::text,'UTF8')) $$;

CREATE FUNCTION gridex_utilts_binding.record_metering_application_v1(
  m public.metering_values, contract jsonb, observation_ordinal integer, source_id uuid
) RETURNS void LANGUAGE plpgsql SET search_path = 'pg_catalog' AS $fn$
DECLARE
  l public.metering_value_sources;
  n public.normalized_metering_values;
  proposed gridex_utilts_binding.metering_application_receipts;
  saved gridex_utilts_binding.metering_application_receipts;
BEGIN
  SELECT * INTO STRICT l FROM public.metering_value_sources
   WHERE company_id=m.company_id AND metering_value_id=m.id AND source_ediel_message_id=source_id
    AND source_transaction_reference=contract->>'transactionId'
    AND source_line_reference IS NOT DISTINCT FROM (contract->'observations'->observation_ordinal->>'sourceLineReference') FOR SHARE;
  SELECT * INTO STRICT n FROM public.normalized_metering_values
   WHERE company_id=m.company_id AND id=l.normalized_metering_value_id AND source_metering_value_id=m.id
    AND revision_status='current' FOR UPDATE;
  proposed := ROW(m.company_id,contract->>'environment',source_id,contract->>'transactionId',observation_ordinal,
     sha256(convert_to(contract::text,'UTF8')),m.id,n.id,l.id,
     gridex_utilts_binding.application_value_hash_v1(m),gridex_utilts_binding.application_normalized_hash_v1(n));
  INSERT INTO gridex_utilts_binding.metering_application_receipts SELECT proposed.*
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT saved FROM gridex_utilts_binding.metering_application_receipts r
      WHERE (r.company_id,r.environment,r.source_message_id,r.transaction_id,r.observation_ordinal)
         = (proposed.company_id,proposed.environment,proposed.source_message_id,proposed.transaction_id,proposed.observation_ordinal);
    IF saved IS DISTINCT FROM proposed THEN
      RAISE EXCEPTION 'utilts_consumption_application_receipt_conflict' USING ERRCODE='P0U01';
    END IF;
  END IF;
END
$fn$;

CREATE FUNCTION gridex_utilts_binding.replay_metering_application_v1(
  company uuid, source_id uuid, contract jsonb, ordinal integer, dedupe text
) RETURNS public.metering_values LANGUAGE plpgsql SET search_path = 'pg_catalog' AS $fn$
DECLARE
  saved gridex_utilts_binding.metering_application_receipts;
  locked gridex_utilts_binding.metering_application_receipts;
  original public.metering_values;
  next_row public.metering_values;
  current_row public.metering_values;
  n public.normalized_metering_values;
  seen uuid[];
BEGIN
  SELECT * INTO saved FROM gridex_utilts_binding.metering_application_receipts r
    WHERE (r.company_id,r.environment,r.source_message_id,r.transaction_id,r.observation_ordinal)
       = (company,contract->>'environment',source_id,contract->>'transactionId',ordinal);
  IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_stale_version' USING ERRCODE='P0U01'; END IF;
  SELECT * INTO original FROM public.metering_values m WHERE m.id=saved.value_id AND m.company_id=company FOR UPDATE;
  SELECT * INTO n FROM public.normalized_metering_values n1
    WHERE n1.id=saved.normalized_id AND n1.company_id=company AND n1.source_metering_value_id=original.id FOR UPDATE;
  PERFORM FROM public.metering_value_sources l WHERE l.id=saved.source_link_id AND l.company_id=company
   AND l.source_ediel_message_id=source_id AND l.metering_value_id=original.id AND l.normalized_metering_value_id=n.id
   AND l.source_transaction_reference=saved.transaction_id
   AND l.source_line_reference IS NOT DISTINCT FROM (contract->'observations'->ordinal->>'sourceLineReference') FOR SHARE;
  IF NOT FOUND OR saved.contract_hash IS DISTINCT FROM sha256(convert_to(contract::text,'UTF8'))
     OR original.canonical_dedupe_key IS DISTINCT FROM dedupe
     OR saved.value_hash IS DISTINCT FROM gridex_utilts_binding.application_value_hash_v1(original)
     OR saved.normalized_hash IS DISTINCT FROM gridex_utilts_binding.application_normalized_hash_v1(n) THEN
    RAISE EXCEPTION 'utilts_consumption_application_receipt_conflict' USING ERRCODE='P0U01';
  END IF;

  IF original.is_current THEN
    -- A successor series may already exist while the original remains the last
    -- materially applied amount. Do not acknowledge the older call until replacement.
    RAISE EXCEPTION 'utilts_consumption_stale_version' USING ERRCODE='P0U01';
  END IF;
  IF original.revision_status IS DISTINCT FROM 'replaced'
     OR n.revision_status IS DISTINCT FROM 'replaced'
     OR n.replaced_by_value_id IS DISTINCT FROM original.replaced_by_value_id THEN
    RAISE EXCEPTION 'utilts_consumption_application_lineage_invalid' USING ERRCODE='P0U01';
  END IF;
  current_row := original;
  seen := ARRAY[original.id];
  LOOP
    SELECT * INTO next_row FROM public.metering_values m WHERE m.id=current_row.replaced_by_value_id
      AND m.company_id=company AND m.canonical_dedupe_key=dedupe
      AND m.previous_value_id=current_row.id AND m.revision_number=current_row.revision_number+1 FOR SHARE;
    IF NOT FOUND OR next_row.id=ANY(seen) OR cardinality(seen)>=1024
       OR NOT EXISTS (SELECT FROM public.ediel_messages e WHERE e.id=next_row.source_ediel_message_id
          AND e.company_id=company AND e.environment=saved.environment)
       OR NOT EXISTS (SELECT FROM gridex_utilts_binding.metering_application_receipts successor
         WHERE successor.company_id=company AND successor.environment=saved.environment
           AND successor.value_id=next_row.id AND successor.source_message_id=next_row.source_ediel_message_id
           AND successor.value_hash=gridex_utilts_binding.application_value_hash_v1(next_row)) THEN
      RAISE EXCEPTION 'utilts_consumption_application_lineage_invalid' USING ERRCODE='P0U01';
    END IF;
    EXIT WHEN next_row.is_current AND next_row.revision_status='current';
    IF next_row.revision_status IS DISTINCT FROM 'replaced' OR next_row.is_current THEN
      RAISE EXCEPTION 'utilts_consumption_application_lineage_invalid' USING ERRCODE='P0U01';
    END IF;
    seen := array_append(seen,next_row.id);
    current_row := next_row;
  END LOOP;

  SELECT * INTO locked FROM gridex_utilts_binding.metering_application_receipts r
    WHERE (r.company_id,r.environment,r.source_message_id,r.transaction_id,r.observation_ordinal)
       = (saved.company_id,saved.environment,saved.source_message_id,saved.transaction_id,saved.observation_ordinal) FOR SHARE;
  IF locked IS DISTINCT FROM saved THEN
     RAISE EXCEPTION 'utilts_consumption_application_receipt_conflict' USING ERRCODE='P0U01';
  END IF;
  RETURN original;
END
$fn$;

REVOKE ALL ON FUNCTION gridex_utilts_binding.application_value_hash_v1(public.metering_values),
  gridex_utilts_binding.application_normalized_hash_v1(public.normalized_metering_values),
  gridex_utilts_binding.record_metering_application_v1(public.metering_values,jsonb,integer,uuid),
  gridex_utilts_binding.replay_metering_application_v1(uuid,uuid,jsonb,integer,text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gridex_consume_utilts_metering_v1(p_company_id uuid, p_source_message_id uuid, p_transaction_id text, p_observation_ordinal integer, p_actor_id uuid, p_expected_contract jsonb) RETURNS public.metering_values
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE v_contract jsonb; v_attribution jsonb; v_observation jsonb; v_key text; v_payload jsonb; v_result public.metering_values%rowtype;
 -- SC046 authentic newer correction declarations.
 sc046_own public.meter_reading_series%rowtype; sc046_pre public.meter_reading_series%rowtype;
 sc046_old public.meter_reading_series%rowtype; sc046_hop public.meter_reading_series%rowtype;
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
 RETURN v_result;
END $$;
CREATE FUNCTION public.gridex_sync_current_e66_request_v1(
  p_company_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_source_message_id uuid,
  p_meter_value_ids uuid[],
  p_response_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source public.ediel_messages%ROWTYPE;
  owner_request public.grid_owner_data_requests%ROWTYPE;
  outbound public.outbound_requests%ROWTYPE;
  billing_id uuid;
  outbound_context jsonb := jsonb_build_object('outboundRequestId',NULL);
  presented uuid;
  bound_rows integer;
  current_rows integer;
  qualified_current_rows integer;
  written_at timestamptz;
  latest_response jsonb;
  request_reference text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR p_company_id IS NULL OR p_request_id IS NULL
    OR p_actor_id IS NULL OR p_source_message_id IS NULL THEN
    RAISE EXCEPTION 'e66_current_request_service_scope_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_response_patch) IS DISTINCT FROM 'object'
    OR p_response_patch->>'edielMessageId' IS DISTINCT FROM p_source_message_id::text
    OR NOT coalesce(cardinality(p_meter_value_ids) > 0, false)
    OR EXISTS (SELECT FROM unnest(p_meter_value_ids) AS input(id) WHERE id IS NULL)
    OR cardinality(p_meter_value_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_meter_value_ids) AS input(id)) THEN
    RAISE EXCEPTION 'e66_current_request_input_invalid' USING ERRCODE = '22023';
  END IF;
  presented := (p_response_patch->>'ingestedMeterValueId')::uuid;
  IF NOT coalesce(presented = ANY(p_meter_value_ids), false)
    OR jsonb_typeof(p_response_patch->'ingestedMeterValueIds') IS DISTINCT FROM 'array'
    OR p_response_patch->'ingestedMeterValueIds' IS DISTINCT FROM to_jsonb(p_meter_value_ids) THEN
    RAISE EXCEPTION 'e66_current_request_observation_payload_mismatch' USING ERRCODE = '22023';
  END IF;

  -- The original writer takes the storage graph before source and attribution.
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  SELECT * INTO source FROM public.ediel_messages e
  WHERE e.company_id = p_company_id AND e.id = p_source_message_id
    AND e.direction = 'inbound' AND e.message_family = 'UTILTS' AND e.message_code = 'E66'
    AND e.grid_owner_data_request_id = p_request_id
  FOR SHARE NOWAIT;
  IF NOT FOUND OR public.gridex_actor_has_company_permission(p_actor_id,p_company_id,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_current_request_bound_actor_required' USING ERRCODE = '42501';
  END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);
  -- Keep the ordinary outbound-before-request order when both exist.
  SELECT * INTO outbound FROM public.outbound_requests o
  WHERE o.company_id = p_company_id AND o.source_type = 'grid_owner_data_request'
    AND o.source_id = p_request_id AND o.request_type IN ('meter_values','billing_underlay')
    AND o.customer_id = source.customer_id AND o.site_id IS NOT DISTINCT FROM source.site_id
    AND o.metering_point_id IS NOT DISTINCT FROM source.metering_point_id
    AND o.status IN ('queued','prepared','sent','acknowledged')
    AND (o.payload->>'environment' = source.environment
      OR (o.payload->>'environment' IS NULL AND o.id = source.outbound_request_id))
  ORDER BY (o.id = source.outbound_request_id) DESC NULLS LAST,
    (o.request_type = 'meter_values') DESC, o.created_at DESC, o.id DESC
  LIMIT 1 FOR UPDATE NOWAIT;
  SELECT * INTO owner_request FROM public.grid_owner_data_requests r
  WHERE r.id = p_request_id AND r.company_id = p_company_id
    AND r.customer_id = source.customer_id
    AND r.site_id IS NOT DISTINCT FROM source.site_id
    AND r.metering_point_id IS NOT DISTINCT FROM source.metering_point_id
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'e66_current_request_source_ownership_required' USING ERRCODE = '42501';
  END IF;
  IF owner_request.status = 'cancelled' THEN RETURN jsonb_build_object('status','cancelled'); END IF;

  PERFORM m.id FROM public.metering_values m
    WHERE m.company_id = p_company_id AND m.id = ANY(p_meter_value_ids)
    ORDER BY m.id FOR SHARE NOWAIT;

  PERFORM n.id FROM public.normalized_metering_values n
    JOIN gridex_utilts_binding.metering_application_receipts r ON r.normalized_id = n.id
    WHERE n.company_id = p_company_id AND r.company_id = n.company_id
      AND r.source_message_id = source.id AND r.value_id = ANY(p_meter_value_ids)
    ORDER BY n.id FOR SHARE OF n NOWAIT;

  SELECT count(DISTINCT m.id) FILTER (WHERE m.id = ANY(p_meter_value_ids)),
    count(DISTINCT m.id) FILTER (WHERE m.id = ANY(p_meter_value_ids)
      AND m.is_current AND m.revision_status = 'current'
      AND n.revision_status = 'current' AND h.is_current),
    count(DISTINCT m.id) FILTER (WHERE m.is_current AND m.revision_status = 'current'
      AND n.revision_status = 'current' AND h.is_current)
  INTO bound_rows,current_rows,qualified_current_rows
  FROM public.metering_values m
  JOIN gridex_utilts_binding.metering_application_receipts r ON r.value_id = m.id
   AND r.company_id = m.company_id AND r.source_message_id = source.id AND r.environment = source.environment
  JOIN public.metering_value_sources x ON x.id = r.source_link_id AND x.company_id = r.company_id
   AND x.metering_value_id = m.id AND x.source_ediel_message_id = source.id
   AND x.normalized_metering_value_id = r.normalized_id AND x.source_transaction_reference = r.transaction_id
  JOIN public.normalized_metering_values n ON n.company_id = m.company_id AND n.id = r.normalized_id
   AND n.source_metering_value_id = m.id
  JOIN public.ediel_ack_transaction_results a ON a.company_id = m.company_id
   AND a.source_message_id = source.id AND a.source_transaction_id = r.transaction_id AND a.environment = source.environment
  JOIN public.meter_reading_series h ON h.id = a.persisted_series_id AND h.company_id = m.company_id
  JOIN gridex_utilts_binding.contracts c ON c.series_id = h.id AND c.company_id = m.company_id
    AND c.source_message_id = source.id AND c.transaction_id = r.transaction_id AND c.environment = source.environment
    AND decode(c.contract_hash,'hex') = r.contract_hash
  WHERE m.company_id = p_company_id
    AND m.source_request_id = p_request_id AND m.metering_point_id = owner_request.metering_point_id
    AND a.disposition = 'accepted' AND a.persistence_status = 'persisted';
  IF bound_rows <> cardinality(p_meter_value_ids) THEN
    RAISE EXCEPTION 'e66_current_request_exact_receipt_required' USING ERRCODE = '23514';
  END IF;
  IF current_rows <> bound_rows THEN RETURN jsonb_build_object('status','replaced'); END IF;
  IF qualified_current_rows <> current_rows THEN
    RAISE EXCEPTION 'e66_current_request_receipt_set_changed' USING ERRCODE = '23514';
  END IF;

  -- Under the storage-graph lock, the persisted canonical contract is the
  -- producer's expected ordinal set; application receipts are its completion.
  IF EXISTS (
    SELECT
    FROM public.ediel_ack_transaction_results a
    JOIN public.meter_reading_series h ON h.id=a.persisted_series_id AND h.company_id=a.company_id
      AND h.source_ediel_message_id=source.id AND h.is_current
    JOIN gridex_utilts_binding.contracts c ON c.series_id=h.id AND c.company_id=a.company_id
      AND c.environment=a.environment AND c.source_message_id=a.source_message_id
      AND c.transaction_id=a.source_transaction_id
    CROSS JOIN LATERAL jsonb_array_elements(c.contract->'observations') WITH ORDINALITY AS expected(obs,slot)
    WHERE a.company_id=p_company_id AND a.source_message_id=source.id AND a.environment=source.environment
      AND a.disposition='accepted' AND a.persistence_status='persisted'
      AND a.planned_response_type='positive_aperak'
      AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
      AND c.contract#>>'{metering,capability}'='write'
      AND c.contract#>>'{metering,sourceRequestId}'=p_request_id::text
      AND c.contract#>>'{metering,customerId}'=owner_request.customer_id::text
      AND (c.contract#>>'{metering,siteId}') IS NOT DISTINCT FROM owner_request.site_id::text
      AND c.contract#>>'{metering,meteringPointId}'=owner_request.metering_point_id::text
      AND NOT EXISTS (
        SELECT FROM gridex_utilts_binding.metering_application_receipts r
        WHERE r.company_id=c.company_id AND r.environment=c.environment AND r.source_message_id=c.source_message_id
          AND r.transaction_id=c.transaction_id AND r.observation_ordinal=expected.slot-1
          AND r.contract_hash=decode(c.contract_hash,'hex') AND r.value_id=ANY(p_meter_value_ids)
      )
  ) THEN
    RAISE EXCEPTION 'e66_current_request_complete_receipt_set_required' USING ERRCODE = '23514';
  END IF;

  billing_id := (p_response_patch->>'billingUnderlayId')::uuid;
  IF billing_id IS NOT NULL THEN
    PERFORM 1 FROM public.billing_underlays b
    WHERE b.id = billing_id AND b.company_id = p_company_id AND b.source_request_id = p_request_id
      AND b.customer_id = owner_request.customer_id AND b.metering_point_id = owner_request.metering_point_id
      AND b.source_system = 'ediel_utilts' AND b.payload->>'edielMessageId' = source.id::text
    FOR SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'e66_current_request_underlay_scope_invalid' USING ERRCODE = '23514'; END IF;
  END IF;

  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);
  IF public.gridex_actor_has_company_permission(p_actor_id,p_company_id,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_current_request_bound_actor_required' USING ERRCODE = '42501';
  END IF;
  written_at := clock_timestamp();
  IF outbound.id IS NOT NULL THEN
    IF outbound.status <> 'acknowledged' OR outbound.response_payload->>'edielMessageId' IS DISTINCT FROM source.id::text THEN
      UPDATE public.outbound_requests SET
        status = 'acknowledged',
        external_reference = coalesce(source.external_reference,outbound.external_reference),
        failure_reason = NULL,
        response_payload = coalesce(outbound.response_payload,'{}'::jsonb) || jsonb_build_object(
          'edielMessageId',source.id,'acknowledgedVia','inbound_utilts',
          'normalizedMeteringPayload',p_response_patch->'normalizedMeteringPayload'),
        acknowledged_at = written_at,
        updated_by = p_actor_id
      WHERE id = outbound.id RETURNING * INTO outbound;
      INSERT INTO public.outbound_dispatch_events
        (company_id,outbound_request_id,event_type,event_status,message,payload,created_by)
      VALUES (p_company_id,outbound.id,'acknowledged','acknowledged','Outbound request uppdaterad till acknowledged.',
        jsonb_build_object('externalReference',outbound.external_reference),p_actor_id);
    END IF;
    outbound_context := jsonb_build_object(
      'outboundRequestId',outbound.id,'outboundStatus',outbound.status,'outboundChannelType',outbound.channel_type,
      'communicationRouteId',outbound.communication_route_id,'acknowledgedVia','inbound_utilts','failureReason',NULL);
  END IF;

  request_reference := coalesce(source.external_reference,owner_request.external_reference,outbound.external_reference);
  latest_response := coalesce(owner_request.response_payload,'{}'::jsonb) || p_response_patch || outbound_context ||
    jsonb_build_object('externalReference',request_reference);
  IF owner_request.status IS DISTINCT FROM 'received' OR owner_request.response_payload IS DISTINCT FROM latest_response
    OR owner_request.external_reference IS DISTINCT FROM request_reference THEN
    UPDATE public.grid_owner_data_requests SET
      status = 'received',
      external_reference = request_reference,
      response_payload = latest_response,
      received_at = written_at,
      last_partner_response_at = written_at,
      failure_reason = NULL,
      updated_by = p_actor_id
    WHERE id = owner_request.id AND company_id = owner_request.company_id;
  END IF;
  RETURN jsonb_build_object('status','received','outboundRequestId',outbound.id);
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_sync_current_e66_request_v1(uuid, uuid, uuid, uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_sync_current_e66_request_v1(uuid, uuid, uuid, uuid, uuid[], jsonb) TO service_role;

END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
