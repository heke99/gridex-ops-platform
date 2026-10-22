-- Qualify two exact historical trigger consumers, not retirement writers.
-- Requires the strict post11 helper53726; only92->94 map entries may change.
-- Historical consumers may be wholly absent on canonical replay. Actual
-- presence requires the reviewed header/ACL/body and exact finite1+40triggers.
-- No legacy routine/trigger/ACL/policy is created, removed or altered.
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
 IF to_regclass('pg_temp.gridex_audit19_legacy_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_audit19_legacy_install_scope ON COMMIT DROP AS
 SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) AS memberships,
 (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) AS roles,
 (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','private','gridex_ediel_retention')) AS namespaces,
 has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') AS owner_public_create;
GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
DO $db05_install_capability$ BEGIN
 IF NOT pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') THEN RAISE EXCEPTION 'db05_atomic_owner_inheritance_unavailable';END IF;
 -- No new public-function owner transfer; no temporary public CREATE.
END $db05_install_capability$;
-- DB05_INSTALL_OWNER_SCOPE_END

DO $audit19_legacy_preflight$
DECLARE expected record;actual pg_proc%ROWTYPE;ns pg_namespace%ROWTYPE;
 tenant_trigger constant text:='integration_api_clients_tenant_website_receipt_completion';
 critical_tables constant text[]:=ARRAY[
 'authorization_scopes','billing_export_run_items','billing_export_runs','billing_underlays',
 'companies','company_invitations','company_memberships','customer_addresses',
 'customer_authorization_documents','customer_case_events','customer_cases','customer_contacts',
 'customer_contract_events','customer_contracts','customer_duplicate_resolution_events',
 'customer_import_batches','customer_import_rows','customer_info_request_events',
 'customer_info_requests','customer_lifecycle_decisions','customer_lifecycle_events',
 'customer_merge_events','customer_readiness_snapshots','customer_sites','customers',
 'document_ai_extractions','ediel_messages','grid_owner_data_requests','metering_permissions',
 'metering_points','metering_values','outbound_dispatch_events','outbound_requests','partner_exports',
 'power_of_attorney_scopes','powers_of_attorney','supplier_switch_events','supplier_switch_requests',
 'tenant_email_outbox','user_roles'];
BEGIN
 PERFORM set_config('search_path','pg_catalog',true);
 IF to_regclass('pg_temp.gridex_audit19_legacy_function_scope') IS NOT NULL THEN
  RAISE EXCEPTION 'audit19_legacy_unexpected_existing_function_scope' USING ERRCODE='42501';
 END IF;
 FOR expected IN SELECT * FROM (VALUES
 ('gridex_ediel_retention.audit19_source_contract_v1(text)',
  '53726bfe039ea8c5761486cdb4f526f349dee2d47bd50c4811385b7505bd1a4a',
  'gridex_ediel_retention_owner',false,ARRAY['action'],ARRAY['search_path=pg_catalog'],false,false),
 ('private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()',
  '38666eee982dfe87a8ee40cc5f56077289c947fae631f950cf21f0d5dff35180',
  'postgres',true,NULL::text[],ARRAY['search_path=pg_catalog, public, private, extensions'],false,true),
 ('public.gridex_audit_critical_row_change()',
  'c83228b7722adb500cb341597f174afeaf88e97cc5511acaf2e190a8c8ec812c',
  'postgres',true,NULL::text[],ARRAY['search_path=public, auth, extensions'],true,true)
 ) AS v(signature,body_hash,owner_name,security_definer,argument_names,configuration,service_execute,optional_legacy) LOOP
  SELECT p.* INTO actual FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature);
  IF NOT FOUND AND expected.optional_legacy THEN
   IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname||'.'||p.proname=split_part(expected.signature,'(',1))
    OR EXISTS(SELECT FROM pg_trigger t WHERE
     CASE WHEN expected.signature LIKE 'private.%' THEN t.tgname=tenant_trigger
      ELSE t.tgname=ANY(ARRAY(SELECT 'gridex_audit_'||x FROM unnest(critical_tables) x)) END)
   THEN RAISE EXCEPTION 'audit19_legacy_absent_consumer_partial_footprint: %',expected.signature USING ERRCODE='42501';END IF;
   CONTINUE;
  END IF;
  IF actual.oid IS NULL
   OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname||'.'||p.proname=split_part(expected.signature,'(',1))<>1
   OR actual.proowner IS DISTINCT FROM to_regrole(expected.owner_name)::oid
   OR actual.prosecdef IS DISTINCT FROM expected.security_definer
   OR actual.proconfig IS DISTINCT FROM expected.configuration
   OR actual.proargnames IS DISTINCT FROM expected.argument_names
   OR actual.pronargs IS DISTINCT FROM (CASE WHEN expected.optional_legacy THEN 0 ELSE 1 END)
   OR actual.pronargdefaults<>0 OR actual.proargdefaults IS NOT NULL
   OR actual.proallargtypes IS NOT NULL OR actual.proargmodes IS NOT NULL OR actual.provariadic<>0
   OR actual.prorettype IS DISTINCT FROM (CASE WHEN expected.optional_legacy THEN 'trigger'::regtype::oid ELSE 'jsonb'::regtype::oid END)
   OR actual.proretset OR actual.proisstrict OR actual.proleakproof
   OR actual.prokind<>'f' OR actual.provolatile<>'v' OR actual.proparallel<>'u'
   OR actual.procost<>100 OR actual.prorows<>0 OR actual.prosupport<>0 OR actual.protrftypes IS NOT NULL
   OR (SELECT lanname FROM pg_language WHERE oid=actual.prolang) IS DISTINCT FROM 'plpgsql'
   OR encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.body_hash
   OR has_function_privilege('anon',actual.oid,'EXECUTE')
   OR has_function_privilege('authenticated',actual.oid,'EXECUTE')
   OR has_function_privilege('service_role',actual.oid,'EXECUTE') IS DISTINCT FROM expected.service_execute
   OR EXISTS(SELECT FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
     WHERE acl.privilege_type<>'EXECUTE' OR acl.grantor<>actual.proowner OR acl.is_grantable
      OR acl.grantee<>actual.proowner AND (NOT expected.service_execute OR acl.grantee<>'service_role'::regrole::oid))
  THEN RAISE EXCEPTION 'audit19_legacy_exact_source_owner_acl_header_required: %',expected.signature USING ERRCODE='42501';END IF;

  IF NOT expected.optional_legacy THEN CONTINUE;END IF;
  IF expected.signature LIKE 'private.%' THEN
   SELECT * INTO STRICT ns FROM pg_namespace WHERE oid=actual.pronamespace;
   IF ns.nspowner IS DISTINCT FROM 'postgres'::regrole::oid
    OR has_schema_privilege('anon',ns.oid,'USAGE') OR has_schema_privilege('authenticated',ns.oid,'USAGE')
    OR NOT has_schema_privilege('service_role',ns.oid,'USAGE')
    OR EXISTS(SELECT FROM aclexplode(coalesce(ns.nspacl,acldefault('n',ns.nspowner))) acl
      WHERE acl.grantor<>ns.nspowner OR acl.is_grantable
       OR acl.grantee<>ns.nspowner AND (acl.grantee<>'service_role'::regrole::oid OR acl.privilege_type<>'USAGE'))
    OR (SELECT count(*) FROM pg_trigger WHERE tgfoid=actual.oid)<>1
    OR NOT EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE t.tgfoid=actual.oid AND t.tgname=tenant_trigger
      AND n.nspname='public' AND c.relname='integration_api_clients' AND c.relkind='r'
      AND c.relowner='postgres'::regrole AND c.relrowsecurity AND NOT c.relforcerowsecurity
      AND NOT t.tgisinternal AND t.tgtype=17 AND t.tgenabled='O' AND t.tgnargs=0
      AND octet_length(t.tgargs)=0 AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND pg_get_triggerdef(t.oid,false)='CREATE TRIGGER integration_api_clients_tenant_website_receipt_completion AFTER UPDATE OF launch_ready, launch_blockers, metadata, status ON public.integration_api_clients FOR EACH ROW WHEN (((new.profile_key = ''tenant_website''::text) AND (new.status = ''active''::text) AND (new.launch_ready IS TRUE))) EXECUTE FUNCTION private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()')
   THEN RAISE EXCEPTION 'audit19_legacy_tenant_exact_namespace_and_trigger_required' USING ERRCODE='42501';END IF;
  ELSE
   IF has_schema_privilege('anon','public','CREATE') OR has_schema_privilege('authenticated','public','CREATE')
    OR has_schema_privilege('service_role','public','CREATE')
    OR (SELECT count(*) FROM pg_trigger WHERE tgfoid=actual.oid)<>cardinality(critical_tables)
    OR EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE t.tgfoid=actual.oid AND (
      n.nspname<>'public' OR NOT(c.relname::text=ANY(critical_tables)) OR c.relkind<>'r'
      OR c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity OR c.relforcerowsecurity
      OR t.tgname IS DISTINCT FROM 'gridex_audit_'||c.relname
      OR t.tgisinternal OR t.tgtype<>29 OR t.tgenabled<>'O' OR t.tgnargs<>0
      OR octet_length(t.tgargs)<>0 OR t.tgattr::text<>'' OR t.tgqual IS NOT NULL
      OR t.tgconstraint<>0 OR t.tgdeferrable OR t.tginitdeferred
      OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL))
   THEN RAISE EXCEPTION 'audit19_legacy_critical_exact_namespace_and_finite40triggers_required' USING ERRCODE='42501';END IF;
  END IF;
 END LOOP;
