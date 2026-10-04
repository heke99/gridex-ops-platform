-- Run only on the disposable clean replay database; every synthetic row is rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir sql/staff-native-role-catalog-fixture.sql
DO $staff_regression$
DECLARE
  company_a uuid := gen_random_uuid();
  company_b uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  colleague uuid := gen_random_uuid();
  foreign_user uuid := gen_random_uuid();
  invitee uuid := gen_random_uuid();
  client uuid := gen_random_uuid();
  role_admin uuid;
  role_support uuid;
  command jsonb;
  result jsonb;
  repeated jsonb;
  audit_count bigint;
  invitation_command jsonb;
  invitation_result jsonb;
  linked_invitation_id uuid;
  acceptance_command jsonb;
  acceptance_result jsonb;
BEGIN
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
    (actor,'staff-actor@example.invalid',now()),(colleague,'staff-colleague@example.invalid',now()),(foreign_user,'staff-foreign@example.invalid',now()),(invitee,'staff-invitee@example.invalid',now());
  INSERT INTO public.user_profiles(id,email,user_status) VALUES
    (actor,'staff-actor@example.invalid','active'),(colleague,'staff-colleague@example.invalid','active'),(foreign_user,'staff-foreign@example.invalid','active'),(invitee,'staff-invitee@example.invalid','active')
  ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.companies(id,name,status) VALUES(company_a,'Synthetic staff A','active'),(company_b,'Synthetic staff B','active');
  SELECT id INTO role_admin FROM public.roles WHERE coalesce(key,name)='company_admin' ORDER BY created_at,id LIMIT 1;
  SELECT id INTO role_support FROM public.roles WHERE coalesce(key,name)='customer_service_agent' ORDER BY created_at,id LIMIT 1;
  IF role_admin IS NULL OR role_support IS NULL THEN RAISE EXCEPTION 'staff fixture role definitions missing'; END IF;
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,role_key,status,is_active,accepted_at) VALUES
    (company_a,actor,'company_admin','company_admin','active',true,now()),
    (company_a,colleague,'support','customer_service_agent','active',true,now()),
    (company_b,foreign_user,'company_admin','company_admin','active',true,now());
  INSERT INTO public.user_roles(company_id,user_id,role,role_id,status,is_active) VALUES
    (company_a,actor,'company_admin',role_admin,'active',true),
    (company_a,colleague,'customer_service_agent',role_support,'active',true),
    (company_b,foreign_user,'company_admin',role_admin,'active',true);
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status)
  VALUES(client,company_a,'Synthetic staff key','staff-test',repeat('a',64),ARRAY['staff_users.read','staff_users.write'],'active');

  command := jsonb_build_object('company_id',company_a,'actor_user_id',actor,'user_id',colleague,'action','upsert',
    'staff_operation','change_role','role_key','operations_agent','membership_role','operations',
    'channel','staff_api','api_client_id',client,'idempotency_key','staff-native-role','reason','synthetic');
  result := public.canonical_change_tenant_user_access(command);
  IF result->>'status'<>'active' OR result->>'role_key'<>'operations_agent' THEN RAISE EXCEPTION 'staff role command did not materialize mapped role'; END IF;
  IF NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=company_a AND user_id=colleague AND membership_role='operations' AND role_key='operations_agent') THEN
    RAISE EXCEPTION 'staff role command did not persist membership role key';
  END IF;
  repeated := public.canonical_change_tenant_user_access(command);
  IF repeated IS DISTINCT FROM result THEN RAISE EXCEPTION 'staff role replay changed result'; END IF;
  SELECT count(*) INTO audit_count FROM public.audit_logs WHERE company_id=company_a AND actor_user_id=actor AND metadata->>'channel'='staff_api' AND metadata->>'api_client_id'=client::text AND action='STAFF_CHANGE_ROLE';
  IF audit_count<>1 THEN RAISE EXCEPTION 'staff provenance missing or duplicate audit: %',audit_count; END IF;

  BEGIN
    PERFORM public.canonical_change_tenant_user_access(command||jsonb_build_object('user_id',foreign_user,'idempotency_key','staff-native-cross-company'));
    RAISE EXCEPTION 'cross-company target accepted';
  EXCEPTION WHEN no_data_found THEN IF SQLERRM<>'staff_user_not_found' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.canonical_change_tenant_user_access(command||jsonb_build_object('staff_operation','disable','action','disable','user_id',actor,'idempotency_key','staff-native-self-disable'));
    RAISE EXCEPTION 'self disable accepted';
  EXCEPTION WHEN check_violation THEN IF SQLERRM<>'staff_self_disable_forbidden' THEN RAISE; END IF; END;

  -- Actual durable intent and worker link close the invitation schema used by
  -- disable. No delivery is performed; its queued job is rolled back below.
  invitation_command := jsonb_build_object('company_id',company_a,'actor_user_id',actor,
    'staff_operation','invite','role_key','operations_agent','membership_role','operations',
    'channel','staff_api','api_client_id',client,'idempotency_key','staff-native-linked-invitation',
    'email','staff-colleague@example.invalid','full_name','Synthetic linked staff');
  invitation_result := public.canonical_create_tenant_invitation(invitation_command);
  linked_invitation_id := (invitation_result->>'invitation_id')::uuid;
  IF public.canonical_create_tenant_invitation(invitation_command) IS DISTINCT FROM invitation_result
    OR NOT EXISTS(SELECT FROM public.company_invitations WHERE id=linked_invitation_id
      AND token=(invitation_result->>'token')::uuid AND full_name='Synthetic linked staff'
      AND membership_role='operations' AND role_key='operations_agent' AND invited_by=actor
      AND accept_token_hash=encode(extensions.digest(token::text,'sha256'),'hex'))
    OR (SELECT count(*) FROM public.company_provisioning_jobs WHERE company_id=company_a
      AND job_key='auth_invite' AND idempotency_key='staff-native-linked-invitation')<>1
  THEN RAISE EXCEPTION 'staff durable invitation schema or replay incomplete'; END IF;
  UPDATE public.company_invitations SET invited_user_id=colleague WHERE id=linked_invitation_id AND company_id=company_a;

  command := command||jsonb_build_object('staff_operation','disable','action','disable','idempotency_key','staff-native-disable');
  result := public.canonical_change_tenant_user_access(command);
  IF result->>'status'<>'disabled' THEN RAISE EXCEPTION 'staff disable did not disable membership'; END IF;
  repeated := public.canonical_change_tenant_user_access(command);
  IF repeated IS DISTINCT FROM result THEN RAISE EXCEPTION 'staff disable replay changed result'; END IF;
  IF EXISTS(SELECT FROM public.user_roles WHERE company_id=company_a AND user_id=colleague AND status='active' AND is_active) THEN RAISE EXCEPTION 'staff disable left role active'; END IF;
  IF NOT EXISTS(SELECT FROM public.company_invitations WHERE id=linked_invitation_id AND company_id=company_a
    AND invited_user_id=colleague AND status='invitation_revoked' AND revoked_at IS NOT NULL)
  THEN RAISE EXCEPTION 'staff disable did not revoke its linked pending invitation'; END IF;

  command := (command-'role_key'-'membership_role')||jsonb_build_object('staff_operation','enable','action','upsert','idempotency_key','staff-native-enable');
  result := public.canonical_change_tenant_user_access(command);
  IF result->>'status'<>'active' OR result->>'role_key'<>'operations_agent' THEN RAISE EXCEPTION 'staff enable did not restore same role'; END IF;
  repeated := public.canonical_change_tenant_user_access(command);
  IF repeated IS DISTINCT FROM result THEN RAISE EXCEPTION 'staff enable replay changed result'; END IF;

  -- The same real domain intent is accepted by the verified synthetic Auth
  -- user, preserving the producer's role/membership and exact replay.
  invitation_command := invitation_command||jsonb_build_object('role_key','customer_service_agent',
    'membership_role','support','idempotency_key','staff-native-accepted-invitation','email','staff-invitee@example.invalid');
  invitation_result := public.canonical_create_tenant_invitation(invitation_command);
  UPDATE public.company_invitations SET invited_user_id=invitee
    WHERE id=(invitation_result->>'invitation_id')::uuid AND company_id=company_a;
  acceptance_command := jsonb_build_object('actor_user_id',invitee,'user_id',invitee,
    'invitation_id',invitation_result->>'invitation_id','idempotency_key','staff-native-accept-invitation');
  acceptance_result := public.canonical_accept_tenant_invitation(acceptance_command);
  IF acceptance_result->>'role_key'<>'customer_service_agent' OR acceptance_result->>'membership_role'<>'support'
    OR public.canonical_accept_tenant_invitation(acceptance_command) IS DISTINCT FROM acceptance_result
    OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=company_a AND user_id=invitee
      AND role_key='customer_service_agent' AND membership_role='support' AND status='active' AND is_active AND accepted_at IS NOT NULL)
    OR NOT EXISTS(SELECT FROM public.company_invitations WHERE id=(invitation_result->>'invitation_id')::uuid
      AND status='accepted' AND invited_user_id=invitee AND accepted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'staff verified invitation acceptance schema incomplete'; END IF;

  INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
  VALUES(company_a,colleague,'users.write','allow','active',true);
  BEGIN
    PERFORM public.canonical_change_tenant_user_access(command||jsonb_build_object('staff_operation','change_role','actor_user_id',colleague,'user_id',actor,'role_key','customer_service_agent','membership_role','support','idempotency_key','staff-native-last-admin'));
    RAISE EXCEPTION 'last admin demotion accepted';
  EXCEPTION WHEN check_violation THEN IF SQLERRM<>'staff_last_admin_required' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.canonical_create_tenant_invitation(jsonb_build_object('company_id',company_a,'actor_user_id',colleague,'staff_operation','invite','channel','staff_api','api_client_id',client,'email','staff-invite@example.invalid','role_key','company_admin','membership_role','company_admin','idempotency_key','staff-native-ceiling'));
    RAISE EXCEPTION 'staff role ceiling accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'staff_role_ceiling_exceeded' THEN RAISE; END IF; END;

  -- Global/foreign direct grants never add authority to the API actor.
  DELETE FROM public.user_permissions WHERE company_id=company_a AND user_id=colleague;
  INSERT INTO public.user_permissions(company_id,user_id,permission_key,effect,status,is_active)
  VALUES(NULL,colleague,'users.write','allow','active',true),(company_b,colleague,'users.write','allow','active',true);
  IF 'users.write'=ANY(public.gridex_staff_actor_permissions_v1(company_a,colleague,false)) THEN RAISE EXCEPTION 'foreign/global override leaked into staff authority'; END IF;
  IF has_function_privilege('authenticated','public.gridex_staff_actor_permissions_v1(uuid,uuid,boolean)','execute') OR has_function_privilege('anon','public.canonical_change_tenant_user_access(jsonb)','execute') THEN
    RAISE EXCEPTION 'staff command/helper publicly executable';
  END IF;
  RAISE NOTICE 'staff user command native regression passed';
END;
$staff_regression$;
ROLLBACK;
