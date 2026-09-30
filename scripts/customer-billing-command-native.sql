\set ON_ERROR_STOP on
-- Disposable replay fixture; all synthetic identities, faults and rows roll back.
begin;
-- Same compact sorted-key bytes as the TypeScript billing serializer for
-- these ASCII-key synthetic fixtures. PostgreSQL's spaced JSON text is not
-- substituted for the application's snapshot hash.
create function pg_temp.billing_compact_sorted_json(p_value jsonb)
returns text language plpgsql immutable as $serialize$
declare v_result text;
begin
  if jsonb_typeof(p_value)='object' then
    select '{'||coalesce(string_agg(to_jsonb(e.key)::text||':'||pg_temp.billing_compact_sorted_json(e.value),
      ',' order by e.key collate "C"),'')||'}' into v_result from jsonb_each(p_value) e;
    return v_result;
  elsif jsonb_typeof(p_value)='array' then
    select '['||coalesce(string_agg(pg_temp.billing_compact_sorted_json(e.value),',' order by e.ordinality),'')||']'
      into v_result from jsonb_array_elements(p_value) with ordinality e(value,ordinality);
    return v_result;
  end if;
  return p_value::text;
end;
$serialize$;
select gen_random_uuid() as ca,gen_random_uuid() as cb,gen_random_uuid() as staff,
  gen_random_uuid() as reader,gen_random_uuid() as session_staff,gen_random_uuid() as session_reader,
  gen_random_uuid() as customer,gen_random_uuid() as other,gen_random_uuid() as foreign_customer,
  gen_random_uuid() as client,gen_random_uuid() as contract_inherit,gen_random_uuid() as contract_override,
  gen_random_uuid() as underlay,gen_random_uuid() as underlay_legacy \gset
insert into public.companies(id,name,status) values(:'ca','Synthetic billing A','active'),(:'cb','Synthetic billing B','active');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
select id,'authenticated','authenticated',id::text||'@example.invalid',now(),'{}','{}',now(),now(),false,false
from unnest(array[:'staff'::uuid,:'reader'::uuid]) id;
insert into auth.sessions(id,user_id,created_at,updated_at) values(:'session_staff',:'staff',now(),now()),(:'session_reader',:'reader',now(),now());
insert into public.user_profiles(id,email,full_name,user_status)
select id,id::text||'@example.invalid','Synthetic billing actor','active' from unnest(array[:'staff'::uuid,:'reader'::uuid]) id;
insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
values(:'ca',:'staff','company_admin','active',now(),'company_admin',true,now(),'company_admin'),
  (:'ca',:'reader','viewer','active',now(),'viewer',true,now(),'finance_readonly');
insert into public.permissions(key,name) values('masterdata.write','Synthetic billing write') on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
select :'staff',:'ca',id,key from public.permissions where key='masterdata.write';
insert into public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,email,phone,invoice_email,billing_profile)
values(:'customer',:'ca',:'customer','Synthetic billing customer','private','Synthetic','Billing','contact@example.invalid','+4600000000','before@example.invalid',
  '{"recipient":"Billing Customer","distributionMethod":"email","email":"before@example.invalid","country":"SE"}'),
  (:'other',:'ca',:'other','Other billing customer','private','Other','Billing','other@example.invalid','+4600000001',null,'{}'),
  (:'foreign_customer',:'cb',:'foreign_customer','Foreign billing customer','private','Foreign','Billing','foreign@example.invalid','+4600000002',null,'{}');
insert into public.customer_contracts(id,company_id,customer_id,status,invoice_email)
values(:'contract_inherit',:'ca',:'customer','draft',null),(:'contract_override',:'ca',:'customer','draft','agency@example.invalid');
insert into public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,underlay_year,underlay_month,status)
values(:'underlay',:'ca',:'customer',:'contract_inherit',:'contract_inherit',2026,9,'pending'),
  (:'underlay_legacy',:'ca',:'customer',:'contract_inherit',:'contract_inherit',2026,8,'pending');
update public.billing_underlays set billing_configuration_snapshot='{"schema":"billing_configuration_v1","invoice_email":"historical@example.invalid"}',
  billing_configuration_snapshot_sha256=encode(extensions.digest(pg_temp.billing_compact_sorted_json(
    '{"schema":"billing_configuration_v1","invoice_email":"historical@example.invalid"}'::jsonb),'sha256'),'hex')
