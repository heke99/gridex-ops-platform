\set ON_ERROR_STOP on
-- Isolated replay fixture. Every row is synthetic and the transaction rolls back.
begin;
select gen_random_uuid() as company_a, gen_random_uuid() as company_b,
  gen_random_uuid() as actor_a, gen_random_uuid() as actor_b,
  gen_random_uuid() as customer_a, gen_random_uuid() as customer_other,
  gen_random_uuid() as client_a \gset

insert into public.companies(id,name,status) values
  (:'company_a','Synthetic contact tenant A','active'),
  (:'company_b','Synthetic contact tenant B','active');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,
  raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
values
  (:'actor_a','authenticated','authenticated',:'actor_a'||'@example.invalid',now(),'{}','{}',now(),now(),false,false),
  (:'actor_b','authenticated','authenticated',:'actor_b'||'@example.invalid',now(),'{}','{}',now(),now(),false,false);
insert into public.user_profiles(id,email,full_name,user_status) values
  (:'actor_a',:'actor_a'||'@example.invalid','Synthetic A','active'),
  (:'actor_b',:'actor_b'||'@example.invalid','Synthetic B','active');
insert into public.company_memberships(company_id,user_id,membership_role,status,
  accepted_at,metadata,role,is_active,joined_at,role_key) values
  (:'company_a',:'actor_a','company_admin','active',now(),'{}','company_admin',true,now(),'company_admin'),
  (:'company_b',:'actor_b','company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
-- The clean replay need not seed product permission catalog rows. The fixture
-- owns only this synthetic grant, then rolls it back with every other row.
insert into public.permissions(key,name)
values('masterdata.write','Synthetic masterdata write')
on conflict (key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
select :'actor_a',:'company_a',id,key from public.permissions
where key='masterdata.write';
insert into public.customers(id,company_id,customer_number,name,customer_type,
  first_name,last_name,email,phone) values
  (:'customer_a',:'company_a',:'customer_a','Synthetic contact customer','private',
    'Synthetic','Customer','before@example.invalid','+4600000000'),
  (:'customer_other',:'company_a',:'customer_other','Other synthetic customer','private',
    'Other','Customer','other@example.invalid','+4600000001');
insert into public.customer_contacts(company_id,customer_id,type,is_primary,name,email,phone)
values(:'company_a',:'customer_a','primary',true,'Synthetic Contact',
  'before@example.invalid','+4600000000');
select id as contact_a from public.customer_contacts
  where customer_id=:'customer_a' and is_primary \gset
insert into public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes)
values(:'client_a',:'company_a','Synthetic contact API',
  'p2native-'||left(:'client_a',8),repeat('a',64),'active',array['customer_contact.write']);
insert into public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,
  status,is_active,role,email) values
  (:'company_a',:'customer_a',:'actor_a',:'actor_a',
   'active',true,'owner',:'actor_a'||'@example.invalid');

select set_config('gridex.test_company_a',:'company_a',true),
  set_config('gridex.test_company_b',:'company_b',true),
  set_config('gridex.test_actor_a',:'actor_a',true),
  set_config('gridex.test_actor_b',:'actor_b',true),
  set_config('gridex.test_customer_a',:'customer_a',true),
  set_config('gridex.test_contact_a',:'contact_a',true),
  set_config('gridex.test_customer_other',:'customer_other',true),
  set_config('gridex.test_client_a',:'client_a',true);
set local role service_role;

do $test$
declare
  ca uuid:=current_setting('gridex.test_company_a')::uuid;
  cb uuid:=current_setting('gridex.test_company_b')::uuid;
  aa uuid:=current_setting('gridex.test_actor_a')::uuid;
  ab uuid:=current_setting('gridex.test_actor_b')::uuid;
  cu uuid:=current_setting('gridex.test_customer_a')::uuid;
  contact uuid:=current_setting('gridex.test_contact_a')::uuid;
  other_customer uuid:=current_setting('gridex.test_customer_other')::uuid;
  client uuid:=current_setting('gridex.test_client_a')::uuid;
  command jsonb;
  api_command jsonb;
  first_result jsonb;
  replay_result jsonb;
  api_result jsonb;
  secondary_result jsonb;
  secondary_contact uuid;
  before_count bigint;
