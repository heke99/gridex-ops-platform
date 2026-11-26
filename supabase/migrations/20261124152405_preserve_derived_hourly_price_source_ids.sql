-- Store the four market quarters behind a derived hourly interval price.
-- Earlier interval evidence keeps its primary source and a NULL quarter list.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $preserve$
DECLARE
  predecessor record;
  replacement text;
  before_columns constant text := 'amount_ex_vat,price_source_id,price_area,evidence_sha256';
  before_values constant text := $anchor$(x->>'amount_ex_vat')::numeric,nullif(x->>'price_source_id','')::uuid,x->>'price_area',$anchor$;
BEGIN
  SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT predecessor
  FROM pg_proc p
  WHERE p.oid = 'public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure;

  IF md5(predecessor.prosrc) <> 'df9f4832179bfdb91a209a96d13b1264'
     OR length(predecessor.prosrc)-length(replace(predecessor.prosrc,before_columns,'')) <> length(before_columns)
     OR length(predecessor.prosrc)-length(replace(predecessor.prosrc,before_values,'')) <> length(before_values) THEN
    RAISE EXCEPTION 'pricing_interval_evidence_writer_predecessor_changed';
  END IF;

  ALTER TABLE public.pricing_interval_evidence ADD COLUMN price_source_ids uuid[];
  ALTER TABLE public.pricing_interval_evidence
    ADD CONSTRAINT pricing_interval_evidence_hourly_quarters_check CHECK (
      price_source_ids IS NULL OR (
        array_ndims(price_source_ids) = 1
        AND array_lower(price_source_ids,1) = 1
        AND cardinality(price_source_ids) = 4
        AND array_position(price_source_ids,NULL::uuid) IS NULL
        AND price_source_id IS NOT NULL AND price_source_ids[1] = price_source_id
        AND price_source_ids[1] <> ALL(price_source_ids[2:4])
        AND price_source_ids[2] <> ALL(price_source_ids[3:4])
        AND price_source_ids[3] <> price_source_ids[4]
      )
    ) NOT VALID;

  replacement := replace(predecessor.prosrc,before_columns,
    'amount_ex_vat,price_source_id,price_source_ids,price_area,evidence_sha256');
  replacement := replace(replacement,before_values,$changed$(x->>'amount_ex_vat')::numeric,nullif(x->>'price_source_id','')::uuid,
    case when x ? 'price_source_ids' then array(
      select source.value::uuid
      from jsonb_array_elements_text(x->'price_source_ids') with ordinality source(value, position)
      order by source.position
    ) end,x->>'price_area',$changed$);
  EXECUTE replace(predecessor.definition,predecessor.prosrc,replacement);

  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=predecessor.oid) IS DISTINCT FROM predecessor.metadata
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=predecessor.oid) IS DISTINCT FROM replacement THEN
    RAISE EXCEPTION 'pricing_interval_evidence_writer_metadata_changed';
  END IF;
END
$preserve$;

RESET statement_timeout;
RESET lock_timeout;
