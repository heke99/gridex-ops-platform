-- A malformed or misplaced envelope has no trustworthy point scope.
-- Rebuild stored values when tightening the immutable parser.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_received_sources.source_wire_point_v1(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v1(p_raw);
 n integer; valid_n integer; point text;
BEGIN
 IF tokens IS NULL THEN RETURN NULL; END IF;
 n:=jsonb_array_length(tokens);
 IF n<8 OR tokens->0->>'tag' IS DISTINCT FROM 'UNB' OR tokens->1->>'tag' IS DISTINCT FROM 'UNH'
 OR tokens->(n-2)->>'tag' IS DISTINCT FROM 'UNT' OR tokens->(n-1)->>'tag' IS DISTINCT FROM 'UNZ'
 OR tokens->0#>>'{elements,1,1}' IS DISTINCT FROM '3'
 OR tokens->1#>>'{elements,2,0}' IS DISTINCT FROM 'PRODAT'
 OR tokens->1#>'{elements,1}' IS DISTINCT FROM jsonb_build_array(tokens->1#>>'{elements,1,0}')
 OR nullif(tokens->1#>>'{elements,1,0}','') IS NULL
 OR tokens->(n-2)#>'{elements,1}' IS DISTINCT FROM jsonb_build_array((n-2)::text)
 OR tokens->(n-2)#>'{elements,2}' IS DISTINCT FROM tokens->1#>'{elements,1}'
 OR tokens->(n-1)#>'{elements,1}' IS DISTINCT FROM '["1"]'::jsonb
 OR tokens->0#>'{elements,5}' IS DISTINCT FROM jsonb_build_array(tokens->0#>>'{elements,5,0}')
 OR nullif(tokens->0#>>'{elements,5,0}','') IS NULL
 OR EXISTS (SELECT FROM (VALUES ('UNB'),('UNH'),('UNT'),('UNZ'),('BGM')) AS required(tag)
   WHERE (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'=required.tag)<>1)
 OR EXISTS (SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM'
  AND ((t->>'index')::integer<=1 OR (t->>'index')::integer >=
   (SELECT min((l->>'index')::integer) FROM jsonb_array_elements(tokens) l WHERE l->>'tag'='LIN')))
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM'
  AND t#>'{elements,1}' IN ('["Z04"]'::jsonb,'["Z05"]'::jsonb,
   '["Z06"]'::jsonb,'["Z10"]'::jsonb))<>1
 OR tokens->0#>>'{elements,5,0}' IS DISTINCT FROM tokens->(n-1)#>>'{elements,2,0}' THEN RETURN NULL; END IF;
 SELECT count(*),count(*) FILTER (WHERE t#>>'{elements,3,3}'='9'
  AND nullif(t#>>'{elements,3,0}','') IS NOT NULL),max(t#>>'{elements,3,0}')
 INTO n,valid_n,point FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';
 IF n=1 AND valid_n=1 AND length(point)<=128 THEN RETURN point; END IF;
 RETURN NULL;
END $$;

ALTER TABLE gridex_received_sources.sources DROP COLUMN scope_point;
ALTER TABLE gridex_received_sources.sources ADD COLUMN scope_point text
 GENERATED ALWAYS AS (gridex_received_sources.source_wire_point_v1(raw_payload)) STORED;
CREATE INDEX sources_combined_scope_point_idx
 ON gridex_received_sources.sources(company_id,environment,scope_point,captured_at);
COMMIT;
