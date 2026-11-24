-- Check E66 register reading timestamps against their immutable wire scope.
DO $guard$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc
     WHERE oid=to_regprocedure('gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'))
    IS DISTINCT FROM '60bac6303917225c7c63f2e95bd36e0a' THEN
  RAISE EXCEPTION 'utilts_register_reading_time_predecessor_changed';
 END IF;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_decimal_source_v2(tokens jsonb, item jsonb, decimal_mark text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE start_at integer; stop_at integer; first_sequence integer; quantity_scope record; with_quality boolean;
 quantities jsonb; source_quantity jsonb; supplied jsonb; o jsonb; unit text; own_mea jsonb; scale numeric; code text; energy_unit text;
 header_offset integer; register_at timestamptz;
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
 SELECT EXISTS(SELECT FROM jsonb_array_elements(item->'quantities') q WHERE jsonb_typeof(q)='object' AND q ? 'quality')
 INTO with_quality;

 IF code='E66' AND EXISTS(
  SELECT FROM jsonb_array_elements(item->'quantities') q
  WHERE q->>'qualifier'='220' AND q ? 'readingAt'
 ) THEN
  WITH header_offsets AS (
   SELECT t->'elements'->1 AS parts FROM jsonb_array_elements(tokens) t
   WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='735'
    AND (t->>'index')::integer>(SELECT min((m->>'index')::integer)
     FROM jsonb_array_elements(tokens) m WHERE m->>'tag'='UNH')
    AND (t->>'index')::integer<(SELECT min((m->>'index')::integer)
     FROM jsonb_array_elements(tokens) m WHERE m->>'tag'='IDE')
  ), offsets AS (
   SELECT CASE WHEN jsonb_array_length(parts)=3 AND parts->>2='406'
    AND parts->>1 ~ '^[+-](0[0-9]|1[0-3])[0-5][0-9]$|^[+-]1400$'
    THEN (CASE WHEN left(parts->>1,1)='-' THEN -1 ELSE 1 END)
     * (substring(parts->>1 FROM 2 FOR 2)::integer*60+right(parts->>1,2)::integer)
   END AS minutes FROM header_offsets
  )
  SELECT CASE WHEN count(*)=count(minutes) AND count(DISTINCT minutes)=1 THEN min(minutes) END
   INTO header_offset FROM offsets;
 END IF;

 -- Group physical segments once; a quality belongs only to the preceding QTY
 -- inside the same SEQ. Unrelated transactions are excluded before grouping.
 FOR quantity_scope IN
  WITH own AS MATERIALIZED (
   SELECT t AS token,(t->>'index')::integer AS pos,t->>'tag' AS tag
   FROM jsonb_array_elements(tokens) t
   WHERE (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at
  ), sequences AS (
   SELECT *,max(pos) FILTER (WHERE tag='SEQ') OVER (ORDER BY pos) AS seq_pos
   FROM own
  ), scopes AS (
   SELECT *,
    max(pos) FILTER (WHERE tag='QTY') OVER (PARTITION BY seq_pos ORDER BY pos) AS qty_pos,
    bool_or(tag='MEA' AND (token#>>'{elements,1,0}' IS DISTINCT FROM 'AAZ'
      OR token#>>'{elements,3,0}' IS DISTINCT FROM unit)) OVER (PARTITION BY seq_pos) AS bad_mea
   FROM sequences
  ), qualities AS (
   SELECT seq_pos,qty_pos,count(*) AS quality_count,
    max(token#>>'{elements,2,0}') AS quality_code,
    bool_or(token#>>'{elements,2,0}'='46') AS has_missing_quality
   FROM scopes
   WHERE tag='STS' AND token#>>'{elements,1,0}'='8' AND qty_pos IS NOT NULL
   GROUP BY seq_pos,qty_pos
  ), reading_dates AS (
   SELECT seq_pos,qty_pos,count(*) AS date_count,
    min(token#>>'{elements,1,1}') AS date_stamp,
    min(token#>>'{elements,1,2}') AS date_format,
    min(jsonb_array_length(token->'elements'->1)) AS part_count
   FROM scopes
   WHERE header_offset IS NOT NULL AND tag='DTM' AND token#>>'{elements,1,0}'='597'
    AND qty_pos IS NOT NULL
   GROUP BY seq_pos,qty_pos
  )
  SELECT s.token,s.seq_pos,s.bad_mea,q.quality_count,q.quality_code,q.has_missing_quality,
   d.date_count,d.date_stamp,d.date_format,d.part_count,
   (row_number() OVER (ORDER BY s.pos)-1)::integer AS ordinal
  FROM scopes s LEFT JOIN qualities q ON q.seq_pos=s.seq_pos AND q.qty_pos=s.pos
   LEFT JOIN reading_dates d ON d.seq_pos=s.seq_pos AND d.qty_pos=s.pos
  WHERE s.tag='QTY' ORDER BY s.pos
 LOOP
  source_quantity:=quantity_scope.token;
  supplied:=item->'quantities'->quantity_scope.ordinal;
  IF supplied->>'qualifier' IS DISTINCT FROM source_quantity#>>'{elements,1,0}'
   OR nullif(source_quantity#>>'{elements,1,2}','') IS NOT NULL
   OR quantity_scope.seq_pos IS NULL OR quantity_scope.bad_mea THEN RETURN false; END IF;
  IF source_quantity#>>'{elements,1,0}' IN ('136','220') AND source_quantity#>>'{elements,1,1}'='NULL' THEN
   IF (source_quantity#>>'{elements,1,0}'='136' OR code='E30')
    AND NOT coalesce(quantity_scope.has_missing_quality,false) THEN RETURN false; END IF;
   IF supplied->'value' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  ELSIF jsonb_typeof(supplied->'value') IS DISTINCT FROM 'string'
   OR gridex_utilts_binding.canonical_decimal_v2(source_quantity#>>'{elements,1,1}',decimal_mark) IS DISTINCT FROM supplied->>'value'
   OR gridex_utilts_binding.canonical_decimal_v2(supplied->>'value') IS DISTINCT FROM supplied->>'value' THEN RETURN false; END IF;
  -- Older committed shapes had no register time. Validate supplied timestamps
  -- against the original register observation without changing legacy series.
  IF code='E66' AND source_quantity#>>'{elements,1,0}'='220' AND supplied ? 'readingAt' THEN
   IF header_offset IS NULL OR quantity_scope.date_count IS DISTINCT FROM 1
    OR quantity_scope.part_count IS DISTINCT FROM 3 OR quantity_scope.date_format IS DISTINCT FROM '203'
    OR quantity_scope.date_stamp IS NULL OR quantity_scope.date_stamp !~ '^[0-9]{12}$'
    OR left(quantity_scope.date_stamp,4)::integer<100
    OR substring(quantity_scope.date_stamp FROM 9 FOR 2)::integer>23
    OR right(quantity_scope.date_stamp,2)::integer>59
    OR jsonb_typeof(supplied->'readingAt') IS DISTINCT FROM 'string'
    OR supplied->>'readingAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$'
   THEN RETURN false; END IF;
   register_at:=(make_timestamp(left(quantity_scope.date_stamp,4)::integer,
    substring(quantity_scope.date_stamp FROM 5 FOR 2)::integer,
    substring(quantity_scope.date_stamp FROM 7 FOR 2)::integer,
    substring(quantity_scope.date_stamp FROM 9 FOR 2)::integer,
    right(quantity_scope.date_stamp,2)::integer,0) AT TIME ZONE 'UTC')-make_interval(mins=>header_offset);
   IF register_at IS DISTINCT FROM (supplied->>'readingAt')::timestamptz THEN RETURN false; END IF;
  END IF;
  IF supplied ? 'quality' THEN
   IF quantity_scope.quality_count>1
    OR supplied->'quality' IS DISTINCT FROM coalesce(to_jsonb(quantity_scope.quality_code),'null'::jsonb)
   THEN RETURN false; END IF;
  ELSIF with_quality AND quantity_scope.quality_count>0 THEN RETURN false;
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
END
$guard$;
