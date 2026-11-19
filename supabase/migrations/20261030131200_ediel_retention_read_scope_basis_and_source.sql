-- F-RET-01 continuation (sim 20261029-3f1a8ab1/claude-track6/003).
-- 20261003150100 moved the read-path choice of ediel_read_invoice_file_retention_v1
-- and ediel_read_finance_copy_retention_v1 to the archived-aware read scope. Three
-- sibling RPCs kept gridex_ediel_retention.permission_v1(...,'ediel.retention.read').
-- 'ediel.retention.read' is not a retention key, so permission_v1 evaluates it via
-- gridex_actor_has_company_permission, which refuses archived/pending_deletion
-- tenants; an archived read-only member then fell to the review path and actor_v1
-- refused (ediel_retention_current_actor_forbidden). Only that CASE predicate is
-- swapped to record_permission_v1(...,'__read_scope__'), the same scope that the
-- chosen read path (record_read_actor_v1) enforces. The review branch,
-- permission_v1/retention_keys, class checks, owners, ACLs, SECURITY DEFINER and
-- search_path are unchanged. Each body is pinned by exact pre/post sha256.
BEGIN;
-- DB05_INSTALL_OWNER_SCOPE_BEGIN
-- Same guarded atomic install capability as 20261019180500 (DB-05 audit19).
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
 IF to_regclass('pg_temp.gridex_fret01_read_scope_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_fret01_read_scope_install_scope ON COMMIT DROP AS
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

DO $fret01_read_scope$
DECLARE f record;body text;patched text;definition text;before_catalog jsonb;
 needle constant text:=$n$CASE WHEN gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.read') THEN 'ediel.retention.read' ELSE 'ediel.retention.review' END$n$;
 replacement constant text:=$n$CASE WHEN gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,'__read_scope__') THEN 'ediel.retention.read' ELSE 'ediel.retention.review' END$n$;
BEGIN
 FOR f IN SELECT x.target::regprocedure AS target,x.before_hash,x.after_hash FROM (VALUES
  ('public.ediel_read_invoice_file_source_v1(uuid,uuid,text,uuid)','eb000f52fff8bfbcdcd044fadae79c160f0cea7e39bbb17d0176be2138039975','c2c766d1676b2c1e4152ee2148085def038c11c767a0946524dbc7cfa8d5348a'),
  ('public.ediel_invoice_file_retention_basis_v1(uuid,uuid,text,uuid)','fdfa963e43abb682de06b46e0b1d42578a4de450aebbcf7643b4623d6275284e','f7d0571189f5fe797e76454b5b293b6d07eb3ae4b2ea3e655659b877d37efc5e'),
  ('public.ediel_finance_copy_retention_basis_v1(uuid,uuid,text,text)','f18961afa6ffdb1bc42462ee33caa04e9f820e33d8f793b87172f6b940042b1f','171f056055cacb7d37a1c29be711d0d81fb474dae4ffe1ddca07560a3703c495')
 ) x(target,before_hash,after_hash)
 LOOP
  SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT body,before_catalog FROM pg_proc p WHERE p.oid=f.target;
  IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM f.before_hash
  THEN RAISE EXCEPTION 'fret01_read_scope_exact_predecessor_required:%',f.target;END IF;
  IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1
  THEN RAISE EXCEPTION 'fret01_read_scope_unique_case_anchor_required:%',f.target;END IF;
  patched:=replace(body,needle,replacement);
  IF encode(sha256(convert_to(patched,'UTF8')),'hex') IS DISTINCT FROM f.after_hash
  THEN RAISE EXCEPTION 'fret01_read_scope_exact_postimage_required:%',f.target;END IF;
  definition:=pg_get_functiondef(f.target);
  IF (length(definition)-length(replace(definition,body,'')))/length(body)<>1
  THEN RAISE EXCEPTION 'fret01_read_scope_exact_definition_anchor_required:%',f.target;END IF;
  EXECUTE replace(definition,body,patched);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.target) IS DISTINCT FROM before_catalog
  OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=f.target) IS DISTINCT FROM f.after_hash
  THEN RAISE EXCEPTION 'fret01_read_scope_catalog_or_body_changed:%',f.target;END IF;
 END LOOP;
END $fret01_read_scope$;
-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_fret01_read_scope_install_scope;
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
