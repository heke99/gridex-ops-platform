-- Created with Supabase CLI 2.118.0: migration new ediel_utilts_exact_decimal_contract_v2.
-- U09: prospective exact logical decimals. Public RPC signatures remain stable.
-- Authentic existing V1 source-bound retries retain their immutable content;
-- no UPDATE of receipts/contracts/ACK outcomes or precision upgrade is performed.
BEGIN;
ALTER TABLE gridex_utilts_binding.receipts DROP CONSTRAINT receipts_contract_version_check;
ALTER TABLE gridex_utilts_binding.receipts ADD CONSTRAINT receipts_contract_version_check CHECK(contract_version IN (1,2));
ALTER TABLE gridex_utilts_binding.contracts DROP CONSTRAINT contracts_contract_version_check;
ALTER TABLE gridex_utilts_binding.contracts ADD CONSTRAINT contracts_contract_version_check CHECK(contract_version IN (1,2));

ALTER FUNCTION gridex_utilts_binding.validate_contract_v1(jsonb) RENAME TO validate_legacy_contract_v1;
CREATE FUNCTION gridex_utilts_binding.canonical_decimal_v2(value text, decimal_mark text DEFAULT '.') RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF value IS NULL OR decimal_mark NOT IN ('.',',') OR
  value !~ (CASE WHEN decimal_mark=',' THEN '^-?[0-9]+(,[0-9]+)?$' ELSE '^-?[0-9]+(\.[0-9]+)?$' END) THEN RETURN NULL; END IF;
 RETURN trim_scale(replace(value,decimal_mark,'.')::numeric)::text;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION gridex_utilts_binding.validate_contract_v1(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE o jsonb; observations jsonb:='[]'; projected jsonb;
BEGIN
 IF c->'version'='1'::jsonb THEN RETURN gridex_utilts_binding.validate_legacy_contract_v1(c); END IF;
 IF c->'version' IS DISTINCT FROM '2'::jsonb OR c->>'projectionVersion' IS DISTINCT FROM 'utilts-consumption-v2'
  OR jsonb_typeof(c->'observations') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR o IN SELECT value FROM jsonb_array_elements(c->'observations') LOOP
  IF jsonb_typeof(o->'quantity') IS DISTINCT FROM 'string'
   OR gridex_utilts_binding.canonical_decimal_v2(o->>'quantity') IS DISTINCT FROM o->>'quantity' THEN RETURN false; END IF;
  -- Reuse the strict frozen V1 shape/time/attribution predicates with an exact
  -- numeric JSON projection. This is validation only, never stored V2 content.
  observations:=observations||jsonb_build_array(o||jsonb_build_object('quantity',(o->>'quantity')::numeric));
 END LOOP;
 projected:=c||jsonb_build_object('version',1,'projectionVersion','utilts-consumption-v1','observations',observations);
 RETURN gridex_utilts_binding.validate_legacy_contract_v1(projected);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION gridex_utilts_binding.validate_decimal_source_v2(tokens jsonb,item jsonb,decimal_mark text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE start_at integer; stop_at integer; first_sequence integer; sequence_at integer; next_sequence integer;
 quantities jsonb; source_quantity jsonb; supplied jsonb; o jsonb; ordinal integer; unit text; own_mea jsonb; scale numeric;
BEGIN
 IF item->>'disposition'<>'accepted' THEN RETURN true; END IF;
 SELECT (t->>'index')::integer INTO STRICT start_at FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=item->>'transactionId';
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t
  WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','UNT');
 SELECT coalesce(min((t->>'index')::integer),stop_at) INTO first_sequence FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='SEQ' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 SELECT jsonb_agg(t) INTO own_mea FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='MEA'
  AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_sequence;
 IF own_mea IS NOT NULL THEN
  IF jsonb_array_length(own_mea) IS DISTINCT FROM 1 OR own_mea#>>'{0,elements,1,0}' IS DISTINCT FROM 'AAZ' THEN RETURN false; END IF;
  unit:=own_mea#>>'{0,elements,3,0}';
  IF nullif(unit,'') IS NULL THEN RETURN false; END IF;
 END IF;
 -- A source-only request, dated E30 reading or monetary series may have no
 -- field264. Preserve its exact raw values without inventing a kWh consumer.
 IF unit IS DISTINCT FROM item->>'unit' THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(t ORDER BY (t->>'index')::integer),'[]') INTO quantities FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='QTY' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 IF jsonb_typeof(item->'quantities') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'quantities')<>jsonb_array_length(quantities) THEN RETURN false; END IF;
 FOR ordinal IN 0..jsonb_array_length(quantities)-1 LOOP
  source_quantity:=quantities->ordinal; supplied:=item->'quantities'->ordinal;
  IF supplied->>'qualifier' IS DISTINCT FROM source_quantity#>>'{elements,1,0}'
   OR (nullif(source_quantity#>>'{elements,1,2}','') IS NOT NULL AND source_quantity#>>'{elements,1,2}' IS DISTINCT FROM unit) THEN RETURN false; END IF;
  SELECT max((t->>'index')::integer) INTO sequence_at FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='SEQ'
   AND (t->>'index')::integer>start_at AND (t->>'index')::integer<(source_quantity->>'index')::integer;
  SELECT coalesce(min((t->>'index')::integer),stop_at) INTO next_sequence FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='SEQ'
   AND (t->>'index')::integer>sequence_at AND (t->>'index')::integer<stop_at;
  IF sequence_at IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='MEA'
   AND (t->>'index')::integer>sequence_at AND (t->>'index')::integer<next_sequence
   AND (t#>>'{elements,1,0}' IS DISTINCT FROM 'AAZ' OR t#>>'{elements,3,0}' IS DISTINCT FROM unit)) THEN RETURN false; END IF;
  IF source_quantity#>>'{elements,1,0}'='220' AND source_quantity#>>'{elements,1,1}'='NULL' THEN
   IF supplied->'value' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  ELSIF jsonb_typeof(supplied->'value') IS DISTINCT FROM 'string'
   OR gridex_utilts_binding.canonical_decimal_v2(source_quantity#>>'{elements,1,1}',decimal_mark) IS DISTINCT FROM supplied->>'value'
   OR gridex_utilts_binding.canonical_decimal_v2(supplied->>'value') IS DISTINCT FROM supplied->>'value' THEN RETURN false; END IF;
 END LOOP;
 FOR o IN SELECT value FROM jsonb_array_elements(item#>'{consumptionContract,observations}') LOOP
  source_quantity:=quantities->((o->>'sourceOrdinal')::integer);
  scale:=CASE unit WHEN 'KWH' THEN 1 WHEN 'MWH' THEN 1000 WHEN 'GWH' THEN 1000000 END;
  IF source_quantity IS NULL OR source_quantity#>>'{elements,1,0}' IS DISTINCT FROM '136'
   OR scale IS NULL OR trim_scale(gridex_utilts_binding.canonical_decimal_v2(source_quantity#>>'{elements,1,1}',decimal_mark)::numeric*scale)::text IS DISTINCT FROM o->>'quantity'
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION gridex_utilts_binding.legacy_retry_item_v1(item jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb:=item->'consumptionContract'; o jsonb; observations jsonb:='[]'; quantities jsonb:='[]';
BEGIN
 IF c->'version'='1'::jsonb THEN RETURN item; END IF;
 FOR o IN SELECT value FROM jsonb_array_elements(c->'observations') LOOP
  observations:=observations||jsonb_build_array(o||jsonb_build_object('quantity',(item->'quantities'->((o->>'sourceOrdinal')::integer)->>'value')::double precision));
 END LOOP;
 FOR o IN SELECT value FROM jsonb_array_elements(item->'quantities') LOOP
  quantities:=quantities||jsonb_build_array(o||jsonb_build_object('value',(o->>'value')::double precision));
 END LOOP;
 RETURN item||jsonb_build_object('quantities',quantities,'consumptionContract',c||
  jsonb_build_object('version',1,'projectionVersion','utilts-consumption-v1','observations',observations));
END $$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.validate_legacy_contract_v1(jsonb),gridex_utilts_binding.validate_contract_v1(jsonb),
 gridex_utilts_binding.canonical_decimal_v2(text,text),gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text),gridex_utilts_binding.legacy_retry_item_v1(jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.gridex_persist_utilts_consumption_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_raw_payload text,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE
 source public.ediel_messages%rowtype; receipt gridex_utilts_binding.receipts%rowtype;
 stored gridex_utilts_binding.contracts%rowtype; series public.meter_reading_series%rowtype;
 tokens jsonb; membership jsonb; expected jsonb; raw_hash text; item jsonb; c jsonb; r jsonb; results jsonb; answer jsonb:='[]';
 v_series_id uuid; identity text; contract_hash text; origin gridex_utilts_binding.receipts%rowtype;
 decimal_mark text; legacy_transactions jsonb;
 own_start integer; own_end integer; sequence_start integer; sequence_end integer; sequence_count integer;
BEGIN
 IF p_company_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_message_code IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)=0 THEN
  RAISE EXCEPTION 'utilts_consumption_input_invalid' USING ERRCODE='P0U01';
 END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF NOT FOUND OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
 OR p_raw_payload IS NULL OR source.raw_payload IS DISTINCT FROM p_raw_payload THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 raw_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 decimal_mark:=CASE WHEN left(source.raw_payload,3)='UNA' THEN substring(source.raw_payload,6,1) ELSE '.' END;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL THEN RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 -- This owner deliberately does not reinterpret multiple physical messages.
 IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='UTILTS')
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM')<>1
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'=p_message_code) THEN
  RAISE EXCEPTION 'utilts_physical_membership_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT coalesce(jsonb_agg(coalesce(nullif(t#>>'{elements,2,0}',''),'transaction-'||ordinal::text) ORDER BY ordinal),'["transaction-1"]') INTO membership
 FROM (SELECT t,row_number() OVER(ORDER BY (t->>'index')::integer) ordinal FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE') physical;
 SELECT jsonb_agg(t->'transactionId' ORDER BY ordinal) INTO expected FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
 IF membership IS DISTINCT FROM expected OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(membership))<>jsonb_array_length(membership) THEN
  RAISE EXCEPTION 'utilts_physical_membership_conflict' USING ERRCODE='P0U01'; END IF;
 -- An invalid physical IDE remains a member so its negative guide outcome can
 -- be bound to this source. It must never create accepted consumption authority.
 IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) x(item)
  JOIN jsonb_array_elements(tokens) t ON t->>'tag'='IDE' AND t#>>'{elements,2,0}'=x.item->>'transactionId'
  WHERE x.item->>'disposition'='accepted' AND t#>>'{elements,1,0}' IS DISTINCT FROM '24') THEN
  RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
 -- Namespace validation precedes receipt/ACK/series writes, independently of
 -- application comparison exemptions and mutable plain-ID matches.
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  c:=item->'consumptionContract';
  IF NOT coalesce(gridex_utilts_binding.validate_contract_v1(c),false) THEN
   RAISE EXCEPTION 'utilts_consumption_contract_invalid' USING ERRCODE='P0U01'; END IF;
  IF c->'version'='2'::jsonb AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(tokens,item,decimal_mark),false) THEN
   RAISE EXCEPTION 'utilts_consumption_decimal_source_conflict' USING ERRCODE='P0U01'; END IF;
  IF item->>'disposition'='accepted' AND (p_message_code IN ('E30','E66','S07','E72','S02') OR jsonb_array_length(c->'observations')>0
   OR (p_message_code IN ('S01','E73') AND NOT gridex_utilts_binding.unowned_regulating_object_v1(tokens,item->>'transactionId'))) THEN
   identity:=gridex_utilts_binding.supported_point_v1(tokens,item->>'transactionId');
   IF identity IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(c->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM identity) THEN
    RAISE EXCEPTION 'utilts_consumption_identity_unsupported' USING ERRCODE='P0U01'; END IF;
  END IF;
  IF item->>'disposition'='accepted' AND p_message_code='S02' THEN
   SELECT (t->>'index')::integer INTO STRICT own_start FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=item->>'transactionId';
   SELECT min((t->>'index')::integer) INTO own_end FROM jsonb_array_elements(tokens) t
    WHERE (t->>'index')::integer>own_start AND t->>'tag' IN ('IDE','UNT');
   sequence_count:=0;
   FOR sequence_start IN SELECT (t->>'index')::integer FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag'='SEQ' AND (t->>'index')::integer>own_start AND (t->>'index')::integer<own_end ORDER BY 1 LOOP
    sequence_count:=sequence_count+1;
    SELECT coalesce(min((t->>'index')::integer),own_end) INTO sequence_end FROM jsonb_array_elements(tokens) t
     WHERE (t->>'index')::integer>sequence_start AND (t->>'index')::integer<own_end AND t->>'tag'='SEQ';
    IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='QTY'
     AND (t->>'index')::integer>sequence_start AND (t->>'index')::integer<sequence_end
     AND t#>>'{elements,1,0}'='135' AND nullif(btrim(t#>>'{elements,1,1}'),'') IS NOT NULL) THEN
     RAISE EXCEPTION 'utilts_s02_quantity_required' USING ERRCODE='P0U01'; END IF;
   END LOOP;
   IF sequence_count=0 THEN RAISE EXCEPTION 'utilts_s02_quantity_required' USING ERRCODE='P0U01'; END IF;
  END IF;
 END LOOP;
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=p_source_message_id;
 IF NOT FOUND THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM '2'::jsonb) THEN
   RAISE EXCEPTION 'utilts_new_consumption_requires_v2' USING ERRCODE='P0U01'; END IF;
  IF EXISTS(SELECT FROM public.ediel_ack_transaction_results WHERE source_message_id=p_source_message_id)
  OR EXISTS(SELECT FROM public.meter_reading_series WHERE source_ediel_message_id=p_source_message_id) THEN
   RAISE EXCEPTION 'utilts_historical_binding_unavailable' USING ERRCODE='P0U01'; END IF;
  INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version)
   VALUES(p_source_message_id,p_company_id,p_environment,p_message_code,raw_hash,gridex_utilts_binding.source_context_v1(source),membership,2) RETURNING * INTO receipt;
 ELSIF receipt.company_id IS DISTINCT FROM p_company_id OR receipt.environment IS DISTINCT FROM p_environment
 OR receipt.message_code IS DISTINCT FROM p_message_code OR receipt.contract_version NOT IN (1,2) OR receipt.raw_hash IS DISTINCT FROM raw_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source) OR receipt.membership IS DISTINCT FROM membership THEN
  RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01';
 END IF;
 -- A retained V1 is solely an authentic retry of this exact source/hash.
 -- New accepted effects require V2; an old held/negative receipt cannot mint V1.
 IF receipt.contract_version=1 THEN
  FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
   IF item->>'disposition'='accepted' AND NOT EXISTS(
    SELECT FROM public.ediel_ack_transaction_results a JOIN gridex_utilts_binding.contracts old ON old.series_id=a.persisted_series_id
    WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=p_environment
    AND a.source_transaction_id=item->>'transactionId' AND a.disposition='accepted' AND a.persistence_status='persisted'
    AND old.contract_version=1 AND old.company_id=p_company_id AND old.environment=p_environment) THEN
    RAISE EXCEPTION 'utilts_legacy_retry_contract_unavailable' USING ERRCODE='P0U01'; END IF;
  END LOOP;
  SELECT jsonb_agg(gridex_utilts_binding.legacy_retry_item_v1(t) ORDER BY ordinal) INTO legacy_transactions
   FROM jsonb_array_elements(p_transactions) WITH ORDINALITY x(t,ordinal);
  p_transactions:=legacy_transactions;
 END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM to_jsonb(receipt.contract_version)) THEN
  RAISE EXCEPTION 'utilts_consumption_version_conflict' USING ERRCODE='P0U01'; END IF;
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
     VALUES(v_series_id,p_company_id,p_environment,p_source_message_id,item->>'transactionId',receipt.contract_version,c,encode(digest(convert_to(c::text,'UTF8'),'sha256'),'hex')) RETURNING * INTO stored;
   END IF;
   contract_hash:=encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex');
   IF stored.company_id<>p_company_id OR stored.environment<>p_environment OR stored.transaction_id<>item->>'transactionId' OR stored.contract_version IS DISTINCT FROM receipt.contract_version OR stored.contract->'version' IS DISTINCT FROM to_jsonb(stored.contract_version)
    OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false) OR stored.contract_hash IS DISTINCT FROM contract_hash OR stored.contract IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'utilts_consumption_contract_conflict' USING ERRCODE='P0U01'; END IF;
   r:=r||jsonb_build_object('contractVersion',stored.contract_version,'contractHash',stored.contract_hash,'consumptionContract',stored.contract);
  END IF;
  answer:=answer||jsonb_build_array(r||jsonb_build_object('sourceBinding',jsonb_build_object('sourceMessageId',receipt.source_message_id,'rawHash',receipt.raw_hash,'boundAt',receipt.bound_at)));
 END LOOP;
 RETURN answer;
