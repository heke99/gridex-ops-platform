-- Actual native PostgreSQL regression; all fixture state is synthetic/rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir sql/staff-native-role-catalog-fixture.sql
CREATE FUNCTION pg_temp.staff_external_snapshot(p_company uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'members',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.company_memberships t WHERE company_id=p_company),
  'roles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.user_roles t WHERE company_id=p_company),
  'commands',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.canonical_command_results t WHERE company_id=p_company),
  'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.canonical_audit_events t WHERE company_id=p_company),
  'events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.canonical_domain_events t WHERE company_id=p_company),
  'outbox',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.canonical_event_outbox t WHERE company_id=p_company));
$$;
CREATE FUNCTION pg_temp.expect_external_identity_denied(p_function text,p_command jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_state jsonb; denied boolean:=false;
BEGIN
 before_state:=pg_temp.staff_external_snapshot((p_command->>'company_id')::uuid);
 BEGIN EXECUTE format('SELECT public.%I($1)',p_function) USING p_command;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external identity refusal not enforced: %',p_function; END IF;
 IF before_state IS DISTINCT FROM pg_temp.staff_external_snapshot((p_command->>'company_id')::uuid) THEN RAISE EXCEPTION 'external identity refusal changed canonical effects'; END IF;
END $$;
DO $regression$
DECLARE
 company uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid();
 client uuid:=gen_random_uuid(); provider uuid:=gen_random_uuid(); invitation uuid:=gen_random_uuid();
 tenant_user uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid();
 actor uuid; binding uuid; command jsonb; delivery jsonb; receipt jsonb; accepted jsonb; resolved jsonb; saved_provider jsonb; saved_metadata jsonb;
 payload jsonb; before_state jsonb; denied boolean; patch text; ops_admin uuid:=gen_random_uuid(); bootstrap jsonb; bootstrap_command jsonb; bootstrap_invitation uuid; bootstrap_actor uuid; bootstrap_binding uuid; legacy_user uuid:=gen_random_uuid(); legacy_invitation uuid:=gen_random_uuid(); legacy_result jsonb;
BEGIN
 INSERT INTO public.companies(id,name,status,is_active) VALUES(company,'Synthetic external staff A','active',true),(other_company,'Synthetic external staff B','active',true);
 INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes,allowed_origins,metadata)
 VALUES(client,company,'Synthetic external staff key',left(client::text,8),repeat('a',64),'active',ARRAY['staff_users.write','staff_users.read','staff_cases.write'],ARRAY['https://support.example.com'],
  jsonb_build_object('staff_onboarding_origin','https://support.example.com','staff_tenant_auth',jsonb_build_object('url','https://abcdefghijklmnopqrst.supabase.co','public_key','synthetic-publishable-key'),
   'staff_tenant_delivery',jsonb_build_object('url','https://support.example.com/api/internal/staff/invitations/deliver','issuer','https://ops.example.com','audience','https://support.example.com/api/internal/staff/invitations/deliver','key_id','synthetic','request_public_jwk',jsonb_build_object('kty','RSA','kid','synthetic','n','AQAB','e','AQAB'))));
 INSERT INTO public.tenant_customer_identity_providers(id,company_id,kind,display_name,issuer,audience,public_jwk,subject_claim,enforcement,purpose,is_active)
 VALUES(provider,company,'tenant_key','Synthetic staff provider','https://support.example.com','staff-audience','{"kty":"RSA","kid":"synthetic","n":"AQAB","e":"AQAB"}','sub','enforce','staff',true);
 command:=jsonb_build_object('company_id',company,'api_client_id',client,'provider_id',provider,
  'verified_client',jsonb_build_object('secret_hash',repeat('a',64),'scopes',jsonb_build_array('staff_users.write','staff_users.read','staff_cases.write'),'allowed_origins',jsonb_build_array('https://support.example.com'),'staff_onboarding_origin','https://support.example.com',
   'staff_tenant_auth',jsonb_build_object('url','https://abcdefghijklmnopqrst.supabase.co','public_key','synthetic-publishable-key'),
   'staff_tenant_delivery',jsonb_build_object('url','https://support.example.com/api/internal/staff/invitations/deliver','issuer','https://ops.example.com','audience','https://support.example.com/api/internal/staff/invitations/deliver','key_id','synthetic','request_public_jwk',jsonb_build_object('kty','RSA','kid','synthetic','n','AQAB','e','AQAB'))),
  'verified_provider',jsonb_build_object('kind','tenant_key','issuer','https://support.example.com','audience','staff-audience','jwks_uri',NULL,'public_jwk','{"kty":"RSA","kid":"synthetic","n":"AQAB","e":"AQAB"}'::jsonb,'subject_claim','sub','enforcement','enforce'));
 PERFORM public.gridex_staff_tenant_onboarding_ready_v1(command);
 INSERT INTO public.company_invitations(id,company_id,email,full_name,status,token,idempotency_key,expires_at,role_key,membership_role,metadata)
 VALUES(invitation,company,'invited@example.invalid','Synthetic local staff','pending',gen_random_uuid(),'external-staff-intent',now()+interval '1 day','customer_service_agent','support','{}');
 payload:=jsonb_build_object('company_id',company,'channel','staff_api','api_client_id',client,'staff_operation','invite');
 INSERT INTO public.canonical_command_results(company_id,command_type,idempotency_key,request_hash,request_payload,result_payload)
 VALUES(company,'tenant.invitation.create','external-staff-intent',public.canonical_json_sha256(payload),payload,jsonb_build_object('invitation_id',invitation));
 INSERT INTO public.company_provisioning_jobs(id,company_id,job_key,status,idempotency_key,lease_token,locked_at)
 VALUES(job,company,'auth_invite','processing','external-staff-intent',lease,now());
 command:=command||jsonb_build_object('invitation_id',invitation,'provisioning_job_id',job,'provisioning_lease_token',lease);
 delivery:=public.gridex_prepare_staff_identity_delivery_v1(command);
 actor:=(delivery->>'actor_user_id')::uuid;
 IF actor=tenant_user OR NOT EXISTS(SELECT FROM auth.users WHERE id=actor AND email IS NULL AND phone IS NULL AND encrypted_password IS NULL)
   OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND email='invited@example.invalid' AND full_name='Synthetic local staff' AND user_status='active')
   OR EXISTS(SELECT FROM public.company_memberships WHERE company_id=company)
   OR public.gridex_prepare_staff_identity_delivery_v1(command) IS DISTINCT FROM delivery
 THEN RAISE EXCEPTION 'external_delivery_anchor_or_prepare_replay_invalid'; END IF;
 PERFORM pg_temp.expect_external_identity_denied('gridex_prepare_staff_identity_delivery_v1',command||jsonb_build_object('provisioning_lease_token',gen_random_uuid()));
 receipt:=jsonb_build_object('request_hash',delivery->>'request_hash','company_id',company,'api_client_id',client,'provider_id',provider,'invitation_id',invitation,
  'delivery_id',delivery->>'delivery_id','local_auth_subject',tenant_user,'auth_issuer',delivery->>'auth_issuer','email','invited@example.invalid','status','sent');
 resolved:=public.gridex_record_staff_identity_delivery_v1(command||jsonb_build_object('delivery_id',delivery->>'delivery_id','verified_receipt',receipt));
 binding:=(resolved->>'binding_id')::uuid;
 IF resolved->>'actor_user_id'<>actor::text OR (resolved->>'binding_version')::integer<>1
  OR public.gridex_record_staff_identity_delivery_v1(command||jsonb_build_object('delivery_id',delivery->>'delivery_id','verified_receipt',receipt)) IS DISTINCT FROM resolved
 THEN RAISE EXCEPTION 'external_delivery_binding_or_replay_invalid'; END IF;
 PERFORM pg_temp.expect_external_identity_denied('gridex_record_staff_identity_delivery_v1',command||jsonb_build_object('delivery_id',delivery->>'delivery_id','verified_receipt',receipt||jsonb_build_object('local_auth_subject',gen_random_uuid())));
 command:=command||jsonb_build_object('local_user_id',tenant_user,'local_auth_issuer',delivery->>'auth_issuer','binding_id',binding,'binding_version',1,'verified_email','invited@example.invalid','email_confirmed',true,'idempotency_key','external-accept');
 PERFORM pg_temp.expect_external_identity_denied('gridex_accept_external_staff_invitation_v1',command||jsonb_build_object('verified_email','different@example.invalid'));
 PERFORM pg_temp.expect_external_identity_denied('gridex_accept_external_staff_invitation_v1',command||jsonb_build_object('email_confirmed',false));
 accepted:=public.gridex_accept_external_staff_invitation_v1(command);
 IF accepted->>'user_id'<>actor::text OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=company AND user_id=actor AND is_active AND accepted_at IS NOT NULL)
  OR EXISTS(SELECT FROM public.company_memberships WHERE user_id=tenant_user)
  OR NOT EXISTS(SELECT FROM public.canonical_audit_events WHERE company_id=company AND actor_user_id=actor AND event_type='TENANT_INVITATION_ACCEPTED')
  OR public.gridex_accept_external_staff_invitation_v1(command) IS DISTINCT FROM accepted
 THEN RAISE EXCEPTION 'external_single_canonical_engine_or_audit_invalid'; END IF;
 UPDATE public.company_memberships SET is_active=false,status='disabled' WHERE company_id=company AND user_id=actor;
 UPDATE public.user_roles SET is_active=false,status='disabled' WHERE company_id=company AND user_id=actor;
 PERFORM public.gridex_accept_external_staff_invitation_v1(command);
 PERFORM public.gridex_accept_external_staff_invitation_v1(command||jsonb_build_object('idempotency_key','external-accept-new-replay-key'));
 IF EXISTS(SELECT FROM public.company_memberships WHERE company_id=company AND user_id=actor AND is_active)
  OR EXISTS(SELECT FROM public.user_roles WHERE company_id=company AND user_id=actor AND is_active)
 THEN RAISE EXCEPTION 'external acceptance replay reactivated disabled staff'; END IF;
 PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command);
 UPDATE public.company_memberships SET is_active=true,status='active' WHERE company_id=company AND user_id=actor;
 UPDATE public.user_roles SET is_active=true,status='active' WHERE company_id=company AND user_id=actor;
 resolved:=public.gridex_resolve_staff_identity_v1(command);
 IF resolved IS DISTINCT FROM jsonb_build_object('actor_user_id',actor,'binding_id',binding,'binding_version',1)
  OR public.gridex_validate_staff_identity_binding_v1(command||jsonb_build_object('actor_user_id',actor)) IS DISTINCT FROM resolved
 THEN RAISE EXCEPTION 'external_exact_identity_resolution_invalid'; END IF;
 PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command||jsonb_build_object('company_id',other_company));
 PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command||jsonb_build_object('provider_id',gen_random_uuid()));
 PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command||jsonb_build_object('api_client_id',gen_random_uuid()));
 -- Cases write uses the existing role profile, not a new external role engine.
 PERFORM public.gridex_staff_assert_write_actor_v1(company,actor,client,'cases.write');
 -- Every existing current-account predicate remains mandatory.
 FOREACH patch IN ARRAY ARRAY['banned_until=now()+interval ''1 hour''','deleted_at=now()'] LOOP
  EXECUTE 'UPDATE auth.users SET '||patch||' WHERE id=$1' USING actor;
  PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command);
  PERFORM pg_temp.expect_external_identity_denied('gridex_accept_external_staff_invitation_v1',command);
  UPDATE auth.users SET banned_until=NULL,deleted_at=NULL WHERE id=actor;
 END LOOP;
 UPDATE public.user_profiles SET user_status='disabled' WHERE id=actor;
 PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command);
 PERFORM pg_temp.expect_external_identity_denied('gridex_accept_external_staff_invitation_v1',command);
 UPDATE public.user_profiles SET user_status='active' WHERE id=actor;
 FOREACH patch IN ARRAY ARRAY['status=''revoked''','deleted_at=now()','revoked_at=now()','expires_at=now()-interval ''1 second''','scopes=ARRAY[''*'']'] LOOP
  EXECUTE 'UPDATE public.integration_api_clients SET '||patch||' WHERE id=$1' USING client;
  PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command);
  PERFORM pg_temp.expect_external_identity_denied('gridex_accept_external_staff_invitation_v1',command);
  UPDATE public.integration_api_clients SET status='active',deleted_at=NULL,revoked_at=NULL,expires_at=NULL,scopes=ARRAY['staff_users.write','staff_users.read','staff_cases.write'] WHERE id=client;
 END LOOP;
 FOREACH patch IN ARRAY ARRAY['purpose=''customer''','is_active=false'] LOOP
  EXECUTE 'UPDATE public.tenant_customer_identity_providers SET '||patch||' WHERE id=$1' USING provider;
  PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command);
  PERFORM pg_temp.expect_external_identity_denied('gridex_accept_external_staff_invitation_v1',command);
  UPDATE public.tenant_customer_identity_providers SET purpose='staff',is_active=true WHERE id=provider;
 END LOOP;
 SELECT metadata INTO saved_metadata FROM public.integration_api_clients WHERE id=client;
 UPDATE public.integration_api_clients SET metadata=metadata-'staff_tenant_auth' WHERE id=client;
 denied:=false; BEGIN PERFORM public.gridex_staff_assert_write_actor_v1(company,actor,client,'cases.write'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external removed registration bypassed native guard'; END IF;
 UPDATE public.integration_api_clients SET metadata=saved_metadata WHERE id=client;
 -- No tuple reassignment is possible, even with a privileged synthetic executor.
 FOREACH patch IN ARRAY ARRAY['actor_user_id','local_user_id','provider_id','company_id','api_client_id','invitation_id','delivery_id'] LOOP
  denied:=false; BEGIN EXECUTE format('UPDATE public.tenant_staff_identity_bindings SET %I=gen_random_uuid() WHERE id=$1',patch) USING binding;
  EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'external immutable binding reassigned: %',patch; END IF;
 END LOOP;
 -- An old provider configuration is denied until explicit, authorized refresh.
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(ops_admin,'ops-admin@example.invalid',now());
 INSERT INTO public.user_profiles(id,email,user_status) VALUES(ops_admin,'ops-admin@example.invalid','active');
 INSERT INTO public.admin_users(user_id,role,is_active) VALUES(ops_admin,'platform_admin',true);
 saved_provider:=command->'verified_provider';
 UPDATE public.tenant_customer_identity_providers SET public_jwk=public_jwk||jsonb_build_object('kid','rotated') WHERE id=provider;
 PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command);
 command:=command||jsonb_build_object('verified_provider',saved_provider||jsonb_build_object('public_jwk',saved_provider->'public_jwk'||jsonb_build_object('kid','rotated')));
 PERFORM pg_temp.expect_external_identity_denied('gridex_resolve_staff_identity_v1',command);
 PERFORM pg_temp.expect_external_identity_denied('gridex_refresh_staff_identity_binding_v1',command||jsonb_build_object('operator_user_id',actor));
 denied:=false; BEGIN PERFORM public.gridex_staff_assert_write_actor_v1(company,actor,client,'cases.write'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external rotated key allowed unrefreshed native write'; END IF;
 resolved:=public.gridex_refresh_staff_identity_binding_v1(command||jsonb_build_object('operator_user_id',ops_admin));
 IF resolved IS DISTINCT FROM jsonb_build_object('actor_user_id',actor,'binding_id',binding,'binding_version',2) THEN RAISE EXCEPTION 'external refresh remapped actor or version'; END IF;
 PERFORM pg_temp.expect_external_identity_denied('gridex_validate_staff_identity_binding_v1',command||jsonb_build_object('actor_user_id',actor));
 command:=command||jsonb_build_object('binding_version',2);
 PERFORM public.gridex_validate_staff_identity_binding_v1(command||jsonb_build_object('actor_user_id',actor));
 PERFORM public.gridex_staff_assert_write_actor_v1(company,actor,client,'cases.write');
 -- Initial administration uses the same verified OPS command engine; the
 -- external marker cannot give a read-only employee invitation authority.
 PERFORM pg_temp.expect_external_identity_denied('gridex_create_external_staff_invitation_v1',command||jsonb_build_object('actor_user_id',actor,'email','admin@example.invalid','role_key','company_admin','idempotency_key','initial-admin'));
 bootstrap:=public.gridex_create_external_staff_invitation_v1(command||jsonb_build_object('actor_user_id',ops_admin,'email','admin@example.invalid','role_key','company_admin','idempotency_key','initial-admin'));
 bootstrap_invitation:=(bootstrap->>'invitation_id')::uuid;
 IF NOT EXISTS(SELECT FROM public.canonical_command_results WHERE company_id=company AND command_type='tenant.invitation.create' AND idempotency_key='initial-admin'
  AND actor_user_id=ops_admin AND request_payload->>'channel'='ops' AND request_payload->'external_staff_identity'='true'::jsonb AND request_payload->>'api_client_id'=client::text)
 THEN RAISE EXCEPTION 'external initial admin bypassed canonical intent'; END IF;
 UPDATE public.company_provisioning_jobs SET status='processing',lease_token=gen_random_uuid(),locked_at=now() WHERE company_id=company AND idempotency_key='initial-admin';
 SELECT id,lease_token INTO job,lease FROM public.company_provisioning_jobs WHERE company_id=company AND idempotency_key='initial-admin';
 bootstrap_command:=command||jsonb_build_object('invitation_id',bootstrap_invitation,'provisioning_job_id',job,'provisioning_lease_token',lease);
 bootstrap:=public.gridex_prepare_staff_identity_delivery_v1(bootstrap_command);
 bootstrap_actor:=(bootstrap->>'actor_user_id')::uuid;
 tenant_user:=gen_random_uuid();
 receipt:=jsonb_build_object('request_hash',bootstrap->>'request_hash','company_id',company,'api_client_id',client,'provider_id',provider,'invitation_id',bootstrap_invitation,
  'delivery_id',bootstrap->>'delivery_id','local_auth_subject',tenant_user,'auth_issuer',bootstrap->>'auth_issuer','email','admin@example.invalid','status','sent');
 resolved:=public.gridex_record_staff_identity_delivery_v1(bootstrap_command||jsonb_build_object('delivery_id',bootstrap->>'delivery_id','verified_receipt',receipt));
 bootstrap_binding:=(resolved->>'binding_id')::uuid;
 bootstrap_command:=bootstrap_command||jsonb_build_object('local_user_id',tenant_user,'binding_id',bootstrap_binding,'binding_version',1,'verified_email','admin@example.invalid','email_confirmed',true,'idempotency_key','initial-admin-accept');
 resolved:=public.gridex_accept_external_staff_invitation_v1(bootstrap_command);
 IF resolved->>'user_id'<>bootstrap_actor::text OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=company AND user_id=bootstrap_actor AND role_key='company_admin' AND membership_role='company_admin' AND is_active)
 THEN RAISE EXCEPTION 'external initial admin acceptance did not use canonical role engine'; END IF;
 PERFORM public.gridex_assert_staff_command_v1(jsonb_build_object('company_id',company,'actor_user_id',bootstrap_actor,'api_client_id',client,'channel','staff_api'),true);
 PERFORM set_config('staff.external.service_command',(bootstrap_command||jsonb_build_object('actor_user_id',bootstrap_actor))::text,true);
 -- Legacy native acceptance remains unchanged for a real central account.
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(legacy_user,'legacy@example.invalid',now());
 INSERT INTO public.user_profiles(id,email,user_status) VALUES(legacy_user,'legacy@example.invalid','active');
 INSERT INTO public.company_invitations(id,company_id,email,invited_user_id,status,expires_at,role_key,membership_role)
 VALUES(legacy_invitation,company,'legacy@example.invalid',legacy_user,'pending',now()+interval '1 day','customer_service_agent','support');
 legacy_result:=public.canonical_accept_tenant_invitation(jsonb_build_object('company_id',company,'invitation_id',legacy_invitation,'user_id',legacy_user,'actor_user_id',legacy_user,'idempotency_key','legacy-accept'));
 IF legacy_result->>'user_id'<>legacy_user::text THEN RAISE EXCEPTION 'external forward changed legacy acceptance'; END IF;
 before_state:=pg_temp.staff_external_snapshot(company);
 FOREACH patch IN ARRAY ARRAY['local_user_id','local_auth_issuer','binding_id','binding_version','actor_user_id'] LOOP
  denied:=false;
  BEGIN PERFORM public.gridex_validate_staff_identity_binding_v1(command||jsonb_build_object('actor_user_id',actor)||jsonb_build_object(patch,CASE WHEN patch='local_auth_issuer' THEN 'https://wrong.example/auth/v1' WHEN patch='binding_version' THEN '999' ELSE gen_random_uuid()::text END));
   EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'external forged identity accepted: %',patch; END IF;
 END LOOP;
 -- Unbound subject equal to an existing OPS UUID remains unbound.
 denied:=false;
 BEGIN PERFORM public.gridex_resolve_staff_identity_v1(command||jsonb_build_object('local_user_id',actor));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external UUID equality fallback accepted'; END IF;
 FOREACH patch IN ARRAY ARRAY['email=''credential@example.invalid''','phone=''+4612345678''','encrypted_password=''copied-password'''] LOOP
  denied:=false;
  BEGIN EXECUTE 'UPDATE auth.users SET '||patch||' WHERE id=$1' USING actor;
  EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'external anchor credential accepted'; END IF;
 END LOOP;
 denied:=false; BEGIN INSERT INTO auth.sessions(id,user_id) VALUES(gen_random_uuid(),actor); EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external anchor session accepted'; END IF;
 denied:=false; BEGIN INSERT INTO auth.refresh_tokens(user_id,token) VALUES(actor::text,gen_random_uuid()::text); EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external anchor refresh token accepted'; END IF;
 IF to_regclass('auth.identities') IS NOT NULL THEN
  denied:=false; BEGIN EXECUTE 'INSERT INTO auth.identities(id,user_id,provider,identity_data) VALUES(gen_random_uuid(),$1,''email'',''{}'')' USING actor; EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'external anchor Auth identity accepted'; END IF;
 END IF;
 UPDATE public.tenant_staff_identity_bindings SET status='revoked',version=version+1,revoked_at=now() WHERE id=binding;
 denied:=false; BEGIN PERFORM public.gridex_resolve_staff_identity_v1(command); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external revoked binding resolved'; END IF;
 denied:=false; BEGIN PERFORM public.gridex_staff_assert_write_actor_v1(company,actor,client,'cases.write'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external revoked binding allowed native write'; END IF;
 denied:=false; BEGIN PERFORM public.gridex_accept_external_staff_invitation_v1(command); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'external revoked binding allowed cached acceptance'; END IF;
 IF before_state IS DISTINCT FROM pg_temp.staff_external_snapshot(company)
 THEN RAISE EXCEPTION 'external denial changed canonical state'; END IF;
 IF has_table_privilege('anon','public.tenant_staff_identity_bindings','SELECT')
  OR has_table_privilege('authenticated','public.tenant_staff_identity_bindings','INSERT')
  OR has_table_privilege('service_role','public.tenant_staff_identity_bindings','UPDATE')
  OR has_function_privilege('authenticated','public.gridex_resolve_staff_identity_v1(jsonb)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.gridex_resolve_staff_identity_v1(jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'external identity direct ACL invalid'; END IF;
END;
$regression$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 PERFORM public.gridex_resolve_staff_identity_v1(current_setting('staff.external.service_command')::jsonb);
 BEGIN PERFORM 1 FROM public.tenant_staff_identity_bindings; RAISE EXCEPTION 'external service direct binding read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.gridex_resolve_staff_identity_v1(current_setting('staff.external.service_command')::jsonb); RAISE EXCEPTION 'external anon RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.gridex_accept_external_staff_invitation_v1(current_setting('staff.external.service_command')::jsonb); RAISE EXCEPTION 'external authenticated acceptance RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN RAISE NOTICE 'STAFF_EXTERNAL_IDENTITY_BINDING_NATIVE_PASS'; END $$;
ROLLBACK;
