\set ON_ERROR_STOP on
-- Run only against the disposable clean replay. Synthetic fixtures and every
-- failure trigger/effect are enclosed in this transaction and rolled back.
begin;
select gen_random_uuid() as company_a, gen_random_uuid() as company_b,
  gen_random_uuid() as actor, gen_random_uuid() as denied_actor,
  gen_random_uuid() as session, gen_random_uuid() as denied_session,
  gen_random_uuid() as customer_a, gen_random_uuid() as customer_other,
  gen_random_uuid() as customer_foreign, gen_random_uuid() as site_a,
  gen_random_uuid() as site_other, gen_random_uuid() as site_foreign \gset
insert into public.companies(id,name,status) values
  (:'company_a','Synthetic site command A','active'),(:'company_b','Synthetic site command B','active');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  select id,'authenticated','authenticated',id::text||'@example.invalid',now(),'{}','{}',now(),now(),false,false
  from unnest(array[:'actor'::uuid,:'denied_actor'::uuid]) id;
insert into public.user_profiles(id,email,full_name,user_status)
  select id,id::text||'@example.invalid','Synthetic site command actor','active'
  from unnest(array[:'actor'::uuid,:'denied_actor'::uuid]) id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
  (:'session',:'actor',now(),now(),now()+interval '1 hour'),
  (:'denied_session',:'denied_actor',now(),now(),now()+interval '1 hour');
insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key) values
  (:'company_a',:'actor','support','active',now(),'support',true,now(),'support'),
  (:'company_a',:'denied_actor','support','active',now(),'support',true,now(),'support');
insert into public.permissions(key,name) values('sites.write','Synthetic explicit site permission'),
  ('customers.write','Synthetic explicit customer permission') on conflict(key) do nothing;
insert into public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
  select :'actor',:'company_a',id,key,'allow' from public.permissions where key='sites.write';
insert into public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
  select :'actor',:'company_a',id,key,'deny' from public.permissions where key='customers.write';
insert into public.user_permissions(user_id,company_id,permission_id,permission_key,effect)
  select :'denied_actor',:'company_a',id,key,'deny' from public.permissions where key in ('sites.write','customers.write');
insert into public.customers(id,company_id,customer_number,name,customer_type) values
  (:'customer_a',:'company_a',:'customer_a','Synthetic Site Own','private'),
  (:'customer_other',:'company_a',:'customer_other','Synthetic Site Other','private'),
  (:'customer_foreign',:'company_b',:'customer_foreign','Synthetic Site Foreign','private');
insert into public.customer_sites(id,company_id,customer_id,site_name,status,facility_id,street,postal_code,city,country) values
  (:'site_a',:'company_a',:'customer_a','Synthetic site','draft','735999999999999999','Original 1','12345','Teststad','SE'),
  (:'site_other',:'company_a',:'customer_other','Synthetic other','draft',null,'Other 1','12345','Teststad','SE'),
  (:'site_foreign',:'company_b',:'customer_foreign','Synthetic foreign','draft',null,'Foreign 1','12345','Teststad','SE');
select set_config('gridex.site.company',:'company_a',true),set_config('gridex.site.foreign_company',:'company_b',true),
  set_config('gridex.site.actor',:'actor',true),set_config('gridex.site.denied_actor',:'denied_actor',true),
  set_config('gridex.site.session',:'session',true),set_config('gridex.site.denied_session',:'denied_session',true),
  set_config('gridex.site.customer',:'customer_a',true),set_config('gridex.site.other_customer',:'customer_other',true),
  set_config('gridex.site.foreign_customer',:'customer_foreign',true),
  set_config('gridex.site.site',:'site_a',true),set_config('gridex.site.other_site',:'site_other',true),
  set_config('gridex.site.foreign_site',:'site_foreign',true);

