-- Run on the disposable full replay database. Every synthetic row is rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.expect_staff_write_denied(company_id uuid,actor_id uuid,client_id uuid,permission text,message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.gridex_staff_assert_write_actor_v1(company_id,actor_id,client_id,permission);
    RAISE EXCEPTION 'staff_write_guard_allowed_%',message;
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM IS DISTINCT FROM message THEN RAISE; END IF;
  END;
END$$;
DO $$
DECLARE
  a uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid();
  guard_oid oid:='public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text)'::regprocedure;
BEGIN
  INSERT INTO public.companies(id,name,status,is_active)
  VALUES(a,'Synthetic staff write guard A','active',true),(b,'Synthetic staff write guard B','active',true);
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
  VALUES(actor,'authenticated','authenticated',actor::text||'@example.invalid','{}','{}',now(),now(),false);
  INSERT INTO public.user_profiles(id,email,user_status) VALUES(actor,actor::text||'@example.invalid','active')
    ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at)
  VALUES(a,actor,'company_admin','company_admin','active',true,now());
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status)
  VALUES(client,a,'Synthetic staff guard key','staff-guard',repeat('a',64),ARRAY['staff_customers.write','staff_cases.write'],'active');

  PERFORM public.gridex_staff_assert_write_actor_v1(a,actor,client,'customers.write');
  PERFORM public.gridex_staff_assert_write_actor_v1(a,actor,client,'masterdata.write');
  PERFORM public.gridex_staff_assert_write_actor_v1(a,actor,client,'cases.write');
  PERFORM pg_temp.expect_staff_write_denied(b,actor,client,'customers.write','staff_api_actor_inactive');
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'users.write','staff_api_actor_not_authorized');

  UPDATE public.company_memberships SET accepted_at=NULL WHERE company_id=a AND user_id=actor;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_actor_inactive');
  UPDATE public.company_memberships SET accepted_at=now() WHERE company_id=a AND user_id=actor;
  UPDATE public.user_profiles SET user_status='disabled' WHERE id=actor;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_actor_inactive');
  UPDATE public.user_profiles SET user_status='active' WHERE id=actor;
  UPDATE auth.users SET deleted_at=now() WHERE id=actor;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'cases.write','staff_api_actor_inactive');
  UPDATE auth.users SET deleted_at=NULL,banned_until=now()+interval '1 hour' WHERE id=actor;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'cases.write','staff_api_actor_inactive');
  UPDATE auth.users SET banned_until=now()-interval '1 second' WHERE id=actor;
  PERFORM public.gridex_staff_assert_write_actor_v1(a,actor,client,'cases.write');
  UPDATE public.companies SET status='paused' WHERE id=a;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'cases.write','staff_api_actor_inactive');
  UPDATE public.companies SET status='active' WHERE id=a;

  UPDATE public.integration_api_clients SET revoked_at=now() WHERE id=client;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_client_not_in_scope');
  UPDATE public.integration_api_clients SET revoked_at=NULL,deleted_at=now() WHERE id=client;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_client_not_in_scope');
  UPDATE public.integration_api_clients SET deleted_at=NULL,expires_at=now()-interval '1 second' WHERE id=client;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_client_not_in_scope');
  UPDATE public.integration_api_clients SET expires_at=NULL,scopes=ARRAY['*','staff_cases.write'] WHERE id=client;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_client_not_in_scope');
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'masterdata.write','staff_api_client_not_in_scope');
  PERFORM public.gridex_staff_assert_write_actor_v1(a,actor,client,'cases.write');
  UPDATE public.integration_api_clients SET scopes=ARRAY['staff_customers.write'] WHERE id=client;
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'cases.write','staff_api_client_not_in_scope');
  UPDATE public.integration_api_clients SET scopes=ARRAY['staff_customers.write','staff_cases.write'] WHERE id=client;

  -- An arbitrary role plus an override is never recognized as staff.
  UPDATE public.company_memberships SET role_key='unknown_staff_role' WHERE company_id=a AND user_id=actor;
  INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
  VALUES(a,actor,'customers.write','allow','active',true);
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_actor_not_authorized');
  DELETE FROM public.user_permissions WHERE user_id=actor;
  UPDATE public.company_memberships SET role_key='finance_readonly' WHERE company_id=a AND user_id=actor;
  INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
  VALUES(NULL,actor,'customers.write','allow','active',true),(b,actor,'customers.write','allow','active',true);
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_actor_not_authorized');
  INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
  VALUES(a,actor,'customers.write','allow','active',true);
  PERFORM public.gridex_staff_assert_write_actor_v1(a,actor,client,'customers.write');
  INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
  VALUES(a,actor,'customers.write','deny','active',true);
  PERFORM pg_temp.expect_staff_write_denied(a,actor,client,'customers.write','staff_api_actor_not_authorized');

  IF has_function_privilege('anon',guard_oid,'EXECUTE')
    OR has_function_privilege('authenticated',guard_oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',guard_oid,'EXECUTE')
    OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=guard_oid)
    OR NOT (SELECT has_table_privilege(proowner,'auth.users','SELECT') AND has_table_privilege(proowner,'auth.users','UPDATE') FROM pg_proc WHERE oid=guard_oid)
  THEN RAISE EXCEPTION 'staff_write_guard_owner_acl_invalid'; END IF;
  RAISE NOTICE 'staff write actor guard native regression passed';
END$$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.gridex_staff_assert_write_actor_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'cases.write');
    RAISE EXCEPTION 'anon_invoked_staff_write_guard';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'permission denied for function gridex_staff_assert_write_actor_v1' THEN RAISE; END IF;
  END;
END$$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.gridex_staff_assert_write_actor_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'cases.write');
    RAISE EXCEPTION 'authenticated_invoked_staff_write_guard';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'permission denied for function gridex_staff_assert_write_actor_v1' THEN RAISE; END IF;
  END;
END$$;
ROLLBACK;
