-- Disposable full native replay only. Actual access/invitation command chains;
-- every synthetic mutation, receipt, outbox event and audit is rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir sql/staff-native-role-catalog-fixture.sql
CREATE FUNCTION pg_temp.expect_staff_user_actor_denied(command jsonb,invitation boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF invitation THEN PERFORM public.canonical_create_tenant_invitation(command);
    ELSE PERFORM public.canonical_change_tenant_user_access(command); END IF;
    RAISE EXCEPTION 'staff_user_actor_guard_allowed';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    IF SQLERRM NOT IN('staff_permission_denied','staff_company_not_operational') THEN RAISE; END IF;
  END;
END$$;
DO $$
DECLARE
  a uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid();
  target uuid:=gen_random_uuid();
  backup_admin uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid();
  command jsonb;
  invitation jsonb;
  first_access jsonb;
  first_invitation jsonb;
  patch text;
  admin_role uuid;
  support_role uuid;
BEGIN
  INSERT INTO public.companies(id,name,status,is_active) VALUES(a,'Synthetic staff actor A','active',true),(b,'Synthetic staff actor B','active',true);
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_anonymous)
  VALUES(actor,'authenticated','authenticated',actor::text||'@example.invalid',now(),'{}','{}',now(),now(),false),
    (target,'authenticated','authenticated',target::text||'@example.invalid',now(),'{}','{}',now(),now(),false),
    (backup_admin,'authenticated','authenticated',backup_admin::text||'@example.invalid',now(),'{}','{}',now(),now(),false);
  INSERT INTO public.user_profiles(id,email,user_status)
  VALUES(actor,actor::text||'@example.invalid','active'),(target,target::text||'@example.invalid','active'),(backup_admin,backup_admin::text||'@example.invalid','active')
    ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at)
  VALUES(a,actor,'company_admin','company_admin','active',true,now()),(a,target,'customer_service_agent','support','active',true,now()),
    (a,backup_admin,'company_admin','company_admin','active',true,now());
  SELECT id INTO admin_role FROM public.roles WHERE coalesce(key,name)='company_admin' ORDER BY created_at,id LIMIT 1;
  SELECT id INTO support_role FROM public.roles WHERE coalesce(key,name)='customer_service_agent' ORDER BY created_at,id LIMIT 1;
  IF admin_role IS NULL OR support_role IS NULL THEN RAISE EXCEPTION 'staff_actor_guard_roles_missing'; END IF;
  INSERT INTO public.user_roles(company_id,user_id,role,role_id,status,is_active)
  VALUES(a,actor,'company_admin',admin_role,'active',true),(a,target,'customer_service_agent',support_role,'active',true),(a,backup_admin,'company_admin',admin_role,'active',true);
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status)
  VALUES(client,a,'Synthetic staff actor guard','staff-actor-'||substr(client::text,1,12),repeat('a',64),ARRAY['staff_users.write'],'active');
  command:=jsonb_build_object('company_id',a,'actor_user_id',actor,'user_id',target,'action','upsert','staff_operation','change_role',
    'role_key','operations_agent','membership_role','operations','channel','staff_api','api_client_id',client,'idempotency_key','staff-client-role','reason','Synthetic guard test');
  invitation:=jsonb_build_object('company_id',a,'actor_user_id',actor,'staff_operation','invite','role_key','customer_service_agent','membership_role','support',
    'channel','staff_api','api_client_id',client,'idempotency_key','staff-client-invite','email',gen_random_uuid()::text||'@example.invalid','full_name','Synthetic guard invite');
  first_access:=public.canonical_change_tenant_user_access(command);
  first_invitation:=public.canonical_create_tenant_invitation(invitation);
  IF first_access->>'role_key'<>'operations_agent' OR first_invitation->>'status'<>'pending'
    OR public.canonical_change_tenant_user_access(command) IS DISTINCT FROM first_access
    OR public.canonical_create_tenant_invitation(invitation) IS DISTINCT FROM first_invitation
  THEN RAISE EXCEPTION 'staff_actor_guard_positive_replay_failed'; END IF;

  -- The backup administrator keeps authentic last-admin triggers satisfied
  -- while each actor lifecycle attribute is changed independently.
  FOREACH patch IN ARRAY ARRAY[
    format('UPDATE public.company_memberships SET accepted_at=NULL WHERE company_id=%L AND user_id=%L',a,actor),
    format('UPDATE public.company_memberships SET status=''disabled'',is_active=false WHERE company_id=%L AND user_id=%L',a,actor),
    format('UPDATE public.company_memberships SET role_key=''unknown_role'' WHERE company_id=%L AND user_id=%L',a,actor),
    format('UPDATE public.company_memberships SET role_key=''white_label_platform_admin'' WHERE company_id=%L AND user_id=%L',a,actor),
    format('UPDATE public.user_profiles SET user_status=''disabled'' WHERE id=%L',actor),
    format('UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id=%L',actor),
    format('UPDATE auth.users SET banned_until=clock_timestamp()+interval ''1 hour'' WHERE id=%L',actor),
    format('UPDATE public.companies SET is_active=false WHERE id=%L',a),
    format('UPDATE public.companies SET status=''paused'' WHERE id=%L',a)
  ] LOOP
    EXECUTE patch;
    PERFORM pg_temp.expect_staff_user_actor_denied(command,false);
    PERFORM pg_temp.expect_staff_user_actor_denied(invitation,true);
    PERFORM pg_temp.expect_staff_user_actor_denied(command||jsonb_build_object('idempotency_key','staff-actor-new-role','role_key','customer_service_agent','membership_role','support'),false);
    PERFORM pg_temp.expect_staff_user_actor_denied(invitation||jsonb_build_object('idempotency_key','staff-actor-new-invite','email',gen_random_uuid()::text||'@example.invalid'),true);
    UPDATE public.company_memberships SET role_key='company_admin',status='active',is_active=true,accepted_at=now() WHERE company_id=a AND user_id=actor;
    UPDATE public.user_profiles SET user_status='active' WHERE id=actor;
    UPDATE auth.users SET deleted_at=NULL,banned_until=NULL WHERE id=actor;
    UPDATE public.companies SET status='active',is_active=true WHERE id=a;
  END LOOP;
  IF EXISTS (
    SELECT FROM unnest(ARRAY['public.company_memberships'::regclass,'public.user_profiles'::regclass,'auth.users'::regclass,'public.integration_api_clients'::regclass]) relation_id
    WHERE NOT EXISTS(SELECT FROM pg_locks lock WHERE lock.pid=pg_backend_pid() AND lock.granted AND lock.relation=relation_id AND lock.mode='RowShareLock')
  ) THEN RAISE EXCEPTION 'staff_actor_guard_eligibility_locks_missing'; END IF;
  IF (SELECT count(*) FROM public.canonical_command_results WHERE company_id=a)<>2
    OR (SELECT count(*) FROM public.audit_logs WHERE company_id=a AND action IN('STAFF_CHANGE_ROLE','STAFF_INVITED'))<>2
    OR (SELECT count(*) FROM public.company_invitations WHERE company_id=a)<>1
    OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=a AND user_id=target AND role_key='operations_agent')
  THEN RAISE EXCEPTION 'staff_actor_guard_denial_wrote'; END IF;

  UPDATE auth.users SET banned_until=now()-interval '1 second' WHERE id=actor;
  IF public.canonical_change_tenant_user_access(command) IS DISTINCT FROM first_access
    OR public.canonical_create_tenant_invitation(invitation) IS DISTINCT FROM first_invitation
  THEN RAISE EXCEPTION 'staff_actor_guard_valid_expiry_denied'; END IF;
  IF has_function_privilege('anon','public.gridex_assert_staff_command_v1(jsonb,boolean)','EXECUTE')
    OR has_function_privilege('authenticated','public.gridex_assert_staff_command_v1(jsonb,boolean)','EXECUTE')
    OR has_function_privilege('service_role','public.gridex_assert_staff_command_v1(jsonb,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.canonical_change_tenant_user_access(jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.canonical_create_tenant_invitation(jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.canonical_change_tenant_user_access(jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.canonical_create_tenant_invitation(jsonb)','EXECUTE')
    OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog'] FROM pg_proc WHERE oid='public.gridex_assert_staff_command_v1(jsonb,boolean)'::regprocedure)
  THEN RAISE EXCEPTION 'staff_actor_guard_acl_invalid'; END IF;
  RAISE NOTICE 'staff user actor guard native regression passed';
END$$;
ROLLBACK;