create function pg_temp.site_fixture_command(p_key text,p_site uuid,p_revision bigint,p_patch jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $fixture$
declare changes jsonb; normalized text; apartment text; candidate jsonb;
begin
  changes:=jsonb_build_object('site_name','Synthetic site','facility_id','735999999999999999','site_type','consumption','status','draft',
    'move_in_date',null,'annual_consumption_kwh',1200,'current_supplier_name',null,'current_supplier_org_number',null,
    'street','Testgatan 1','care_of',null,'postal_code','12345','city','Teststad','country','SE',
    'moved_from_street',null,'moved_from_postal_code',null,'moved_from_city',null,'moved_from_supplier_name',null,'internal_notes',null)||p_patch;
  select apartment_number into apartment from public.customer_sites where id=p_site;
  normalized:=lower(concat_ws('|',changes->>'street',coalesce(apartment,''),changes->>'postal_code',changes->>'city',changes->>'country'));
  candidate:=jsonb_build_object('street',changes->>'street','postal_code',changes->>'postal_code','city',changes->>'city','country',changes->>'country',
    'care_of',changes->>'care_of','apartment_number',apartment,'complete',true,'normalized',normalized,
    'address_hash',encode(extensions.digest(normalized,'sha256'),'hex'));
  return jsonb_build_object('companyId',current_setting('gridex.site.company'),'customerId',current_setting('gridex.site.customer'),
    'siteId',p_site,'actorUserId',current_setting('gridex.site.actor'),'sessionId',current_setting('gridex.site.session'),
    'reason','Synthetic verified site correction','expectedRevision',p_revision,'idempotencyKey',p_key,'siteFlowType','switch',
    'changes',changes,'addressHints',jsonb_build_object('claimedGridOwnerId',null,'claimedPriceAreaCode','SE3'),'candidate',candidate);
end;
$fixture$;
create function pg_temp.site_fixture_snapshot() returns jsonb
language sql volatile security invoker set search_path=pg_catalog as $snapshot$
  select jsonb_build_object(
    'customers',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customers t where t.company_id=any(ids.companies)),
    'sites',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_sites t where t.company_id=any(ids.companies)),
    'addresses',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_addresses t where t.company_id=any(ids.companies)),
    'history',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_site_address_history t where t.company_id=any(ids.companies)),
    'conflicts',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_site_address_conflicts t where t.company_id=any(ids.companies)),
    'commands',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_command_results t where t.company_id=any(ids.companies)),
    'audit',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_audit_events t where t.company_id=any(ids.companies)),
    'events',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_domain_events t where t.company_id=any(ids.companies)),
    'outbox',(select jsonb_agg(to_jsonb(t) order by t.id) from public.canonical_event_outbox t where t.company_id=any(ids.companies)),
    'tasks',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_data_tasks t where t.company_id=any(ids.companies)),
    'jobs',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_operation_jobs t where t.company_id=any(ids.companies)),
    'snapshots',(select jsonb_agg(to_jsonb(t) order by t.id) from public.customer_operation_request_snapshots t where t.company_id=any(ids.companies)))
  from (select array[current_setting('gridex.site.company')::uuid,current_setting('gridex.site.foreign_company')::uuid] companies) ids;
$snapshot$;

do $acl$
begin
  if has_function_privilege('anon','public.gridex_save_customer_site_v1(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.gridex_save_customer_site_v1(jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.gridex_save_customer_site_v1(jsonb)','EXECUTE') then
    raise exception 'site_command_acl_invalid'; end if;
end;
$acl$;
set local role anon;
do $denied$
begin
  begin perform public.gridex_save_customer_site_v1('{}'); raise exception 'site_anon_execute_allowed';
  exception when insufficient_privilege then null; end;
end;
$denied$;
reset role;
set local role authenticated;
do $denied$
begin
  begin perform public.gridex_save_customer_site_v1('{}'); raise exception 'site_authenticated_execute_allowed';
  exception when insufficient_privilege then null; end;
end;
$denied$;
reset role;
\echo SITE_COMMAND_ACL_NATIVE_PASS

