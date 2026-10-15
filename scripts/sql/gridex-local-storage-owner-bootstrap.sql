-- PRIVATE proposal; not executed. Disposable official CLI2.101.0 ONLY.
-- Source owner channel: official b2f10f0169954f5d5ee4f03b49442666532f82fd
-- apps/cli-go/internal/db/start/start.go:297-316; separate Storage LOGIN.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Refuse filtering by RLS; never treat hidden rows as empty.
SET LOCAL row_security = off;
DO $storage_owner_local$
DECLARE
 objects_oid oid := pg_catalog.to_regclass('storage.objects');
 buckets_oid oid := pg_catalog.to_regclass('storage.buckets');
 owner_oid oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='supabase_storage_admin');
 before_snapshot jsonb;
 snapshot jsonb;
 relation_name text;
 rows_json jsonb;
 phase integer;
 actual_acl text[];
 known_acl constant text[] := ARRAY[
  'anon=arwdDxtm/supabase_storage_admin',
  'authenticated=arwdDxtm/supabase_storage_admin',
  'postgres=a*r*w*d*D*x*t*m*/supabase_storage_admin',
  'service_role=arwdDxtm/supabase_storage_admin',
  'supabase_storage_admin=arwdDxtm/supabase_storage_admin'];
 desired_acl constant text[] := ARRAY[
  'anon=arwd/supabase_storage_admin',
  'authenticated=arwd/supabase_storage_admin',
  'postgres=a*r*w*d*D*x*t*m*/supabase_storage_admin',
  'service_role=arwdDxtm/supabase_storage_admin',
  'supabase_storage_admin=a*r*w*d*D*x*t*m*/supabase_storage_admin'];
 expected_namespace_acl constant text[] := ARRAY[
  'anon=U/supabase_admin','authenticated=U/supabase_admin',
  'dashboard_user=UC/supabase_admin','postgres=U*/supabase_admin',
  'service_role=U/supabase_admin','supabase_admin=UC/supabase_admin',
  'supabase_storage_admin=U*C*/supabase_admin'];
 change_required boolean;
