-- SC046 JSON-return prerequisite only; no insertion, sink, ACK or whole-ID proof.
-- Source95d8d160491e79b172342654d8dc643346758105/treefa5ab60527a40bd642749365fc275d1d4a69e277.
-- Preserve the existing owner chain and both execution-actor checks. Rewrite
-- only this source-bound wrapper, retaining its OID and every pg_proc member
-- except prosrc. No new function/API, schema, grants, defaults or settings.
DO $migration$
DECLARE
 target oid := 'public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)'::regprocedure;
 before_metadata jsonb; after_metadata jsonb; old_body text; new_body text;
 old_definition text; new_definition text; installed_body text;
 declaration_anchor text := 'DECLARE source public.ediel_messages%rowtype;result jsonb;';
 return_anchor text := ' -- The preserved owner may wait on its source/advisory locks.';
 declarations text := $declarations$
 -- SC046 return-state declarations
 sc046_item jsonb; sc046_answer jsonb := '[]'::jsonb; sc046_contract jsonb;
 sc046_series public.meter_reading_series%rowtype; sc046_count bigint;
 sc046_state text;$declarations$;
 classification text := $classification$ -- SC046 stored return-state begin
 IF jsonb_typeof(result) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
 END IF;
 FOR sc046_item IN SELECT value FROM jsonb_array_elements(result) LOOP
  IF jsonb_typeof(sc046_item) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
  END IF;
  IF sc046_item->>'persistenceStatus'='persisted' THEN
   -- The result is from the retained lower owner, never caller metadata.
   -- Persisted classification requires one own accepted ACK reservation and
   -- the exact returned series/transaction plus its genuine contract origin.
   IF sc046_item->>'disposition' IS DISTINCT FROM 'accepted'
    OR sc046_item->>'responseType' IS DISTINCT FROM 'positive_aperak'
    OR nullif(sc046_item->>'transactionId','') IS NULL
    OR sc046_item ? 'versionState'
    OR sc046_item#>>'{sourceBinding,sourceMessageId}' IS DISTINCT FROM source.id::text
    OR sc046_item#>>'{sourceBinding,rawHash}' IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
    OR (SELECT count(*) FROM jsonb_array_elements(result) x
      WHERE x->>'transactionId'=sc046_item->>'transactionId')<>1 THEN
    RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
   END IF;
   -- Lock candidate rows after the retained graph/source locks; check every
   -- binding below AFTER any row-lock wait, including mutable origin context.
   -- Authentic reuse may have an earlier source origin in the SAME scope.
   SELECT s.* INTO sc046_series FROM public.ediel_ack_transaction_results a
   JOIN public.meter_reading_series s ON s.id=a.persisted_series_id
   JOIN public.ediel_messages o ON o.id=s.source_ediel_message_id
   JOIN gridex_utilts_binding.contracts c ON c.series_id=s.id
   WHERE a.company_id=p_company_id AND a.environment=p_environment
    AND a.source_message_id=source.id AND a.source_transaction_id=sc046_item->>'transactionId'
    AND s.id::text=sc046_item->>'seriesId'
   FOR SHARE OF a,s,o,c;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
   END IF;
   SELECT count(*) INTO sc046_count
   FROM public.ediel_ack_transaction_results a
   JOIN public.meter_reading_series s ON s.id=a.persisted_series_id
   JOIN public.ediel_messages o ON o.id=s.source_ediel_message_id
   JOIN gridex_utilts_binding.contracts c ON c.series_id=s.id
   WHERE a.company_id=p_company_id AND a.environment=p_environment
    AND a.source_message_id=source.id AND a.source_transaction_id=sc046_item->>'transactionId'
    AND a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak'
    AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
    AND s.id::text=sc046_item->>'seriesId' AND s.company_id=p_company_id
    AND s.message_code=p_message_code AND s.source_transaction_reference=a.source_transaction_id
    AND o.company_id=p_company_id AND o.environment=p_environment AND o.direction='inbound'
    AND o.message_family='UTILTS' AND o.message_code=p_message_code AND o.raw_payload IS NOT NULL
    AND c.company_id=p_company_id AND c.environment=p_environment
    AND c.source_message_id=o.id AND c.transaction_id=a.source_transaction_id
    AND c.contract_version IN (1,2) AND c.contract->'version'=to_jsonb(c.contract_version)
    AND c.contract_version::text=sc046_item->>'contractVersion' AND c.contract_hash=sc046_item->>'contractHash'
    AND c.contract_hash=encode(sha256(convert_to(c.contract::text,'UTF8')),'hex')
    AND c.contract=sc046_item->'consumptionContract'
    AND s.raw_transaction->'consumptionContract'=c.contract
    AND jsonb_typeof(s.raw_transaction)='object'
    AND s.immutable_hash=encode(sha256(convert_to(s.raw_transaction::text,'UTF8')),'hex');
   IF sc046_count<>1 THEN
    RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
   END IF;
   -- This existing port independently validates stored raw/contract/source and
   -- supported point/decimal authority. NULL or disagreement is never current.
   sc046_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,source.id,sc046_item->>'transactionId');
   IF jsonb_typeof(sc046_contract) IS DISTINCT FROM 'object'
    OR sc046_contract IS DISTINCT FROM sc046_item->'consumptionContract' THEN
    RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
   END IF;
   -- Installed immutable-series guard permits changing only is_current.
   -- Initial1 and correction-with-predecessor are born current, including
   -- later noncurrent replay. U04's higher/no-predecessor birth is late history.
   IF sc046_series.version_no=1 AND sc046_series.supersedes_series_id IS NULL THEN
    sc046_state:='current';
   ELSIF sc046_series.version_no>1 AND sc046_series.supersedes_series_id IS NOT NULL THEN
    SELECT count(*) INTO sc046_count FROM public.meter_reading_series p
    JOIN public.ediel_messages o ON o.id=p.source_ediel_message_id
    WHERE p.id=sc046_series.supersedes_series_id AND p.id<>sc046_series.id
     AND p.company_id=p_company_id AND o.company_id=p_company_id AND o.environment=p_environment
     AND o.direction='inbound' AND o.message_family='UTILTS' AND o.message_code=p_message_code
     AND p.version_no=sc046_series.version_no-1
     AND p.series_kind=sc046_series.series_kind AND p.message_code IS NOT DISTINCT FROM sc046_series.message_code
     AND coalesce(p.external_metering_point_id,'')=coalesce(sc046_series.external_metering_point_id,'')
     AND coalesce(p.grid_area_id,'')=coalesce(sc046_series.grid_area_id,'')
     AND p.period_start IS NOT DISTINCT FROM sc046_series.period_start
     AND p.period_end IS NOT DISTINCT FROM sc046_series.period_end
     AND p.resolution=sc046_series.resolution AND coalesce(p.product_id,'')=coalesce(sc046_series.product_id,'');
    IF sc046_count<>1 THEN
     RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
    END IF;
    sc046_state:='current';
   ELSIF sc046_series.version_no>1 AND sc046_series.supersedes_series_id IS NULL AND sc046_series.is_current IS FALSE THEN
    sc046_state:='late_older_history';
   ELSE
    RAISE EXCEPTION 'utilts_return_state_unavailable' USING ERRCODE='P0U01';
   END IF;
   sc046_item:=sc046_item||jsonb_build_object('versionState',sc046_state);
  END IF;
  -- Array iteration retains order; all existing members and nonpersisted
  -- results (including negative outcomes and NULL content) stay untouched.
  sc046_answer:=sc046_answer||jsonb_build_array(sc046_item);
 END LOOP;
 result:=sc046_answer;
 -- SC046 stored return-state end