where id=:'underlay_legacy';
insert into public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes)
values(:'client',:'ca','Synthetic billing API','billing-'||left(:'client',8),repeat('a',64),'active',array['customer_billing.write']);
insert into public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
values(:'ca',:'customer',:'staff',:'staff','active',true,'owner',:'staff'||'@example.invalid');
select set_config('gridex.billingtest.ca',:'ca',true),set_config('gridex.billingtest.cb',:'cb',true),
  set_config('gridex.billingtest.staff',:'staff',true),set_config('gridex.billingtest.reader',:'reader',true),
  set_config('gridex.billingtest.session',:'session_staff',true),set_config('gridex.billingtest.reader_session',:'session_reader',true),
  set_config('gridex.billingtest.customer',:'customer',true),set_config('gridex.billingtest.other',:'other',true),
  set_config('gridex.billingtest.client',:'client',true),set_config('gridex.billingtest.inherit',:'contract_inherit',true),
  set_config('gridex.billingtest.override',:'contract_override',true),set_config('gridex.billingtest.underlay',:'underlay',true),
  set_config('gridex.billingtest.underlay_legacy',:'underlay_legacy',true);
set local role service_role;
-- The exact backfill initializer is also the insertion boundary. Destination
-- availability must not override an existing tenant channel or invoice country.
do $test$
declare ca uuid:=current_setting('gridex.billingtest.ca')::uuid; cu uuid:=gen_random_uuid();
  agreement uuid:=gen_random_uuid(); saved public.customers%rowtype; initialized jsonb;
  legacy jsonb:=jsonb_build_object('full_name','Synthetic Legacy Billing',
    'email','contact-only@example.invalid','invoice_email','legacy-invoice@example.invalid',
    'billing_street','Synthetic Norway Street','billing_postal_code','0123',
    'billing_city','Synthetic Norway City','billing_country','NO');
begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='customers' and column_name='invoice_email') then
    raise exception 'billing_native_invoice_email_prerequisite_missing'; end if;
  initialized:=private.gridex_billing_default_from_legacy_v1(legacy);
  if initialized->>'country' is distinct from 'NO' or initialized ? 'distributionMethod'
    or initialized->>'email' is distinct from 'legacy-invoice@example.invalid'
    or private.gridex_billing_default_from_legacy_v1(legacy-'invoice_email') ? 'email' then
    raise exception 'billing_native_legacy_destination_or_contact_separation_failed'; end if;
  update public.companies set billing_settings=jsonb_build_object('invoice_profile',jsonb_build_object('distribution_method','paper')) where id=ca;
  insert into public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,full_name,
    email,invoice_email,billing_street,billing_postal_code,billing_city,billing_country)
  values(cu,ca,cu::text,'Synthetic Legacy Billing','private','Synthetic','Legacy Billing',
    legacy->>'full_name',legacy->>'email',legacy->>'invoice_email',legacy->>'billing_street',
    legacy->>'billing_postal_code',legacy->>'billing_city',legacy->>'billing_country') returning * into saved;
  if saved.billing_profile is distinct from initialized or saved.billing_profile_revision<>0
    or saved.billing_country is distinct from 'NO'
    or (select billing_settings#>>'{invoice_profile,distribution_method}' from public.companies where id=ca) is distinct from 'paper' then
    raise exception 'billing_native_legacy_insert_changed_country_or_channel'; end if;
  insert into public.customer_contracts(id,company_id,customer_id,status,invoice_email)
    values(agreement,ca,cu,'draft',legacy->>'invoice_email');
  if not exists(select 1 from public.customer_contracts where id=agreement
    and billing_profile_override ? 'email' and billing_profile_override->>'email'=saved.billing_profile->>'email') then
    raise exception 'billing_native_equal_legacy_copy_incorrectly_inherited'; end if;
end;
$test$;
\echo BILLING_NATIVE_LEGACY_INITIALIZATION_COUNTRY_TENANT_CHANNEL_CONTACT_SEPARATION_PASS

-- A country change is part of the same revision/result/audit transaction.
-- Clearing the country stays explicit null; a raw legacy-column writer is denied.
do $test$
declare ca uuid:=gen_random_uuid(); cu uuid:=gen_random_uuid();
  command jsonb; result jsonb; denied boolean:=false; before_state jsonb; after_state jsonb;
  results_before bigint; audits_before bigint; events_before bigint; outbox_before bigint;
begin
  -- Isolate this proof from the original fixture's company-wide event counts.
  insert into public.companies(id,name,status) values(ca,'Synthetic Billing Country Tenant','active');
  insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
    values(ca,current_setting('gridex.billingtest.staff')::uuid,'viewer','active',now(),'viewer',true,now(),'viewer');
  insert into public.user_permissions(user_id,company_id,permission_id,permission_key)
    select current_setting('gridex.billingtest.staff')::uuid,ca,id,key from public.permissions where key='masterdata.write';
  insert into public.customers(id,company_id,customer_number,name,customer_type,first_name,last_name,billing_profile)
    values(cu,ca,cu::text,'Synthetic Billing Country','private','Synthetic','Country',
      jsonb_build_object('recipient','Synthetic Billing Country','country','SE'));
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'actorUserId',current_setting('gridex.billingtest.staff'),
    'sessionId',current_setting('gridex.billingtest.session'),'mode','ops','reason','Synthetic invoice country correction',
    'expectedRevision',0,'idempotencyKey','billing-native-country-change','changes',jsonb_build_object('country','NO'));
  result:=public.gridex_change_customer_billing_profile_v1(command);
  if result->>'revision'<>'1' or result->>'changed'<>'true' or not exists(select 1 from public.customers where id=cu
    and billing_country='NO' and billing_profile->>'country'='NO' and billing_profile_revision=1) then
    raise exception 'billing_native_country_projection_not_atomic'; end if;
  result:=public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object('expectedRevision',1,
    'idempotencyKey','billing-native-country-clear','changes',jsonb_build_object('country',null)));
  if result->>'revision'<>'2' or result->>'changed'<>'true' or not exists(select 1 from public.customers where id=cu
    and billing_country is null and billing_profile->'country'='null'::jsonb and billing_profile_revision=2) then
    raise exception 'billing_native_unset_country_inferred_legacy_default'; end if;
  select to_jsonb(c) into before_state from public.customers c where id=cu;
  select count(*) into results_before from public.canonical_command_results where company_id=ca;
  select count(*) into audits_before from public.canonical_audit_events where company_id=ca;
  select count(*) into events_before from public.canonical_domain_events where company_id=ca;
  select count(*) into outbox_before from public.canonical_event_outbox where company_id=ca;
  begin update public.customers set billing_country='DK' where id=cu;
  exception when insufficient_privilege then denied:=sqlerrm='billing_profile_command_required'; end;
  select to_jsonb(c) into after_state from public.customers c where id=cu;
  if not denied or before_state is distinct from after_state
    or (select count(*) from public.canonical_command_results where company_id=ca)<>results_before
    or (select count(*) from public.canonical_audit_events where company_id=ca)<>audits_before
    or (select count(*) from public.canonical_domain_events where company_id=ca)<>events_before
    or (select count(*) from public.canonical_event_outbox where company_id=ca)<>outbox_before then
    raise exception 'billing_native_raw_country_writer_allowed_or_effects_changed'; end if;
