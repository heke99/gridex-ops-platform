-- LOC+175 is an SG5 identity before SEQ. A misplaced occurrence after SEQ
-- cannot make the same physical IDE a safe LOC+172 point or a positive
-- regulating-object series. This is an internal refusal, not a national ERC.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.unowned_regulating_object_v1(tokens jsonb, transaction_id text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM jsonb_array_elements(tokens) ide
  JOIN jsonb_array_elements(tokens) loc ON (loc->>'index')::integer>(ide->>'index')::integer
  WHERE ide->>'tag'='IDE' AND ide#>>'{elements,1,0}'='24'
   AND ide#>>'{elements,2,0}'=transaction_id
   AND loc->>'tag'='LOC' AND loc#>>'{elements,1,0}'='175'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tokens) boundary
    WHERE boundary->>'tag' IN ('IDE','UNT')
     AND (boundary->>'index')::integer>(ide->>'index')::integer
     AND (boundary->>'index')::integer<(loc->>'index')::integer)
 )
$$;

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
 -- The point locator is in the SG5 header, but any LOC+175 before the next
 -- physical IDE/UNT makes that transaction ineligible for point consumption.
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LOC'
   AND t#>>'{elements,1,0}'='175' AND (t->>'index')::integer>start_at
   AND (t->>'index')::integer<end_at) THEN RETURN NULL; END IF;
 SELECT min((t->>'index')::integer) INTO stop_at FROM jsonb_array_elements(tokens) t
  WHERE (t->>'index')::integer>start_at AND t->>'tag' IN ('IDE','SEQ','UNT');
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
-- Both functions retain their private signatures and existing privileges.
COMMIT;
