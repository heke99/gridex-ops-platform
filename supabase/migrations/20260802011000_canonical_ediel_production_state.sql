-- Canonical Ediel production state. Legacy company fields remain projections.

begin;


alter table public.ediel_production_readiness_checks
  add column if not exists configuration_snapshot_id uuid,
  add column if not exists configuration_hash text,
  add column if not exists target_state text,
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text;

alter table public.ediel_go_live_events
  add column if not exists configuration_snapshot_id uuid,
  add column if not exists configuration_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists is_stale boolean not null default false,
  add column if not exists stale_reason text;

create table if not exists public.ediel_production_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  state text not null default 'disabled',
  configuration_snapshot_id uuid,
  readiness_check_id uuid references public.ediel_production_readiness_checks(id) on delete set null,
  dry_run_id uuid references public.ediel_go_live_events(id) on delete set null,
  state_version bigint not null default 0,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paused_by uuid references auth.users(id) on delete set null,
  paused_at timestamptz,
  pause_reason text,
  blocked_reason text,
  first_live_send_approved_by uuid references auth.users(id) on delete set null,
  first_live_send_approved_at timestamptz,
  last_idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ediel_production_state_state_check
    check (state in ('disabled','configuring','prepared','live','paused','blocked','retired'))
);

create index if not exists ediel_production_state_state_idx
  on public.ediel_production_state(state, updated_at desc);

insert into public.ediel_production_state(
  company_id,state,approved_by,approved_at,paused_by,paused_at,pause_reason,
  blocked_reason,first_live_send_approved_by,first_live_send_approved_at
)
select c.id,
  case coalesce(c.ediel_production_status,c.production_status,'not_ready')
    when 'live' then 'live'
    when 'paused' then 'paused'
    when 'blocked' then 'blocked'
    when 'production_prepared' then 'prepared'
    when 'prepared' then 'prepared'
    when 'configuring' then 'configuring'
    when 'retired' then 'retired'
    else 'disabled'
  end,
  coalesce(c.ediel_production_enabled_by,c.live_approved_by),
  coalesce(c.ediel_production_enabled_at,c.live_approved_at),
  c.ediel_production_paused_by,c.ediel_production_paused_at,c.ediel_production_pause_reason,
  c.live_blocked_reason,c.ediel_first_live_send_approved_by,c.ediel_first_live_send_approved_at
from public.companies c
on conflict (company_id) do nothing;

alter table public.ediel_production_state enable row level security;
drop policy if exists ediel_production_state_service_role_all on public.ediel_production_state;
create policy ediel_production_state_service_role_all
  on public.ediel_production_state for all to service_role
  using (true) with check (true);
drop policy if exists ediel_production_state_tenant_read on public.ediel_production_state;
create policy ediel_production_state_tenant_read
  on public.ediel_production_state for select to authenticated
  using (public.gridex_can_read_company(company_id));
grant all on public.ediel_production_state to service_role;
grant select on public.ediel_production_state to authenticated;