end;
$test$;
\echo BILLING_NATIVE_COUNTRY_PROJECTION_NULL_RAW_WRITER_DENIED_PASS

do $test$
declare ca uuid:=current_setting('gridex.billingtest.ca')::uuid; cu uuid:=current_setting('gridex.billingtest.customer')::uuid;
  command jsonb; result jsonb; replay jsonb; denied boolean;
begin
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'actorUserId',current_setting('gridex.billingtest.staff'),
    'sessionId',current_setting('gridex.billingtest.session'),'mode','ops','reason','Synthetic billing default',
    'expectedRevision',0,'idempotencyKey','billing-native-default','changes',jsonb_build_object('email','after@example.invalid'));
  result:=public.gridex_change_customer_billing_profile_v1(command);
  if result->>'revision'<>'1' or result->>'changed'<>'true'
    or result->'affectedContractIds'<>jsonb_build_array(current_setting('gridex.billingtest.inherit'))
    or (select billing_profile->>'email' from public.customers where id=cu)<>'after@example.invalid'
    or (select email from public.customers where id=cu)<>'contact@example.invalid'
    or (select billing_profile_override->>'email' from public.customer_contracts where id=current_setting('gridex.billingtest.override')::uuid)<>'agency@example.invalid'
    or (select count(*) from public.canonical_event_outbox where company_id=ca and topic='customer.billing_profile.changed')<>1 then
    raise exception 'billing_native_default_override_transaction_failed'; end if;
  replay:=public.gridex_change_customer_billing_profile_v1(command);
  if replay->>'replayed'<>'true' or replay->>'revision'<>'1' then raise exception 'billing_native_replay_failed'; end if;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_v1(jsonb_set(command,'{changes,email}','"different@example.invalid"'));
  exception when unique_violation then denied:=sqlerrm='billing_profile_idempotency_conflict'; end;
  if not denied then raise exception 'billing_native_payload_conflict_missing'; end if;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object('idempotencyKey','billing-native-stale'));
  exception when raise_exception then denied:=sqlerrm='billing_profile_revision_conflict'; end;
  if not denied then raise exception 'billing_native_revision_conflict_missing'; end if;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object('companyId',current_setting('gridex.billingtest.cb')));
  exception when insufficient_privilege then denied:=sqlerrm='billing_profile_customer_unavailable'; end;
  if not denied then raise exception 'billing_native_other_tenant_missing'; end if;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object('actorUserId',current_setting('gridex.billingtest.reader'),'sessionId',current_setting('gridex.billingtest.reader_session')));
  exception when insufficient_privilege then denied:=sqlerrm='billing_profile_actor_forbidden'; end;
  if not denied then raise exception 'billing_native_readonly_missing'; end if;
  denied:=false;
  begin update public.customers set invoice_email='bypass@example.invalid' where id=cu;
  exception when insufficient_privilege then denied:=sqlerrm='billing_profile_command_required'; end;
  if not denied then raise exception 'billing_native_legacy_bypass_not_denied'; end if;
  perform set_config('gridex.billingtest.command',command::text,true);
