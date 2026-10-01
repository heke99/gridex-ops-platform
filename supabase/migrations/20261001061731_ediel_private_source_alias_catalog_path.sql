-- Narrow hardening over the actual clean-replay private alias bodies.
-- Original logic, OID, owner, ACL, volatility and all other settings remain.
BEGIN;
DO $private_source_alias_catalog_path$
DECLARE spec record;before_record record;after_record record;expected_config text[];
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text)',
   'b7fa3112e3dc01935574d40783b6bc0ea55c7919fad97aad46bb5dc71c46162b'),
  ('gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid)',
   'f4fcc0c6746d6f54629e00daced7a2551f934c8dc03de748d330d1cdefbe496a')
 ) AS targets(identity,body_hash) LOOP
  SELECT p.*,to_jsonb(p)-'proconfig' unchanged_catalog
   INTO STRICT before_record FROM pg_catalog.pg_proc p
   WHERE p.oid=pg_catalog.to_regprocedure(spec.identity);
  IF before_record.prosecdef IS DISTINCT FROM true
   OR encode(sha256(convert_to(before_record.prosrc,'UTF8')),'hex') IS DISTINCT FROM spec.body_hash
   THEN RAISE EXCEPTION 'private_source_alias_body_review_required:%',spec.identity;END IF;
  IF (SELECT count(*) FROM unnest(before_record.proconfig) setting WHERE setting ~ '^search_path=')<>1
   THEN RAISE EXCEPTION 'private_source_alias_original_path_required:%',spec.identity;END IF;
  SELECT array_agg(CASE WHEN setting ~ '^search_path=' THEN 'search_path=pg_catalog' ELSE setting END ORDER BY ordinal)
   INTO expected_config
   FROM unnest(before_record.proconfig) WITH ORDINALITY AS config(setting,ordinal)
   ;
  EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path=pg_catalog',spec.identity);
  SELECT p.* INTO STRICT after_record FROM pg_catalog.pg_proc p WHERE p.oid=before_record.oid;
  IF to_jsonb(after_record)-'proconfig' IS DISTINCT FROM before_record.unchanged_catalog
   OR after_record.proconfig IS DISTINCT FROM expected_config
   OR pg_catalog.to_regprocedure(spec.identity) IS DISTINCT FROM before_record.oid
   THEN RAISE EXCEPTION 'private_source_alias_catalog_drift:%',spec.identity;END IF;
 END LOOP;
END
$private_source_alias_catalog_path$;
COMMIT;
