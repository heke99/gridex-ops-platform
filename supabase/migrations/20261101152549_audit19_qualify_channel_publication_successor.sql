-- Qualify only the reviewed channel publisher after PR972 and PR998.
-- PR972 preserves the audit INSERT's company/actor/action/entity/id bindings
-- and offer_id/channel/offer_reference, adding publication_version_reused to
-- distinguish immutable reuse from new finalization. It does not add a
-- retention writer or alter audit19's approved actions/owned-OID exemptions.
-- PR998 adds the ordinary publication graph gate before that unchanged audit
-- INSERT. Invalid reused graphs raise 23514 and roll back the statement.
-- This is intentional metadata compatibility, NOT a byte-identical audit payload.
-- Exact helper ef491015 (after 20261030131500) and publisher 07d53d27 required.
-- Only one existing value in the full 94-entry map changes; 93 values,
-- signatures, owned/writer CASE, sourceVersion and all denials remain exact.
-- Native PG17 non-superuser replay and GEN capture remain separate evidence.
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
 IF to_regclass('pg_temp.gridex_audit19_channel_publisher_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_audit19_channel_publisher_install_scope ON COMMIT DROP AS
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

DO $audit19_channel_publisher_preflight$
DECLARE expected record;actual record;BEGIN
 FOR expected IN SELECT * FROM (VALUES
 ('gridex_ediel_retention.audit19_source_contract_v1(text)','ef491015524922d0f679678c1854d0fa398c979607ba5e82cd765c1453c116a2','gridex_ediel_retention_owner',false,ARRAY['action'],ARRAY['search_path=pg_catalog'],false),
 ('public.gridex_publish_contract_channel(uuid,uuid,text,uuid)','07d53d270bceab612c0acf5b3b722e85302b660703a843143b8ce6687c7ea049','postgres',true,ARRAY['p_company_id','p_offer_id','p_channel','p_actor_user_id'],ARRAY['search_path=public, extensions, pg_temp'],true)
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
  THEN RAISE EXCEPTION 'audit19_channel_publisher_exact_predecessor_source_owner_acl_header_required: %',expected.signature USING ERRCODE='42501';END IF;
 END LOOP;
END $audit19_channel_publisher_preflight$;

CREATE TEMPORARY TABLE gridex_audit19_channel_publisher_function_scope ON COMMIT DROP AS
 SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) AS profiles FROM pg_proc p
 WHERE p.oid=ANY(ARRAY['gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure::oid,
 'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure::oid]);

DO $audit19_channel_publisher_slot$
DECLARE old_body text;new_body text;
 old_pin constant text:='"public.gridex_publish_contract_channel":"e06f4b770cda17e95553f2297c0db310419022a3e817df01931b6359bfd36c47"';
 new_pin constant text:='"public.gridex_publish_contract_channel":"07d53d270bceab612c0acf5b3b722e85302b660703a843143b8ce6687c7ea049"';
BEGIN
 SELECT prosrc INTO STRICT old_body FROM pg_proc WHERE oid='gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure;
 IF encode(sha256(convert_to(old_body,'UTF8')),'hex')<>'ef491015524922d0f679678c1854d0fa398c979607ba5e82cd765c1453c116a2'
 OR length(old_body)-length(replace(old_body,old_pin,''))<>length(old_pin)
 OR strpos(old_body,new_pin)<>0
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure)
 IS DISTINCT FROM '07d53d270bceab612c0acf5b3b722e85302b660703a843143b8ce6687c7ea049'
 THEN RAISE EXCEPTION 'audit19_channel_publisher_exact_two_source_anchors_required' USING ERRCODE='42501';END IF;
 -- Exactly one existing value changes; no new consumer, owned-OID exemption
 -- or eligible retirement writer. All other values/signatures and guards persist.
 new_body:=replace(old_body,old_pin,new_pin);
 IF encode(sha256(convert_to(new_body,'UTF8')),'hex')<>'de5e1627aa6e99c3c158784fde923a6986bad7631381d17ee572891fca485f75'
 THEN RAISE EXCEPTION 'audit19_channel_publisher_unrelated_source_change_forbidden' USING ERRCODE='42501';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION gridex_ediel_retention.audit19_source_contract_v1(action text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS %L',new_body);
END $audit19_channel_publisher_slot$;

DO $audit19_channel_publisher_profiles_preserved$
DECLARE after_profiles jsonb;BEGIN
 SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) INTO after_profiles FROM pg_proc p
 WHERE p.oid=ANY(ARRAY['gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure::oid,
 'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure::oid]);
 IF after_profiles IS DISTINCT FROM (SELECT profiles FROM pg_temp.gridex_audit19_channel_publisher_function_scope)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure)
 IS DISTINCT FROM 'de5e1627aa6e99c3c158784fde923a6986bad7631381d17ee572891fca485f75'
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure)
 IS DISTINCT FROM '07d53d270bceab612c0acf5b3b722e85302b660703a843143b8ce6687c7ea049'
 THEN RAISE EXCEPTION 'audit19_channel_publisher_function_metadata_and_exact_bodies_must_preserve' USING ERRCODE='42501';END IF;
END $audit19_channel_publisher_profiles_preserved$;

-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_audit19_channel_publisher_install_scope;
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
