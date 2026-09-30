\set ON_ERROR_STOP on
-- Disposable native proof of selected-customer UI authority. Every fixture is
-- synthetic and the transaction rolls back. No delivery/worker is invoked.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select gen_random_uuid() as company_a,gen_random_uuid() as company_b,
  gen_random_uuid() as customer_a,gen_random_uuid() as customer_b,gen_random_uuid() as archived_customer,
  gen_random_uuid() as platform_actor,gen_random_uuid() as reader_actor,gen_random_uuid() as masterdata_actor,
  gen_random_uuid() as legal_actor,gen_random_uuid() as site_actor,gen_random_uuid() as writer_actor,
  gen_random_uuid() as platform_session,gen_random_uuid() as reader_session,gen_random_uuid() as masterdata_session,
  gen_random_uuid() as legal_session,gen_random_uuid() as site_session,gen_random_uuid() as writer_session,
  gen_random_uuid() as expired_session,gen_random_uuid() as revoked_session \gset

insert into public.companies(id,name,status,is_active) values
  (:'company_a','Synthetic capability company A','active',true),
  (:'company_b','Synthetic capability company B','active',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous)
select id,'authenticated','authenticated',id::text||'@example.invalid',now(),'{}','{}',now(),now(),false,false
  from unnest(array[:'platform_actor'::uuid,:'reader_actor'::uuid,:'masterdata_actor'::uuid,
    :'legal_actor'::uuid,:'site_actor'::uuid,:'writer_actor'::uuid]) id;
insert into public.user_profiles(id,email,full_name,user_status)
select id,id::text||'@example.invalid','Synthetic capability actor','active'
  from unnest(array[:'platform_actor'::uuid,:'reader_actor'::uuid,:'masterdata_actor'::uuid,
    :'legal_actor'::uuid,:'site_actor'::uuid,:'writer_actor'::uuid]) id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
  (:'platform_session',:'platform_actor',now(),now(),null),
  (:'reader_session',:'reader_actor',now(),now(),null),
  (:'masterdata_session',:'masterdata_actor',now(),now(),null),
  (:'legal_session',:'legal_actor',now(),now(),null),
  (:'site_session',:'site_actor',now(),now(),null),
  (:'writer_session',:'writer_actor',now(),now(),null),
  (:'expired_session',:'writer_actor',now(),now(),clock_timestamp()-interval '1 minute'),
  (:'revoked_session',:'writer_actor',now(),now(),null);
delete from auth.sessions where id=:'revoked_session';
insert into public.company_memberships(company_id,user_id,membership_role,role,role_key,status,is_active,accepted_at,joined_at)
select :'company_a',id,'viewer','viewer','viewer','active',true,now(),now()
  from unnest(array[:'reader_actor'::uuid,:'masterdata_actor'::uuid,:'legal_actor'::uuid,:'site_actor'::uuid,:'writer_actor'::uuid]) id;
-- The platform actor belongs only to B, despite its global permission fallback.
insert into public.company_memberships(company_id,user_id,membership_role,role,role_key,status,is_active,accepted_at,joined_at)
  values(:'company_b',:'platform_actor','viewer','viewer','viewer','active',true,now(),now());
insert into public.admin_users(user_id,role,is_active) values(:'platform_actor','super_admin',true);
insert into public.permissions(key,name) values
  ('masterdata.write','Synthetic capability masterdata write'),('customers.write','Synthetic capability legal write'),
  ('sites.write','Synthetic capability site write') on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
select grants.actor,:'company_a',p.id,p.key from public.permissions p join (values
  (:'masterdata_actor'::uuid,'masterdata.write'),(:'legal_actor'::uuid,'customers.write'),
  (:'site_actor'::uuid,'sites.write'),(:'writer_actor'::uuid,'masterdata.write'),
  (:'writer_actor'::uuid,'customers.write'),(:'writer_actor'::uuid,'sites.write')) grants(actor,permission)
  on grants.permission=p.key;
insert into public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,status,archived_at) values
  (:'customer_a',:'company_a',:'customer_a','Synthetic capability customer A','private','Synthetic','Capability A','active',null),
  (:'customer_b',:'company_b',:'customer_b','Synthetic capability customer B','private','Synthetic','Capability B','active',null),
  (:'archived_customer',:'company_a',:'archived_customer','Synthetic archived capability customer','private','Synthetic','Archived','archived',now());