END $audit19_legacy_preflight$;

CREATE TEMPORARY TABLE gridex_audit19_legacy_function_scope ON COMMIT DROP AS
 SELECT (SELECT jsonb_agg(CASE WHEN p.oid=to_regprocedure('gridex_ediel_retention.audit19_source_contract_v1(text)') THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid)
  FROM pg_proc p WHERE p.oid=ANY(ARRAY[to_regprocedure('gridex_ediel_retention.audit19_source_contract_v1(text)')::oid,
   to_regprocedure('private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()')::oid,to_regprocedure('public.gridex_audit_critical_row_change()')::oid])) AS profiles,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t
  WHERE t.tgfoid=ANY(ARRAY[to_regprocedure('private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()')::oid,
   to_regprocedure('public.gridex_audit_critical_row_change()')::oid])) AS triggers;

DO $audit19_legacy_consumer_slots$
DECLARE old_body text;new_body text;
 hash_end constant text:='}$contracts$::jsonb;';
 signature_end constant text:='}$signatures$::jsonb;';
 hash_add constant text:=',"private.gridex_complete_tenant_website_receipt_on_launch_ready_v1":"38666eee982dfe87a8ee40cc5f56077289c947fae631f950cf21f0d5dff35180","public.gridex_audit_critical_row_change":"c83228b7722adb500cb341597f174afeaf88e97cc5511acaf2e190a8c8ec812c"}$contracts$::jsonb;';
 signature_add constant text:=',"private.gridex_complete_tenant_website_receipt_on_launch_ready_v1":"private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()","public.gridex_audit_critical_row_change":"public.gridex_audit_critical_row_change()"}$signatures$::jsonb;';
