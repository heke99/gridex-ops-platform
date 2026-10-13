-- Complete one missing deployed guard; the canonical schema already contains it.
-- One atomic statement: no business-row writes, role/table/policy creation, or
-- historical replay. Existing canonical installations are strictly read-only.
DO $forward$
DECLARE
 migration_role name := current_user;
 owner_id oid := to_regrole('gridex_ediel_retention_owner')::oid;
 service_id oid := to_regrole('service_role')::oid;
 public_id oid := to_regnamespace('public')::oid;
 private_id oid := to_regnamespace('gridex_ediel_retention')::oid;
 contract_id oid := to_regclass('public.customer_contracts')::oid;
 tombstone_id oid;
 function_id oid;
 owner_had_create boolean;
 schema_acl aclitem[];
 schema_owner oid;
 app_role text;
 expected record;
 canonical_body constant text := $body$BEGIN
 PERFORM id FROM public.customer_contracts WHERE id=p_contract_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_contract_record_scope_required';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND contract_id=p_contract_id) THEN RAISE EXCEPTION 'customer_contract_records_retention_tombstoned';END IF;
END$body$;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(20261013,40000);
 -- The migration driver has SET membership, not inherited private USAGE.
 -- Resolve this prerequisite from catalogs without entering the private schema.
 SELECT oid INTO tombstone_id FROM pg_catalog.pg_class
   WHERE relnamespace=private_id AND relname='record_tombstones';
 IF owner_id IS NULL OR service_id IS NULL OR public_id IS NULL OR private_id IS NULL
 OR contract_id IS NULL OR tombstone_id IS NULL
 OR migration_role IN('anon','authenticated','authenticator','service_role','gridex_ediel_retention_owner') THEN
  RAISE EXCEPTION 'ops_api_contract_guard_prerequisite_required';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE oid=owner_id AND NOT rolcanlogin AND NOT rolinherit
   AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_namespace WHERE oid=private_id AND nspowner=owner_id)
 OR pg_catalog.pg_has_role(migration_role,owner_id,'SET') IS NOT TRUE
 OR pg_catalog.has_schema_privilege(owner_id,public_id,'USAGE') IS NOT TRUE
 OR pg_catalog.has_schema_privilege(owner_id,private_id,'USAGE') IS NOT TRUE
 OR pg_catalog.has_table_privilege(owner_id,tombstone_id,'SELECT') IS NOT TRUE THEN
  RAISE EXCEPTION 'ops_api_contract_guard_private_owner_required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_class WHERE oid=contract_id AND relnamespace=public_id
   AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity)
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_class WHERE oid=tombstone_id AND relnamespace=private_id
   AND relkind='r' AND relowner=owner_id AND relrowsecurity AND relforcerowsecurity) THEN
  RAISE EXCEPTION 'ops_api_contract_guard_relation_rls_required';
 END IF;
 -- Full UUID scope columns are required; no defaults or coercion are introduced.
 FOR expected IN SELECT * FROM (VALUES
   (contract_id,'id',true),(contract_id,'company_id',true),
   (tombstone_id,'company_id',true),(tombstone_id,'contract_id',false)
 ) AS x(relation_id,column_name,required_not_null) LOOP
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_attribute WHERE attrelid=expected.relation_id
    AND attname=expected.column_name AND attnum>0 AND NOT attisdropped
    AND atttypid='pg_catalog.uuid'::regtype AND atttypmod=-1
    AND attnotnull=expected.required_not_null AND attgenerated='' AND attidentity='') THEN
   RAISE EXCEPTION 'ops_api_contract_guard_scope_column_required: %',expected.column_name;
  END IF;
 END LOOP;
 -- No ordinary actor can enter the private owner/schema or read tombstones.
 FOREACH app_role IN ARRAY ARRAY['anon','authenticated','authenticator','service_role'] LOOP
  IF to_regrole(app_role) IS NULL OR pg_catalog.pg_has_role(app_role,owner_id,'MEMBER')
  OR pg_catalog.has_schema_privilege(app_role,private_id,'USAGE,CREATE')
  OR pg_catalog.has_table_privilege(app_role,tombstone_id,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
  OR pg_catalog.has_any_column_privilege(app_role,tombstone_id,'SELECT,INSERT,UPDATE,REFERENCES') THEN
   RAISE EXCEPTION 'ops_api_contract_guard_private_acl_required' USING ERRCODE='42501';
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM pg_catalog.pg_namespace n,
   LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
   WHERE n.oid=private_id AND a.grantee<>owner_id)
 OR EXISTS(SELECT FROM pg_catalog.pg_class c,
   LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
   WHERE c.oid=tombstone_id AND a.grantee<>owner_id)
 OR EXISTS(SELECT FROM pg_catalog.pg_attribute a,
   LATERAL pg_catalog.aclexplode(a.attacl) g
   WHERE a.attrelid=tombstone_id AND g.grantee<>owner_id) THEN
  RAISE EXCEPTION 'ops_api_contract_guard_private_acl_required' USING ERRCODE='42501';
 END IF;
 -- The guard locks rows but does not insert/delete records or grant capabilities.
 IF pg_catalog.has_table_privilege(owner_id,contract_id,'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
 OR pg_catalog.has_table_privilege(owner_id,contract_id,'SELECT WITH GRANT OPTION,UPDATE WITH GRANT OPTION')
 OR pg_catalog.has_any_column_privilege(owner_id,contract_id,'SELECT WITH GRANT OPTION,UPDATE WITH GRANT OPTION')
 OR pg_catalog.has_any_column_privilege(owner_id,contract_id,'INSERT,REFERENCES') THEN
  RAISE EXCEPTION 'ops_api_contract_guard_contract_owner_acl_required' USING ERRCODE='42501';
 END IF;
 function_id := to_regprocedure('public.ediel_require_contract_records_available_v1(uuid,uuid)')::oid;
 IF EXISTS(SELECT FROM pg_catalog.pg_proc WHERE pronamespace=public_id
   AND proname='ediel_require_contract_records_available_v1' AND oid IS DISTINCT FROM function_id) THEN
  RAISE EXCEPTION 'ops_api_contract_guard_unknown_overload';
 END IF;
 IF function_id IS NULL THEN
  IF pg_catalog.has_schema_privilege(migration_role,public_id,'CREATE WITH GRANT OPTION') IS NOT TRUE
  OR pg_catalog.has_table_privilege(migration_role,contract_id,'SELECT WITH GRANT OPTION') IS NOT TRUE
  OR pg_catalog.has_table_privilege(migration_role,contract_id,'UPDATE WITH GRANT OPTION') IS NOT TRUE THEN
   RAISE EXCEPTION 'ops_api_contract_guard_migration_grant_authority_required' USING ERRCODE='42501';
  END IF;
  SELECT nspacl,nspowner INTO schema_acl,schema_owner FROM pg_catalog.pg_namespace WHERE oid=public_id;
  owner_had_create := pg_catalog.has_schema_privilege(owner_id,public_id,'CREATE');
  -- FOR SHARE requires UPDATE as well as SELECT, even for a BYPASSRLS owner.
  GRANT SELECT,UPDATE ON TABLE public.customer_contracts TO gridex_ediel_retention_owner;
  IF NOT owner_had_create THEN GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner; END IF;
  EXECUTE 'SET LOCAL ROLE gridex_ediel_retention_owner';
  EXECUTE pg_catalog.format(
   'CREATE FUNCTION public.ediel_require_contract_records_available_v1(p_company_id uuid,p_contract_id uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog AS %L',
   canonical_body);
  REVOKE ALL ON FUNCTION public.ediel_require_contract_records_available_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,authenticator;
  GRANT EXECUTE ON FUNCTION public.ediel_require_contract_records_available_v1(uuid,uuid) TO service_role;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migration_role);
  IF NOT owner_had_create THEN REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner; END IF;
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_namespace WHERE oid=public_id AND nspowner=schema_owner
    AND nspacl IS NOT DISTINCT FROM schema_acl) THEN
   RAISE EXCEPTION 'ops_api_contract_guard_public_schema_restore_required';
  END IF;
  function_id := to_regprocedure('public.ediel_require_contract_records_available_v1(uuid,uuid)')::oid;
 END IF;
 -- This same final verification is the present-canonical strict no-op branch.
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=function_id AND p.pronamespace=public_id AND p.proowner=owner_id AND l.lanname='plpgsql'
   AND p.prokind='f' AND p.pronargs=2 AND p.pronargdefaults=0
   AND p.proargtypes='2950 2950'::oidvector AND p.proallargtypes IS NULL AND p.proargmodes IS NULL
   AND p.proargdefaults IS NULL AND p.protrftypes IS NULL AND p.probin IS NULL AND p.prosqlbody IS NULL
   AND p.proargnames=ARRAY['p_company_id','p_contract_id']::text[]
   AND p.prorettype='pg_catalog.void'::regtype AND NOT p.proretset
   AND p.provolatile='v' AND p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof
   AND p.proparallel='u' AND p.procost=100 AND p.prorows=0 AND p.prosupport=0
   AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
   AND p.prosrc=canonical_body AND pg_catalog.md5(p.prosrc)='fb147a8c9fa9e10f7f4e1c6ee8a8ecb3')
 OR pg_catalog.has_table_privilege(owner_id,contract_id,'SELECT') IS NOT TRUE
 OR pg_catalog.has_table_privilege(owner_id,contract_id,'UPDATE') IS NOT TRUE
 OR (SELECT count(*) FROM pg_catalog.pg_proc p,LATERAL pg_catalog.aclexplode(p.proacl) a
    WHERE p.oid=function_id AND a.grantee IN(owner_id,service_id) AND a.grantor=owner_id
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)<>2
 OR EXISTS(SELECT FROM pg_catalog.pg_proc p,
   LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   WHERE p.oid=function_id AND (a.grantee NOT IN(owner_id,service_id) OR a.grantor<>owner_id
     OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR pg_catalog.has_function_privilege(service_id,function_id,'EXECUTE') IS NOT TRUE THEN
  RAISE EXCEPTION 'ops_api_contract_guard_canonical_metadata_required';
 END IF;
 FOREACH app_role IN ARRAY ARRAY['anon','authenticated','authenticator'] LOOP
  IF pg_catalog.has_function_privilege(app_role,function_id,'EXECUTE') THEN
   RAISE EXCEPTION 'ops_api_contract_guard_service_only_required' USING ERRCODE='42501';
  END IF;
 END LOOP;
END
$forward$;
