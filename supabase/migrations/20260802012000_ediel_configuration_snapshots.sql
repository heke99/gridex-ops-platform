-- Immutable Ediel configuration snapshots and transactional actor profile writes.

begin;

create table if not exists public.ediel_configuration_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_version bigint not null,
  actor_role text,
  test_ediel_id text,
  production_ediel_id text,
  test_brp_ediel_id text,
  production_brp_ediel_id text,
  test_application_reference text,
  production_application_reference text,
  primary_test_route_id uuid,
  primary_production_route_id uuid,
  payload jsonb not null,
  configuration_hash text not null,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ediel_configuration_snapshots_company_version_key unique(company_id,snapshot_version),
  constraint ediel_configuration_snapshots_company_hash_key unique(company_id,configuration_hash)
);

create index if not exists ediel_configuration_snapshots_company_created_idx
  on public.ediel_configuration_snapshots(company_id,created_at desc);

alter table public.ediel_configuration_snapshots enable row level security;
drop policy if exists ediel_configuration_snapshots_service_role_all on public.ediel_configuration_snapshots;
create policy ediel_configuration_snapshots_service_role_all
  on public.ediel_configuration_snapshots for all to service_role
  using(true) with check(true);
drop policy if exists ediel_configuration_snapshots_tenant_read on public.ediel_configuration_snapshots;
create policy ediel_configuration_snapshots_tenant_read
  on public.ediel_configuration_snapshots for select to authenticated
  using(public.gridex_can_read_company(company_id));
grant all on public.ediel_configuration_snapshots to service_role;
grant select on public.ediel_configuration_snapshots to authenticated;

create table if not exists public.ediel_active_test_configurations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'test',
  test_suite text not null,
  actor_role text not null,
  message_family text not null,
  setup_package text not null,
  configuration_snapshot_id uuid not null references public.ediel_configuration_snapshots(id) on delete restrict,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ediel_active_test_configurations_status_check check(status in ('active','inactive','archived'))
);
create unique index if not exists ediel_active_test_configurations_active_key
  on public.ediel_active_test_configurations(
    company_id,environment,test_suite,actor_role,message_family,setup_package
  ) where status='active';
alter table public.ediel_active_test_configurations enable row level security;
drop policy if exists ediel_active_test_configurations_service_role_all on public.ediel_active_test_configurations;
create policy ediel_active_test_configurations_service_role_all on public.ediel_active_test_configurations
for all to service_role using(true) with check(true);
drop policy if exists ediel_active_test_configurations_tenant_read on public.ediel_active_test_configurations;
create policy ediel_active_test_configurations_tenant_read on public.ediel_active_test_configurations
for select to authenticated using(public.gridex_can_read_company(company_id));
grant all on public.ediel_active_test_configurations to service_role;
grant select on public.ediel_active_test_configurations to authenticated;

create or replace function public.prevent_ediel_configuration_snapshot_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'ediel_configuration_snapshots_are_immutable';
end;
$$;
drop trigger if exists ediel_configuration_snapshots_immutable on public.ediel_configuration_snapshots;
create trigger ediel_configuration_snapshots_immutable
before update or delete on public.ediel_configuration_snapshots
for each row execute function public.prevent_ediel_configuration_snapshot_mutation();

do $$
begin
  if not exists (select 1 from pg_constraint where conname='ediel_production_state_configuration_snapshot_fk') then
    alter table public.ediel_production_state
      add constraint ediel_production_state_configuration_snapshot_fk
      foreign key(configuration_snapshot_id)
      references public.ediel_configuration_snapshots(id) on delete restrict not valid;
  end if;
end $$;

alter table public.ediel_test_runs
  add column if not exists configuration_snapshot_id uuid references public.ediel_configuration_snapshots(id) on delete restrict,
  add column if not exists configuration_hash text,
  add column if not exists rulebook_version text,
  add column if not exists engine_version text,
  add column if not exists message_variant text,
  add column if not exists actor_role text,
  add column if not exists message_family text,
  add column if not exists setup_package text,
  add column if not exists environment text not null default 'test',
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text,
  add column if not exists stale_at timestamptz;

alter table public.ediel_production_readiness_checks
  add column if not exists configuration_snapshot_id uuid references public.ediel_configuration_snapshots(id) on delete restrict,
  add column if not exists configuration_hash text,
  add column if not exists target_state text,
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text;

