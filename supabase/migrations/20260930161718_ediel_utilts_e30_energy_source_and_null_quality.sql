-- Forward source correction. Frozen U SHA2560524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be.
-- U p36 standard energy dimension; p85 excludes E30MEA; p95 QTY6411=N
-- and missing energy requires literalNULL with own following STS8/46.
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
COMMIT;