set local role service_role;
do $authority$
declare original jsonb; command jsonb; patch jsonb; expected text; before_state jsonb;
begin
  original:=pg_temp.site_fixture_command('site-native-authority-key',current_setting('gridex.site.site')::uuid,0);
  before_state:=pg_temp.site_fixture_snapshot();
  for patch,expected in select * from (values
    (jsonb_build_object('actorUserId',current_setting('gridex.site.denied_actor'),'sessionId',current_setting('gridex.site.denied_session')),'site_actor_forbidden'),
    (jsonb_build_object('sessionId',gen_random_uuid()),'site_actor_forbidden'),
    (jsonb_build_object('siteId',current_setting('gridex.site.other_site')),'site_resource_not_found'),
    (jsonb_build_object('siteId',current_setting('gridex.site.foreign_site')),'site_resource_not_found'),
    (jsonb_build_object('companyId',current_setting('gridex.site.foreign_company')),'site_customer_unavailable'),
    (jsonb_build_object('customerId',current_setting('gridex.site.other_customer')),'site_resource_not_found')
  ) cases(patch,expected) loop
    command:=original||patch;
    begin
      perform public.gridex_save_customer_site_v1(command); raise exception 'site_authority_denial_missing';
    exception when others then
      if sqlerrm<>expected then raise; end if;
    end;
    if pg_temp.site_fixture_snapshot() is distinct from before_state then raise exception 'site_denial_left_effects'; end if;
  end loop;
end;
$authority$;
reset role;
\echo SITE_COMMAND_AUTHORITY_NATIVE_PASS

set local role service_role;
do $positive$
declare command jsonb; result jsonb; replay jsonb; before_replay jsonb; row_site public.customer_sites%rowtype;
begin
  command:=pg_temp.site_fixture_command('site-native-success-key',current_setting('gridex.site.site')::uuid,0);
  result:=public.gridex_save_customer_site_v1(command);
  select * into row_site from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  if result->>'siteId'<>row_site.id::text or not (result->>'changed')::boolean or (result->>'replayed')::boolean
    or (result->>'revision')::bigint<>row_site.site_revision or row_site.site_revision<=0
    or row_site.street<>'Testgatan 1' or row_site.postal_code<>'12345' or row_site.address_source<>'manual_intake'
    or row_site.price_area_code is not null or row_site.grid_owner_id is not null
    or row_site.metadata->>'claimed_price_area_code'<>'SE3'
    or (select count(*) from public.customer_site_address_history where customer_site_id=row_site.id)<>1
    or (select count(*) from public.canonical_command_results where company_id=row_site.company_id and command_type='customer.site.save.v1')<>1
    or (select count(*) from public.canonical_audit_events where aggregate_id=row_site.id and event_type='CUSTOMER_SITE_COMMAND')<>1
    or (select count(*) from public.canonical_event_outbox where company_id=row_site.company_id and topic='customer.site.saved')<>1
    or (select count(*) from public.customer_operation_jobs where customer_site_id=row_site.id and status='queued')<>1
    or (select count(*) from public.customer_operation_request_snapshots where customer_site_id=row_site.id)<>1 then
    raise exception 'site_atomic_success_invalid'; end if;
  before_replay:=pg_temp.site_fixture_snapshot();
  replay:=public.gridex_save_customer_site_v1(command);
  if replay is distinct from result||jsonb_build_object('replayed',true)
    or pg_temp.site_fixture_snapshot() is distinct from before_replay then raise exception 'site_replay_changed_effects'; end if;
  begin
    perform public.gridex_save_customer_site_v1(pg_temp.site_fixture_command('site-native-success-key',row_site.id,0,jsonb_build_object('site_name','Different request')));
    raise exception 'site_changed_key_allowed';
  exception when others then if sqlerrm<>'site_idempotency_conflict' then raise; end if; end;
  begin
    perform public.gridex_save_customer_site_v1(pg_temp.site_fixture_command('site-native-stale-key',row_site.id,0));
    raise exception 'site_stale_revision_allowed';
  exception when others then if sqlerrm<>'site_revision_conflict' then raise; end if; end;
  if pg_temp.site_fixture_snapshot() is distinct from before_replay then raise exception 'site_conflict_left_effects'; end if;
end;
$positive$;
reset role;
\echo SITE_COMMAND_ATOMIC_REPLAY_REVISION_NATIVE_PASS

