-- Audit19 hashes named JSONB fields, not physical tuple positions. Preserve the
-- exact nineteen names/types while admitting the already-qualified column order.
-- No audit data, table definition, policy, permission or hash routine is changed.
DO $audit19_named_schema_install$
DECLARE
 target_oid oid:=to_regprocedure('gridex_ediel_retention.audit19_schema_v1()');
 owner_oid oid:=to_regrole('gridex_ediel_retention_owner');
 actual pg_catalog.pg_proc%rowtype;
 old_hash text;
 definition text;
 metadata_before jsonb;
 memberships_before jsonb;
 roles_before jsonb;
 namespaces_before jsonb;
 acl_profile jsonb;
 new_body constant text:=$named_schema_body$
BEGIN
 IF (SELECT array_agg(attname::text ORDER BY attname::text COLLATE "C") FROM pg_attribute WHERE attrelid='public.audit_logs'::regclass AND attnum>0 AND NOT attisdropped)
 IS DISTINCT FROM ARRAY['action','actor_type','actor_user_id','company_id','correlation_id','created_at','entity_id','entity_type','id','metadata','new_status','new_values','old_values','previous_status','request_id','resource_id','resource_type','system_actor','updated_at']
 OR (SELECT array_agg(atttypid::regtype::text ORDER BY attname::text COLLATE "C") FROM pg_attribute WHERE attrelid='public.audit_logs'::regclass AND attnum>0 AND NOT attisdropped)
 IS DISTINCT FROM ARRAY['text','text','uuid','uuid','text','timestamp with time zone','text','text','uuid','jsonb','text','jsonb','jsonb','text','text','text','text','text','timestamp with time zone'] THEN RAISE EXCEPTION 'audit19_exact_schema_required' USING ERRCODE='42501';END IF;
END$named_schema_body$;
 new_hash constant text:='a8b63b538e0c09cb7562847e00f241265598321eacb9f9287636ec2a222769d9';
BEGIN
 SELECT p.* INTO actual FROM pg_catalog.pg_proc p WHERE p.oid=target_oid;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'audit19_named_schema_exact_function_required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_agg(jsonb_build_array(a.grantee,a.grantor,a.privilege_type,a.is_grantable)
   ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable)
 INTO acl_profile FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) a;
 old_hash:=encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex');
 IF actual.proowner IS DISTINCT FROM owner_oid
 OR actual.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
 OR actual.prorettype IS DISTINCT FROM 'void'::regtype::oid
 OR actual.pronargs<>0 OR actual.proargtypes IS DISTINCT FROM ''::oidvector
 OR actual.proargnames IS NOT NULL OR actual.proargmodes IS NOT NULL OR actual.proallargtypes IS NOT NULL
 OR actual.pronargdefaults<>0 OR actual.proargdefaults IS NOT NULL
 OR actual.prosecdef OR actual.proretset OR actual.proisstrict OR actual.proleakproof
 OR actual.prokind<>'f' OR actual.provolatile<>'v' OR actual.proparallel<>'u'
 OR actual.procost<>100 OR actual.prorows<>0 OR actual.provariadic<>0 OR actual.prosupport<>0
 OR actual.probin IS NOT NULL OR actual.prosqlbody IS NOT NULL OR actual.protrftypes IS NOT NULL
 OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
 OR acl_profile IS DISTINCT FROM jsonb_build_array(jsonb_build_array(owner_oid,owner_oid,'EXECUTE',false))
 OR old_hash NOT IN('3921810b5bcf315193fec96cd2cf94a34a52e71a9c33889efec09472b593d07a',new_hash)
 OR encode(sha256(convert_to(new_body,'UTF8')),'hex') IS DISTINCT FROM new_hash
 THEN RAISE EXCEPTION 'audit19_named_schema_exact_function_required' USING ERRCODE='42501';END IF;

 -- A qualified already-installed image performs no DDL or membership GRANT.
 IF old_hash=new_hash THEN RETURN;END IF;

 -- Finite non-super migration-owner bridge, from the qualified DB05/865 donor.
 -- It is entered only for the exact old body and restored in this atomic DO.
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit AND rolcreaterole AND rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM owner_oid
 OR EXISTS(SELECT FROM pg_auth_members WHERE roleid=owner_oid AND member<>'postgres'::regrole)
 OR (SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C")
     FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid=owner_oid AND m.member='postgres'::regrole)
   IS DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 OR pg_has_role('postgres','gridex_ediel_retention_owner','SET') IS DISTINCT FROM true
 OR pg_has_role('postgres','gridex_ediel_retention_owner','MEMBER') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'db05_qualified_non_super_migration_owner_profile_required' USING ERRCODE='42501';END IF;

 SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) INTO memberships_before FROM pg_auth_members m;
 SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) INTO roles_before FROM pg_roles r;
 SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) INTO namespaces_before FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention');
 metadata_before:=to_jsonb(actual)-'prosrc';
 definition:=pg_get_functiondef(target_oid);

 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
 IF pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'db05_atomic_owner_inheritance_unavailable' USING ERRCODE='42501';
 END IF;
 EXECUTE replace(definition,actual.prosrc,new_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p WHERE oid=target_oid) IS DISTINCT FROM metadata_before
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=target_oid) IS DISTINCT FROM new_hash
 THEN RAISE EXCEPTION 'audit19_named_schema_function_metadata_must_restore' USING ERRCODE='42501';END IF;

 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM memberships_before
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM roles_before
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) IS DISTINCT FROM namespaces_before
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'db05_install_roles_memberships_namespaces_must_restore' USING ERRCODE='42501';END IF;
END $audit19_named_schema_install$;
