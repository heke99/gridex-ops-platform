-- Qualify the exact customer-support audit consumer added by 20261020160633.
-- Requires the post-20261020155348 source contract and that exact support RPC.
-- Add only its source hash/signature; preserve old91, owned16, writerCASE and
-- sourceVersion. Unknown bodies/headers/ACLs fail closed, with atomic rollback.
-- This is source qualification, not live legal authority or full replay proof.
BEGIN;
-- DB05_INSTALL_OWNER_SCOPE_BEGIN
-- Same guarded atomic install capability as existing OPS part03/part11.
-- No role/owner/application capability persists outside this transaction.
DO $db05_install_preflight$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit AND rolcreaterole AND rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
 OR EXISTS(SELECT FROM pg_auth_members WHERE roleid='gridex_ediel_retention_owner'::regrole AND member<>'postgres'::regrole)
 OR (SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='gridex_ediel_retention_owner'::regrole AND m.member='postgres'::regrole)
 IS DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 OR pg_has_role('postgres','gridex_ediel_retention_owner','SET') IS DISTINCT FROM true
 OR pg_has_role('postgres','gridex_ediel_retention_owner','MEMBER') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'db05_qualified_non_super_migration_owner_profile_required' USING ERRCODE='42501';END IF;
 IF to_regclass('pg_temp.gridex_audit19_support_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_audit19_support_install_scope ON COMMIT DROP AS
 SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) AS memberships,
 (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) AS roles,
 (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) AS namespaces,
 has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') AS owner_public_create;
GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
DO $db05_install_capability$ BEGIN
 IF NOT pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') THEN RAISE EXCEPTION 'db05_atomic_owner_inheritance_unavailable';END IF;
 -- No new public-function owner transfer; no temporary public CREATE.
END $db05_install_capability$;
-- DB05_INSTALL_OWNER_SCOPE_END

DO $audit19_support_preflight$
DECLARE expected record;actual record;BEGIN
 FOR expected IN SELECT * FROM (VALUES
 ('gridex_ediel_retention.audit19_source_contract_v1(text)','eb61a02ed9353d68bf7e4048a70c746a0cd97bd6fdbdfd7c12b98a553ed78a3d','gridex_ediel_retention_owner',false,ARRAY['action'],ARRAY['search_path=pg_catalog'],false),
 ('public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)','b4a7eafefc3375066b64cf4605301c3aa64f409e0778c0e34a46699eb852fa6d','postgres',true,ARRAY['p_company_id','p_customer_id','p_api_client_id','p_portal_identity_id','p_title','p_message','p_category','p_idempotency_key'],ARRAY['search_path=pg_catalog','lock_timeout=2s','statement_timeout=5s'],true)
 ) AS v(signature,body_hash,owner_name,security_definer,argument_names,configuration,service_execute) LOOP
  SELECT p.* INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature);
  IF NOT FOUND
   OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname||'.'||p.proname=split_part(expected.signature,'(',1))<>1
   OR actual.proowner IS DISTINCT FROM to_regrole(expected.owner_name)::oid
   OR actual.prosecdef IS DISTINCT FROM expected.security_definer
   OR actual.proconfig IS DISTINCT FROM expected.configuration
   OR actual.proargnames IS DISTINCT FROM expected.argument_names
   OR actual.pronargs IS DISTINCT FROM cardinality(expected.argument_names)
   OR actual.pronargdefaults<>0 OR actual.proargdefaults IS NOT NULL
   OR actual.proallargtypes IS NOT NULL OR actual.proargmodes IS NOT NULL OR actual.provariadic<>0
   OR actual.prorettype IS DISTINCT FROM 'jsonb'::regtype::oid
   OR actual.proretset OR actual.proisstrict OR actual.proleakproof
   OR actual.prokind<>'f' OR actual.provolatile<>'v' OR actual.proparallel<>'u'
   OR (SELECT lanname FROM pg_language WHERE oid=actual.prolang) IS DISTINCT FROM 'plpgsql'
   OR encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.body_hash
   OR has_function_privilege('anon',actual.oid,'EXECUTE')
   OR has_function_privilege('authenticated',actual.oid,'EXECUTE')
   OR has_function_privilege('service_role',actual.oid,'EXECUTE') IS DISTINCT FROM expected.service_execute
   OR EXISTS(SELECT FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
     WHERE acl.privilege_type<>'EXECUTE' OR acl.grantee<>actual.proowner AND
       (NOT expected.service_execute OR acl.grantee<>'service_role'::regrole::oid OR acl.is_grantable))
  THEN RAISE EXCEPTION 'audit19_support_exact_predecessor_source_owner_acl_header_required: %',expected.signature USING ERRCODE='42501';END IF;
 END LOOP;