end;
$test$;
\echo BILLING_NATIVE_DEFAULT_OVERRIDE_REPLAY_TENANT_READONLY_PASS

-- Fault occurs after profile write but before audit/completion/outbox/result.
reset role;
create function pg_temp.billing_late_audit_failure() returns trigger language plpgsql as $fault$
begin if new.idempotency_key='billing-native-late-audit'
  or new.idempotency_key=current_setting('gridex.billingtest.api_fault_key',true) then
  raise exception 'billing_synthetic_late_audit'; end if; return new; end;
$fault$;
create trigger billing_native_audit_fault before insert on public.canonical_audit_events for each row execute function pg_temp.billing_late_audit_failure();
set local role service_role;
do $test$
declare command jsonb:=current_setting('gridex.billingtest.command')::jsonb; failed boolean:=false;
begin
  begin perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object('expectedRevision',1,
    'idempotencyKey','billing-native-late-audit','changes',jsonb_build_object('email','rollback@example.invalid')));
  exception when raise_exception then failed:=sqlerrm='billing_synthetic_late_audit'; end;
  if not failed or (select billing_profile_revision from public.customers where id=(command->>'customerId')::uuid)<>1
    or (select invoice_email from public.customers where id=(command->>'customerId')::uuid)<>'after@example.invalid'
    or exists(select 1 from public.canonical_command_results where company_id=(command->>'companyId')::uuid and idempotency_key='billing-native-late-audit') then
    raise exception 'billing_native_late_audit_rollback_failed'; end if;
end;
$test$;
\echo BILLING_NATIVE_LATE_AUDIT_ROLLBACK_PASS

-- Snapshots retain their revision when the next customer default changes.
do $test$
declare ca uuid:=current_setting('gridex.billingtest.ca')::uuid; cu uuid:=current_setting('gridex.billingtest.customer')::uuid;
  contract uuid:=current_setting('gridex.billingtest.inherit')::uuid; underlay uuid:=current_setting('gridex.billingtest.underlay')::uuid;
  snapshot jsonb; result jsonb; snapshot_hash text; denied boolean:=false;
  command jsonb:=current_setting('gridex.billingtest.command')::jsonb;