BEGIN
 IF current_user IS DISTINCT FROM 'supabase_storage_admin'
 OR session_user IS DISTINCT FROM 'supabase_storage_admin'
 OR current_database() IS DISTINCT FROM 'postgres'
 OR current_setting('server_version_num')::integer NOT BETWEEN 170006 AND 170006
 OR inet_server_addr() IS NULL OR inet_server_port() IS DISTINCT FROM 5432
 OR owner_oid IS NULL OR objects_oid IS NULL OR buckets_oid IS NULL THEN
  RAISE EXCEPTION 'local_storage_owner_identity_or_version_unknown';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE oid=owner_oid AND NOT rolsuper
  AND NOT rolinherit AND rolcanlogin AND NOT rolbypassrls AND NOT rolreplication)
 OR NOT EXISTS(SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
  WHERE n.nspname='storage' AND r.rolname='supabase_admin'
  AND ARRAY(SELECT a::text FROM unnest(n.nspacl) a ORDER BY a::text COLLATE "C")
    IS NOT DISTINCT FROM expected_namespace_acl)
 OR EXISTS(SELECT FROM pg_namespace WHERE nspname LIKE 'gridex\_%' ESCAPE '\')
 OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN('r','p','f','v','m','S')) THEN
  RAISE EXCEPTION 'local_storage_owner_namespace_or_pregridex_unknown';
 END IF;
 -- Both actual Storage tables must be owned by this session's exact role.
 IF (SELECT count(*) FROM pg_class WHERE oid IN(objects_oid,buckets_oid)
     AND relkind='r' AND relowner=owner_oid AND relpersistence='p'
     AND NOT relforcerowsecurity) IS DISTINCT FROM 2
 OR EXISTS(SELECT FROM pg_attribute WHERE attrelid IN(objects_oid,buckets_oid)
   AND attacl IS NOT NULL)
 OR EXISTS(SELECT FROM pg_event_trigger WHERE evtenabled<>'D'
   AND (evttags IS NULL OR evttags && ARRAY['GRANT','REVOKE'])) THEN
  RAISE EXCEPTION 'local_storage_table_or_acl_event_trigger_unknown';
 END IF;
 -- Acquire before ALL protected catalog and empty-row snapshots.
 LOCK TABLE storage.objects, storage.buckets IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT FROM storage.objects) OR EXISTS(SELECT FROM storage.buckets) THEN
  RAISE EXCEPTION 'local_storage_pregridex_requires_empty_tables';
 END IF;
 SELECT ARRAY(SELECT a::text FROM unnest(c.relacl) a ORDER BY a::text COLLATE "C")
 INTO actual_acl FROM pg_class c WHERE c.oid=objects_oid;
 IF actual_acl IS NOT DISTINCT FROM desired_acl THEN change_required:=false;
 ELSIF actual_acl IS NOT DISTINCT FROM known_acl THEN change_required:=true;
 ELSE RAISE EXCEPTION 'local_storage_unknown_complete_acl_profile'; END IF;

 FOR phase IN 1..2 LOOP
  IF phase=2 AND change_required THEN
   -- Actual object owner changes only its own pre-existing ACL tuples.
   GRANT ALL PRIVILEGES ON TABLE storage.objects
     TO supabase_storage_admin WITH GRANT OPTION;
   REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE storage.objects
     FROM anon, authenticated RESTRICT;
  END IF;
  snapshot := '{}'::jsonb;
  -- Complete rows, including function bodies/ABI/owners/ACLs and Auth metadata.
  -- No protected SQL function is created or replaced; snapshots remain private
  -- in this DO block and are never emitted to CI logs.
  FOREACH relation_name IN ARRAY ARRAY[
   'pg_namespace','pg_proc','pg_attribute','pg_attrdef','pg_index','pg_constraint',
   'pg_trigger','pg_policy','pg_rewrite','pg_depend','pg_shdepend','pg_default_acl',
   'pg_event_trigger','pg_type','pg_enum','pg_range','pg_collation','pg_description',
   'pg_seclabel','pg_foreign_table','pg_inherits','pg_roles','pg_auth_members'] LOOP
   EXECUTE format('SELECT coalesce(jsonb_agg(v ORDER BY v::text COLLATE "C"),''[]''::jsonb) FROM (SELECT to_jsonb(t) v FROM pg_catalog.%I t) q',relation_name)
     INTO rows_json;
   snapshot:=jsonb_set(snapshot,ARRAY[relation_name],rows_json);
  END LOOP;
  SELECT coalesce(jsonb_agg(v ORDER BY v::text COLLATE "C"),'[]'::jsonb)
  INTO rows_json FROM (
   SELECT CASE WHEN c.oid=objects_oid THEN to_jsonb(c)-'relacl'
          ELSE to_jsonb(c) END v FROM pg_class c) q;
  snapshot:=jsonb_set(snapshot,ARRAY['pg_class_except_target_acl'],rows_json);
  IF phase=1 THEN before_snapshot:=snapshot;
  ELSIF snapshot IS DISTINCT FROM before_snapshot THEN
   RAISE EXCEPTION 'local_storage_protected_catalog_changed';
  END IF;
 END LOOP;
 SELECT ARRAY(SELECT a::text FROM unnest(c.relacl) a ORDER BY a::text COLLATE "C")
 INTO actual_acl FROM pg_class c WHERE c.oid=objects_oid;
 IF actual_acl IS DISTINCT FROM desired_acl
 OR current_user IS DISTINCT FROM 'supabase_storage_admin'
 OR session_user IS DISTINCT FROM 'supabase_storage_admin'
 OR EXISTS(SELECT FROM storage.objects) OR EXISTS(SELECT FROM storage.buckets) THEN
  RAISE EXCEPTION 'local_storage_exact_native_postcondition_failed';
 END IF;
END
$storage_owner_local$;
COMMIT;
