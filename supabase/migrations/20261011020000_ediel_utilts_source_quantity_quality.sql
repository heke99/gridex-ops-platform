-- SC-053 / U-09: keep each stored UTILTS value's own source quality.
-- The TypeScript owner now supplies the physical STS+8 quality per quantity;
-- this validator requires it to equal the source, so a caller cannot invent
-- or swap it. A missing value (46) and a verified zero (21) stay distinct.
-- Committed pre-fix series stored no quantity quality; their idempotent
-- retries are compared without the new key and keep their original row.
BEGIN;

CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_decimal_source_v2(tokens jsonb,item jsonb,decimal_mark text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE start_at integer; stop_at integer; first_sequence integer; sequence_at integer; next_sequence integer;
 quantities jsonb; source_quantity jsonb; supplied jsonb; o jsonb; ordinal integer; unit text; own_mea jsonb; scale numeric; code text; energy_unit text; quality_end integer;
BEGIN
 IF item->>'disposition'<>'accepted' THEN RETURN true; END IF;
 SELECT t#>>'{elements,1,0}' INTO STRICT code FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
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
 IF unit IS DISTINCT FROM item->>'unit' OR (code='E30' AND own_mea IS NOT NULL) THEN RETURN false; END IF;
 energy_unit:=unit;
 -- U p36 requires standard E30 quarter/month/year energy in kWh, while p85
 -- excludes MEA. This explicit source condition never manufactures a raw MEA.
 IF code='E30' AND unit IS NULL AND (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM'
  AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_sequence AND t#>>'{elements,1,0}'='354')=1
  AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM'
  AND (t->>'index')::integer>start_at AND (t->>'index')::integer<first_sequence AND t#>>'{elements,1,0}'='354'
  AND ((t#>>'{elements,1,1}'='15' AND t#>>'{elements,1,2}'='806') OR (t#>>'{elements,1,1}'='1' AND t#>>'{elements,1,2}' IN ('801','802'))))
 THEN energy_unit:='KWH'; END IF;
 IF code IN ('E31','E66','S07','S02','S03','S04') AND unit IS NULL THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(t ORDER BY (t->>'index')::integer),'[]') INTO quantities FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='QTY' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 IF code IN ('S01','S05') AND jsonb_array_length(quantities)>0 AND unit IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(item->'quantities') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'quantities')<>jsonb_array_length(quantities) THEN RETURN false; END IF;
 FOR ordinal IN 0..jsonb_array_length(quantities)-1 LOOP
  source_quantity:=quantities->ordinal; supplied:=item->'quantities'->ordinal;
  IF supplied->>'qualifier' IS DISTINCT FROM source_quantity#>>'{elements,1,0}'
   OR nullif(source_quantity#>>'{elements,1,2}','') IS NOT NULL THEN RETURN false; END IF;
  SELECT max((t->>'index')::integer) INTO sequence_at FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='SEQ'
   AND (t->>'index')::integer>start_at AND (t->>'index')::integer<(source_quantity->>'index')::integer;
  SELECT coalesce(min((t->>'index')::integer),stop_at) INTO next_sequence FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='SEQ'
   AND (t->>'index')::integer>sequence_at AND (t->>'index')::integer<stop_at;
  IF sequence_at IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='MEA'
   AND (t->>'index')::integer>sequence_at AND (t->>'index')::integer<next_sequence
   AND (t#>>'{elements,1,0}' IS DISTINCT FROM 'AAZ' OR t#>>'{elements,3,0}' IS DISTINCT FROM unit)) THEN RETURN false; END IF;
  IF source_quantity#>>'{elements,1,0}' IN ('136','220') AND source_quantity#>>'{elements,1,1}'='NULL' THEN
   IF source_quantity#>>'{elements,1,0}'='136' OR code='E30' THEN
    SELECT coalesce(min((t->>'index')::integer),next_sequence) INTO quality_end FROM jsonb_array_elements(tokens) t
     WHERE t->>'tag'='QTY' AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<next_sequence;
    IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS'
     AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<quality_end
     AND t#>>'{elements,1,0}'='8' AND t#>>'{elements,2,0}'='46') THEN RETURN false; END IF;
   END IF;
   IF supplied->'value' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  ELSIF jsonb_typeof(supplied->'value') IS DISTINCT FROM 'string'
   OR gridex_utilts_binding.canonical_decimal_v2(source_quantity#>>'{elements,1,1}',decimal_mark) IS DISTINCT FROM supplied->>'value'
   OR gridex_utilts_binding.canonical_decimal_v2(supplied->>'value') IS DISTINCT FROM supplied->>'value' THEN RETURN false; END IF;
  -- SC-053: a supplied stored quality must be this QTY's own STS+8 code
  -- (until the next QTY of the same SEQ), or JSON null when it has none.
  IF supplied ? 'quality' THEN
   SELECT coalesce(min((t->>'index')::integer),next_sequence) INTO quality_end FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag'='QTY' AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<next_sequence;
   IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='8'
     AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<quality_end)>1
    OR supplied->'quality' IS DISTINCT FROM coalesce((SELECT to_jsonb(t#>>'{elements,2,0}') FROM jsonb_array_elements(tokens) t
     WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='8'
      AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<quality_end),'null'::jsonb)
   THEN RETURN false; END IF;
  END IF;
 END LOOP;
 FOR o IN SELECT value FROM jsonb_array_elements(item#>'{consumptionContract,observations}') LOOP
  source_quantity:=quantities->((o->>'sourceOrdinal')::integer);
  scale:=CASE energy_unit WHEN 'KWH' THEN 1 WHEN 'MWH' THEN 1000 WHEN 'GWH' THEN 1000000 END;
  IF source_quantity IS NULL OR source_quantity#>>'{elements,1,0}' IS DISTINCT FROM '136'
   OR scale IS NULL OR trim_scale(gridex_utilts_binding.canonical_decimal_v2(source_quantity#>>'{elements,1,1}',decimal_mark)::numeric*scale)::text IS DISTINCT FROM o->>'quantity'
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;


REVOKE ALL ON FUNCTION gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_utilts_binding.preserve_committed_projection_v1(c uuid,env text,sid uuid,transactions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public.ediel_messages%rowtype;item jsonb;old_item jsonb;adapted jsonb;answer jsonb:='[]';r gridex_utilts_binding.receipts%rowtype;v public.meter_reading_series%rowtype;
BEGIN
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE company_id=c AND id=sid AND environment=env;
 SELECT * INTO r FROM gridex_utilts_binding.receipts WHERE source_message_id=sid AND company_id=c AND environment=env;
 IF r.source_message_id IS NULL OR r.raw_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') OR r.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(s) THEN RETURN transactions;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(transactions) LOOP
  SELECT series.* INTO v FROM public.ediel_ack_transaction_results a JOIN public.meter_reading_series series ON series.id=a.persisted_series_id AND series.company_id=a.company_id
   WHERE a.company_id=c AND a.environment=env AND a.source_message_id=sid AND a.source_transaction_id=item->>'transactionId'
    AND a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak' FOR SHARE OF a,series;
  IF FOUND AND v.immutable_hash=encode(sha256(convert_to(v.raw_transaction::text,'UTF8')),'hex') THEN
   old_item:=v.raw_transaction;
   -- A series committed before SC-053 has no quantity quality. Compare its
   -- retry without that key; the original immutable row stays authoritative.
   IF jsonb_typeof(item->'quantities')='array' AND NOT EXISTS(SELECT FROM jsonb_array_elements(coalesce(old_item->'quantities','[]'::jsonb)) q WHERE q ? 'quality') THEN
    adapted:=item||jsonb_build_object('quantities',(SELECT coalesce(jsonb_agg(q-'quality' ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(item->'quantities') WITH ORDINALITY x(q,n)));
    IF adapted IS NOT DISTINCT FROM old_item THEN item:=adapted;
    ELSIF adapted IS DISTINCT FROM item THEN
     adapted:=(adapted-'productId')||jsonb_build_object('periodStart',adapted#>'{consumptionContract,interpretation,localPeriodStart}','periodEnd',adapted#>'{consumptionContract,interpretation,localPeriodEnd}');
     IF r.contract_version=1 THEN adapted:=gridex_utilts_binding.legacy_retry_item_v1(adapted);END IF;
     IF adapted IS NOT DISTINCT FROM old_item THEN item:=adapted;END IF;
    END IF;
   END IF;
   IF item IS DISTINCT FROM old_item THEN
    -- Only the newly introduced metadata fields differ. V1's existing numeric
    -- comparison remains the immutable private owner's exact original shape.
    adapted:=(item-'productId')||jsonb_build_object('periodStart',item#>'{consumptionContract,interpretation,localPeriodStart}','periodEnd',item#>'{consumptionContract,interpretation,localPeriodEnd}');
    IF r.contract_version=1 THEN adapted:=gridex_utilts_binding.legacy_retry_item_v1(adapted);END IF;
    IF adapted IS NOT DISTINCT FROM old_item THEN item:=adapted;END IF;
   END IF;
  END IF;
  answer:=answer||jsonb_build_array(item);
 END LOOP;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.preserve_committed_projection_v1(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