$classification$;
BEGIN
 SELECT to_jsonb(p)-'prosrc',p.prosrc,pg_get_functiondef(p.oid)
 INTO STRICT before_metadata,old_body,old_definition FROM pg_proc p WHERE p.oid=target;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex')<>'d1072ccfd2c9ed9d7edd8e4bf780c0809bb4d904fe61a579be5239dfa6f220b1'
  OR (length(old_body)-length(replace(old_body,declaration_anchor,'')))<>length(declaration_anchor)
  OR (length(old_body)-length(replace(old_body,return_anchor,'')))<>length(return_anchor)
  OR position('sc046_' IN old_body)>0 THEN
  RAISE EXCEPTION 'utilts_return_state_predecessor_conflict' USING ERRCODE='P0U01';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='public.meter_reading_series'::regclass
  AND t.tgname='meter_reading_series_immutable_guard' AND NOT t.tgisinternal
  AND t.tgenabled IN ('O','A') AND t.tgtype=27
  AND t.tgfoid='public.gridex_guard_immutable_meter_reading_series()'::regprocedure)
  OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
    WHERE p.oid='public.gridex_guard_immutable_meter_reading_series()'::regprocedure)
    IS DISTINCT FROM '2042b573d05a577deaa451e1fcc66e1c797dd1e52c4b1a7756afda4632f1bf43' THEN
  RAISE EXCEPTION 'utilts_return_state_immutable_guard_unavailable' USING ERRCODE='P0U01';
 END IF;
 new_body:=replace(old_body,declaration_anchor,declaration_anchor||declarations);
 new_body:=replace(new_body,return_anchor,classification||return_anchor);
 IF replace(replace(new_body,declaration_anchor||declarations,declaration_anchor),classification,'') IS DISTINCT FROM old_body
  OR (length(old_definition)-length(replace(old_definition,old_body,'')))<>length(old_body) THEN
  RAISE EXCEPTION 'utilts_return_state_inverse_conflict' USING ERRCODE='P0U01';
 END IF;
 new_definition:=replace(old_definition,old_body,new_body);
 EXECUTE new_definition;
 SELECT to_jsonb(p)-'prosrc',p.prosrc INTO STRICT after_metadata,installed_body FROM pg_proc p WHERE p.oid=target;
 IF after_metadata IS DISTINCT FROM before_metadata OR installed_body IS DISTINCT FROM new_body
  OR replace(replace(installed_body,declaration_anchor||declarations,declaration_anchor),classification,'') IS DISTINCT FROM old_body THEN
  RAISE EXCEPTION 'utilts_return_state_metadata_or_inverse_conflict' USING ERRCODE='P0U01';
 END IF;
END
$migration$;