select set_config('gridex.capability.fixture',jsonb_build_object(
  'companyA',:'company_a','companyB',:'company_b','customerA',:'customer_a','customerB',:'customer_b','archivedCustomer',:'archived_customer',
  'platformActor',:'platform_actor','readerActor',:'reader_actor','masterdataActor',:'masterdata_actor',
  'legalActor',:'legal_actor','siteActor',:'site_actor','writerActor',:'writer_actor',
  'platformSession',:'platform_session','readerSession',:'reader_session','masterdataSession',:'masterdata_session',
  'legalSession',:'legal_session','siteSession',:'site_session','writerSession',:'writer_session',
  'expiredSession',:'expired_session','revokedSession',:'revoked_session')::text,true);

create function pg_temp.assert_customer_ops_capabilities(p_company uuid,p_customer uuid,p_actor uuid,p_session uuid,
  p_expected jsonb,p_label text,p_compare_actor boolean default true) returns void
language plpgsql security invoker set search_path=pg_catalog as $test$
declare actual jsonb; accepted boolean; kind text; context jsonb; before_effects jsonb; after_effects jsonb;
begin
  select jsonb_build_array(
    (select count(*) from public.canonical_command_results where company_id=p_company),
    (select count(*) from public.canonical_audit_events where company_id=p_company),
    (select count(*) from public.canonical_domain_events where company_id=p_company),
    (select count(*) from public.canonical_event_outbox where company_id=p_company)) into before_effects;
  actual:=public.gridex_customer_ops_command_capabilities_v1(p_company,p_customer,p_actor,p_session);
  if actual->>'companyId' is distinct from p_company::text or actual->>'customerId' is distinct from p_customer::text
    or actual->>'actorUserId' is distinct from p_actor::text or actual->>'sessionId' is distinct from p_session::text
    or (actual-array['companyId','customerId','actorUserId','sessionId']) is distinct from p_expected then
    raise exception 'customer_ops_capability_projection_failed: %',p_label; end if;
  -- Compare against the actual current profile authorization used by contact
  -- and address commands; the billing kind uses the same masterdata permission.
  context:=jsonb_build_object('companyId',p_company,'customerId',p_customer,'mode','ops',
    'actorUserId',p_actor,'sessionId',p_session,'reason','Synthetic projection authority comparison',
    'idempotencyKey','capability-native-authority-check','requestJson','{}');
  foreach kind in array array['contact','billing'] loop
    accepted:=true;
    begin perform private.gridex_profile_command_authorize_v1(context,kind);
    exception when insufficient_privilege then accepted:=false; end;
    if accepted is distinct from (p_expected->>(case kind when 'billing' then 'canEditBilling' else 'canEditContact' end))::boolean then
      raise exception 'customer_ops_capability_command_authority_mismatch: %, %',p_label,kind; end if;
  end loop;
  if p_compare_actor then
    if private.gridex_customer_ops_actor_allowed_v1(p_actor,p_session,p_company,'customers.write')
      is distinct from (p_expected->>'canEditLegalProfile')::boolean
      or private.gridex_site_ops_actor_allowed_v1(p_actor,p_session,p_company)
      is distinct from (p_expected->>'canEditSites')::boolean then
      raise exception 'customer_ops_capability_legal_site_authority_mismatch: %',p_label; end if;
  end if;
  select jsonb_build_array(
    (select count(*) from public.canonical_command_results where company_id=p_company),
    (select count(*) from public.canonical_audit_events where company_id=p_company),
    (select count(*) from public.canonical_domain_events where company_id=p_company),
    (select count(*) from public.canonical_event_outbox where company_id=p_company)) into after_effects;
  if before_effects is distinct from after_effects then raise exception 'customer_ops_capability_read_wrote_effects: %',p_label; end if;
