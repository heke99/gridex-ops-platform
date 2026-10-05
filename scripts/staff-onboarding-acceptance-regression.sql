-- Disposable native PostgreSQL clean replay only. All synthetic effects rollback.
\set ON_ERROR_STOP on
BEGIN;
\ir sql/staff-native-role-catalog-fixture.sql
CREATE FUNCTION pg_temp.expect_staff_onboarding_denied(command jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.gridex_accept_staff_invitation_v1(command);
    RAISE EXCEPTION 'staff_onboarding_unexpected_grant';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'staff_onboarding_%' THEN RAISE; END IF;
  END;
END$$;
DO $regression$
DECLARE
  company uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid();
  invitee uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid(); provider uuid:=gen_random_uuid(); invitation uuid:=gen_random_uuid();
  command jsonb; original jsonb; wrong_binding jsonb; first_result jsonb; patch text; support_role uuid;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(company,'Synthetic support onboarding','active'),(other_company,'Synthetic foreign support','active');
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(invitee,invitee::text||'@example.invalid',now()),(other_user,other_user::text||'@example.invalid',now());
  INSERT INTO public.user_profiles(id,email,user_status) VALUES(invitee,invitee::text||'@example.invalid','active'),(other_user,other_user::text||'@example.invalid','active')
    ON CONFLICT(id) DO UPDATE SET user_status='active';
  SELECT id INTO support_role FROM public.roles WHERE key='customer_service_agent' ORDER BY created_at,id LIMIT 1;
  IF support_role IS NULL THEN RAISE EXCEPTION 'staff_onboarding_fixture_role_missing'; END IF;
  INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes,status,allowed_origins,metadata)
    VALUES(client,company,'Synthetic support client','support-onboarding',repeat('a',64),ARRAY['staff_users.write'],'active',ARRAY['https://support123.gridex.se'],jsonb_build_object('staff_onboarding_origin','https://support123.gridex.se'));
  INSERT INTO public.tenant_customer_identity_providers(id,company_id,kind,display_name,issuer,audience,jwks_uri,public_jwk,subject_claim,enforcement,purpose,is_active)
    VALUES(provider,company,'tenant_key','Synthetic staff provider','https://support123.gridex.se','staff-audience',NULL,'{"kty":"RSA","kid":"synthetic","n":"AQAB","e":"AQAB"}'::jsonb,'sub','enforce','staff',true);
  -- The acceptance fixture begins with a committed, delivered canonical intent;
  -- creation/role ceiling and leased delivery are separately tested at their own boundaries.
  INSERT INTO public.company_invitations(id,company_id,email,invited_user_id,status,expires_at,role_key,membership_role,metadata)
    VALUES(invitation,company,invitee::text||'@example.invalid',invitee,'pending',now()+interval '1 day','customer_service_agent','support','{}');
  original:=jsonb_build_object('company_id',company,'channel','staff_api','api_client_id',client,'staff_operation','invite');
  INSERT INTO public.canonical_command_results(company_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id)
    VALUES(company,'tenant.invitation.create','onboarding-delivered-intent',public.canonical_json_sha256(original),original,jsonb_build_object('invitation_id',invitation),invitee);
  command:=jsonb_build_object('company_id',company,'invitation_id',invitation,'user_id',invitee,'actor_user_id',invitee,'api_client_id',client,'provider_id',provider,'channel','staff_onboarding','idempotency_key','support-onboarding-accept',
    'verified_client',jsonb_build_object('secret_hash',repeat('a',64),'scopes',jsonb_build_array('staff_users.write'),'allowed_origins',jsonb_build_array('https://support123.gridex.se'),'staff_onboarding_origin','https://support123.gridex.se'),
    'verified_provider',jsonb_build_object('kind','tenant_key','issuer','https://support123.gridex.se','audience','staff-audience','jwks_uri',NULL,'public_jwk','{"kty":"RSA","kid":"synthetic","n":"AQAB","e":"AQAB"}'::jsonb,'subject_claim','sub','enforcement','enforce'));

  -- Direct RPC callers never gain browser authority.
  IF has_function_privilege('anon','public.gridex_accept_staff_invitation_v1(jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.gridex_accept_staff_invitation_v1(jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.gridex_accept_staff_invitation_v1(jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'staff_onboarding_execute_acl_invalid'; END IF;
  PERFORM pg_temp.expect_staff_onboarding_denied(command||jsonb_build_object('company_id',other_company));
  PERFORM pg_temp.expect_staff_onboarding_denied(command||jsonb_build_object('actor_user_id',other_user));
  PERFORM pg_temp.expect_staff_onboarding_denied(command||jsonb_build_object('user_id',other_user,'actor_user_id',other_user));
  PERFORM pg_temp.expect_staff_onboarding_denied(command||jsonb_build_object('channel','ops'));
  PERFORM pg_temp.expect_staff_onboarding_denied(command||jsonb_build_object('verified_provider',command->'verified_provider'||jsonb_build_object('issuer','https://forged.example')));
  PERFORM pg_temp.expect_staff_onboarding_denied(command||jsonb_build_object('verified_client',command->'verified_client'||jsonb_build_object('secret_hash',repeat('b',64))));
  UPDATE public.companies SET is_active=false WHERE id=company;
  PERFORM pg_temp.expect_staff_onboarding_denied(command);
  UPDATE public.companies SET is_active=true WHERE id=company;
  FOREACH patch IN ARRAY ARRAY['status=''revoked''','deleted_at=now()','revoked_at=now()','expires_at=now()-interval ''1 second''','scopes=ARRAY[''*'']','allowed_origins=ARRAY[]::text[]','secret_hash=repeat(''b'',64)'] LOOP
    EXECUTE 'UPDATE public.integration_api_clients SET '||patch||' WHERE id=$1' USING client;
    PERFORM pg_temp.expect_staff_onboarding_denied(command);
    UPDATE public.integration_api_clients SET status='active',deleted_at=NULL,revoked_at=NULL,expires_at=NULL,scopes=ARRAY['staff_users.write'],allowed_origins=ARRAY['https://support123.gridex.se'],secret_hash=repeat('a',64) WHERE id=client;
  END LOOP;
  FOREACH patch IN ARRAY ARRAY['purpose=''customer''','is_active=false','issuer=''https://rotated.example''','audience=''other-audience''','public_jwk=''{}''::jsonb'] LOOP
    EXECUTE 'UPDATE public.tenant_customer_identity_providers SET '||patch||' WHERE id=$1' USING provider;
    PERFORM pg_temp.expect_staff_onboarding_denied(command);
    UPDATE public.tenant_customer_identity_providers SET purpose='staff',is_active=true,issuer='https://support123.gridex.se',audience='staff-audience',public_jwk=command->'verified_provider'->'public_jwk' WHERE id=provider;
  END LOOP;
  FOREACH patch IN ARRAY ARRAY['email_confirmed_at=NULL','deleted_at=now()','banned_until=now()+interval ''1 hour'''] LOOP
    EXECUTE 'UPDATE auth.users SET '||patch||' WHERE id=$1' USING invitee;
    PERFORM pg_temp.expect_staff_onboarding_denied(command);
    UPDATE auth.users SET email_confirmed_at=now(),deleted_at=NULL,banned_until=NULL WHERE id=invitee;
  END LOOP;
  wrong_binding:=original||jsonb_build_object('api_client_id',gen_random_uuid());
  UPDATE public.canonical_command_results SET request_payload=wrong_binding,request_hash=public.canonical_json_sha256(wrong_binding) WHERE company_id=company AND command_type='tenant.invitation.create';
  PERFORM pg_temp.expect_staff_onboarding_denied(command);
  UPDATE public.canonical_command_results SET request_payload=original,request_hash=public.canonical_json_sha256(original) WHERE company_id=company AND command_type='tenant.invitation.create';
  IF EXISTS(SELECT FROM public.company_memberships WHERE company_id=company) OR EXISTS(SELECT FROM public.user_roles WHERE company_id=company)
    OR EXISTS(SELECT FROM public.canonical_command_results WHERE company_id=company AND command_type='tenant.invitation.accept')
    OR EXISTS(SELECT FROM public.canonical_domain_events WHERE company_id=company)
  THEN RAISE EXCEPTION 'staff_onboarding_denial_created_effects'; END IF;

  first_result:=public.gridex_accept_staff_invitation_v1(command);
  IF NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=company AND user_id=invitee AND is_active AND role_key='customer_service_agent')
    OR NOT EXISTS(SELECT FROM public.user_roles WHERE company_id=company AND user_id=invitee AND role_id=support_role AND is_active)
    OR public.gridex_accept_staff_invitation_v1(command) IS DISTINCT FROM first_result
    OR (SELECT count(*) FROM public.canonical_command_results WHERE company_id=company AND command_type='tenant.invitation.accept')<>1
    OR (SELECT count(*) FROM public.canonical_audit_events WHERE company_id=company AND event_type='TENANT_INVITATION_ACCEPTED')<>1
    OR (SELECT count(*) FROM public.canonical_domain_events WHERE company_id=company AND event_type='TENANT_INVITATION_ACCEPTED')<>1
    OR (SELECT count(*) FROM public.canonical_event_outbox WHERE company_id=company)<>1
  THEN RAISE EXCEPTION 'staff_onboarding_canonical_accept_or_replay_invalid'; END IF;
  IF EXISTS(SELECT FROM public.canonical_command_results WHERE company_id=company AND command_type='tenant.invitation.accept'
    AND (request_payload ? 'verified_client' OR request_payload ? 'verified_provider' OR request_payload ? 'provider_id'))
  THEN RAISE EXCEPTION 'staff_onboarding_verification_snapshot_persisted'; END IF;
  UPDATE public.company_memberships SET is_active=false,status='disabled' WHERE company_id=company AND user_id=invitee;
  UPDATE public.user_roles SET is_active=false,status='disabled' WHERE company_id=company AND user_id=invitee;
  PERFORM public.gridex_accept_staff_invitation_v1(command);
  PERFORM public.gridex_accept_staff_invitation_v1(command||jsonb_build_object('idempotency_key','support-onboarding-new-replay-key'));
  IF EXISTS(SELECT FROM public.company_memberships WHERE company_id=company AND is_active)
    OR EXISTS(SELECT FROM public.user_roles WHERE company_id=company AND is_active)
    OR (SELECT count(*) FROM public.canonical_domain_events WHERE company_id=company)<>1
  THEN RAISE EXCEPTION 'staff_onboarding_replay_reactivated_disabled_staff'; END IF;
  UPDATE public.integration_api_clients SET status='revoked' WHERE id=client;
  PERFORM pg_temp.expect_staff_onboarding_denied(command);
END;
$regression$;
ROLLBACK;
