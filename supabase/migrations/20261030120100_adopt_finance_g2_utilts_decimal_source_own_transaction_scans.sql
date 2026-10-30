-- Adopted from finance (simulation T1 finding 010) as version 20261030120100, assigned by GEN in the PR #930 queue.
-- Source: c400f6959d8c279fb518b7199fe6e77da30409c4:supabase/migrations/20261024120000_g2_utilts_decimal_source_own_transaction_scans.sql
--   (source file sha256 8e585f942588327cf911b9469c4153ef2fe81525b4e97130d4f897973c7d43cb). Everything below this
-- header is the source file byte for byte; its pre-image guard bb11ba59... equals main's current
-- validate_decimal_source_v2 prosrc and its post-image is ef375fac...d981.
--
-- FINDINGS G-2 / P1 (live-chain-20261015): storing one inbound E66 value cost ~1.3 s. Measured in the world DB
-- (pg_stat_statements track=all, rolled-back transactions): ~70% of each per-value RPC
-- (gridex_consume_utilts_metering_v1, gridex_set_metering_billing_gate, gridex_read_billing_source_values_v1) is
-- gridex_utilts_binding.validate_decimal_source_v2, reached through stored_contract_v1 (2x in consume, 1x via
-- basis_before_precision_v1 in the gate and the read). For every quantity (96 per E66 day) it scanned ALL tokens of the
-- file (406) up to six times: O(quantities x tokens), ~130 ms per call.
--
-- Change (exact pre-image, one function): the per-quantity scans read own-transaction subsets of the SAME token
-- elements instead of the whole token array:
--   SEQ / MEA tokens with start_at < index < stop_at (built once before the loop; the same predicates as the
--   pre-loop scans), QTY from the already built `quantities` (identical bounds), STS built lazily at first use.
-- Every per-quantity predicate is unchanged and its index range lies inside (start_at, stop_at), so each scan sees
-- exactly the rows it saw before; results are identical (proved against every UTILTS series in the world plus
-- mutation variants, and by the existing decimal/SC-053 regressions). No validation, error path, volatility,
-- owner, ACL or configuration changes.
--
-- Refuses (g2_decimal_source_pre_image_changed) unless the installed body is exactly the reviewed pre-image.
begin;

do $g2$
declare
  pre_image constant text := 'bb11ba59f76ee781cea7e456e237377bbdfd25802d6781e2277432883376115d';
  post_image constant text := 'ef375fac0ea02250db91baf4e437bbd3e7a931580710d7cbb814fca13a14d981';
  fn constant regprocedure := 'gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)'::regprocedure;
  new_body constant text := $g2body$