BEGIN
 SELECT prosrc INTO STRICT old_body FROM pg_proc WHERE oid='gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex')<>'53726bfe039ea8c5761486cdb4f526f349dee2d47bd50c4811385b7505bd1a4a'
  OR length(old_body)-length(replace(old_body,hash_end,''))<>length(hash_end)
  OR length(old_body)-length(replace(old_body,signature_end,''))<>length(signature_end)
 THEN RAISE EXCEPTION 'audit19_legacy_exact_post11_and_unique_anchors_required' USING ERRCODE='42501';END IF;
 new_body:=replace(replace(old_body,hash_end,hash_add),signature_end,signature_add);
 IF encode(sha256(convert_to(new_body,'UTF8')),'hex')<>'3a4cd230f9ffc6cc7fe97671fbe21f11d3feac7c928fb3530201ab853ef34314'
 THEN RAISE EXCEPTION 'audit19_legacy_unrelated_source_change_forbidden' USING ERRCODE='42501';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION gridex_ediel_retention.audit19_source_contract_v1(action text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS %L',new_body);
END $audit19_legacy_consumer_slots$;

DO $audit19_legacy_profiles_preserved$
DECLARE after_profiles jsonb;after_triggers jsonb;BEGIN
 SELECT jsonb_agg(CASE WHEN p.oid=to_regprocedure('gridex_ediel_retention.audit19_source_contract_v1(text)') THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid)
 INTO after_profiles FROM pg_proc p WHERE p.oid=ANY(ARRAY[to_regprocedure('gridex_ediel_retention.audit19_source_contract_v1(text)')::oid,
  to_regprocedure('private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()')::oid,to_regprocedure('public.gridex_audit_critical_row_change()')::oid]);
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO after_triggers FROM pg_trigger t
 WHERE t.tgfoid=ANY(ARRAY[to_regprocedure('private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()')::oid,
  to_regprocedure('public.gridex_audit_critical_row_change()')::oid]);
 IF after_profiles IS DISTINCT FROM (SELECT profiles FROM pg_temp.gridex_audit19_legacy_function_scope)
  OR after_triggers IS DISTINCT FROM (SELECT triggers FROM pg_temp.gridex_audit19_legacy_function_scope)
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure)
   IS DISTINCT FROM '3a4cd230f9ffc6cc7fe97671fbe21f11d3feac7c928fb3530201ab853ef34314'
 THEN RAISE EXCEPTION 'audit19_legacy_full_function_metadata_bodies_and_triggers_must_preserve' USING ERRCODE='42501';END IF;
END $audit19_legacy_profiles_preserved$;

-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_audit19_legacy_install_scope;
 -- No temporary public CREATE was introduced.
 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM before_row.memberships
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM before_row.roles
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','private','gridex_ediel_retention')) IS DISTINCT FROM before_row.namespaces
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'db05_install_roles_memberships_namespaces_must_restore';END IF;
END $db05_install_restore$;
-- DB05_INSTALL_OWNER_RESTORE_END
COMMIT;
