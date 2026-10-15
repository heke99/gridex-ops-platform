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
 -- Only command-start/end hooks can observe these GRANT/REVOKE commands.
 -- sql_drop/table_rewrite hooks cannot fire for this owner-only ACL operation.
 -- One official PG17.6.1.155 invoker hook is source-proven inert for these tags:
 -- its exact body only reads ddl_commands and NOTIFYs for an explicit whitelist
 -- that EXCLUDES GRANT/REVOKE. Unknown applicable hooks still fail closed.
 OR EXISTS(SELECT FROM pg_event_trigger e LEFT JOIN pg_proc p ON p.oid=e.evtfoid
   WHERE e.evtenabled<>'D'
   AND e.evtevent IN('ddl_command_start','ddl_command_end')
   AND (e.evttags IS NULL OR e.evttags && ARRAY['GRANT','REVOKE'])
   AND (
    e.evtname='pgrst_ddl_watch' AND e.evtevent='ddl_command_end'
    AND e.evtenabled='O' AND e.evttags IS NULL
    AND pg_get_userbyid(e.evtowner)='supabase_admin'
    AND EXISTS(SELECT FROM pg_namespace n
      WHERE n.oid=p.pronamespace AND n.nspname='extensions')
    AND p.proname='pgrst_ddl_watch'
    AND pg_get_userbyid(p.proowner)='supabase_admin'
    AND (SELECT lanname FROM pg_language WHERE oid=p.prolang)='plpgsql'
    AND p.prokind='f' AND p.prorettype='event_trigger'::regtype
    AND p.pronargs=0 AND p.proargtypes=''::oidvector
    AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.proargnames IS NULL
    AND p.pronargdefaults=0 AND p.proargdefaults IS NULL AND p.provariadic=0
    AND NOT p.proretset AND NOT p.prosecdef AND NOT p.proisstrict
    AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
    AND p.procost=100 AND p.prorows=0 AND p.prosupport=0
    AND p.protrftypes IS NULL AND p.probin IS NULL AND p.prosqlbody IS NULL
    AND p.proconfig IS NULL
    AND octet_length(convert_to(p.prosrc,'UTF8'))=729
    AND md5(p.prosrc)='7f27b8118fea5c88b0164331292859e3'
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
      'de987df746eb39647098459e7993bd8595e592969b0cd647828a3d13d37cffe0'
   ) IS NOT TRUE) THEN
  -- Diagnostic metadata ONLY; the original refusal/rollback remains below.
  -- No rows, credentials, function bodies or unrelated catalogs are emitted.
  RAISE NOTICE 'local_storage_table_guard_diagnostic %', jsonb_build_object(
   'currentUser',current_user,'sessionUser',session_user,
   'storageOwnerRole',(SELECT jsonb_build_object('oid',r.oid,'name',r.rolname,
     'super',r.rolsuper,'inherit',r.rolinherit,'login',r.rolcanlogin,
     'bypassRls',r.rolbypassrls,'replication',r.rolreplication,
     'createRole',r.rolcreaterole,'createDb',r.rolcreatedb)
     FROM pg_roles r WHERE r.oid=owner_oid),
   'tablePredicateMatchCount',(SELECT count(*) FROM pg_class
     WHERE oid IN(objects_oid,buckets_oid) AND relkind='r'
       AND relowner=owner_oid AND relpersistence='p' AND NOT relforcerowsecurity),
   'tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',c.oid,
     'identity',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),
     'kind',c.relkind::text,'persistence',c.relpersistence::text,
     'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity)
     ORDER BY c.oid),'[]'::jsonb) FROM pg_class c
     WHERE c.oid IN(objects_oid,buckets_oid)),
   'columnAclRows',(SELECT coalesce(jsonb_agg(jsonb_build_object(
     'relation',a.attrelid::regclass::text,'number',a.attnum,'name',a.attname,
     'dropped',a.attisdropped,'acl',to_jsonb(a.attacl))
     ORDER BY a.attrelid,a.attnum),'[]'::jsonb) FROM pg_attribute a
     WHERE a.attrelid IN(objects_oid,buckets_oid) AND a.attacl IS NOT NULL),
   'eventsMatchingExistingPredicate',(SELECT coalesce(jsonb_agg(
     jsonb_build_object('oid',e.oid,'name',e.evtname,'event',e.evtevent,
       'enabled',e.evtenabled::text,'tags',to_jsonb(e.evttags),
       'owner',pg_get_userbyid(e.evtowner),'function',p.oid::regprocedure::text,
       'functionOwner',pg_get_userbyid(p.proowner),
       'functionSecurityDefiner',p.prosecdef,
       'functionConfig',(SELECT jsonb_agg(CASE
         WHEN split_part(setting,'=',1)='search_path' THEN setting
         ELSE split_part(setting,'=',1)||'=<redacted>' END ORDER BY ordinal)
         FROM unnest(p.proconfig) WITH ORDINALITY config(setting,ordinal)),
       'functionConfigSHA256',encode(sha256(convert_to(
         coalesce(to_jsonb(p.proconfig)::text,'null'),'UTF8')),'hex'),
       'functionBodySHA256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
     ORDER BY e.oid),'[]'::jsonb) FROM pg_event_trigger e
     LEFT JOIN pg_proc p ON p.oid=e.evtfoid WHERE e.evtenabled<>'D'
       AND (e.evttags IS NULL OR e.evttags && ARRAY['GRANT','REVOKE'])));
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
