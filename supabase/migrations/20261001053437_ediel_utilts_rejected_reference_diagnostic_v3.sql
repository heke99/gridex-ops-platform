-- Created with Supabase CLI 2.118.0 migration new.
-- U505 own an..35 stays unchanged. A negative reply may copy the observed
-- invalid original in A505/ACW an..70. This distinct diagnostic V3 has no
-- business-write content, attribution, series or billing contract authority.
-- Existing V1/V2 validators, stored content and genuine committed replay stay.
BEGIN;
CREATE FUNCTION gridex_utilts_binding.validate_rejected_contract_v3(c jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE observed text;maximum integer;projected jsonb;
BEGIN
 observed:=c->>'transactionId';maximum:=(gridex_ediel_ack_guide.utilts_reference_constraints_v1()->>'originalAcwMax')::integer;
 IF c->'version' IS DISTINCT FROM '3'::jsonb OR c->>'projectionVersion' IS DISTINCT FROM 'utilts-rejected-diagnostic-v3'
  OR jsonb_typeof(c->'transactionId') IS DISTINCT FROM 'string' OR observed IS NULL OR char_length(observed) NOT BETWEEN 1 AND maximum
  OR coalesce(gridex_utilts_binding.valid_transaction_reference_v2(observed),false)
  OR EXISTS(SELECT FROM generate_series(1,char_length(observed)) n WHERE ascii(substr(observed,n,1))<32 OR ascii(substr(observed,n,1)) BETWEEN 127 AND 159 OR ascii(substr(observed,n,1))>255)
  OR c->'observations' IS DISTINCT FROM '[]'::jsonb OR c->'billingContributionOrdinals' IS DISTINCT FROM '[]'::jsonb
  OR c#>>'{metering,capability}' IS DISTINCT FROM 'skip' OR c#>>'{billing,capability}' IS DISTINCT FROM 'skip'
  OR c#>>'{interpretation,timestampPolicy}' IS DISTINCT FROM 'no-consumption-v1' THEN RETURN false; END IF;
 -- Shape-only projection into the strict frozen zero-effect validator. The
 -- replacement is never returned/stored/hashed and never denotes sourceID.
 projected:=c||jsonb_build_object('version',1,'projectionVersion','utilts-consumption-v1','transactionId','rejected-observation');
 RETURN gridex_utilts_binding.validate_legacy_contract_v1(projected);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION gridex_utilts_binding.valid_rejected_item_v3(item jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(item->>'disposition'='guide_rejected' AND item->>'responseType'='negative_aperak'
  AND jsonb_typeof(item->'issueCodes')='array' AND item->'issueCodes' ? 'UTILTS_TRANSACTION_ID_INVALID'
  AND item->>'transactionId'=item#>>'{consumptionContract,transactionId}'
  AND gridex_utilts_binding.validate_rejected_contract_v3(item->'consumptionContract'),false)
$$;
-- Preserve the exact current bound owner, including whole physical membership,
-- same-source receipts, immutable negative replay and atomic sibling effects.
-- The existing public source/precision facade requires the actual latest
-- COMMITTED own canonical facet before any new diagnostic item reaches here.
CREATE OR REPLACE FUNCTION gridex_utilts_binding.persist_consumption_before_precision_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_raw_payload text,p_transactions jsonb)
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
  IF NOT coalesce(CASE WHEN c->'version'='3'::jsonb THEN gridex_utilts_binding.valid_rejected_item_v3(item) ELSE gridex_utilts_binding.validate_contract_v1(c) END,false) THEN
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
  IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM '2'::jsonb AND NOT coalesce(gridex_utilts_binding.valid_rejected_item_v3(t),false)) THEN
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
 IF EXISTS(SELECT FROM jsonb_array_elements(p_transactions) t WHERE t#>'{consumptionContract,version}' IS DISTINCT FROM to_jsonb(receipt.contract_version) AND NOT (receipt.contract_version=2 AND coalesce(gridex_utilts_binding.valid_rejected_item_v3(t),false))) THEN
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
  IF NOT coalesce(CASE WHEN c->'version'='3'::jsonb THEN gridex_utilts_binding.valid_rejected_item_v3(item) ELSE gridex_utilts_binding.validate_contract_v1(c) END,false) OR c->>'companyId' IS DISTINCT FROM p_company_id::text OR c->>'environment' IS DISTINCT FROM p_environment
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

REVOKE ALL ON FUNCTION gridex_utilts_binding.validate_rejected_contract_v3(jsonb),gridex_utilts_binding.valid_rejected_item_v3(jsonb),gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
