-- Owner-private reference only. The shared legacy mutex precedes all catalog reads.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public,extensions,pg_temp;
SELECT pg_catalog.pg_advisory_xact_lock(20260910, 140053);
DO $repair$
DECLARE r record; rel oid;
BEGIN
 IF to_regclass('pg_temp.repair_reference') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ENVELOPE_REQUIRED'; END IF;
 -- All actual-prefix tables are locked in qualified-name order. Stronger
 -- offline locks also serialize parent/trigger/DDL dependencies without upgrades.
 FOR r IN SELECT key FROM jsonb_each((SELECT base FROM pg_temp.repair_reference))
 WHERE key LIKE 'relation/%' AND value->>'kind' IN ('r','p') ORDER BY key LOOP
  rel := to_regclass(substr(r.key,10));
  IF rel IS NULL THEN RAISE EXCEPTION USING ERRCODE='42P01',MESSAGE='CATALOG_MISMATCH'; END IF;
  EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',rel::regclass);
 END LOOP;
END $repair$;
-- REPAIR_CATALOG_CAPTURE
CREATE TEMP TABLE repair_context(database_name name,backend integer,txid bigint,hashes text[],stage text,
 role_columns text[]) ON COMMIT DROP;
CREATE TEMP TABLE repair_rows(relation_name text,row_value jsonb) ON COMMIT DROP;
CREATE TEMP TABLE repair_role_rows(id uuid PRIMARY KEY,row_value jsonb) ON COMMIT DROP;
CREATE TEMP TABLE repair_sequences(relation_name text PRIMARY KEY,row_value jsonb) ON COMMIT DROP;
CREATE TEMP TABLE repair_policies(table_name text,policy_name text,command text,permissive boolean,
 roles text,using_expr text,check_expr text) ON COMMIT DROP;