create or replace function public.canonical_transition_ediel_production(
  p_company_id uuid,
  p_target_state text,
  p_expected_state_version bigint,
  p_configuration_snapshot_id uuid,
  p_readiness_check_id uuid,
  p_dry_run_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_state public.ediel_production_state%rowtype;
  v_readiness public.ediel_production_readiness_checks%rowtype;
  v_dry_run public.ediel_go_live_events%rowtype;
  v_existing jsonb;
  v_changed boolean;
  v_next_version bigint;
  v_event_type text;
  v_domain_event_id uuid;
  v_result jsonb;
  v_lock boolean;
  v_configuration_snapshot_id uuid;
begin
  if p_company_id is null or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'company_id_and_idempotency_key_required';
  end if;
  if p_target_state not in ('disabled','configuring','prepared','live','paused','blocked','retired') then
    raise exception 'invalid_ediel_production_target_state:%', p_target_state;
  end if;

  select result_payload into v_existing
  from public.canonical_command_results
  where company_id=p_company_id
    and command_type='ediel.production.transition'
    and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  select * into v_company from public.companies where id=p_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  insert into public.ediel_production_state(company_id,state)
  values (p_company_id,'disabled') on conflict do nothing;
  select * into v_state from public.ediel_production_state where company_id=p_company_id for update;

  if p_expected_state_version is not null and v_state.state_version<>p_expected_state_version then
    raise exception 'ediel_production_state_version_conflict:expected=%,actual=%',
      p_expected_state_version,v_state.state_version;
  end if;

  if v_company.status is null or v_company.status not in (
    'onboarding','active','paused','suspended','archived',
    'pending_deletion','closed','deleted_test_only'
  ) then
    raise exception 'tenant_status_unknown_or_invalid';
  end if;
  if v_company.status in ('closed','archived','suspended','pending_deletion','deleted_test_only') then
    raise exception 'tenant_lifecycle_blocks_ediel_production:%',v_company.status;
  end if;
  if p_target_state in ('prepared','live') and v_company.status<>'active' then
    raise exception 'tenant_must_be_active_for_ediel_production:%',v_company.status;
  end if;
  if v_state.state='retired' and p_target_state<>'retired' then
    raise exception 'retired_ediel_production_is_terminal';
  end if;

  v_configuration_snapshot_id:=coalesce(p_configuration_snapshot_id,v_state.configuration_snapshot_id);

  if p_target_state in ('prepared','live') then
    if p_readiness_check_id is null then raise exception 'readiness_check_required'; end if;
    select * into v_readiness
    from public.ediel_production_readiness_checks
    where id=p_readiness_check_id and company_id=p_company_id;
    if not found then raise exception 'readiness_check_not_found_for_tenant'; end if;
    if v_readiness.status not in ('ready','warning','live')
       or jsonb_array_length(coalesce(v_readiness.blocking_issues,'[]'::jsonb))>0 then
      raise exception 'readiness_check_has_blockers';
    end if;
    if v_configuration_snapshot_id is null then raise exception 'configuration_snapshot_required'; end if;
    if v_readiness.configuration_snapshot_id is distinct from v_configuration_snapshot_id
       or coalesce(v_readiness.is_stale,false) then
      raise exception 'readiness_snapshot_is_stale_or_mismatched';
    end if;
  end if;

  if p_target_state='live' then
    if p_dry_run_id is null then raise exception 'current_dry_run_required'; end if;
    select * into v_dry_run
    from public.ediel_go_live_events
    where id=p_dry_run_id and company_id=p_company_id and event_type='production_dry_run';
    if not found then raise exception 'production_dry_run_not_found_for_tenant'; end if;
    if v_dry_run.to_status not in ('allowed','warning') then
      raise exception 'production_dry_run_not_approved';
    end if;
    if coalesce(v_dry_run.is_stale,false)
       or v_dry_run.configuration_snapshot_id is distinct from v_configuration_snapshot_id then
      raise exception 'production_dry_run_snapshot_is_stale_or_mismatched';
    end if;
    if coalesce(v_dry_run.expires_at,v_dry_run.created_at+interval '24 hours') <= now() then
      raise exception 'production_dry_run_expired';
    end if;
    if v_state.state not in ('prepared','paused','blocked','live') then
      raise exception 'production_must_be_prepared_before_live:%',v_state.state;
    end if;
  end if;

  v_changed := v_state.state is distinct from p_target_state
    or v_state.configuration_snapshot_id is distinct from v_configuration_snapshot_id
    or v_state.readiness_check_id is distinct from p_readiness_check_id
    or v_state.dry_run_id is distinct from p_dry_run_id;

  if not v_changed then
    v_result:=jsonb_build_object('changed',false,'company_id',p_company_id,'state',v_state.state,'state_version',v_state.state_version);
    insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
    values(p_company_id,'ediel.production.transition',p_idempotency_key,
      jsonb_build_object('target_state',p_target_state,'reason',p_reason),v_result,p_actor_user_id)
    on conflict do nothing;
    return v_result;
  end if;

  v_next_version:=v_state.state_version+1;
  update public.ediel_production_state
  set state=p_target_state,
      configuration_snapshot_id=v_configuration_snapshot_id,
      readiness_check_id=coalesce(p_readiness_check_id,readiness_check_id),
      dry_run_id=coalesce(p_dry_run_id,dry_run_id),
      state_version=v_next_version,
      approved_by=case when p_target_state='live' then p_actor_user_id else approved_by end,
      approved_at=case when p_target_state='live' then now() else approved_at end,
      paused_by=case when p_target_state='paused' then p_actor_user_id when p_target_state='live' then null else paused_by end,
      paused_at=case when p_target_state='paused' then now() when p_target_state='live' then null else paused_at end,
      pause_reason=case when p_target_state='paused' then p_reason when p_target_state='live' then null else pause_reason end,
      blocked_reason=case when p_target_state='blocked' then p_reason when p_target_state in ('prepared','live') then null else blocked_reason end,
      last_idempotency_key=p_idempotency_key,
      updated_at=now()
  where company_id=p_company_id;

  v_lock:=p_target_state<>'live';
  insert into public.ediel_send_locks(
    company_id,environment,locked,locked_reason,locked_by,locked_at,
    unlocked_by,unlocked_at,updated_at
  ) values (
    p_company_id,'production',v_lock,
    case when v_lock then coalesce(p_reason,'Canonical production state is not live.') else null end,
    case when v_lock then p_actor_user_id else null end,
    case when v_lock then now() else null end,
    case when not v_lock then p_actor_user_id else null end,
    case when not v_lock then now() else null end,
    now()
  ) on conflict (company_id,environment) do update
  set locked=excluded.locked,locked_reason=excluded.locked_reason,
      locked_by=excluded.locked_by,locked_at=excluded.locked_at,
      unlocked_by=excluded.unlocked_by,unlocked_at=excluded.unlocked_at,
      updated_at=excluded.updated_at;

  -- Compatibility projections. Runtime decisions must use ediel_production_state.
  update public.companies
  set operating_environment=case when p_target_state='live' then 'production' else operating_environment end,
      production_status=case p_target_state when 'prepared' then 'production_prepared' else p_target_state end,
      ediel_production_status=case p_target_state when 'prepared' then 'production_prepared' else p_target_state end,
      live_ediel_enabled=p_target_state='live',
      ediel_production_enabled=p_target_state='live',
      live_approved_by=case when p_target_state='live' then p_actor_user_id else live_approved_by end,
      live_approved_at=case when p_target_state='live' then now() else live_approved_at end,
      ediel_production_enabled_by=case when p_target_state='live' then p_actor_user_id else ediel_production_enabled_by end,
      ediel_production_enabled_at=case when p_target_state='live' then now() else ediel_production_enabled_at end,
      ediel_production_paused_by=case when p_target_state='paused' then p_actor_user_id when p_target_state='live' then null else ediel_production_paused_by end,
      ediel_production_paused_at=case when p_target_state='paused' then now() when p_target_state='live' then null else ediel_production_paused_at end,
      ediel_production_pause_reason=case when p_target_state='paused' then p_reason when p_target_state='live' then null else ediel_production_pause_reason end,
      live_blocked_reason=case when p_target_state in ('blocked','paused') then p_reason when p_target_state in ('prepared','live') then null else live_blocked_reason end,
      updated_at=now()
  where id=p_company_id;

  v_event_type:=case p_target_state
    when 'prepared' then 'EDIEL_PRODUCTION_PREPARED'
    when 'live' then case when v_state.state='paused' then 'EDIEL_PRODUCTION_RESUMED' else 'EDIEL_PRODUCTION_ACTIVATED' end
    when 'paused' then 'EDIEL_PRODUCTION_PAUSED'
    else 'EDIEL_PRODUCTION_STATE_CHANGED'
  end;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,state_version,
    actor_user_id,reason,idempotency_key,before_state,after_state,metadata
  ) values (
    p_company_id,v_event_type,'ediel_production',p_company_id,v_next_version,
    p_actor_user_id,p_reason,p_idempotency_key,
    jsonb_build_object('state',v_state.state,'state_version',v_state.state_version),
    jsonb_build_object('state',p_target_state,'state_version',v_next_version),
    jsonb_build_object('readiness_check_id',p_readiness_check_id,'dry_run_id',p_dry_run_id,'configuration_snapshot_id',v_configuration_snapshot_id)
  );

  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,aggregate_version,
    idempotency_key,payload,created_by
  ) values (
    p_company_id,v_event_type,'ediel_production',p_company_id,v_next_version,
    p_idempotency_key,
    jsonb_build_object('from_state',v_state.state,'to_state',p_target_state,'reason',p_reason,
      'readiness_check_id',p_readiness_check_id,'dry_run_id',p_dry_run_id,
      'configuration_snapshot_id',v_configuration_snapshot_id),
    p_actor_user_id
  ) returning id into v_domain_event_id;

  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(p_company_id,v_domain_event_id,'ediel.production.state.changed',p_idempotency_key,
    jsonb_build_object('company_id',p_company_id,'state',p_target_state,'state_version',v_next_version));

  insert into public.ediel_go_live_events(
    company_id,event_type,from_status,to_status,reason,actor_user_id,readiness_check_id,metadata
  ) values (
    p_company_id,lower(v_event_type),v_state.state,p_target_state,p_reason,p_actor_user_id,p_readiness_check_id,
    jsonb_build_object('canonical',true,'state_version',v_next_version,'dry_run_id',p_dry_run_id,'configuration_snapshot_id',v_configuration_snapshot_id)
  );

  v_result:=jsonb_build_object('changed',true,'company_id',p_company_id,'previous_state',v_state.state,
    'state',p_target_state,'state_version',v_next_version,'domain_event_id',v_domain_event_id);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(p_company_id,'ediel.production.transition',p_idempotency_key,
    jsonb_build_object('target_state',p_target_state,'reason',p_reason),v_result,p_actor_user_id);
  return v_result;