END $$;

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
 IF NOT FOUND OR v_contract.contract_version NOT IN (1,2) OR v_contract.contract_version IS DISTINCT FROM v_receipt.contract_version
 OR v_contract.contract->'version' IS DISTINCT FROM to_jsonb(v_contract.contract_version) OR v_contract.environment IS DISTINCT FROM v_source.environment OR v_contract.transaction_id IS DISTINCT FROM p_transaction
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
 IF v_contract.contract_version=2 AND NOT coalesce(gridex_utilts_binding.validate_decimal_source_v2(gridex_utilts_binding.wire_tokens_v1(v_source.raw_payload),v_series.raw_transaction,
  CASE WHEN left(v_source.raw_payload,3)='UNA' THEN substring(v_source.raw_payload,6,1) ELSE '.' END),false) THEN
  RAISE EXCEPTION 'utilts_consumption_decimal_source_conflict' USING ERRCODE='P0U01'; END IF;
 RETURN v_contract.contract;
END $$;


REVOKE ALL ON FUNCTION gridex_utilts_binding.stored_contract_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;
-- Existing metering/billing sinks already cast stored quantity text to exact
-- PostgreSQL numeric and compare the complete stored contracts. They dispatch
-- through stored_contract_v1 above; no public signature or type is invented.
COMMIT;
