-- SG5 LOC+172 identifies a point before SEQ. A second LOC+172 later in the
-- same physical IDE cannot leave the first one eligible for positive series.
-- This private refusal makes no national error-code or historical claim.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.supported_point_v1(tokens jsonb, transaction_id text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE first_ide integer; start_at integer; stop_at integer; end_at integer; point jsonb; party jsonb; role_name text;
BEGIN
 SELECT min((t->>'index')::integer) INTO first_ide FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE';
 FOREACH role_name IN ARRAY ARRAY['MS','MR'] LOOP
  SELECT jsonb_agg(t) INTO party FROM jsonb_array_elements(tokens) t
   WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=role_name AND (t->>'index')::integer<first_ide;
  IF jsonb_array_length(party) IS DISTINCT FROM 1 OR party#>'{0,elements,1}' IS DISTINCT FROM jsonb_build_array(role_name)
   OR jsonb_array_length(party#>'{0,elements,2}') IS DISTINCT FROM 3
   OR nullif(btrim(party#>>'{0,elements,2,0}'),'') IS NULL
   OR party#>>'{0,elements,2,0}' IS DISTINCT FROM btrim(party#>>'{0,elements,2,0}')
   OR party#>>'{0,elements,2,1}' IS DISTINCT FROM 'SVK' OR party#>>'{0,elements,2,2}' IS DISTINCT FROM '260' THEN RETURN NULL; END IF;
 END LOOP;
 SELECT jsonb_agg(t) INTO point FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE' AND t#>>'{elements,2,0}'=transaction_id;
 IF jsonb_array_length(point) IS DISTINCT FROM 1 OR point#>'{0,elements,1}' IS DISTINCT FROM '["24"]'::jsonb
  OR point#>'{0,elements,2}' IS DISTINCT FROM jsonb_build_array(transaction_id) THEN RETURN NULL; END IF;
 start_at:=(point#>>'{0,index}')::integer;
 SELECT min((t->>'index')::integer) INTO end_at FROM jsonb_array_elements(tokens) t
  WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','UNT');
 IF end_at IS NULL THEN RETURN NULL; END IF;
 -- Preserve the previously reviewed LOC+175 physical-IDE refusal.
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LOC'
   AND t#>>'{elements,1,0}'='175' AND (t->>'index')::integer>start_at
   AND (t->>'index')::integer<end_at) THEN RETURN NULL; END IF;
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t
  WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','SEQ','UNT');
 -- A post-SEQ LOC+172 is still inside this IDE, even though it is outside
 -- the SG5 header selected below. Earlier duplicate LOC+172 is caught there.
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LOC'
   AND t#>>'{elements,1,0}'='172' AND (t->>'index')::integer>=stop_at
   AND (t->>'index')::integer<end_at) THEN RETURN NULL; END IF;
 SELECT jsonb_agg(t) INTO point FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LOC' AND t#>>'{elements,1,0}'='172'
  AND (t->>'index')::integer>start_at AND (t->>'index')::integer<stop_at;
 IF jsonb_array_length(point) IS DISTINCT FROM 1 OR point#>'{0,elements,1}' IS DISTINCT FROM '["172"]'::jsonb
  OR jsonb_array_length(point#>'{0,elements,2}') IS DISTINCT FROM 3
  OR point#>>'{0,elements,2,1}' IS DISTINCT FROM '' OR point#>>'{0,elements,2,2}' IS DISTINCT FROM '9'
  OR nullif(btrim(point#>>'{0,elements,2,0}'),'') IS NULL
  OR point#>>'{0,elements,2,0}' IS DISTINCT FROM btrim(point#>>'{0,elements,2,0}')
  OR point#>>'{0,elements,2,0}' ~ '[[:cntrl:]]' THEN RETURN NULL; END IF;
 RETURN point#>>'{0,elements,2,0}';
END $$;
-- Same private signature, owner and grants; no Data API entry point is added.
COMMIT;