begin
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'contactId',contact,'actorUserId',aa,
    'mode','ops','reason','Rättelse efter verifierad kontakt',
    'expectedRevision',0,'idempotencyKey','p2-native-ops-one',
    'changes',jsonb_build_object('phone','+46123456789'));
  first_result:=public.gridex_change_customer_contact_v1(command);
  if first_result->>'revision'<>'1' or first_result->>'changed'<>'true'
    or (select email from public.customers where id=cu)<>'before@example.invalid'
    or (select phone from public.customer_contacts where customer_id=cu and is_primary)<>'+46123456789'
    or (select count(*) from public.canonical_event_outbox
        where company_id=ca and topic='customer.contact.changed')<>1 then
    raise exception 'p2_phone_only_atomic_write_failed';
  end if;
  replay_result:=public.gridex_change_customer_contact_v1(command);
  if replay_result->>'replayed'<>'true' or replay_result->>'revision'<>'1'
    or (select count(*) from public.canonical_command_results
        where company_id=ca and command_type='customer.contact.change.v1')<>1 then
    raise exception 'p2_committed_replay_failed';
  end if;

  begin
    perform public.gridex_change_customer_contact_v1(
      jsonb_set(command,'{changes,phone}','"+46111111111"'::jsonb));
    raise exception 'p2_changed_key_was_accepted';
  exception when unique_violation then
    if sqlerrm<>'contact_idempotency_conflict' then raise; end if;
  end;
  begin
    perform public.gridex_change_customer_contact_v1(
      jsonb_set(command,'{idempotencyKey}','"p2-native-stale"'::jsonb));
    raise exception 'p2_stale_revision_was_accepted';
  exception when raise_exception then
    if sqlerrm<>'contact_revision_conflict' then raise; end if;
  end;
  begin
    perform public.gridex_change_customer_contact_v1(command||
      jsonb_build_object('companyId',cb,'actorUserId',ab,'idempotencyKey','p2-native-wrong-tenant'));
    raise exception 'p2_cross_tenant_was_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'contact_customer_unavailable' then raise; end if;
  end;
  if (select contact_revision from public.customers where id=cu)<>1 then
    raise exception 'p2_negative_test_mutated_revision';
  end if;
  begin
    perform public.gridex_change_customer_contact_v1(command||
      jsonb_build_object('idempotencyKey','p2-native-invalid-field',
        'expectedRevision',1,'changes',jsonb_build_object('email','invalid')));
    raise exception 'p2_invalid_field_was_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_contact_field' then raise; end if;
  end;
  begin
    perform public.gridex_change_customer_contact_v1(command||
      jsonb_build_object('idempotencyKey','p2-native-wrong-contact',
        'expectedRevision',1,'contactId',gen_random_uuid()));
    raise exception 'p2_wrong_contact_was_accepted';
  exception when raise_exception then
    if sqlerrm<>'contact_selection_conflict' then raise; end if;
  end;

  -- A later audit uniqueness error occurs after customer/contact updates in
  -- the function; the exception block must roll the whole invocation back.
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,
    aggregate_id,idempotency_key) values
    (ca,'CUSTOMER_CONTACT_COMMAND','customer',cu,'p2-native-fault');
  begin
    perform public.gridex_change_customer_contact_v1(command||
      jsonb_build_object('expectedRevision',1,'idempotencyKey','p2-native-fault',
        'changes',jsonb_build_object('phone','+46222222222')));
    raise exception 'p2_fault_was_accepted';
  exception when unique_violation then null;
  end;
  if (select phone from public.customers where id=cu)<>'+46123456789'
    or (select contact_revision from public.customers where id=cu)<>1
    or exists(select 1 from public.canonical_command_results
      where company_id=ca and idempotency_key='p2-native-fault') then
    raise exception 'p2_fault_did_not_rollback';
  end if;

  command:=jsonb_build_object('companyId',ca,'customerId',cu,'clientId',client,
    'subject',aa::text,'mode','api','expectedRevision',1,
    'idempotencyKey','p2-native-api-one','changes',jsonb_build_object('email','after@example.invalid'));
  api_command:=command;
  api_result:=public.gridex_change_customer_contact_v1(command);
  if api_result->>'revision'<>'2' or api_result->>'completionReference' is null
    or (select email from public.customer_contacts where customer_id=cu and is_primary)<>'after@example.invalid'
    or (select count(*) from public.canonical_event_outbox where company_id=ca
        and topic='customer.contact.changed')<>2 then
    raise exception 'p2_api_parity_failed';
  end if;
  replay_result:=public.gridex_change_customer_contact_v1(command);
  if replay_result->>'replayed'<>'true'
    or replay_result->>'completionReference'<>api_result->>'completionReference'
    or (select count(*) from public.customer_portal_completions
        where company_id=ca and idempotency_key='p2-native-api-one')<>1 then
    raise exception 'p2_api_commit_before_response_replay_failed';
  end if;
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'actorUserId',aa,
    'mode','ops','reason','Verified secondary contact',
    'contactTarget','secondary','contactType','billing',
    'expectedRevision',1,'idempotencyKey','p2-secondary-stale',
    'changes',jsonb_build_object('name','Synthetic Billing','email','billing@example.invalid'));
  begin
    perform public.gridex_change_customer_contact_v1(command);
    raise exception 'p2_secondary_stale_revision_was_accepted';
  exception when raise_exception then
    if sqlerrm<>'contact_revision_conflict' then raise; end if;
  end;
  if exists(select 1 from public.customer_contacts
      where company_id=ca and customer_id=cu and type='billing')
    or exists(select 1 from public.canonical_command_results
      where company_id=ca and idempotency_key='p2-secondary-stale') then
    raise exception 'p2_secondary_stale_mutated_rows';
  end if;
  command:=command||jsonb_build_object('expectedRevision',2,
    'idempotencyKey','p2-secondary-create');
  secondary_result:=public.gridex_change_customer_contact_v1(command);
  secondary_contact:=(secondary_result->>'contactId')::uuid;
  if secondary_result->>'revision'<>'3'
    or secondary_contact is null
    or (select count(*) from public.customer_contacts
      where id=secondary_contact and company_id=ca and customer_id=cu
        and not is_primary and type='billing' and email='billing@example.invalid')<>1
    or (select phone from public.customers where id=cu)<>'+46123456789'
    or (select email from public.customers where id=cu)<>'after@example.invalid'
    or (select contact_revision from public.customers where id=cu)<>3
    or (select count(*) from public.canonical_domain_events
      where company_id=ca and aggregate_id=cu and event_type='CUSTOMER_SECONDARY_CONTACT_CHANGED')<>1
    or (select count(*) from public.canonical_event_outbox
      where company_id=ca and topic='customer.contact.secondary.changed')<>1 then
    raise exception 'p2_secondary_create_not_atomic';
  end if;
  replay_result:=public.gridex_change_customer_contact_v1(command);
  if replay_result->>'replayed'<>'true' or replay_result->>'contactId'<>secondary_contact::text
    or (select count(*) from public.canonical_event_outbox
      where company_id=ca and topic='customer.contact.secondary.changed')<>1 then
    raise exception 'p2_secondary_replay_duplicated_effects';
  end if;
  begin
    perform public.gridex_change_customer_contact_v1(command||jsonb_build_object(
      'contactType','technical'));
    raise exception 'p2_secondary_changed_key_was_accepted';
  exception when unique_violation then
    if sqlerrm<>'contact_idempotency_conflict' then raise; end if;
  end;
  begin
    perform public.gridex_change_customer_contact_v1(command||jsonb_build_object(
      'mode','api','actorUserId',null,'clientId',client,'subject',aa::text,
      'idempotencyKey','p2-secondary-delegated'));
    raise exception 'p2_secondary_delegated_was_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_contact_command' then raise; end if;
  end;
  begin
    perform public.gridex_change_customer_contact_v1(command||jsonb_build_object(
      'contactId',contact,'expectedRevision',3,'idempotencyKey','p2-secondary-primary-target'));
    raise exception 'p2_secondary_changed_primary_contact';
  exception when raise_exception then
    if sqlerrm<>'contact_selection_conflict' then raise; end if;
  end;
  command:=command||jsonb_build_object('contactId',secondary_contact,
    'expectedRevision',3,'idempotencyKey','p2-secondary-update',
    'changes',jsonb_build_object('phone','+46333333333'));
  secondary_result:=public.gridex_change_customer_contact_v1(command);
  if secondary_result->>'revision'<>'4'
    or (select phone from public.customer_contacts where id=secondary_contact)<>'+46333333333'
    or (select email from public.customer_contacts where id=secondary_contact)<>'billing@example.invalid'
    or (select phone from public.customer_contacts where id=contact)<>'+46123456789'
    or (select contact_revision from public.customers where id=cu)<>4 then
    raise exception 'p2_secondary_update_changed_primary_or_lost_fields';
  end if;
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,
    aggregate_id,idempotency_key) values
    (ca,'CUSTOMER_CONTACT_COMMAND','customer',cu,'p2-secondary-fault');
  begin
    perform public.gridex_change_customer_contact_v1(command||jsonb_build_object(
      'expectedRevision',4,'idempotencyKey','p2-secondary-fault',
      'changes',jsonb_build_object('phone','+46444444444')));
    raise exception 'p2_secondary_fault_was_accepted';
  exception when unique_violation then null;
  end;
  if (select phone from public.customer_contacts where id=secondary_contact)<>'+46333333333'
    or (select contact_revision from public.customers where id=cu)<>4
    or exists(select 1 from public.canonical_command_results
      where company_id=ca and idempotency_key='p2-secondary-fault') then
    raise exception 'p2_secondary_fault_did_not_rollback';
  end if;
  command:=api_command;
  begin
    perform public.gridex_change_customer_contact_v1(command||
      jsonb_build_object('customerId',other_customer,'idempotencyKey','p2-native-other-customer'));
    raise exception 'p2_other_customer_was_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'contact_delegation_forbidden' then raise; end if;
  end;
  update public.customer_portal_accounts set is_active=false,status='disabled'
    where company_id=ca and customer_id=cu and portal_user_id=aa;
  begin
    perform public.gridex_change_customer_contact_v1(command);
    raise exception 'p2_revoked_replay_was_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'contact_delegation_forbidden' then raise; end if;
  end;
  update public.integration_api_clients set revoked_at=clock_timestamp(),status='revoked'
    where id=client;
  begin
    perform public.gridex_change_customer_contact_v1(command||
      jsonb_build_object('idempotencyKey','p2-native-revoked-client'));
    raise exception 'p2_revoked_client_was_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'contact_delegation_forbidden' then raise; end if;
  end;
end;
$test$;

set local role authenticated;
do $deny$
begin
  begin
    perform public.gridex_change_customer_contact_v1('{}'::jsonb);
    raise exception 'p2_low_privilege_rpc_was_accepted';
  exception when insufficient_privilege then null;
  end;
end;
$deny$;

rollback;
\echo P2_CONTACT_NATIVE_PASS
