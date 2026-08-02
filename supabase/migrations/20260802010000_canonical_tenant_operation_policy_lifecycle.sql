-- Canonical tenant operation policy and lifecycle state machine.
-- Forward-only, additive and fail-closed. Historical migrations are untouched.

begin;

create extension if not exists pgcrypto;

alter table public.companies
  add column if not exists lifecycle_state_version bigint not null default 0,
  add column if not exists lifecycle_last_transition_at timestamptz,
  add column if not exists lifecycle_last_transition_by uuid references auth.users(id) on delete set null,
  add column if not exists lifecycle_last_idempotency_key text;

alter table public.companies drop constraint if exists companies_canonical_status_check;
alter table public.companies add constraint companies_canonical_status_check
  check (status in (
    'onboarding','active','paused','suspended','archived',
    'pending_deletion','closed','deleted_test_only'
  )) not valid;

create table if not exists public.canonical_command_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  command_type text not null,
  idempotency_key text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint canonical_command_results_company_command_key
    unique (company_id, command_type, idempotency_key)
);

create table if not exists public.canonical_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  state_version bigint,
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text,
  idempotency_key text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint canonical_audit_events_idempotency_key
    unique (company_id, event_type, idempotency_key)
);

create table if not exists public.canonical_domain_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version bigint,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint canonical_domain_events_idempotency_key
    unique (company_id, event_type, idempotency_key)
);

create table if not exists public.canonical_event_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain_event_id uuid not null references public.canonical_domain_events(id) on delete cascade,
  topic text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint canonical_event_outbox_status_check
    check (status in ('pending','processing','processed','failed','blocked_tenant_state')),
  constraint canonical_event_outbox_idempotency_key
    unique (company_id, topic, idempotency_key)
);

create index if not exists canonical_event_outbox_claim_idx
  on public.canonical_event_outbox(status, available_at, created_at);

alter table public.canonical_command_results enable row level security;
alter table public.canonical_audit_events enable row level security;
alter table public.canonical_domain_events enable row level security;
alter table public.canonical_event_outbox enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'canonical_command_results','canonical_audit_events',
    'canonical_domain_events','canonical_event_outbox'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_service_role_all', v_table);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      v_table || '_service_role_all', v_table
    );
    execute format('drop policy if exists %I on public.%I', v_table || '_tenant_read', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.gridex_can_read_company(company_id))',
      v_table || '_tenant_read', v_table
    );
  end loop;
end $$;

grant all on public.canonical_command_results to service_role;
grant all on public.canonical_audit_events to service_role;
grant all on public.canonical_domain_events to service_role;
grant all on public.canonical_event_outbox to service_role;
grant select on public.canonical_audit_events, public.canonical_domain_events to authenticated;

-- Dedicated permissions make mutating Ediel semantics explicit.
insert into public.permissions(key, name, description)
values
  ('ediel_testing.write', 'Ändra Ediel-tester', 'Skapa, ändra och köra tenantägda Ediel-tester.'),
  ('ediel_testing.attest', 'Attestera Ediel-test', 'Skapa separat manuell attestering; kan aldrig sätta machine passed.'),
  ('ediel.send', 'Skicka Ediel', 'Utföra faktisk extern Ediel-transport.'),
  ('ediel.production.activate', 'Aktivera Ediel-produktion', 'Förbereda, aktivera och återuppta Ediel-produktion.'),
  ('ediel.production.pause', 'Pausa Ediel-produktion', 'Pausa outbound Ediel-produktion.'),
  ('ediel.profile.write', 'Ändra Ediel-profil', 'Ändra aktörsprofil och skapa ny konfigurationssnapshot.')
on conflict (key) do update
set name = excluded.name,
    description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'ediel_testing.write','ediel_testing.attest','ediel.send',
  'ediel.production.activate','ediel.production.pause','ediel.profile.write'
)
where r.key in ('super_admin','platform_admin')
on conflict do nothing;

-- Add all canonical capability rows disabled by default. Existing explicit
-- readiness is preserved; absence never means allowed.
insert into public.company_capabilities(company_id, capability_code, enabled, readiness_status)
select c.id, capability_code, false, 'not_configured'
from public.companies c
cross join unnest(array[
  'customer_intake','website_sales','api_sales','ediel_test',
  'ediel_production','webhooks','email_outbound',
  'customer_automation','billing','facility_lookup'
]::text[]) as capability_code
on conflict (company_id, capability_code) do nothing;