DECLARE start_at integer; stop_at integer; first_sequence integer; sequence_at integer; next_sequence integer;
 quantities jsonb; source_quantity jsonb; supplied jsonb; o jsonb; ordinal integer; unit text; own_mea jsonb; scale numeric; code text; energy_unit text; quality_end integer;
 -- G-2 (20261024120000): own-transaction token subsets per tag, scanned per quantity instead of all tokens.
 tx_seq jsonb; tx_mea jsonb; tx_sts jsonb;
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
 SELECT coalesce(jsonb_agg(t),'[]') INTO tx_seq FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='SEQ' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 SELECT coalesce(jsonb_agg(t),'[]') INTO tx_mea FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='MEA' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 FOR ordinal IN 0..jsonb_array_length(quantities)-1 LOOP
  source_quantity:=quantities->ordinal; supplied:=item->'quantities'->ordinal;
  IF supplied->>'qualifier' IS DISTINCT FROM source_quantity#>>'{elements,1,0}'
   OR nullif(source_quantity#>>'{elements,1,2}','') IS NOT NULL THEN RETURN false; END IF;
  SELECT max((t->>'index')::integer) INTO sequence_at FROM jsonb_array_elements(tx_seq) t WHERE t->>'tag'='SEQ'
   AND (t->>'index')::integer>start_at AND (t->>'index')::integer<(source_quantity->>'index')::integer;
  SELECT coalesce(min((t->>'index')::integer),stop_at) INTO next_sequence FROM jsonb_array_elements(tx_seq) t WHERE t->>'tag'='SEQ'
   AND (t->>'index')::integer>sequence_at AND (t->>'index')::integer<stop_at;
  IF sequence_at IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(tx_mea) t WHERE t->>'tag'='MEA'
   AND (t->>'index')::integer>sequence_at AND (t->>'index')::integer<next_sequence
   AND (t#>>'{elements,1,0}' IS DISTINCT FROM 'AAZ' OR t#>>'{elements,3,0}' IS DISTINCT FROM unit)) THEN RETURN false; END IF;
  IF source_quantity#>>'{elements,1,0}' IN ('136','220') AND source_quantity#>>'{elements,1,1}'='NULL' THEN
   IF source_quantity#>>'{elements,1,0}'='136' OR code='E30' THEN
    SELECT coalesce(min((t->>'index')::integer),next_sequence) INTO quality_end FROM jsonb_array_elements(quantities) t
     WHERE t->>'tag'='QTY' AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<next_sequence;
    IF tx_sts IS NULL THEN SELECT coalesce(jsonb_agg(t),'[]') INTO tx_sts FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at; END IF;
    IF NOT EXISTS(SELECT FROM jsonb_array_elements(tx_sts) t WHERE t->>'tag'='STS'
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
   SELECT coalesce(min((t->>'index')::integer),next_sequence) INTO quality_end FROM jsonb_array_elements(quantities) t
    WHERE t->>'tag'='QTY' AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<next_sequence;
   IF tx_sts IS NULL THEN SELECT coalesce(jsonb_agg(t),'[]') INTO tx_sts FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at; END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(tx_sts) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='8'
     AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<quality_end)>1
    OR supplied->'quality' IS DISTINCT FROM coalesce((SELECT to_jsonb(t#>>'{elements,2,0}') FROM jsonb_array_elements(tx_sts) t
     WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='8'
      AND (t->>'index')::integer>(source_quantity->>'index')::integer AND (t->>'index')::integer<quality_end),'null'::jsonb)
   THEN RETURN false; END IF;
  END IF;
 END LOOP;
 -- SC-053: once an item carries stored qualities (the SC-053 shape), every
 -- quantity with a source STS+8 must carry its own; a committed pre-SC-053
 -- item has none and keeps its original validation.
 IF EXISTS(SELECT FROM jsonb_array_elements(item->'quantities') q WHERE jsonb_typeof(q)='object' AND q ? 'quality')
  AND gridex_utilts_binding.missing_source_quality_v2(tokens,item) THEN RETURN false; END IF;
 FOR o IN SELECT value FROM jsonb_array_elements(item#>'{consumptionContract,observations}') LOOP
  source_quantity:=quantities->((o->>'sourceOrdinal')::integer);
  scale:=CASE energy_unit WHEN 'KWH' THEN 1 WHEN 'MWH' THEN 1000 WHEN 'GWH' THEN 1000000 END;
  IF source_quantity IS NULL OR source_quantity#>>'{elements,1,0}' IS DISTINCT FROM '136'
   OR scale IS NULL OR trim_scale(gridex_utilts_binding.canonical_decimal_v2(source_quantity#>>'{elements,1,1}',decimal_mark)::numeric*scale)::text IS DISTINCT FROM o->>'quantity'
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $g2body$;
  before jsonb;
  after jsonb;
begin
  select to_jsonb(p) - 'prosrc' into strict before from pg_proc p where p.oid = fn;
  if (select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') from pg_proc where oid = fn) is distinct from pre_image then
    raise exception 'g2_decimal_source_pre_image_changed';
  end if;
  if encode(sha256(convert_to(new_body, 'UTF8')), 'hex') is distinct from post_image then
    raise exception 'g2_decimal_source_post_image_invalid';
  end if;
  execute 'CREATE OR REPLACE FUNCTION gridex_utilts_binding.validate_decimal_source_v2(tokens jsonb, item jsonb, decimal_mark text)'
    || ' RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO ''pg_catalog'' AS ' || quote_literal(new_body);
  select to_jsonb(p) - 'prosrc' into strict after from pg_proc p where p.oid = fn;
  if after is distinct from before
    or (select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') from pg_proc where oid = fn) is distinct from post_image then
    raise exception 'g2_decimal_source_metadata_changed';
  end if;
end
$g2$;

commit;