END $audit19_support_preflight$;

CREATE TEMPORARY TABLE gridex_audit19_support_function_scope ON COMMIT DROP AS
 SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) AS profiles FROM pg_proc p
 WHERE p.oid=ANY(ARRAY['gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure::oid,
 'public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure::oid]);

DO $audit19_support_consumer_slot$
DECLARE old_body text;new_body text;
 hash_end constant text:='}$contracts$::jsonb;';
 signature_end constant text:='}$signatures$::jsonb;';
 hash_add constant text:=',"public.gridex_create_customer_support_case_v1":"b4a7eafefc3375066b64cf4605301c3aa64f409e0778c0e34a46699eb852fa6d"}$contracts$::jsonb;';
 signature_add constant text:=',"public.gridex_create_customer_support_case_v1":"public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)"}$signatures$::jsonb;';
BEGIN
 SELECT prosrc INTO STRICT old_body FROM pg_proc WHERE oid='gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex')<>'eb61a02ed9353d68bf7e4048a70c746a0cd97bd6fdbdfd7c12b98a553ed78a3d'
 OR length(old_body)-length(replace(old_body,hash_end,''))<>length(hash_end)
 OR length(old_body)-length(replace(old_body,signature_end,''))<>length(signature_end)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure)
 IS DISTINCT FROM 'b4a7eafefc3375066b64cf4605301c3aa64f409e0778c0e34a46699eb852fa6d'
 THEN RAISE EXCEPTION 'audit19_support_exact_two_source_anchors_required' USING ERRCODE='42501';END IF;
 -- Exactly one new legitimate consumer, not another owned-OID exemption or
 -- eligible retirement writer. All old91 values/signatures and guards persist.
 new_body:=replace(replace(old_body,hash_end,hash_add),signature_end,signature_add);
 IF encode(sha256(convert_to(new_body,'UTF8')),'hex')<>'53726bfe039ea8c5761486cdb4f526f349dee2d47bd50c4811385b7505bd1a4a'
 THEN RAISE EXCEPTION 'audit19_support_unrelated_source_change_forbidden' USING ERRCODE='42501';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION gridex_ediel_retention.audit19_source_contract_v1(action text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS %L',new_body);
END $audit19_support_consumer_slot$;

DO $audit19_support_profiles_preserved$
DECLARE after_profiles jsonb;BEGIN
 SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) INTO after_profiles FROM pg_proc p
 WHERE p.oid=ANY(ARRAY['gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure::oid,
 'public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure::oid]);
 IF after_profiles IS DISTINCT FROM (SELECT profiles FROM pg_temp.gridex_audit19_support_function_scope)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure)
 IS DISTINCT FROM '53726bfe039ea8c5761486cdb4f526f349dee2d47bd50c4811385b7505bd1a4a'
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure)
 IS DISTINCT FROM 'b4a7eafefc3375066b64cf4605301c3aa64f409e0778c0e34a46699eb852fa6d'
 THEN RAISE EXCEPTION 'audit19_support_function_metadata_and_exact_bodies_must_preserve' USING ERRCODE='42501';END IF;
END $audit19_support_profiles_preserved$;

-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_audit19_support_install_scope;
 -- No temporary public CREATE was introduced.
 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM before_row.memberships
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM before_row.roles
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) IS DISTINCT FROM before_row.namespaces
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'db05_install_roles_memberships_namespaces_must_restore';END IF;
END $db05_install_restore$;
-- DB05_INSTALL_OWNER_RESTORE_END
COMMIT;
