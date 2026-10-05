-- E72 requires LOC+172 (UF-request-209-63). Empty observations do not waive a
-- supported physical LOC+172 before the durable series or ACK. LOC+175 keeps
-- its independent regulating-object owner refusal in persist_series_v1.
BEGIN;
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
  IF item->>'disposition'='accepted' AND (p_message_code IN ('E30','E66','S07','E72') OR jsonb_array_length(c->'observations')>0
   OR (p_message_code IN ('S01','E73') AND NOT gridex_utilts_binding.unowned_regulating_object_v1(tokens,item->>'transactionId'))) THEN
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
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;
COMMIT;
