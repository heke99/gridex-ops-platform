-- The independent reference is complete first52 plus source-declared safe deltas.
-- REPAIR_CATALOG_CAPTURE
DO $repair$
DECLARE r record; result boolean; shape jsonb; role_name text; obj text;
BEGIN
 IF (SELECT count(*) FROM pg_temp.repair_context WHERE database_name=current_database()
  AND backend=pg_backend_pid() AND txid=txid_current() AND stage='W')<>1 THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED'; END IF;
 SELECT catalog INTO STRICT shape FROM pg_temp.repair_catalog_after;
 IF shape IS DISTINCT FROM (SELECT final FROM pg_temp.repair_reference) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
 FOR r IN SELECT key FROM jsonb_each((SELECT catalog FROM pg_temp.repair_catalog_before))
 WHERE key LIKE 'relation/%' AND value->>'kind' IN ('r','p') AND key<>'relation/public.roles' LOOP
  EXECUTE format('SELECT NOT EXISTS ((SELECT to_jsonb(x) FROM %s x EXCEPT ALL SELECT row_value FROM pg_temp.repair_rows WHERE relation_name=%L) UNION ALL (SELECT row_value FROM pg_temp.repair_rows WHERE relation_name=%L EXCEPT ALL SELECT to_jsonb(x) FROM %s x))',substr(r.key,10),substr(r.key,10),substr(r.key,10),substr(r.key,10)) INTO result;
  IF result IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
 END LOOP;
 FOR r IN SELECT * FROM pg_temp.repair_sequences LOOP
  EXECUTE format('SELECT to_jsonb(x)=%L::jsonb FROM %s x',r.row_value,r.relation_name) INTO result;
  IF result IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
 END LOOP;
 IF EXISTS ((SELECT to_jsonb(a) FROM public.roles a JOIN pg_temp.repair_role_rows b ON a.id=b.id
  EXCEPT ALL SELECT row_value FROM pg_temp.repair_role_rows)
 UNION ALL (SELECT row_value FROM pg_temp.repair_role_rows EXCEPT ALL
  SELECT to_jsonb(a) FROM public.roles a JOIN pg_temp.repair_role_rows b ON a.id=b.id)) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
 -- Only the independently derived missing seed subset may be new. Its UUID is
 -- mapped by unique key; every other source default/value remains exact.
 IF EXISTS ((SELECT to_jsonb(a)-'id' FROM public.roles a WHERE NOT EXISTS(SELECT 1 FROM pg_temp.repair_role_rows b WHERE b.id=a.id)
  EXCEPT ALL SELECT to_jsonb(e)-'id' FROM pg_temp.repair_expected_roles e)
 UNION ALL (SELECT to_jsonb(e)-'id' FROM pg_temp.repair_expected_roles e EXCEPT ALL
  SELECT to_jsonb(a)-'id' FROM public.roles a WHERE NOT EXISTS(SELECT 1 FROM pg_temp.repair_role_rows b WHERE b.id=a.id))) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
 IF EXISTS (SELECT 1 FROM public.user_roles) OR EXISTS (SELECT 1 FROM public.company_invitations) THEN
  RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','authenticator','service_role'] LOOP
  FOREACH obj IN ARRAY ARRAY['gridex_get_user_roles(uuid)','gridex_table_has_company_id(text)'] LOOP
   IF has_function_privilege(role_name,'public.'||obj,'EXECUTE') THEN
    RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
  END LOOP;
  FOREACH obj IN ARRAY ARRAY['gridex_debug_batch2_rbac_v','gridex_debug_batch2_tenant_policy_gaps_v'] LOOP
   IF has_table_privilege(role_name,'public.'||obj,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege(role_name,'public.'||obj,'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION USING ERRCODE='P0003',MESSAGE='PRESERVATION_FAILED'; END IF;
  END LOOP;
 END LOOP;
 UPDATE pg_temp.repair_context SET stage='completed';
END $repair$;
SELECT 'REPAIR_STAGE_COMPLETED';