end;
$$;

revoke all on function public.canonical_transition_ediel_production(uuid,text,bigint,uuid,uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.canonical_transition_ediel_production(uuid,text,bigint,uuid,uuid,uuid,text,uuid,text) to service_role;

create or replace function public.canonical_approve_first_live_send(
  p_company_id uuid,
  p_readiness_check_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_state public.ediel_production_state%rowtype;
  v_readiness public.ediel_production_readiness_checks%rowtype;
  v_existing jsonb;
  v_event_id uuid;
  v_result jsonb;
begin
  select result_payload into v_existing from public.canonical_command_results
  where company_id=p_company_id and command_type='ediel.production.first_live_send.approve' and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  select * into v_company from public.companies where id=p_company_id for update;
  select * into v_state from public.ediel_production_state where company_id=p_company_id for update;
  if v_company.status<>'active' then raise exception 'tenant_must_be_active'; end if;
  if v_state.state<>'live' then raise exception 'ediel_production_must_be_live'; end if;
  select * into v_readiness from public.ediel_production_readiness_checks
  where id=p_readiness_check_id and company_id=p_company_id;
  if not found or v_readiness.status not in ('ready','warning','live')
     or jsonb_array_length(coalesce(v_readiness.blocking_issues,'[]'::jsonb))>0
     or coalesce(v_readiness.is_stale,false)
     or v_readiness.configuration_snapshot_id is distinct from v_state.configuration_snapshot_id then
    raise exception 'valid_current_readiness_check_required';
  end if;

  update public.ediel_production_state
  set first_live_send_approved_by=p_actor_user_id,
      first_live_send_approved_at=coalesce(first_live_send_approved_at,now()),
      updated_at=now()
  where company_id=p_company_id;
  update public.companies
  set ediel_first_live_send_approved_by=p_actor_user_id,
      ediel_first_live_send_approved_at=coalesce(ediel_first_live_send_approved_at,now()),
      updated_at=now()
  where id=p_company_id;

  insert into public.canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
  values(p_company_id,'EDIEL_FIRST_LIVE_SEND_APPROVED','ediel_production',p_company_id,v_state.state_version,
    p_idempotency_key,jsonb_build_object('readiness_check_id',p_readiness_check_id),p_actor_user_id)
  returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(p_company_id,v_event_id,'ediel.production.first_live_send.approved',p_idempotency_key,
    jsonb_build_object('company_id',p_company_id,'readiness_check_id',p_readiness_check_id));
  insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,reason,idempotency_key,after_state)
  values(p_company_id,'EDIEL_FIRST_LIVE_SEND_APPROVED','ediel_production',p_company_id,v_state.state_version,
    p_actor_user_id,'Första live-sändning godkänd.',p_idempotency_key,
    jsonb_build_object('approved',true,'readiness_check_id',p_readiness_check_id));

  v_result:=jsonb_build_object('changed',true,'company_id',p_company_id,'approved',true,'domain_event_id',v_event_id);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(p_company_id,'ediel.production.first_live_send.approve',p_idempotency_key,
    jsonb_build_object('readiness_check_id',p_readiness_check_id),v_result,p_actor_user_id);
  return v_result;
end;
$$;

revoke all on function public.canonical_approve_first_live_send(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.canonical_approve_first_live_send(uuid,uuid,uuid,text) to service_role;

commit;
