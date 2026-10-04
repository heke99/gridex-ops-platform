-- Actual Supabase 17.6 replay ACL: postgres can read/row-lock Auth but cannot
-- delegate auth schema USAGE or auth.users UPDATE to the private owner. Keep
-- that existing owner boundary; never acquire AuthAdmin/Super membership.
BEGIN;
DO $retention_auth_bridge_prerequisite$
BEGIN
 IF current_user IN('anon','authenticated','service_role','authenticator','gridex_ediel_retention_owner')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole))
 OR has_schema_privilege(current_user,'auth','USAGE') IS NOT TRUE
 OR has_table_privilege(current_user,'auth.users','SELECT') IS NOT TRUE
 OR has_table_privilege(current_user,'auth.users','UPDATE') IS NOT TRUE
 OR has_function_privilege(current_user,'auth.uid()','EXECUTE') IS NOT TRUE THEN
  RAISE EXCEPTION 'retention_actual_auth_migration_owner_required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner'
               AND NOT rolcanlogin AND NOT rolinherit AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole)
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN('anon','authenticated','service_role','authenticator')
           AND pg_has_role(oid,'gridex_ediel_retention_owner','MEMBER')) THEN
  RAISE EXCEPTION 'retention_private_auth_consumer_required' USING ERRCODE='42501';
 END IF;
END
$retention_auth_bridge_prerequisite$;
-- These functions retain the actual migration principal as owner. Only the
-- private, non-login retention consumer may execute them. No Auth rows or user
-- metadata are exported, and no new operational permission is granted.
CREATE FUNCTION public.ediel_retention_session_actor_v1() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT auth.uid()$$;
CREATE FUNCTION public.ediel_retention_lock_auth_actor_v1(p_actor_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active boolean;
BEGIN
 -- The same FOR SHARE lock as the installed actor/reviewer owners prevents a
 -- concurrent deletion/ban from passing a prior unlocked authorization check.
 SELECT deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())
 INTO active FROM auth.users WHERE id=p_actor_user_id FOR SHARE;
 IF active IS DISTINCT FROM true THEN RETURN false;END IF;
 PERFORM id FROM public.user_profiles WHERE id=p_actor_user_id FOR SHARE;
 RETURN EXISTS(SELECT FROM public.user_profiles p WHERE p.id=p_actor_user_id
               AND p.user_status='active' AND to_jsonb(p)->>'disabled_at' IS NULL);
END$$;
REVOKE ALL ON FUNCTION public.ediel_retention_session_actor_v1(),public.ediel_retention_lock_auth_actor_v1(uuid)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_retention_session_actor_v1(),public.ediel_retention_lock_auth_actor_v1(uuid)
TO gridex_ediel_retention_owner;
-- Adapt only the already installed private retention owner's Auth expressions.
-- Every company/grant/DENY/current-class/issuer/policy/deadline/source/hash/body
-- check remains in its original function. CREATE OR REPLACE retains its exact
-- OID, owner, ACL and search_path; unrecognised Auth expressions fail closed.
DO $retention_auth_consumer_binding$
DECLARE f record;body text;definition text;actor text;predicate text;lock_expression text;changed integer:=0;after_record record;
BEGIN
 FOR f IN SELECT p.oid,p.oid::regprocedure identity,p.proowner,p.proacl,p.proconfig,p.prosrc
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE p.proowner='gridex_ediel_retention_owner'::regrole
          AND n.nspname IN('public','gridex_ediel_retention')
          AND p.prosrc~*'auth\.(uid|users)' LOOP
  body:=replace(f.prosrc,'auth.uid()','public.ediel_retention_session_actor_v1()');
  FOREACH actor IN ARRAY ARRAY['actor','p_actor_user_id','r.actor_user_id'] LOOP
   lock_expression:='PERFORM id FROM auth.users WHERE id='||actor||' FOR SHARE;';
   body:=replace(body,lock_expression,'PERFORM public.ediel_retention_lock_auth_actor_v1('||actor||');');
   predicate:='EXISTS(SELECT FROM auth.users WHERE id='||actor||' AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))';
   body:=replace(body,predicate,'public.ediel_retention_lock_auth_actor_v1('||actor||')');
  END LOOP;
  IF body~*'auth\.(uid|users)' OR body=f.prosrc THEN
   RAISE EXCEPTION 'retention_auth_consumer_requires_explicit_review:%',f.identity;
  END IF;
  definition:=pg_get_functiondef(f.oid);
  IF position(f.prosrc IN definition)=0 THEN RAISE EXCEPTION 'retention_auth_definition_binding_required:%',f.identity;END IF;
  EXECUTE replace(definition,f.prosrc,body);
  SELECT proowner,proacl,proconfig INTO STRICT after_record FROM pg_proc WHERE oid=f.oid;
  IF after_record.proowner IS DISTINCT FROM f.proowner OR after_record.proacl IS DISTINCT FROM f.proacl
  OR after_record.proconfig IS DISTINCT FROM f.proconfig THEN
   RAISE EXCEPTION 'retention_auth_original_owner_acl_changed:%',f.identity;
  END IF;
  changed:=changed+1;
 END LOOP;
 IF changed<2 THEN RAISE EXCEPTION 'retention_installed_auth_consumer_graph_required';END IF;
END
$retention_auth_consumer_binding$;
COMMIT;
