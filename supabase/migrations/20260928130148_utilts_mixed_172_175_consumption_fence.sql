-- The source-bound RPC and both sink RPCs call this private physical point
-- selector. A regulating object in the same IDE header must not borrow the
-- otherwise valid LOC+172 point and its meter/billing contract. This is a
-- fail-closed scope fence, not a positive LOC+175 object implementation or a
-- historical 203/505 uniqueness decision.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.supported_point_v1(tokens jsonb, transaction_id text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE first_ide integer; start_at integer; stop_at integer; point jsonb; party jsonb; role_name text;
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
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t
  WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','SEQ','UNT');
 -- TS consumptionIdentity inspects this same IDE header. A second physical
 -- LOC+175 is an ambiguous object domain even when LOC+172 is well formed.
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LOC'
   AND t#>>'{elements,1,0}'='175' AND (t->>'index')::integer>start_at
   AND (t->>'index')::integer<stop_at) THEN RETURN NULL; END IF;
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
-- CREATE OR REPLACE retains the existing private function signature and
-- privileges; do not grant it through the Data API.
COMMIT;