begin
  snapshot:=jsonb_build_object('schema','billing_configuration_v2','company_id',ca,'customer_id',cu,'contract_id',contract,
    'effective_billing_profile',jsonb_build_object('companyId',ca,'customerId',cu,'contractId',contract,'recipient','Billing Customer',
      'distributionMethod','email','email','after@example.invalid','reference',null,
      'address',jsonb_build_object('street',null,'postalCode',null,'city',null,'country','SE'),
      'sources',jsonb_build_object('recipient','customer_default','distributionMethod','customer_default','email','customer_default',
        'reference','missing','street','missing','postalCode','missing','city','missing','country','customer_default'),
      'profileRevision',1,'contractOverrideRevision',0,'blockers','[]'::jsonb));
  snapshot_hash:=encode(extensions.digest(pg_temp.billing_compact_sorted_json(snapshot),'sha256'),'hex');
  if private.gridex_billing_effective_profile_valid_v2(jsonb_set(snapshot->'effective_billing_profile','{recipient}',to_jsonb(repeat('x',321))))
    or private.gridex_billing_effective_profile_valid_v2(jsonb_set(snapshot->'effective_billing_profile','{profileRevision}','1.5'::jsonb)) then
    raise exception 'billing_native_malformed_effective_profile_allowed'; end if;
  begin perform public.gridex_lock_billing_configuration_v2(ca,underlay,1,0,snapshot,repeat('a',64),pg_temp.billing_compact_sorted_json(snapshot));
  exception when invalid_parameter_value then denied:=sqlerrm='invalid_billing_configuration_snapshot'; end;
  if not denied then raise exception 'billing_native_fake_snapshot_hash_not_rejected'; end if;
  denied:=false;
  begin perform public.gridex_lock_billing_configuration_v2(ca,underlay,1,0,snapshot#-'{effective_billing_profile,address}',
    encode(extensions.digest(pg_temp.billing_compact_sorted_json(snapshot#-'{effective_billing_profile,address}'),'sha256'),'hex'),
    pg_temp.billing_compact_sorted_json(snapshot#-'{effective_billing_profile,address}'));
  exception when invalid_parameter_value then denied:=sqlerrm='invalid_billing_configuration_snapshot'; end;
  if not denied or (select billing_configuration_snapshot is not null from public.billing_underlays where id=underlay) then
    raise exception 'billing_native_incomplete_snapshot_not_rejected'; end if;
  result:=public.gridex_lock_billing_configuration_v2(ca,underlay,1,0,snapshot,snapshot_hash,pg_temp.billing_compact_sorted_json(snapshot));
  if result<>snapshot or (select billing_configuration_snapshot_sha256 from public.billing_underlays where id=underlay)<>snapshot_hash then
    raise exception 'billing_native_snapshot_first_lock_failed'; end if;
  perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object('expectedRevision',1,
    'idempotencyKey','billing-native-next-default','changes',jsonb_build_object('email','next@example.invalid')));
  result:=public.gridex_lock_billing_configuration_v2(ca,underlay,2,0,
    jsonb_set(snapshot,'{effective_billing_profile,email}','"next@example.invalid"'),
    encode(extensions.digest(pg_temp.billing_compact_sorted_json(jsonb_set(snapshot,'{effective_billing_profile,email}','"next@example.invalid"')),'sha256'),'hex'),
    pg_temp.billing_compact_sorted_json(jsonb_set(snapshot,'{effective_billing_profile,email}','"next@example.invalid"')));
  if result<>snapshot or (select billing_configuration_snapshot_sha256 from public.billing_underlays where id=underlay)<>snapshot_hash then
    raise exception 'billing_native_snapshot_revision_rewritten'; end if;
  command:=command||jsonb_build_object('expectedRevision',2,'idempotencyKey','billing-native-override-inherit',
    'contractId',current_setting('gridex.billingtest.override'),'expectedOverrideRevision',0,
    'changes','{}'::jsonb,'inheritFields',jsonb_build_array('email'));
  result:=public.gridex_change_customer_billing_profile_v1(command);
  if result->>'contractOverrideRevision'<>'1' or not exists(select 1 from public.canonical_audit_events
    where company_id=ca and idempotency_key='billing-native-override-inherit' and state_version=1
      and before_state->>'revision'='0' and after_state->>'revision'='1') or
    (select billing_profile_override ? 'email' from public.customer_contracts where id=current_setting('gridex.billingtest.override')::uuid) then
    raise exception 'billing_native_controlled_override_inherit_failed'; end if;
  -- An old completion never authorizes the contract after it belongs to a
  -- different same-tenant customer. Current ownership precedes replay lookup.
  update public.customer_contracts set customer_id=current_setting('gridex.billingtest.other')::uuid
    where id=current_setting('gridex.billingtest.override')::uuid;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_v1(command);
  exception when insufficient_privilege then denied:=sqlerrm='billing_profile_customer_unavailable'; end;
  if not denied or (select billing_profile_revision from public.customers where id=cu)<>2
    or (select count(*) from public.canonical_command_results where company_id=ca and idempotency_key='billing-native-override-inherit')<>1 then
    raise exception 'billing_native_reassigned_override_replay_allowed'; end if;
  update public.customer_contracts set customer_id=cu where id=current_setting('gridex.billingtest.override')::uuid;
  result:=public.gridex_lock_billing_configuration_v2(ca,current_setting('gridex.billingtest.underlay_legacy')::uuid,2,0,snapshot,snapshot_hash,pg_temp.billing_compact_sorted_json(snapshot));
  if result<>'{"schema":"billing_configuration_v1","invoice_email":"historical@example.invalid"}'::jsonb then
    raise exception 'billing_native_legacy_snapshot_rewritten'; end if;
end;
$test$;
\echo BILLING_NATIVE_SNAPSHOT_IMMUTABILITY_OVERRIDE_TRANSITION_PASS
\echo BILLING_NATIVE_REASSIGNED_OVERRIDE_REPLAY_DENIED_PASS

-- A site-address destination is a separately locked input to the profile.
do $test$
declare ca uuid:=current_setting('gridex.billingtest.ca')::uuid; cu uuid:=current_setting('gridex.billingtest.customer')::uuid;
  site uuid:=gen_random_uuid(); agreement uuid:=gen_random_uuid(); underlay uuid:=gen_random_uuid();
  snapshot jsonb; stale jsonb; result jsonb; denied boolean:=false;
begin
  insert into public.customer_sites(id,company_id,customer_id,site_name,street,postal_code,city,country)
    values(site,ca,cu,'Synthetic invoice site','Native Site Street','11111','Native Site City','SE');
  insert into public.customer_contracts(id,company_id,customer_id,customer_site_id,status,billing_address_same_as_site)
    values(agreement,ca,cu,site,'draft',true);
  insert into public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,underlay_year,underlay_month,status)
    values(underlay,ca,cu,agreement,agreement,2026,7,'pending');
  snapshot:=jsonb_build_object('schema','billing_configuration_v2','company_id',ca,'customer_id',cu,'contract_id',agreement,
    'effective_billing_profile',jsonb_build_object('companyId',ca,'customerId',cu,'contractId',agreement,'recipient','Billing Customer',
      'distributionMethod','email','email','next@example.invalid','reference',null,
      'address',jsonb_build_object('street','Native Site Street','postalCode','11111','city','Native Site City','country','SE'),
      'sources',jsonb_build_object('recipient','customer_default','distributionMethod','customer_default','email','customer_default',
        'reference','missing','street','site_address','postalCode','site_address','city','site_address','country','customer_default'),
      'profileRevision',2,'contractOverrideRevision',0,'blockers','[]'::jsonb));
  stale:=jsonb_set(snapshot,'{effective_billing_profile,address,street}','"Stale Street"');
  begin perform public.gridex_lock_billing_configuration_v2(ca,underlay,2,0,stale,
    encode(extensions.digest(pg_temp.billing_compact_sorted_json(stale),'sha256'),'hex'),pg_temp.billing_compact_sorted_json(stale));
  exception when raise_exception then denied:=sqlerrm='billing_profile_revision_conflict'; end;
  if not denied or (select billing_configuration_snapshot is not null from public.billing_underlays where id=underlay) then
    raise exception 'billing_native_stale_site_snapshot_allowed'; end if;
  result:=public.gridex_lock_billing_configuration_v2(ca,underlay,2,0,snapshot,
    encode(extensions.digest(pg_temp.billing_compact_sorted_json(snapshot),'sha256'),'hex'),pg_temp.billing_compact_sorted_json(snapshot));
  if result<>snapshot then raise exception 'billing_native_site_snapshot_failed'; end if;
  update public.customer_sites set street='Changed Site Street' where id=site;
  if (select billing_configuration_snapshot from public.billing_underlays where id=underlay)<>snapshot then
    raise exception 'billing_native_locked_site_snapshot_rewritten'; end if;
end;
$test$;
\echo BILLING_NATIVE_SITE_ADDRESS_LOCK_AND_HISTORY_PASS

-- The entire profile-update route shares historical compact claims across
-- contact, preferences, facilities and billing. Replays are read-only even
-- when the prior request predates billing revisions.
do $test$
declare ca uuid:=current_setting('gridex.billingtest.ca')::uuid; cu uuid:=current_setting('gridex.billingtest.customer')::uuid;
  client uuid:=current_setting('gridex.billingtest.client')::uuid; command jsonb; payload text; result jsonb;
  before_revision bigint; before_results bigint; before_events bigint; key text; prior_status text; denied boolean; expected_error text;
  original_body jsonb:='{"data":{"completion_reference":"synthetic-historical-billing","status":"accepted","profile_updated":true,"facility_updated":false,"address_result":null}}';
begin
  select billing_profile_revision into before_revision from public.customers where id=cu;
  -- Exact historical ECMAScript canonicalJson bytes, including 1e-7. Do not
  -- reserialize through jsonb, which changes that number's representation.
  payload:='{"metadata":{"number":1e-7,"unicode":"Ä"},"profile":{"invoice_email":"historical@example.invalid"}}';
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'mode','api','clientId',client,
    'subject',current_setting('gridex.billingtest.staff'),'idempotencyKey','billing-native-old-completed','requestJson',payload);
  insert into public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status,response_status,response_body)
    values(ca,client,cu,'/api/v1/customer/profile-update','billing-native-old-completed',
      encode(extensions.digest(payload,'sha256'),'hex'),'completed',201,original_body);
  result:=public.gridex_change_customer_billing_profile_api_v1(command);
  if result->>'statusCode'<>'201' or result->>'replayed'<>'true' or result->'body'<>original_body
    or (select billing_profile_revision from public.customers where id=cu)<>before_revision then
    raise exception 'billing_native_legacy_shared_route_replay_changed'; end if;
  foreach prior_status in array array['failed','processing'] loop
    key:='billing-native-old-'||prior_status; denied:=false;
    expected_error:=case prior_status when 'failed' then 'idempotency_previous_attempt_failed' else 'idempotency_in_progress' end;
    insert into public.customer_portal_write_idempotency(company_id,api_client_id,customer_id,route,idempotency_key,request_hash,status)
      values(ca,client,cu,'/api/v1/customer/profile-update',key,encode(extensions.digest(payload,'sha256'),'hex'),prior_status);
    begin perform public.gridex_change_customer_billing_profile_api_v1(command||jsonb_build_object('idempotencyKey',key));
    exception when raise_exception then denied:=sqlerrm=expected_error; end;
    if not denied then raise exception 'billing_native_old_claim_reexecuted'; end if;
  end loop;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_api_v1(command||jsonb_build_object('idempotencyKey','billing-native-fresh-no-revision',
    'requestJson','{"profile":{"invoice_email":"historical@example.invalid"}}'));
  exception when invalid_parameter_value then denied:=sqlerrm='billing_profile_revision_required'; end;
  if not denied or exists(select 1 from public.customer_portal_write_idempotency where company_id=ca and idempotency_key='billing-native-fresh-no-revision') then
    raise exception 'billing_native_fresh_revision_or_claim_rollback_failed'; end if;
  select count(*) into before_results from public.canonical_command_results where company_id=ca;
  select count(*) into before_events from public.canonical_event_outbox where company_id=ca;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_api_v1(command||jsonb_build_object('idempotencyKey','billing-native-fresh-metadata',
    'requestJson','{"expected_billing_revision":2,"metadata":{"number":1e-7,"unicode":"Ä"},"profile":{"invoice_email":"fresh-metadata@example.invalid"}}'));
  exception when invalid_parameter_value then denied:=sqlerrm='invalid_billing_profile_command'; end;
  if not denied or (select billing_profile_revision from public.customers where id=cu)<>before_revision
    or exists(select 1 from public.customer_portal_write_idempotency where company_id=ca and idempotency_key='billing-native-fresh-metadata')
    or (select count(*) from public.canonical_command_results where company_id=ca)<>before_results
    or (select count(*) from public.canonical_event_outbox where company_id=ca)<>before_events then
    raise exception 'billing_native_fresh_metadata_not_atomic_rejection'; end if;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_api_v1(command||jsonb_build_object('requestJson',
    pg_temp.billing_compact_sorted_json('{"profile":{"invoice_email":"different@example.invalid"}}')));
  exception when raise_exception then denied:=sqlerrm='idempotency_conflict'; end;
  if not denied then raise exception 'billing_native_shared_route_payload_conflict_missing'; end if;
  update public.integration_api_clients set scopes=array['customer_portal.write'] where id=client;
  denied:=false;
  begin perform public.gridex_change_customer_billing_profile_api_v1(command);
  exception when insufficient_privilege then denied:=sqlerrm='profile_delegation_forbidden'; end;
  if not denied then raise exception 'billing_native_portal_alias_granted_economic_mandate'; end if;
  update public.integration_api_clients set scopes=array['customer_billing.write'] where id=client;
end;
$test$;
\echo BILLING_NATIVE_SHARED_ROUTE_LEGACY_FAILED_PROCESSING_REPLAY_PASS
\echo BILLING_NATIVE_SHARED_ROUTE_HISTORICAL_METADATA_BYTES_FRESH_REJECT_PASS

-- API scope/owner and revocation checks run before both fresh and stored results.
do $test$
declare command jsonb; failed boolean:=false; result jsonb;
begin
  command:=jsonb_build_object('companyId',current_setting('gridex.billingtest.ca'),'customerId',current_setting('gridex.billingtest.customer'),
    'mode','api','clientId',current_setting('gridex.billingtest.client'),'subject',current_setting('gridex.billingtest.staff'),
    'expectedRevision',2,'idempotencyKey','billing-native-api-default','changes',jsonb_build_object('email','api@example.invalid'));
  begin perform public.gridex_change_customer_billing_profile_v1(command||jsonb_build_object('idempotencyKey','billing-native-late-audit'));
  exception when raise_exception then failed:=sqlerrm='billing_synthetic_late_audit'; end;
  if not failed or (select billing_profile_revision from public.customers where id=(command->>'customerId')::uuid)<>2
    or exists(select 1 from public.customer_portal_completions where company_id=(command->>'companyId')::uuid and idempotency_key='billing-native-late-audit') then
    raise exception 'billing_native_api_completion_late_audit_rollback_failed'; end if;
  failed:=false;
  result:=public.gridex_change_customer_billing_profile_v1(command);
  if result->>'completionReference' is null or result->>'revision'<>'3' then raise exception 'billing_native_api_completion_failed'; end if;
  update public.integration_api_clients set scopes=array['customer_contact.write'] where id=current_setting('gridex.billingtest.client')::uuid;
  begin perform public.gridex_change_customer_billing_profile_v1(command);
  exception when insufficient_privilege then failed:=sqlerrm='billing_profile_delegation_forbidden'; end;
  if not failed then raise exception 'billing_native_revoked_scope_replay_allowed'; end if;
end;
$test$;
\echo BILLING_NATIVE_API_COMPLETION_SCOPE_REPLAY_PASS

-- Fresh shared-route billing commits exactly one canonical change, completion
-- and compact-byte claim; late audit failure rolls all three back together.
do $test$
declare ca uuid:=current_setting('gridex.billingtest.ca')::uuid; cu uuid:=current_setting('gridex.billingtest.customer')::uuid;
  client uuid:=current_setting('gridex.billingtest.client')::uuid; command jsonb; payload text; result jsonb; replay jsonb;
  fault_namespace text; namespace text; denied boolean:=false; before_events bigint;
begin
  update public.integration_api_clients set scopes=array['customer_billing.write','customer_contact.write'] where id=client;
  payload:=pg_temp.billing_compact_sorted_json('{"expected_billing_revision":3,"profile":{"invoice_email":"Fresh@Example.invalid"}}');
  command:=jsonb_build_object('companyId',ca,'customerId',cu,'mode','api','clientId',client,
    'subject',current_setting('gridex.billingtest.staff'),'idempotencyKey','billing-native-shared-fresh','requestJson',payload);
  fault_namespace:=encode(extensions.digest(concat_ws(':','customer.profile','billing','api',cu::text,
    client::text,'billing-native-shared-audit-fault'),'sha256'),'hex');
  perform set_config('gridex.billingtest.api_fault_key',fault_namespace,true);
  begin perform public.gridex_change_customer_billing_profile_api_v1(command||jsonb_build_object('idempotencyKey','billing-native-shared-audit-fault'));
  exception when raise_exception then denied:=sqlerrm='billing_synthetic_late_audit'; end;
  if not denied or (select billing_profile_revision from public.customers where id=cu)<>3
    or exists(select 1 from public.customer_portal_write_idempotency where company_id=ca and idempotency_key='billing-native-shared-audit-fault')
    or exists(select 1 from public.customer_portal_completions where company_id=ca and idempotency_key=fault_namespace)
    or exists(select 1 from public.canonical_command_results where company_id=ca and idempotency_key=fault_namespace) then
    raise exception 'billing_native_shared_route_late_audit_rollback_failed'; end if;
  perform set_config('gridex.billingtest.api_fault_key','',true);
  select count(*) into before_events from public.canonical_event_outbox where company_id=ca and topic='customer.billing_profile.changed';
  result:=public.gridex_change_customer_billing_profile_api_v1(command);
  replay:=public.gridex_change_customer_billing_profile_api_v1(command);
  namespace:=encode(extensions.digest(concat_ws(':','customer.profile','billing','api',cu::text,
    client::text,'billing-native-shared-fresh'),'sha256'),'hex');
  if result->>'statusCode'<>'200' or result->>'replayed'<>'false' or result#>>'{body,data,billing_revision}'<>'4'
    or result#>>'{body,data,completion_reference}' is null or replay->'body'<>result->'body' or replay->>'replayed'<>'true'
    or (select billing_profile->>'email' from public.customers where id=cu)<>'fresh@example.invalid'
    or (select count(*) from public.customer_portal_write_idempotency where company_id=ca and idempotency_key='billing-native-shared-fresh'
      and status='completed' and response_status=200 and response_body=result->'body'
      and request_hash=encode(extensions.digest(payload,'sha256'),'hex'))<>1
    or (select count(*) from public.customer_portal_completions where company_id=ca and idempotency_key=namespace)<>1
    or (select count(*) from public.canonical_command_results where company_id=ca and idempotency_key=namespace)<>1
    or (select count(*) from public.canonical_event_outbox where company_id=ca and topic='customer.billing_profile.changed')<>before_events+1 then
    raise exception 'billing_native_shared_route_fresh_replay_transaction_failed'; end if;
  denied:=false;
  begin perform public.gridex_change_customer_profile_preferences_v1(command||jsonb_build_object('requestJson',
    pg_temp.billing_compact_sorted_json('{"profile":{"email":"contact-change@example.invalid"}}')));
  exception when raise_exception then denied:=sqlerrm='idempotency_conflict'; end;
  if not denied or (select email from public.customers where id=cu)<>'contact@example.invalid' then
    raise exception 'billing_native_shared_route_category_collision_allowed'; end if;
  if (select billing_configuration_snapshot#>>'{effective_billing_profile,profileRevision}' from public.billing_underlays
    where id=current_setting('gridex.billingtest.underlay')::uuid)<>'1'
    or (select billing_configuration_snapshot#>>'{effective_billing_profile,email}' from public.billing_underlays
      where id=current_setting('gridex.billingtest.underlay')::uuid)<>'after@example.invalid' then
    raise exception 'billing_native_shared_route_rewrote_historical_snapshot'; end if;
end;
$test$;
\echo BILLING_NATIVE_SHARED_ROUTE_FRESH_REPLAY_ROLLBACK_CATEGORY_HISTORY_PASS
reset role;
delete from auth.sessions where id=:'session_staff';
set local role service_role;
do $test$
declare failed boolean:=false;
begin
  begin perform public.gridex_change_customer_billing_profile_v1(current_setting('gridex.billingtest.command')::jsonb);
  exception when insufficient_privilege then failed:=sqlerrm='billing_profile_actor_forbidden'; end;
  if not failed then raise exception 'billing_native_revoked_session_replay_allowed'; end if;
end;
$test$;
\echo BILLING_NATIVE_REVOKED_SESSION_REPLAY_PASS
reset role;
do $test$
begin
  if has_function_privilege('anon','public.gridex_change_customer_billing_profile_v1(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.gridex_change_customer_billing_profile_v1(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.gridex_change_customer_billing_profile_api_v1(jsonb)','EXECUTE')
    or has_function_privilege('anon','private.gridex_billing_profile_current_clock_v1(text,uuid,uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.gridex_billing_profile_current_clock_v1(text,uuid,uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.gridex_lock_billing_configuration_v2(uuid,uuid,bigint,bigint,jsonb,text,text)','EXECUTE') then
    raise exception 'billing_native_public_rpc_grant'; end if;
end;
$test$;
\echo BILLING_NATIVE_SERVICE_ONLY_RPC_PASS
rollback;