set local role service_role;
do $hints$
declare before_site public.customer_sites%rowtype; after_site public.customer_sites%rowtype; result jsonb; command jsonb;
begin
  select * into before_site from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  command:=pg_temp.site_fixture_command('site-native-changed-hint',before_site.id,before_site.site_revision);
  command:=jsonb_set(command,'{addressHints,claimedPriceAreaCode}','"SE4"');
  result:=public.gridex_save_customer_site_v1(command);
  select * into after_site from public.customer_sites where id=before_site.id;
  if result->>'addressStatus'<>'unchanged' or after_site.metadata->>'claimed_price_area_code'<>'SE4'
    or after_site.site_revision<=before_site.site_revision or after_site.address_hash<>before_site.address_hash
    or after_site.grid_owner_id is distinct from before_site.grid_owner_id or after_site.price_area_code is distinct from before_site.price_area_code
    or after_site.address_source is distinct from before_site.address_source
    or after_site.address_verified_at is distinct from before_site.address_verified_at then
    raise exception 'site_changed_hint_discarded_or_operational'; end if;
end;
$hints$;
reset role;
\echo SITE_COMMAND_UNCHANGED_ADDRESS_HINT_NATIVE_PASS

-- Any trusted canonical writer advances the same revision; callers cannot
-- reset it. Timestamp-only updates do not make an otherwise valid draft stale.
set local role service_role;
do $revision$
declare before_revision bigint; after_revision bigint;
begin
  select site_revision into before_revision from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  update public.customer_sites set site_revision=0,updated_at=clock_timestamp() where id=current_setting('gridex.site.site')::uuid;
  select site_revision into after_revision from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  if after_revision<>before_revision then raise exception 'site_timestamp_forged_revision'; end if;
  update public.customer_sites set site_revision=0,care_of='Trusted writer' where id=current_setting('gridex.site.site')::uuid;
  select site_revision into after_revision from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  if after_revision<>before_revision+1 then raise exception 'site_trusted_writer_revision_lost'; end if;
end;
$revision$;
reset role;
\echo SITE_COMMAND_TRUSTED_WRITER_REVISION_NATIVE_PASS

create function pg_temp.site_fail_late() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $failure$
begin
  if new.company_id=current_setting('gridex.site.company')::uuid then
    if tg_table_name='canonical_audit_events' then
      if new.event_type='CUSTOMER_SITE_COMMAND' and current_setting('gridex.site.failure',true)='audit' then
        raise exception 'synthetic_site_late_failure'; end if;
    elsif tg_table_name='canonical_command_results' then
      if new.command_type='customer.site.save.v1' and current_setting('gridex.site.failure',true)='completion' then
        raise exception 'synthetic_site_late_failure'; end if;
    end if;
  end if;
  return new;
end;
$failure$;
create trigger site_native_late_audit before insert on public.canonical_audit_events for each row execute function pg_temp.site_fail_late();
create trigger site_native_late_completion before insert on public.canonical_command_results for each row execute function pg_temp.site_fail_late();
set local role service_role;
do $rollback$
declare before_state jsonb; revision bigint; stage text;
begin
  select site_revision into revision from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  foreach stage in array array['audit','completion'] loop
    before_state:=pg_temp.site_fixture_snapshot();
    perform set_config('gridex.site.failure',stage,true);
    begin
      perform public.gridex_save_customer_site_v1(pg_temp.site_fixture_command('site-native-rollback-'||stage,current_setting('gridex.site.site')::uuid,
        revision,jsonb_build_object('site_name','Rollback candidate','street','Rollback 2')));
      raise exception 'site_late_failure_not_observed';
    exception when others then if sqlerrm<>'synthetic_site_late_failure' then raise; end if; end;
    if pg_temp.site_fixture_snapshot() is distinct from before_state then raise exception 'site_late_failure_left_effects'; end if;
  end loop;
  perform set_config('gridex.site.failure','',true);
