\set ON_ERROR_STOP on
-- Canonical disposable replay, before any business fixture. This checks the
-- actual public boundary; genuine source/send/revocation effects are native.
BEGIN;
DO $boundary$
DECLARE
 wrapper regprocedure := 'public.ediel_require_requested_change_source_current_v1(uuid,uuid)'::regprocedure;
 retained regprocedure := 'public.ediel_require_requested_change_source_current_before_scope_fence_v1(uuid,uuid)'::regprocedure;
 denied boolean := false;
BEGIN
 IF NOT has_function_privilege('service_role',wrapper,'EXECUTE')
 OR has_function_privilege('anon',wrapper,'EXECUTE') OR has_function_privilege('authenticated',wrapper,'EXECUTE')
 OR has_function_privilege('service_role',retained,'EXECUTE')
 OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid IN(wrapper,retained) AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
  RAISE EXCEPTION 'requested_current_bridge_existing_service_acl_required';
 END IF;
 IF (SELECT count(*) FROM pg_proc WHERE oid IN(wrapper,retained) AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])<>2 THEN
  RAISE EXCEPTION 'requested_current_bridge_fixed_search_path_required';
 END IF;
 BEGIN PERFORM public.ediel_require_requested_change_source_current_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'requested_current_bridge_actual_nonservice_refusal_required';END IF;
 RAISE NOTICE 'requested current bridge existing service/ACL boundary PASS';
END $boundary$;
DO $generic_boundary$
DECLARE
 private_current regprocedure := 'gridex_customer_life_events.require_current_v1(uuid,uuid,uuid,text)'::regprocedure;
 legacy regprocedure := 'gridex_customer_life_events.require_before_certification_v1(uuid,uuid,uuid,text)'::regprocedure;
 public_current regprocedure := 'public.ediel_customer_life_event_message_basis_v1(uuid,uuid,uuid)'::regprocedure;
 denied boolean := false;
BEGIN
 IF NOT has_function_privilege('service_role',public_current,'EXECUTE')
 OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   WHERE p.oid IN(private_current,legacy,public_current) AND acl.grantee=0 AND acl.privilege_type='EXECUTE')
 OR EXISTS(SELECT FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role')
   AND (has_function_privilege(r.oid,private_current,'EXECUTE') OR has_function_privilege(r.oid,legacy,'EXECUTE')))
 OR has_function_privilege('anon',public_current,'EXECUTE') OR has_function_privilege('authenticated',public_current,'EXECUTE')
 OR (SELECT count(*) FROM pg_proc WHERE oid IN(private_current,legacy,public_current) AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])<>3 THEN
  RAISE EXCEPTION 'generic_current_bridge_existing_private_service_acl_required';
 END IF;
 BEGIN PERFORM public.ediel_customer_life_event_message_basis_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'generic_current_bridge_actual_nonservice_refusal_required';END IF;
 RAISE NOTICE 'generic current bridge existing private/public service boundary PASS';
END $generic_boundary$;
SET LOCAL ROLE service_role;
DO $scope$
DECLARE denied boolean := false;
BEGIN
 BEGIN PERFORM public.ediel_require_requested_change_source_current_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');EXCEPTION WHEN no_data_found THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'requested_current_bridge_actual_message_scope_refusal_required';END IF;
 RAISE NOTICE 'requested current bridge existing message scope boundary PASS';
 denied:=false;
 BEGIN PERFORM public.ediel_customer_life_event_message_basis_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');EXCEPTION WHEN raise_exception THEN
  IF SQLERRM IS DISTINCT FROM 'customer_life_event_message_scope_required' THEN RAISE;END IF;denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'generic_current_bridge_actual_message_scope_refusal_required';END IF;
 RAISE NOTICE 'generic current bridge existing message scope boundary PASS';
END $scope$;
ROLLBACK;
