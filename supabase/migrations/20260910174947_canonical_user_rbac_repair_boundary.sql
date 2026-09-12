-- Offline whole-source R2/E2/S2 repair; never a standalone production migration.
-- Actual CLI2.101.0 skeleton: 20260910174947. Context is owner-run protocol only.
DO $repair$
DECLARE r record; obj text; col text; columns_sql text; roles_sql text; statement text;
BEGIN
 IF to_regclass('pg_temp.repair_context') IS NULL OR to_regclass('pg_temp.repair_reference') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='pg_temp.repair_context'::regclass
  AND relnamespace=pg_my_temp_schema() AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
  AND relacl IS NULL)
 OR (SELECT count(*) FROM pg_temp.repair_context WHERE database_name=current_database()
  AND backend=pg_backend_pid() AND txid=txid_current() AND stage='S2'
  AND hashes=(SELECT hashes FROM pg_temp.repair_reference))<>1 THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED'; END IF;
 -- Restore complete old-role rows by original UUID, never replace their identities.
 SELECT string_agg(format('%I = restored.%I',c,c),',' ORDER BY n) INTO columns_sql
 FROM unnest((SELECT role_columns FROM pg_temp.repair_context)) WITH ORDINALITY a(c,n) WHERE c<>'id';
 EXECUTE 'UPDATE public.roles AS live SET '||columns_sql||
  ' FROM pg_temp.repair_role_rows old CROSS JOIN LATERAL jsonb_populate_record(NULL::public.roles,old.row_value) restored WHERE live.id=old.id';
 -- REPAIR_TEST_INSIDE_W
 -- CREATE OR REPLACE preserves owner and existing ACL while restoring all options.
 EXECUTE (SELECT definition FROM pg_temp.repair_helper);
 -- Restore precisely S2's named policy preimages, including original absence.
 FOR r IN SELECT * FROM pg_temp.repair_tables ORDER BY table_name LOOP
  FOREACH obj IN ARRAY ARRAY['select','insert','update'] LOOP
   EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I','gridex_debug2_'||r.table_name||'_tenant_'||obj,r.table_name);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I %s ROW LEVEL SECURITY',r.table_name,CASE WHEN r.rls THEN 'ENABLE' ELSE 'DISABLE' END);
  EXECUTE format('ALTER TABLE public.%I %s FORCE ROW LEVEL SECURITY',r.table_name,CASE WHEN r.force_rls THEN '' ELSE 'NO' END);
 END LOOP;
 FOR r IN SELECT * FROM pg_temp.repair_policies ORDER BY table_name,policy_name LOOP
  statement:=format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',r.policy_name,r.table_name,
   CASE WHEN r.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
   CASE r.command WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,r.roles);
  IF r.using_expr IS NOT NULL THEN statement:=statement||' USING ('||r.using_expr||')'; END IF;
  IF r.check_expr IS NOT NULL THEN statement:=statement||' WITH CHECK ('||r.check_expr||')'; END IF;
  EXECUTE statement;
 END LOOP;
 -- New private diagnostics: all non-owner grant paths, including inherited and
 -- column privileges. Existing unrelated ACLs and memberships are unchanged.
 FOREACH obj IN ARRAY ARRAY['gridex_get_user_roles(uuid)','gridex_table_has_company_id(text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC',obj);
  FOR r IN SELECT rolname FROM pg_roles WHERE oid<>(SELECT proowner FROM pg_proc WHERE oid=('public.'||obj)::regprocedure) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I',obj,r.rolname);
  END LOOP;
 END LOOP;
 FOREACH obj IN ARRAY ARRAY['gridex_debug_batch2_rbac_v','gridex_debug_batch2_tenant_policy_gaps_v'] LOOP
  EXECUTE format('ALTER VIEW public.%I SET (security_invoker=true)',obj);
  FOR roles_sql IN SELECT 'PUBLIC' UNION ALL SELECT quote_ident(rolname) FROM pg_roles
   WHERE oid<>(SELECT relowner FROM pg_class WHERE oid=('public.'||obj)::regclass) LOOP
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s',obj,roles_sql);
   FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=('public.'||obj)::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM %s',col,obj,roles_sql);
   END LOOP;
  END LOOP;
 END LOOP;
 UPDATE pg_temp.repair_context SET stage='W';
END $repair$;