end;
$test$;
revoke all on function pg_temp.assert_customer_ops_capabilities(uuid,uuid,uuid,uuid,jsonb,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function pg_temp.assert_customer_ops_capabilities(uuid,uuid,uuid,uuid,jsonb,text,boolean) to service_role;

set local role service_role;
do $test$
declare f jsonb:=current_setting('gridex.capability.fixture')::jsonb;
  ca uuid:=(f->>'companyA')::uuid; cu uuid:=(f->>'customerA')::uuid;
  no_write jsonb:='{"canEditContact":false,"canEditAddresses":false,"canEditBilling":false,"canEditLegalProfile":false,"canCloseLifecycle":false,"canEditSites":false}';
  all_write jsonb:='{"canEditContact":true,"canEditAddresses":true,"canEditBilling":true,"canEditLegalProfile":true,"canCloseLifecycle":true,"canEditSites":true}';
begin
  if not public.gridex_actor_has_company_permission((f->>'platformActor')::uuid,ca,'masterdata.write') then
    raise exception 'customer_ops_capability_platform_fixture_missing_global_authority'; end if;
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'platformActor')::uuid,(f->>'platformSession')::uuid,no_write,'platform without chosen company membership');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'readerActor')::uuid,(f->>'readerSession')::uuid,no_write,'reader membership');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'masterdataActor')::uuid,(f->>'masterdataSession')::uuid,
    no_write||'{"canEditContact":true,"canEditAddresses":true,"canEditBilling":true}','masterdata-only writer');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'legalActor')::uuid,(f->>'legalSession')::uuid,
    no_write||'{"canEditLegalProfile":true,"canCloseLifecycle":true,"canEditSites":true}','legal-only writer');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'siteActor')::uuid,(f->>'siteSession')::uuid,
    no_write||'{"canEditSites":true}','site-only writer');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'writerActor')::uuid,(f->>'writerSession')::uuid,all_write,'explicitly granted writer');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'writerActor')::uuid,(f->>'readerSession')::uuid,no_write,'wrong session owner');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'writerActor')::uuid,(f->>'expiredSession')::uuid,no_write,'expired session');
  perform pg_temp.assert_customer_ops_capabilities(ca,cu,(f->>'writerActor')::uuid,(f->>'revokedSession')::uuid,no_write,'revoked session');
  perform pg_temp.assert_customer_ops_capabilities(ca,(f->>'customerB')::uuid,(f->>'writerActor')::uuid,(f->>'writerSession')::uuid,no_write,'foreign customer binding',false);
  perform pg_temp.assert_customer_ops_capabilities(ca,(f->>'archivedCustomer')::uuid,(f->>'writerActor')::uuid,(f->>'writerSession')::uuid,no_write,'archived customer',false);
end;
$test$;
\echo CUSTOMER_OPS_CAPABILITIES_SELECTED_RESOURCE_PERMISSION_SESSION_PARITY_PASS

reset role;
update public.user_permissions set is_active=false where user_id=:'writer_actor' and company_id=:'company_a';
set local role service_role;
do $test$
declare f jsonb:=current_setting('gridex.capability.fixture')::jsonb;
begin
  perform pg_temp.assert_customer_ops_capabilities((f->>'companyA')::uuid,(f->>'customerA')::uuid,
    (f->>'writerActor')::uuid,(f->>'writerSession')::uuid,
    '{"canEditContact":false,"canEditAddresses":false,"canEditBilling":false,"canEditLegalProfile":false,"canCloseLifecycle":false,"canEditSites":false}',
    'current revoked permission');
end;
$test$;
reset role;
update public.user_permissions set is_active=true where user_id=:'writer_actor' and company_id=:'company_a';
update public.company_memberships set is_active=false where user_id=:'writer_actor' and company_id=:'company_a';
set local role service_role;
do $test$
declare f jsonb:=current_setting('gridex.capability.fixture')::jsonb;
begin
  perform pg_temp.assert_customer_ops_capabilities((f->>'companyA')::uuid,(f->>'customerA')::uuid,
    (f->>'writerActor')::uuid,(f->>'writerSession')::uuid,
    '{"canEditContact":false,"canEditAddresses":false,"canEditBilling":false,"canEditLegalProfile":false,"canCloseLifecycle":false,"canEditSites":false}',
    'current inactive membership');
end;
$test$;
\echo CUSTOMER_OPS_CAPABILITIES_CURRENT_PERMISSION_MEMBERSHIP_DENIED_PASS

reset role;
do $test$
begin
  if has_function_privilege('anon','public.gridex_customer_ops_command_capabilities_v1(uuid,uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.gridex_customer_ops_command_capabilities_v1(uuid,uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','private.gridex_customer_ops_session_live_v1(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.gridex_customer_ops_session_live_v1(uuid,uuid)','EXECUTE') then
    raise exception 'customer_ops_capability_untrusted_execute_grant'; end if;
end;
$test$;
set local role anon;
do $test$
declare denied boolean:=false;
begin
  begin perform public.gridex_customer_ops_command_capabilities_v1(null,null,null,null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'customer_ops_capability_anon_execute_allowed'; end if;
end;
$test$;
set local role authenticated;
do $test$
declare denied boolean:=false;
begin
  begin perform public.gridex_customer_ops_command_capabilities_v1(null,null,null,null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'customer_ops_capability_authenticated_execute_allowed'; end if;
end;
$test$;
reset role;
\echo CUSTOMER_OPS_CAPABILITIES_SERVICE_ROLE_ONLY_READ_PASS
rollback;
