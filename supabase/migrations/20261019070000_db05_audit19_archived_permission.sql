-- DB-05: keep the explicit audit19 retention class usable after tenant closure.
-- Only the existing retention permission-key set changes; no grants or actor/status bypass.
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
 IF to_regclass('pg_temp.gridex_db05_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_db05_install_scope ON COMMIT DROP AS
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

DO $audit19_archived_permission$
DECLARE target oid:='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure;
 body text;patched text;definition text;before_catalog jsonb;after_catalog jsonb;
 old_needle constant text:=$key$'ediel.retention.completed_review_reason'$key$;
 new_needle constant text:=$key$'ediel.retention.completed_review_reason','ediel.retention.audit_normalized19_cleanup'$key$;
BEGIN
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT body,before_catalog FROM pg_proc p WHERE oid=target;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM '6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7'
 THEN RAISE EXCEPTION 'audit19_permission_exact_source6_predecessor_required';END IF;
 IF (length(body)-length(replace(body,old_needle,'')))/length(old_needle)<>1
 THEN RAISE EXCEPTION 'audit19_permission_unique_retention_key_anchor_required';END IF;
 patched:=replace(body,old_needle,new_needle);
 IF encode(sha256(convert_to(patched,'UTF8')),'hex') IS DISTINCT FROM 'b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa'
 THEN RAISE EXCEPTION 'audit19_permission_exact_postimage_required';END IF;
 definition:=pg_get_functiondef(target);
 IF (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'audit19_permission_exact_definition_anchor_required';END IF;
 EXECUTE replace(definition,body,patched);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_catalog FROM pg_proc p WHERE oid=target;
 IF after_catalog IS DISTINCT FROM before_catalog
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa'
 THEN RAISE EXCEPTION 'audit19_permission_catalog_or_body_changed';END IF;
END $audit19_archived_permission$;
-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_db05_install_scope;
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
