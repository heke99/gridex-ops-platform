\set ON_ERROR_STOP on
-- Real additive service boundary against disposable canonical replay. No private
-- business rows or authority seeds. Genuine positive/revocation paths are native.
BEGIN;
DO $boundary$
DECLARE fn regprocedure:='public.ediel_requested_customer_change_selected_facts_v1(uuid,uuid,uuid)'::regprocedure;denied boolean:=false;
BEGIN
 IF NOT has_function_privilege('service_role',fn,'EXECUTE') OR has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE') OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE p.oid=fn AND x.grantee=0 AND x.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'selected_customer_facts_service_acl_required';END IF;
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=fn AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'selected_customer_facts_fixed_search_path_required';END IF;
 BEGIN PERFORM public.ediel_requested_customer_change_selected_facts_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'selected_customer_facts_actual_service_refusal_required';END IF;
 RAISE NOTICE 'selected customer facts actual service/ACL boundary PASS';
END$boundary$;
SET LOCAL ROLE service_role;
DO $actor$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM public.ediel_requested_customer_change_selected_facts_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'selected_customer_facts_actual_actor_refusal_required';END IF;
 RAISE NOTICE 'selected customer facts actual actor boundary PASS';
END$actor$;
ROLLBACK;