create or replace function public.canonical_tenant_operation_decision(
  p_company_id uuid,
  p_operation text
)
returns table (
  allowed boolean,
  reason_code text,
  company_status text,
  capability_status text,
  production_status text,
  state_version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_capability text;
  v_capability_row public.company_capabilities%rowtype;
  v_production_status text;
  v_base_allowed boolean := false;
begin
  select * into v_company from public.companies where id = p_company_id;
  if not found then
    return query select false, 'tenant_not_found', null::text, 'missing'::text, null::text, 0::bigint;
    return;
  end if;

  if to_regclass('public.ediel_production_state') is not null then
    execute 'select state from public.ediel_production_state where company_id = $1'
      into v_production_status using p_company_id;
  end if;
  v_production_status := coalesce(v_production_status, v_company.ediel_production_status, v_company.production_status, 'disabled');

  v_capability := case p_operation
    when 'email.send' then 'email_outbound'
    when 'webhook.deliver' then 'webhooks'
    when 'ediel.production.send' then 'ediel_production'
    when 'ediel.test.process' then 'ediel_test'
    when 'customer_automation.execute' then 'customer_automation'
    when 'facility_lookup.execute' then 'facility_lookup'
    when 'contract_channel.sell' then 'website_sales'
    when 'api_client.execute' then 'api_sales'
    else null
  end;

  if v_capability is not null then
    select * into v_capability_row
    from public.company_capabilities
    where company_id = p_company_id and capability_code = v_capability;
  end if;

  v_base_allowed := case coalesce(v_company.status, '__unknown__')
    when 'onboarding' then p_operation in (
      'ediel.test.process','invitation.accept','company_user.manage',
      'production.prepare','production.pause'
    )
    when 'active' then p_operation in (
      'email.send','webhook.deliver','ediel.production.send','ediel.test.process',
      'customer_automation.execute','facility_lookup.execute','invitation.accept',
      'company_user.manage','production.prepare','production.activate',
      'production.pause','production.resume','contract_channel.sell','api_client.execute'
    )
    else false
  end;

  if not v_base_allowed then
    return query select false,
      case coalesce(v_company.status, '__unknown__')
        when 'paused' then 'tenant_paused'
        when 'suspended' then 'tenant_suspended'
        when 'archived' then 'tenant_archived'
        when 'pending_deletion' then 'tenant_pending_deletion'
        when 'closed' then 'tenant_closed'
        when 'deleted_test_only' then 'tenant_deleted_test_only'
        when 'onboarding' then 'operation_not_allowed_during_onboarding'
        else 'tenant_status_unknown'
      end,
      v_company.status,
      case when v_capability is null then 'not_required' else coalesce(v_capability_row.readiness_status, 'missing') end,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if v_capability is not null and not (
    coalesce(v_capability_row.enabled, false)
    and coalesce(v_capability_row.readiness_status, 'missing') = 'ready'
  ) then
    return query select false, 'capability_not_ready', v_company.status,
      coalesce(v_capability_row.readiness_status, 'missing'), v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if p_operation = 'ediel.production.send' and v_production_status <> 'live' then
    return query select false, 'ediel_production_not_live', v_company.status,
      coalesce(v_capability_row.readiness_status, 'missing'), v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  return query select true, 'allowed', v_company.status,
    case when v_capability is null then 'not_required' else coalesce(v_capability_row.readiness_status, 'missing') end,
    v_production_status, v_company.lifecycle_state_version;
end;
$$;

revoke all on function public.canonical_tenant_operation_decision(uuid, text) from public, anon, authenticated;
grant execute on function public.canonical_tenant_operation_decision(uuid, text) to service_role;

create or replace function public.canonical_transition_tenant_lifecycle(
  p_company_id uuid,
  p_target_status text,
  p_expected_state_version bigint,
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
  v_existing jsonb;
  v_changed boolean;
  v_next_version bigint;
  v_event_id uuid;
  v_result jsonb;
  v_allowed boolean := false;
begin
  if p_company_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'company_id_and_idempotency_key_required';
  end if;
  if p_target_status not in (
    'onboarding','active','paused','suspended','archived',
    'pending_deletion','closed','deleted_test_only'
  ) then
    raise exception 'invalid_tenant_target_status:%', p_target_status;
  end if;

  select result_payload into v_existing
  from public.canonical_command_results
  where company_id = p_company_id
    and command_type = 'tenant.lifecycle.transition'
    and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  select * into v_company from public.companies where id = p_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  if p_expected_state_version is not null
     and v_company.lifecycle_state_version <> p_expected_state_version then
    raise exception 'tenant_state_version_conflict:expected=%,actual=%',
      p_expected_state_version, v_company.lifecycle_state_version;
  end if;

  v_changed := v_company.status is distinct from p_target_status;
  if not v_changed then
    v_result := jsonb_build_object(
      'changed', false, 'company_id', p_company_id, 'status', v_company.status,
      'state_version', v_company.lifecycle_state_version
    );
    insert into public.canonical_command_results(
      company_id, command_type, idempotency_key, request_payload,
      result_payload, actor_user_id
    ) values (
      p_company_id, 'tenant.lifecycle.transition', p_idempotency_key,
      jsonb_build_object('target_status', p_target_status, 'reason', p_reason),
      v_result, p_actor_user_id
    ) on conflict do nothing;
    return v_result;
  end if;

  v_allowed := case v_company.status
    when 'onboarding' then p_target_status in ('active','paused','suspended','archived','pending_deletion','closed','deleted_test_only')
    when 'active' then p_target_status in ('paused','suspended','archived','pending_deletion','closed')
    when 'paused' then p_target_status in ('active','suspended','archived','pending_deletion','closed')
    when 'suspended' then p_target_status in ('active','paused','archived','pending_deletion','closed')
    when 'archived' then p_target_status in ('pending_deletion','closed')
    when 'pending_deletion' then p_target_status in ('closed','deleted_test_only')
    when 'closed' then false
    when 'deleted_test_only' then false
    else false
  end;
  if not v_allowed then
    raise exception 'invalid_tenant_lifecycle_transition:%->%', v_company.status, p_target_status;
  end if;

  v_next_version := v_company.lifecycle_state_version + 1;
  update public.companies
  set status = p_target_status,
      lifecycle_state_version = v_next_version,
      lifecycle_last_transition_at = now(),
      lifecycle_last_transition_by = p_actor_user_id,
      lifecycle_last_idempotency_key = p_idempotency_key,
      status_reason = p_reason,
      updated_at = now(),
      closed_at = case when p_target_status = 'closed' then coalesce(closed_at, now()) else closed_at end,
      closed_by = case when p_target_status = 'closed' then coalesce(closed_by, p_actor_user_id) else closed_by end,
      closure_reason = case when p_target_status = 'closed' then coalesce(closure_reason, p_reason) else closure_reason end
  where id = p_company_id;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='is_active') then
    execute 'update public.companies set is_active = $2 where id = $1'
      using p_company_id, p_target_status = 'active';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='is_paused') then
    execute 'update public.companies set is_paused = $2 where id = $1'
      using p_company_id, p_target_status = 'paused';
  end if;

  if p_target_status in ('paused','suspended','archived','pending_deletion','closed')
     and to_regclass('public.company_invitations') is not null then
    update public.company_invitations
    set status = 'invitation_revoked', updated_at = now()
    where company_id = p_company_id and status in ('pending','invited');
  end if;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,state_version,
    actor_user_id,reason,idempotency_key,before_state,after_state
  ) values (
    p_company_id,'TENANT_LIFECYCLE_CHANGED','company',p_company_id,v_next_version,
    p_actor_user_id,p_reason,p_idempotency_key,
    jsonb_build_object('status',v_company.status,'state_version',v_company.lifecycle_state_version),
    jsonb_build_object('status',p_target_status,'state_version',v_next_version)
  );

  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,aggregate_version,
    idempotency_key,payload,created_by
  ) values (
    p_company_id,'TENANT_LIFECYCLE_CHANGED','company',p_company_id,v_next_version,
    p_idempotency_key,
    jsonb_build_object('from_status',v_company.status,'to_status',p_target_status,'reason',p_reason),
    p_actor_user_id
  ) returning id into v_event_id;

  insert into public.canonical_event_outbox(
    company_id,domain_event_id,topic,idempotency_key,payload
  ) values (
    p_company_id,v_event_id,'tenant.lifecycle.changed',p_idempotency_key,
    jsonb_build_object('company_id',p_company_id,'status',p_target_status,'state_version',v_next_version)
  );

  v_result := jsonb_build_object(
    'changed', true, 'company_id', p_company_id,
    'previous_status', v_company.status, 'status', p_target_status,
    'state_version', v_next_version, 'domain_event_id', v_event_id
  );
  insert into public.canonical_command_results(
    company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id
  ) values (
    p_company_id,'tenant.lifecycle.transition',p_idempotency_key,
    jsonb_build_object('target_status',p_target_status,'reason',p_reason),
    v_result,p_actor_user_id
  );
  return v_result;
end;
$$;

revoke all on function public.canonical_transition_tenant_lifecycle(uuid,text,bigint,text,uuid,text) from public, anon, authenticated;
grant execute on function public.canonical_transition_tenant_lifecycle(uuid,text,bigint,text,uuid,text) to service_role;

commit;