alter table public.ediel_go_live_events
  add column if not exists configuration_snapshot_id uuid references public.ediel_configuration_snapshots(id) on delete restrict,
  add column if not exists configuration_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='ediel_production_readiness_configuration_snapshot_fk') then
    alter table public.ediel_production_readiness_checks
      add constraint ediel_production_readiness_configuration_snapshot_fk
      foreign key(configuration_snapshot_id) references public.ediel_configuration_snapshots(id) on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='ediel_go_live_events_configuration_snapshot_fk') then
    alter table public.ediel_go_live_events
      add constraint ediel_go_live_events_configuration_snapshot_fk
      foreign key(configuration_snapshot_id) references public.ediel_configuration_snapshots(id) on delete restrict not valid;
  end if;
end $$;

alter table public.actor_test_results
  add column if not exists configuration_snapshot_id uuid references public.ediel_configuration_snapshots(id) on delete restrict,
  add column if not exists configuration_hash text,
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text;

create or replace function public.canonical_capture_ediel_configuration_snapshot(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns public.ediel_configuration_snapshots
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_payload jsonb;
  v_hash text;
  v_next_version bigint;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_existing public.ediel_configuration_snapshots%rowtype;
begin
  if p_company_id is null then raise exception 'company_id_required'; end if;
  select * into v_company from public.companies where id=p_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  v_payload:=jsonb_build_object(
    'company',jsonb_build_object(
      'id',v_company.id,
      'actor_role',coalesce(v_company.actor_role,v_company.market_role),
      'test_ediel_id',v_company.test_ediel_id,
      'production_ediel_id',v_company.production_ediel_id,
      'brp_ediel_id',v_company.brp_ediel_id,
      'test_application_reference',v_company.test_application_reference,
      'production_application_reference',v_company.production_application_reference,
      'test_sender_sub_address',v_company.test_sender_sub_address,
      'production_sender_sub_address',v_company.production_sender_sub_address,
      'test_mailbox',v_company.test_mailbox,
      'production_mailbox',v_company.production_mailbox,
      'primary_test_route_id',v_company.ediel_primary_test_route_profile_id,
      'primary_production_route_id',v_company.ediel_primary_production_route_profile_id
    ),
    'actor_profiles',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'environment',a.environment,'actor_role',coalesce(a.actor_role,a.role),
        'ediel_id',coalesce(a.actor_ediel_id,a.ediel_id),
        'sender_subaddress',coalesce(a.sender_sub_address,a.sender_subaddress),
        'receiver_subaddress',coalesce(a.receiver_sub_address,a.receiver_subaddress),
        'application_reference',coalesce(a.application_reference,a.default_application_reference),
        'mailbox',a.mailbox,'brp_ediel_id',a.brp_ediel_id,'is_active',a.is_active
      ) order by a.environment,a.id)
      from public.ediel_actor_settings a where a.company_id=p_company_id
    ),'[]'::jsonb),
    'routes',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'environment',r.environment,'route_type',r.route_type,
        'sender_ediel_id',r.sender_ediel_id,
        'sender_subaddress',coalesce(r.sender_sub_address,r.sender_subaddress),
        'receiver_ediel_id',r.receiver_ediel_id,
        'receiver_subaddress',coalesce(r.receiver_sub_address,r.receiver_subaddress),
        'mailbox_id',r.mailbox_id,'transport_profile_id',r.transport_profile_id,
        'certificate_id',r.certificate_id,'receiver_certificate_id',r.receiver_certificate_id,
        'is_active',r.is_active,'is_enabled',r.is_enabled
      ) order by r.environment,r.id)
      from public.ediel_route_profiles r where r.company_id=p_company_id
    ),'[]'::jsonb),
    'mailboxes',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'environment',m.environment,'mailbox_name',m.mailbox_name,
        'email_address',m.email_address,'imap_host',m.imap_host,'imap_port',m.imap_port,
        'provider',m.provider,'mailbox_type',m.mailbox_type,
        'is_active',m.is_active,'is_shared_platform_mailbox',m.is_shared_platform_mailbox,
        'secret_reference_present',m.secret_reference is not null
      ) order by m.environment,m.id)
      from public.ediel_mailboxes m where m.company_id=p_company_id
    ),'[]'::jsonb),
    'certificates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'fingerprint',c.certificate_fingerprint,
        'valid_from',c.certificate_valid_from,'valid_to',c.certificate_valid_to,
        'encryption_status',c.encryption_status,'status',c.status
      ) order by c.id)
      from public.ediel_certificates c where c.company_id=p_company_id
    ),'[]'::jsonb),
    'active_test_configurations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'environment',tc.environment,'test_suite',tc.test_suite,'actor_role',tc.actor_role,
        'message_family',tc.message_family,'setup_package',tc.setup_package,'status',tc.status
      ) order by tc.environment,tc.test_suite,tc.actor_role,tc.message_family,tc.setup_package)
      from public.ediel_active_test_configurations tc
      where tc.company_id=p_company_id and tc.status='active'
    ),'[]'::jsonb),
    'active_rule_versions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'rule_key',rv.rule_key,'version_code',rv.version_code,'schema_version',rv.schema_version,
        'environment',rv.environment,'status',rv.status,'is_active',rv.is_active
      ) order by rv.rule_key,rv.version_code)
      from public.ediel_rule_versions rv
      where coalesce(rv.is_active,false)=true and coalesce(rv.status,'active')='active'
    ),'[]'::jsonb),
    'engine_version','canonical-evidence-v2'
  );

  v_hash:=encode(digest(convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  select * into v_existing from public.ediel_configuration_snapshots
  where company_id=p_company_id and configuration_hash=v_hash;
  if found then return v_existing; end if;

  select coalesce(max(snapshot_version),0)+1 into v_next_version
  from public.ediel_configuration_snapshots where company_id=p_company_id;

  insert into public.ediel_configuration_snapshots(
    company_id,snapshot_version,actor_role,test_ediel_id,production_ediel_id,
    test_brp_ediel_id,production_brp_ediel_id,
    test_application_reference,production_application_reference,
    primary_test_route_id,primary_production_route_id,payload,configuration_hash,
    reason,created_by
  ) values (
    p_company_id,v_next_version,coalesce(v_company.actor_role,v_company.market_role),
    v_company.test_ediel_id,v_company.production_ediel_id,v_company.brp_ediel_id,v_company.brp_ediel_id,
    v_company.test_application_reference,v_company.production_application_reference,
    v_company.ediel_primary_test_route_profile_id,v_company.ediel_primary_production_route_profile_id,
    v_payload,v_hash,coalesce(nullif(btrim(p_reason),''),'configuration_changed'),p_actor_user_id
  ) returning * into v_snapshot;

  update public.ediel_test_runs
    set is_stale=true,stale_reason='configuration_changed',stale_at=now()
    where company_id=p_company_id and completed_at is not null
      and configuration_snapshot_id is distinct from v_snapshot.id;
  update public.actor_test_results
    set is_stale=true,stale_reason='configuration_changed',updated_at=now()
    where company_id=p_company_id and configuration_snapshot_id is distinct from v_snapshot.id;
  update public.ediel_production_readiness_checks
    set is_stale=true,stale_reason='configuration_changed'
    where company_id=p_company_id and configuration_snapshot_id is distinct from v_snapshot.id;
  update public.ediel_go_live_events
    set is_stale=true,stale_reason='configuration_changed'
    where company_id=p_company_id and event_type='production_dry_run'
      and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.ediel_production_state
  set configuration_snapshot_id=v_snapshot.id,
      state=case when state in ('prepared','live') then 'blocked' else state end,
      blocked_reason=case when state in ('prepared','live') then 'configuration_changed' else blocked_reason end,
      state_version=state_version+1,
      updated_at=now()
  where company_id=p_company_id;

  if exists(select 1 from public.ediel_production_state where company_id=p_company_id and state='blocked') then
    update public.companies set
      production_status='blocked',ediel_production_status='blocked',
      live_ediel_enabled=false,ediel_production_enabled=false,
      live_blocked_reason='configuration_changed',updated_at=now()
    where id=p_company_id;
    insert into public.ediel_send_locks(company_id,environment,locked,locked_reason,locked_at,updated_at)
    values(p_company_id,'production',true,'configuration_changed',now(),now())
    on conflict(company_id,environment) do update
      set locked=true,locked_reason='configuration_changed',locked_at=now(),updated_at=now();
  end if;

  return v_snapshot;
end;
$$;

revoke all on function public.canonical_capture_ediel_configuration_snapshot(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.canonical_capture_ediel_configuration_snapshot(uuid,uuid,text) to service_role;

create or replace function public.canonical_save_ediel_actor_profile(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid:=(p_command->>'company_id')::uuid;
  v_actor_user_id uuid:=nullif(p_command->>'actor_user_id','')::uuid;
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_actor_role text:=lower(nullif(btrim(p_command->>'actor_role'),''));
  v_environment text;
  v_ediel_id text;
  v_profile_id uuid;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_existing jsonb;
  v_result jsonb;
begin
  if v_company_id is null or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'company_id_and_idempotency_key_required';
  end if;
  if v_actor_role is null or v_actor_role not in (
    'supplier','electricity_supplier','grid_owner','energy_service_company',
    'balance_responsible_party','brp','system_supplier','metering_point_operator',
    'metering_data_responsible'
  ) then raise exception 'unsupported_actor_role:%',coalesce(v_actor_role,'null'); end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='ediel.actor_profile.save' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  perform 1 from public.companies where id=v_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  perform set_config('gridex.skip_ediel_snapshot_trigger','on',true);

  update public.companies set
    org_number=nullif(p_command->>'organization_number',''),
    market_role=v_actor_role,actor_role=v_actor_role,
    ediel_id=nullif(upper(p_command->>'ediel_id'),''),
    test_ediel_id=nullif(upper(p_command->>'test_ediel_id'),''),
    production_ediel_id=nullif(upper(p_command->>'production_ediel_id'),''),
    test_sender_sub_address=nullif(p_command->>'test_sender_sub_address',''),
    production_sender_sub_address=nullif(p_command->>'production_sender_sub_address',''),
    test_mailbox=nullif(p_command->>'test_mailbox',''),
    production_mailbox=nullif(p_command->>'production_mailbox',''),
    test_application_reference=nullif(upper(p_command->>'test_application_reference'),''),
    production_application_reference=nullif(upper(p_command->>'production_application_reference'),''),
    test_counterparty_ediel_id=nullif(upper(p_command->>'test_counterparty_ediel_id'),''),
    production_counterparty_ediel_id=nullif(upper(p_command->>'production_counterparty_ediel_id'),''),
    brp_name=nullif(p_command->>'brp_name',''),
    brp_ediel_id=nullif(upper(p_command->>'brp_ediel_id'),''),
    brp_status=coalesce(nullif(p_command->>'brp_status',''),'missing'),
    esett_status=coalesce(nullif(p_command->>'esett_status',''),'missing'),
    technical_contact_name=nullif(p_command->>'technical_contact_name',''),
    technical_contact_email=nullif(p_command->>'technical_contact_email',''),
    support_email=nullif(p_command->>'support_email',''),
    billing_contact_email=nullif(p_command->>'billing_contact_email',''),
    updated_at=now()
  where id=v_company_id;

  foreach v_environment in array array['test','production'] loop
    v_ediel_id:=nullif(upper(p_command->>(v_environment||'_ediel_id')),'');
    if v_ediel_id is null then
      update public.ediel_actor_settings
      set is_active=false,updated_by=v_actor_user_id,updated_at=now()
      where company_id=v_company_id and environment=v_environment and is_active=true;
      continue;
    end if;

    select id into v_profile_id from public.ediel_actor_settings
    where company_id=v_company_id and environment=v_environment and is_active=true
    order by updated_at desc,id desc limit 1 for update;

    update public.ediel_actor_settings
    set is_active=false,updated_by=v_actor_user_id,updated_at=now()
    where company_id=v_company_id and environment=v_environment
      and is_active=true and id is distinct from v_profile_id;

    if v_profile_id is null then
      insert into public.ediel_actor_settings(
        company_id,actor_name,sender_name,actor_role,role,actor_ediel_id,ediel_id,
        environment,is_active,sender_sub_address,sender_subaddress,
        default_application_reference,application_reference,mailbox,
        default_charset,default_timezone,default_test_flag,smtp_from_email,
        smtp_reply_to_email,brp_name,brp_ediel_id,brp_status,esett_status,
        created_by,updated_by,created_at,updated_at
      ) values (
        v_company_id,coalesce(nullif(p_command->>'company_name',''),'Aktör'),
        coalesce(nullif(p_command->>'company_name',''),'Aktör'),v_actor_role,v_actor_role,v_ediel_id,v_ediel_id,
        v_environment,true,nullif(p_command->>(v_environment||'_sender_sub_address'),''),
        nullif(p_command->>(v_environment||'_sender_sub_address'),''),
        nullif(upper(p_command->>(v_environment||'_application_reference')),''),
        nullif(upper(p_command->>(v_environment||'_application_reference')),''),
        nullif(p_command->>(v_environment||'_mailbox'),''),'UNOC',1,
        case when v_environment='production' then 0 else 1 end,
        nullif(p_command->>'smtp_from_email',''),nullif(p_command->>'smtp_from_email',''),
        nullif(p_command->>'brp_name',''),nullif(upper(p_command->>'brp_ediel_id'),''),
        coalesce(nullif(p_command->>'brp_status',''),'missing'),
        coalesce(nullif(p_command->>'esett_status',''),'missing'),
        v_actor_user_id,v_actor_user_id,now(),now()
      ) returning id into v_profile_id;
    else
      update public.ediel_actor_settings set
        actor_name=coalesce(nullif(p_command->>'company_name',''),'Aktör'),
        sender_name=coalesce(nullif(p_command->>'company_name',''),'Aktör'),
        actor_role=v_actor_role,role=v_actor_role,
        actor_ediel_id=v_ediel_id,ediel_id=v_ediel_id,is_active=true,
        sender_sub_address=nullif(p_command->>(v_environment||'_sender_sub_address'),''),
        sender_subaddress=nullif(p_command->>(v_environment||'_sender_sub_address'),''),
        default_application_reference=nullif(upper(p_command->>(v_environment||'_application_reference')),''),
        application_reference=nullif(upper(p_command->>(v_environment||'_application_reference')),''),
        mailbox=nullif(p_command->>(v_environment||'_mailbox'),''),
        default_test_flag=case when v_environment='production' then 0 else 1 end,
        smtp_from_email=nullif(p_command->>'smtp_from_email',''),
        smtp_reply_to_email=nullif(p_command->>'smtp_from_email',''),
        brp_name=nullif(p_command->>'brp_name',''),
        brp_ediel_id=nullif(upper(p_command->>'brp_ediel_id'),''),
        brp_status=coalesce(nullif(p_command->>'brp_status',''),'missing'),
        esett_status=coalesce(nullif(p_command->>'esett_status',''),'missing'),
        updated_by=v_actor_user_id,updated_at=now()
      where id=v_profile_id and company_id=v_company_id;
    end if;
  end loop;

  perform set_config('gridex.skip_ediel_snapshot_trigger','off',true);
  v_snapshot:=public.canonical_capture_ediel_configuration_snapshot(v_company_id,v_actor_user_id,'actor_profile_updated');

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,after_state,metadata
  ) values (
    v_company_id,'EDIEL_ACTOR_PROFILE_UPDATED','company',v_company_id,v_actor_user_id,
    'Aktörsprofil uppdaterad atomiskt.',v_idempotency_key,
    jsonb_build_object('actor_role',v_actor_role,'configuration_snapshot_id',v_snapshot.id,'configuration_hash',v_snapshot.configuration_hash),p_command
  );

  v_result:=jsonb_build_object('changed',true,'company_id',v_company_id,
    'configuration_snapshot_id',v_snapshot.id,'configuration_hash',v_snapshot.configuration_hash);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company_id,'ediel.actor_profile.save',v_idempotency_key,p_command,v_result,v_actor_user_id);
  return v_result;
end;
$$;

revoke all on function public.canonical_save_ediel_actor_profile(jsonb) from public,anon,authenticated;
grant execute on function public.canonical_save_ediel_actor_profile(jsonb) to service_role;

create or replace function public.ediel_configuration_change_snapshot_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company_id uuid;
begin
  if current_setting('gridex.skip_ediel_snapshot_trigger',true)='on' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' then v_company_id:=old.company_id; else v_company_id:=new.company_id; end if;
  if v_company_id is not null then
    perform public.canonical_capture_ediel_configuration_snapshot(v_company_id,auth.uid(),tg_table_name||'_changed');
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['ediel_actor_settings','ediel_route_profiles','ediel_mailboxes','ediel_certificates','ediel_active_test_configurations'] loop
    execute format('drop trigger if exists %I on public.%I','canonical_snapshot_'||v_table,v_table);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.ediel_configuration_change_snapshot_trigger()',
      'canonical_snapshot_'||v_table,v_table);
  end loop;
end $$;

commit;