CREATE TEMP TABLE repair_tables(table_name text PRIMARY KEY,rls boolean,force_rls boolean) ON COMMIT DROP;
CREATE TEMP TABLE repair_helper(definition text) ON COMMIT DROP;
DO $repair$
DECLARE shape jsonb; base jsonb; final_shape jsonb; r record; t text; rel oid;
BEGIN
 SELECT catalog INTO STRICT shape FROM pg_temp.repair_catalog_before;
 SELECT x.base,x.final INTO STRICT base,final_shape FROM pg_temp.repair_reference x;
 IF EXISTS (SELECT 1 FROM public.user_roles) OR EXISTS (SELECT 1 FROM public.company_invitations) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DIRTY_DATA'; END IF;
 -- Reject all alias identities, including aliases currently shielded by a
 -- canonical row. They are never admitted as canonical role identifiers.
 IF EXISTS (SELECT 1 FROM public.roles WHERE
   (nullif(btrim(coalesce(key,'')),'') IS NULL AND nullif(btrim(coalesce(name,'')),'') IS NOT NULL)
   OR key=ANY(ARRAY['superadmin','platform_super_admin','companyadmin','tenant_admin','company_owner',
    'bolagsansvarig','support','customer_service','kundservice','finance','ekonomi','compliance_officer']))
 OR EXISTS (SELECT key FROM public.roles WHERE key IS NOT NULL GROUP BY key HAVING count(*)>1)
 OR EXISTS (SELECT 1 FROM public.roles a JOIN public.roles b ON lower(btrim(a.name))=lower(btrim(b.key)) AND a.id<>b.id)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DIRTY_DATA'; END IF;
 IF shape IS DISTINCT FROM base AND shape IS DISTINCT FROM final_shape THEN
  IF EXISTS (SELECT 1 FROM jsonb_each(shape) a WHERE
   (a.key LIKE 'trigger/%' OR a.key LIKE 'rule/%') AND a.value IS DISTINCT FROM base->a.key
   AND a.value IS DISTINCT FROM final_shape->a.key) THEN
   RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='UNEXPECTED_TRIGGER'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(base) a WHERE a.key LIKE 'column/%' AND NOT shape ? a.key) THEN
   RAISE EXCEPTION USING ERRCODE='42703',MESSAGE='CATALOG_MISMATCH'; END IF;
  RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='CATALOG_MISMATCH';
 END IF;
 -- Restoring role rows must never generate additional transactional history.
 IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.roles'::regclass AND NOT tgisinternal AND tgenabled<>'D')
 OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN
  RAISE EXCEPTION USING ERRCODE='P0004',MESSAGE='UNEXPECTED_TRIGGER'; END IF;
 -- REPAIR_DIAGNOSTIC_GUARD
 -- Selected39 supplies read/write helpers (write also calls company_is_writable).
 -- Full reference equality above binds their actual bodies/options/owners/ACLs.
 FOREACH t IN ARRAY ARRAY['gridex_can_read_company(uuid)','gridex_can_write_company(uuid)',
 'gridex_company_is_writable(uuid)','gridex_user_is_platform_admin()'] LOOP
  IF to_regprocedure('public.'||t) IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='CATALOG_MISMATCH'; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['customer_blockers','customer_authorization_documents','customer_documents',
 'customer_contacts','customer_internal_notes','customer_info_requests','customer_info_request_events',
 'authorization_scopes','metering_permissions','power_of_attorney_scopes','customer_lifecycle_events',
 'customer_lifecycle_decisions','customer_cases','grid_owner_data_requests','partner_exports',
 'outbound_dispatch_events','supplier_switch_events'] LOOP
  rel:=to_regclass(format('public.%I',t));
  IF rel IS NOT NULL THEN
   IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=rel AND relkind IN ('r','p'))
   OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=rel AND attname='company_id'
    AND atttypid='uuid'::regtype AND attgenerated='' AND NOT attisdropped) THEN
    RAISE EXCEPTION USING ERRCODE='42804',MESSAGE='CATALOG_MISMATCH'; END IF;
   INSERT INTO repair_tables SELECT t,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=rel;
   INSERT INTO repair_policies
   SELECT t,p.polname,p.polcmd,p.polpermissive,
    (SELECT string_agg(CASE WHEN u=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(u)) END,',' ORDER BY u) FROM unnest(p.polroles) u),
    pg_get_expr(p.polqual,p.polrelid,false),pg_get_expr(p.polwithcheck,p.polrelid,false)
   FROM pg_policy p WHERE p.polrelid=rel AND p.polname=ANY(ARRAY['gridex_debug2_'||t||'_tenant_select',
     'gridex_debug2_'||t||'_tenant_insert','gridex_debug2_'||t||'_tenant_update']);
  END IF;
 END LOOP;
 INSERT INTO repair_context SELECT current_database(),pg_backend_pid(),txid_current(),hashes,'admitted',
 ARRAY(SELECT attname FROM pg_attribute WHERE attrelid='public.roles'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum)
 FROM repair_reference;
 INSERT INTO repair_role_rows SELECT role_row.id,to_jsonb(role_row) FROM public.roles AS role_row;
 INSERT INTO repair_helper SELECT pg_get_functiondef('public.gridex_user_is_platform_admin()'::regprocedure);
 FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','S')
 AND NOT (n.nspname='public' AND c.relname='roles') ORDER BY n.nspname,c.relname LOOP
  IF r.relkind='S' THEN
   EXECUTE format('INSERT INTO repair_sequences SELECT %L,jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called) FROM %I.%I',format('%I.%I',r.nspname,r.relname),r.nspname,r.relname);
  ELSE
   EXECUTE format('INSERT INTO repair_rows SELECT %L,to_jsonb(x) FROM %I.%I x',format('%I.%I',r.nspname,r.relname),r.nspname,r.relname);
  END IF;
 END LOOP;
END $repair$;
-- REPAIR_SEED_ORACLE