end;
$rollback$;
reset role;
drop trigger site_native_late_audit on public.canonical_audit_events;
drop trigger site_native_late_completion on public.canonical_command_results;
\echo SITE_COMMAND_LATE_FAILURE_ROLLBACK_NATIVE_PASS

-- Verify that a lower-ranked manual address remains a candidate and cannot
-- overwrite the established canonical grid-owner response/provenance.
update public.customer_sites set address_source='grid_owner_response',address_verified_at=clock_timestamp(),
  address_verification_method='grid_owner_response' where id=:'site_a';
set local role service_role;
do $verified$
declare before_site public.customer_sites%rowtype; after_site public.customer_sites%rowtype; result jsonb;
begin
  select * into before_site from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  result:=public.gridex_save_customer_site_v1(pg_temp.site_fixture_command('site-native-verified-conflict',before_site.id,before_site.site_revision,
    jsonb_build_object('street','Lower rank 2','site_name','Reviewed candidate')));
  select * into after_site from public.customer_sites where id=before_site.id;
  if result->>'addressStatus'<>'conflict' or after_site.street<>before_site.street or after_site.address_hash<>before_site.address_hash
    or after_site.address_source<>before_site.address_source or after_site.address_verified_at<>before_site.address_verified_at
    or (select count(*) from public.customer_site_address_conflicts where customer_site_id=before_site.id and status='open')<>1 then
    raise exception 'site_verified_provenance_overwritten'; end if;
end;
$verified$;
reset role;
\echo SITE_COMMAND_VERIFIED_ADDRESS_CONFLICT_NATIVE_PASS

-- Existing OPS policy deliberately accepts either explicit permission. Prove
-- the customers.write branch with an actual sites.write denial and mutation,
-- rather than equating a rendered capability with command authorization.
update public.user_permissions set effect=case permission_key when 'customers.write' then 'allow' else 'deny' end
  where user_id=:'actor' and company_id=:'company_a' and permission_key in ('sites.write','customers.write');
set local role service_role;
do $customer_permission$
declare revision bigint; result jsonb;
begin
  if coalesce(public.gridex_actor_has_company_permission(current_setting('gridex.site.actor')::uuid,
      current_setting('gridex.site.company')::uuid,'sites.write'),false)
    or not coalesce(public.gridex_actor_has_company_permission(current_setting('gridex.site.actor')::uuid,
      current_setting('gridex.site.company')::uuid,'customers.write'),false) then
    raise exception 'site_customers_only_permission_fixture_invalid'; end if;
  select site_revision into revision from public.customer_sites where id=current_setting('gridex.site.site')::uuid;
  result:=public.gridex_save_customer_site_v1(pg_temp.site_fixture_command('site-native-customers-only-key',
    current_setting('gridex.site.site')::uuid,revision,jsonb_build_object('site_name','Customers permission correction')));
  if (result->>'replayed')::boolean or not (result->>'changed')::boolean or (result->>'revision')::bigint<=revision
    or (select site_name from public.customer_sites where id=current_setting('gridex.site.site')::uuid)<>'Customers permission correction' then
    raise exception 'site_customers_only_command_rejected'; end if;
end;
$customer_permission$;
reset role;
\echo SITE_COMMAND_CUSTOMERS_WRITE_ONLY_NATIVE_PASS

-- Current membership, exact permission, tenant and actual session remain
-- required even when the idempotency row is already completed.
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=:'session';
set local role service_role;
do $expired$
declare before_state jsonb;
begin
  before_state:=pg_temp.site_fixture_snapshot();
  begin
    perform public.gridex_save_customer_site_v1(pg_temp.site_fixture_command('site-native-success-key',current_setting('gridex.site.site')::uuid,0));
    raise exception 'site_expired_replay_allowed';
  exception when others then if sqlerrm<>'site_actor_forbidden' then raise; end if; end;
  if pg_temp.site_fixture_snapshot() is distinct from before_state then raise exception 'site_expired_replay_left_effects'; end if;
end;
$expired$;
reset role;
\echo SITE_COMMAND_CURRENT_SESSION_REPLAY_NATIVE_PASS
rollback;
