-- Created with Supabase CLI 2.101.0: migration new ediel_utilts_consumer_content_identity.
-- R1/R3: independently bind reusable business content and original identity.
BEGIN;

CREATE FUNCTION gridex_utilts_binding.supported_point_v1(tokens jsonb, transaction_id text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE first_ide integer; start_at integer; stop_at integer; point jsonb; party jsonb; role_name text;
BEGIN
 SELECT min((t->>'index')::integer) INTO first_ide FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE';
 FOREACH role_name IN ARRAY ARRAY['MS','MR'] LOOP
  SELECT jsonb_agg(t) INTO party FROM jsonb_array_elements(tokens) t
   WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=role_name AND (t->>'index')::integer<first_ide;
  IF jsonb_array_length(party) IS DISTINCT FROM 1 OR party#>'{0,elements,1}' IS DISTINCT FROM jsonb_build_array(role_name)
   OR jsonb_array_length(party#>'{0,elements,2}') IS DISTINCT FROM 3
   OR nullif(btrim(party#>>'{0,elements,2,0}'),'') IS NULL
   OR party#>>'{0,elements,2,0}' IS DISTINCT FROM btrim(party#>>'{0,elements,2,0}')
   OR party#>>'{0,elements,2,1}' IS DISTINCT FROM 'SVK' OR party#>>'{0,elements,2,2}' IS DISTINCT FROM '260' THEN RETURN NULL; END IF;
 END LOOP;
 SELECT jsonb_agg(t) INTO point FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=transaction_id;
 IF jsonb_array_length(point) IS DISTINCT FROM 1 OR point#>'{0,elements,1}' IS DISTINCT FROM '["24"]'::jsonb
  OR point#>'{0,elements,2}' IS DISTINCT FROM jsonb_build_array(transaction_id) THEN RETURN NULL; END IF;
 start_at:=(point#>>'{0,index}')::integer;
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t
  WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','SEQ','UNT');
 SELECT jsonb_agg(t) INTO point FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LOC' AND t#>>'{elements,1,0}'='172'
  AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 IF jsonb_array_length(point) IS DISTINCT FROM 1 OR point#>'{0,elements,1}' IS DISTINCT FROM '["172"]'::jsonb
  OR jsonb_array_length(point#>'{0,elements,2}') IS DISTINCT FROM 3
  OR point#>>'{0,elements,2,1}' IS DISTINCT FROM '' OR point#>>'{0,elements,2,2}' IS DISTINCT FROM '9'
  OR nullif(btrim(point#>>'{0,elements,2,0}'),'') IS NULL
  OR point#>>'{0,elements,2,0}' IS DISTINCT FROM btrim(point#>>'{0,elements,2,0}')
  OR point#>>'{0,elements,2,0}' ~ '[[:cntrl:]]' THEN RETURN NULL; END IF;
 RETURN point#>>'{0,elements,2,0}';
END $$;

CREATE OR REPLACE FUNCTION public.gridex_persist_utilts_consumption_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_raw_payload text,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE
 source public.ediel_messages%rowtype; receipt gridex_utilts_binding.receipts%rowtype;
 stored gridex_utilts_binding.contracts%rowtype; series public.meter_reading_series%rowtype;
 tokens jsonb; membership jsonb; expected jsonb; raw_hash text; item jsonb; c jsonb; r jsonb; results jsonb; answer jsonb:='[]';
 v_series_id uuid; identity text; contract_hash text; origin gridex_utilts_binding.receipts%rowtype;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_message_code IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)=0 THEN
  RAISE EXCEPTION 'utilts_consumption_input_invalid' USING ERRCODE='P0U01';
 END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF NOT FOUND OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
 OR p_raw_payload IS NULL OR source.raw_payload IS DISTINCT FROM p_raw_payload THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 raw_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL THEN RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 -- This owner deliberately does not reinterpret multiple physical messages.
 IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='UTILTS')
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'=p_message_code) THEN
  RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT coalesce(jsonb_agg(coalesce(nullif(t#>>'{elements,2,0}',''),'transaction-'||ordinal::text) ORDER BY ordinal),'["transaction-1"]') INTO membership
 FROM (SELECT t,row_number() OVER(ORDER BY (t->>'index')::integer) ordinal FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE' AND t#>>'{elements,1,0}'='24') physical;
 SELECT jsonb_agg(t->'transactionId' ORDER BY ordinal) INTO expected FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
 IF membership IS DISTINCT FROM expected OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(membership))<>jsonb_array_length(membership) THEN
  RAISE EXCEPTION 'utilts_physical_membership_conflict' USING ERRCODE='P0U01'; END IF;
 -- Namespace validation precedes receipt/ACK/series writes, independently of
 -- application comparison exemptions and mutable plain-ID matches.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(gridex_utilts_binding.validate_contract_v1(c),false) THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
  IF item->>'disposition'='accepted' AND (p_message_code IN ('E30','E66','S07') OR jsonb_array_length(c->'observations')>0) THEN
   identity:=gridex_utilts_binding.supported_point_v1(tokens,item->>'transactionId');
   IF identity IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(c->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM identity) THEN
    RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
  END IF;
 END LOOP;
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=p_source_message_id;
 IF NOT FOUND THEN
  IF EXISTS(SELECT FROM public.ediel_ack_transaction_results WHERE source_message_id=p_source_message_id)
  OR EXISTS(SELECT FROM public.meter_reading_series WHERE source_ediel_message_id=p_source_message_id) THEN
   RAISE EXCEPTION 'utilts_historical_binding_unavailable' USING ERRCODE='P0U01'; END IF;
  INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version)
   VALUES(p_source_message_id,p_company_id,p_environment,p_message_code,raw_hash,gridex_utilts_binding.source_context_v1(source),membership,1) RETURNING * INTO receipt;
 ELSIF receipt.raw_hash IS DISTINCT FROM raw_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source) OR receipt.membership IS DISTINCT FROM membership THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';
 END IF;
 -- Acquire all locks before insertion, in stable order (including the private
 -- insertion core's logical-series lock) to avoid opposite-order batch deadlocks.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) ORDER BY value->>'transactionId' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|'||p_environment||'|'||p_source_message_id::text||'|'||(item->>'transactionId'),0));
 END LOOP;
 FOR identity IN SELECT DISTINCT concat_ws('|',p_company_id::text,p_environment,coalesce(t->>'seriesKind','actual'),p_message_code,coalesce(t->>'externalMeteringPointId',''),coalesce(t->>'gridAreaId',''),coalesce(t->>'periodStart',''),coalesce(t->>'periodEnd',''),coalesce(t->>'resolution','UNKNOWN'),coalesce(t->>'productId','')) FROM jsonb_array_elements(p_transactions) t ORDER BY 1 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(identity,0));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(gridex_utilts_binding.validate_contract_v1(c),false) OR c->>'companyId' IS DISTINCT FROM p_company_id::text OR c->>'environment' IS DISTINCT FROM p_environment
   OR c->>'messageCode' IS DISTINCT FROM p_message_code OR c->>'transactionId' IS DISTINCT FROM item->>'transactionId' OR c->>'seriesKind' IS DISTINCT FROM item->>'seriesKind' THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 results:=gridex_utilts_binding.persist_series_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_transactions);
 FOR r IN SELECT value FROM jsonb_array_elements(results) LOOP
  SELECT value INTO STRICT item FROM jsonb_array_elements(p_transactions) WHERE value->>'transactionId'=r->>'transactionId';
  c:=item->'consumptionContract';
  IF r->>'persistenceStatus'='persisted' THEN
   v_series_id:=(r->>'seriesId')::uuid;
   SELECT * INTO series FROM public.meter_reading_series WHERE id=v_series_id AND company_id=p_company_id FOR SHARE;
   IF NOT FOUND OR series.message_code IS DISTINCT FROM p_message_code OR series.source_transaction_reference IS DISTINCT FROM item->>'transactionId'
    OR jsonb_typeof(series.raw_transaction) IS DISTINCT FROM 'object' OR series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(series.raw_transaction::text,'UTF8'),'sha256'),'hex')
    OR series.raw_transaction IS DISTINCT FROM item THEN RAISE EXCEPTION 'utilts_consumption_raw_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO origin FROM gridex_utilts_binding.receipts WHERE source_message_id=series.source_ediel_message_id;
   IF NOT FOUND OR origin.company_id<>p_company_id OR origin.environment<>p_environment OR origin.message_code<>p_message_code THEN RAISE EXCEPTION 'utilts_consumption_origin_conflict' USING ERRCODE='P0U01'; END IF;
   SELECT * INTO stored FROM gridex_utilts_binding.contracts WHERE contracts.series_id=v_series_id;
   IF NOT FOUND THEN
    IF coalesce((r->>'idempotentReplay')::boolean,true) THEN RAISE EXCEPTION 'utilts_historical_contract_unavailable' USING ERRCODE='P0U01'; END IF;
    INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash)
     VALUES(v_series_id,p_company_id,p_environment,p_source_message_id,item->>'transactionId',1,c,encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex')) RETURNING * INTO stored;
   END IF;
   contract_hash:=encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex');
   IF stored.company_id<>p_company_id OR stored.environment<>p_environment OR stored.transaction_id<>item->>'transactionId' OR stored.contract_version<>1
    OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false) OR stored.contract_hash IS DISTINCT FROM contract_hash OR stored.contract IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
   r:=r||jsonb_build_object('contractVersion',stored.contract_version,'contractHash',stored.contract_hash,'consumptionContract',stored.contract);
  END IF;
  answer:=answer||jsonb_build_array(r||jsonb_build_object('sourceBinding',jsonb_build_object('sourceMessageId',receipt.source_message_id,'rawHash',receipt.raw_hash,'boundAt',receipt.bound_at)));
 END LOOP;
 RETURN answer;
END $$;

-- No successful unbound alternative remains, even for an old service caller.

CREATE OR REPLACE FUNCTION gridex_utilts_binding.stored_contract_v1(p_company uuid,p_source uuid,p_transaction text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_source public.ediel_messages%rowtype; v_receipt gridex_utilts_binding.receipts%rowtype;
 v_ack public.ediel_ack_transaction_results%rowtype; v_series public.meter_reading_series%rowtype;
 v_contract gridex_utilts_binding.contracts%rowtype; v_point text;
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
 -- Pre-forward receipts are not a namespace approval either. All sinks use
 -- this check, including direct calls with an already committed contract.
 v_point:=gridex_utilts_binding.supported_point_v1(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),p_transaction);
 IF v_point IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(v_contract.contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM v_point) THEN
  RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
 RETURN v_contract.contract;
END $$;

-- FOR SHARE blocks non-key ownership changes too; KEY SHARE would be weaker.
-- Both sinks use the same lock order: customer, sites, point, grid owner, request.

-- Source IDs, transaction references and audit/workflow columns are lineage,
-- not reusable observation content. They are intentionally not equated.
CREATE FUNCTION gridex_utilts_binding.check_metering_result_v1(p_result public.metering_values,p_payload jsonb,p_environment text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE m jsonb:=to_jsonb(p_result); n public.normalized_metering_values%rowtype; field text; normalized jsonb; count_rows integer:=0;
BEGIN
 FOREACH field IN ARRAY string_to_array('company_id customer_id site_id customer_site_id metering_point_id grid_owner_id source_request_id reading_type resolution quality_code register_code product_code direction unit source_system price_area canonical_dedupe_key',' ') LOOP
  IF m->>field IS DISTINCT FROM p_payload->>field THEN RAISE EXCEPTION 'utilts_consumption_existing_metering_conflict' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 IF p_result.value_kwh IS DISTINCT FROM (p_payload->>'value_kwh')::numeric
  OR p_result.read_at IS DISTINCT FROM (p_payload->>'read_at')::timestamptz
  OR p_result.period_start IS DISTINCT FROM (p_payload->>'period_start')::timestamptz
  OR p_result.period_end IS DISTINCT FROM (p_payload->>'period_end')::timestamptz THEN
  RAISE EXCEPTION 'utilts_consumption_existing_metering_conflict' USING ERRCODE='P0U01'; END IF;
 -- The natural key has no environment: prove it from each original lineage.
 IF NOT EXISTS(SELECT FROM public.ediel_messages s WHERE s.id=p_result.source_ediel_message_id AND s.company_id=p_result.company_id AND s.environment=p_environment)
  OR EXISTS(SELECT FROM public.metering_value_sources l LEFT JOIN public.ediel_messages s ON s.id=l.source_ediel_message_id AND s.company_id=l.company_id
   WHERE l.company_id=p_result.company_id AND l.metering_value_id=p_result.id AND s.environment IS DISTINCT FROM p_environment) THEN
  RAISE EXCEPTION 'utilts_consumption_existing_metering_environment_conflict' USING ERRCODE='P0U01'; END IF;
 FOR n IN SELECT v.* FROM public.normalized_metering_values v WHERE v.company_id=p_result.company_id
  AND v.source_metering_value_id=p_result.id AND v.revision_status='current' FOR UPDATE LOOP
  count_rows:=count_rows+1; normalized:=to_jsonb(n);
  FOREACH field IN ARRAY string_to_array('company_id customer_id site_id customer_site_id metering_point_id facility_id price_area grid_area resolution register_code product_code direction unit canonical_dedupe_key',' ') LOOP
   IF normalized->>field IS DISTINCT FROM p_payload->>field THEN RAISE EXCEPTION 'utilts_consumption_existing_normalized_conflict' USING ERRCODE='P0U01'; END IF;
  END LOOP;
  IF n.quantity_kwh IS DISTINCT FROM (p_payload->>'value_kwh')::numeric OR n.quality_status IS DISTINCT FROM p_payload->>'quality_code'
   OR n.source_type IS DISTINCT FROM p_payload->>'source_system' OR n.period_start IS DISTINCT FROM (p_payload->>'period_start')::timestamptz
   OR n.period_end IS DISTINCT FROM (p_payload->>'period_end')::timestamptz THEN
   RAISE EXCEPTION 'utilts_consumption_existing_normalized_conflict' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 IF count_rows<>1 THEN RAISE EXCEPTION 'utilts_consumption_existing_normalized_ambiguous' USING ERRCODE='P0U01'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gridex_consume_utilts_metering_v1(p_company_id uuid,p_source_message_id uuid,p_transaction_id text,p_observation_ordinal integer,p_actor_id uuid,p_expected_contract jsonb)
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

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_utilts_binding FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb) TO service_role;
COMMIT;
