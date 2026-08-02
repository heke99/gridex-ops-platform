-- Canonical security convergence.
-- Forward-only repair: verified actors, request-bound idempotency, canonical
-- readiness, deterministic profile identity and least-privilege internals.

begin;

alter table public.canonical_command_results
  add column if not exists request_hash text;

update public.canonical_command_results
set request_hash = encode(extensions.digest(convert_to(request_payload::text, 'utf8'), 'sha256'::text), 'hex')
where request_hash is null;

alter table public.canonical_command_results
  alter column request_hash set not null;

alter table public.canonical_provisioning_requests
  add column if not exists request_hash text;

update public.canonical_provisioning_requests
set request_hash = encode(extensions.digest(convert_to(request_payload::text, 'utf8'), 'sha256'::text), 'hex')
where request_hash is null;

create or replace function public.canonical_json_sha256(p_payload jsonb)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(convert_to(p_payload::text, 'utf8'), 'sha256'::text), 'hex')
$$;

create or replace function public.canonical_command_request_hash_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text := public.canonical_json_sha256(coalesce(new.request_payload, '{}'::jsonb));
begin
  if new.request_hash is not null and new.request_hash <> v_hash then
    raise exception 'canonical_request_hash_mismatch';
  end if;
  new.request_hash := v_hash;
  return new;
end;
$$;

drop trigger if exists canonical_command_results_request_hash_guard
  on public.canonical_command_results;
create trigger canonical_command_results_request_hash_guard
before insert or update of request_payload, request_hash
on public.canonical_command_results
for each row execute function public.canonical_command_request_hash_guard();

create or replace function public.canonical_actor_is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p_user_id is not null
    and exists (
      select 1
      from auth.users u
      join public.user_profiles up on up.id = u.id
      where u.id = p_user_id
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= now())
        and u.email_confirmed_at is not null
        and up.user_status = 'active'
    )
    and (
      exists (
        select 1
        from public.admin_users au
        where au.user_id = p_user_id
          and coalesce(au.is_active, true)
          and lower(replace(coalesce(au.role, ''), '-', '_'))
            in ('super_admin', 'superadmin', 'platform_admin', 'platformadmin')
      )
      or exists (
        select 1
        from public.user_roles ur
        left join public.roles r on r.id = ur.role_id
        where ur.user_id = p_user_id
          and ur.company_id is null
          and coalesce(ur.is_active, true)
          and coalesce(ur.status, 'active') = 'active'
          and lower(replace(coalesce(ur.role, r.key, r.name, ''), '-', '_'))
            in ('super_admin', 'superadmin', 'platform_admin', 'platformadmin')
      )
    )
$$;

create or replace function public.canonical_actor_is_authorized(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_permission_key text,
  p_platform_only boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.canonical_actor_is_platform_admin(p_actor_user_id)
    or (
      not p_platform_only
      and p_company_id is not null
      and exists (
        select 1
        from auth.users u
        join public.user_profiles up on up.id = u.id
        join public.company_memberships cm
          on cm.user_id = u.id and cm.company_id = p_company_id
        where u.id = p_actor_user_id
          and u.deleted_at is null
          and (u.banned_until is null or u.banned_until <= now())
          and u.email_confirmed_at is not null
          and up.user_status = 'active'
          and cm.status = 'active'
          and coalesce(cm.is_active, true)
          and (
            (
              cm.membership_role in ('owner', 'admin', 'company_admin')
              and p_permission_key in (
                'tenant.user.manage', 'ediel.profile.write',
                'ediel.production.activate', 'ediel.production.pause', 'ediel.send'
              )
            )
            or exists (
              select 1
              from public.user_roles ur
              join public.roles r on r.id = ur.role_id
              join public.role_permissions rp on rp.role_id = r.id
              join public.permissions p on p.id = rp.permission_id
              where ur.user_id = p_actor_user_id
                and ur.company_id = p_company_id
                and coalesce(ur.is_active, true)
                and coalesce(ur.status, 'active') = 'active'
                and p.key = p_permission_key
            )
          )
      )
    )
$$;

revoke all on function public.canonical_json_sha256(jsonb) from public, anon, authenticated;
revoke all on function public.canonical_command_request_hash_guard() from public, anon, authenticated, service_role;
revoke all on function public.canonical_actor_is_platform_admin(uuid) from public, anon, authenticated;
revoke all on function public.canonical_actor_is_authorized(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.canonical_json_sha256(jsonb) to service_role;
grant execute on function public.canonical_actor_is_platform_admin(uuid) to service_role;
grant execute on function public.canonical_actor_is_authorized(uuid, uuid, text, boolean) to service_role;

create table if not exists public.canonical_ediel_profile_identities (
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null,
  actor_role text not null,
  profile_id uuid not null references public.ediel_actor_settings(id) on delete restrict,
  bound_at timestamptz not null default now(),
  bound_by uuid references auth.users(id) on delete set null,
  primary key (company_id, environment, actor_role),
  unique (profile_id),
  constraint canonical_ediel_profile_identity_environment_check
    check (environment in ('test', 'production'))
);

insert into public.canonical_ediel_profile_identities(company_id, environment, actor_role, profile_id)
select company_id, environment, lower(coalesce(role, actor_role)), min(id::text)::uuid
from public.ediel_actor_settings
where environment in ('test', 'production') and is_active = true
  and nullif(lower(coalesce(role, actor_role)), '') is not null
group by company_id, environment, lower(coalesce(role, actor_role))
having count(*) = 1
on conflict (company_id, environment, actor_role) do nothing;

alter table public.canonical_ediel_profile_identities enable row level security;
drop policy if exists canonical_ediel_profile_identities_service_role_all
  on public.canonical_ediel_profile_identities;
create policy canonical_ediel_profile_identities_service_role_all
on public.canonical_ediel_profile_identities
for all to service_role using (true) with check (true);
drop policy if exists canonical_ediel_profile_identities_tenant_read
  on public.canonical_ediel_profile_identities;
create policy canonical_ediel_profile_identities_tenant_read
on public.canonical_ediel_profile_identities
for select to authenticated using (public.gridex_can_read_company(company_id));
revoke all on public.canonical_ediel_profile_identities from anon, authenticated;
grant all on public.canonical_ediel_profile_identities to service_role;
grant select on public.canonical_ediel_profile_identities to authenticated;

create table if not exists public.canonical_readiness_shadow_comparisons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  canonical_ready boolean not null,
  legacy_ready boolean,
  configuration_snapshot_id uuid references public.ediel_configuration_snapshots(id) on delete restrict,
  canonical_result jsonb not null,
  legacy_result jsonb,
  differs boolean generated always as (legacy_ready is distinct from canonical_ready) stored,
  compared_at timestamptz not null default now(),
  compared_by uuid references auth.users(id) on delete set null
);

create index if not exists canonical_readiness_shadow_company_time_idx
  on public.canonical_readiness_shadow_comparisons(company_id, compared_at desc);
alter table public.canonical_readiness_shadow_comparisons enable row level security;
drop policy if exists canonical_readiness_shadow_service_role_all
  on public.canonical_readiness_shadow_comparisons;
create policy canonical_readiness_shadow_service_role_all
on public.canonical_readiness_shadow_comparisons
for all to service_role using (true) with check (true);
drop policy if exists canonical_readiness_shadow_platform_read
  on public.canonical_readiness_shadow_comparisons;
create policy canonical_readiness_shadow_platform_read
on public.canonical_readiness_shadow_comparisons
for select to authenticated using (public.gridex_user_is_platform_admin());
revoke all on public.canonical_readiness_shadow_comparisons from anon, authenticated;
grant all on public.canonical_readiness_shadow_comparisons to service_role;
grant select on public.canonical_readiness_shadow_comparisons to authenticated;

create or replace function public.canonical_company_readiness(
  p_company_id uuid,
  p_configuration_snapshot_id uuid default null,
  p_readiness_check_id uuid default null,
  p_dry_run_id uuid default null,
  p_target_state text default 'prepared'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_status text;
  v_snapshot_id uuid;
  v_snapshot_hash text;
  v_latest_snapshot_id uuid;
  v_active_profile_count bigint;
  v_active_route_count bigint;
  v_check public.ediel_production_readiness_checks%rowtype;
  v_dry_run public.ediel_go_live_events%rowtype;
  v_blockers jsonb := '[]'::jsonb;
begin
  select status into v_company_status from public.companies where id = p_company_id;
  if not found then
    return jsonb_build_object('ready', false, 'company_id', p_company_id,
      'target_state', p_target_state, 'blockers', jsonb_build_array('tenant_not_found'));
  end if;

  if v_company_status <> 'active' then
    v_blockers := v_blockers || jsonb_build_array('tenant_not_active');
  end if;

  select id, configuration_hash into v_latest_snapshot_id, v_snapshot_hash
  from public.ediel_configuration_snapshots
  where company_id = p_company_id
  order by snapshot_version desc
  limit 1;
  v_snapshot_id := coalesce(p_configuration_snapshot_id, v_latest_snapshot_id);
  if v_snapshot_id is null then
    v_blockers := v_blockers || jsonb_build_array('configuration_snapshot_missing');
  elsif v_snapshot_id is distinct from v_latest_snapshot_id then
    v_blockers := v_blockers || jsonb_build_array('configuration_snapshot_stale');
  end if;

  select count(*) into v_active_profile_count
  from public.ediel_actor_settings
  where company_id = p_company_id and environment = 'production' and is_active = true
    and lower(coalesce(role, actor_role)) in ('supplier', 'electricity_supplier');
  if v_active_profile_count <> 1 then
    v_blockers := v_blockers || jsonb_build_array('production_profile_identity_ambiguous');
  elsif not exists (
    select 1 from public.canonical_ediel_profile_identities i
    join public.ediel_actor_settings a on a.id = i.profile_id
    where i.company_id = p_company_id and i.environment = 'production'
      and i.actor_role in ('supplier', 'electricity_supplier')
      and a.company_id = i.company_id and a.environment = i.environment
      and lower(coalesce(a.role, a.actor_role)) = i.actor_role
      and a.is_active = true
  ) then
    v_blockers := v_blockers || jsonb_build_array('production_profile_identity_missing');
  end if;

  select count(*) into v_active_route_count
  from public.ediel_route_profiles
  where company_id = p_company_id and environment = 'production'
    and coalesce(is_active, false) and coalesce(is_enabled, false);
  if v_active_route_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('production_route_missing');
  end if;

  if p_readiness_check_id is null then
    v_blockers := v_blockers || jsonb_build_array('readiness_check_missing');
  else
    select * into v_check from public.ediel_production_readiness_checks
    where id = p_readiness_check_id and company_id = p_company_id;
    if not found
       or v_check.status not in ('ready', 'warning', 'live')
       or jsonb_array_length(coalesce(v_check.blocking_issues, '[]'::jsonb)) > 0
       or coalesce(v_check.is_stale, false)
       or v_check.configuration_snapshot_id is distinct from v_snapshot_id then
      v_blockers := v_blockers || jsonb_build_array('readiness_check_invalid_or_stale');
    end if;
  end if;

  if p_target_state = 'live' then
    if p_dry_run_id is null then
      v_blockers := v_blockers || jsonb_build_array('production_dry_run_missing');
    else
      select * into v_dry_run from public.ediel_go_live_events
      where id = p_dry_run_id and company_id = p_company_id
        and event_type = 'production_dry_run';
      if not found
         or v_dry_run.to_status not in ('allowed', 'warning')
         or coalesce(v_dry_run.is_stale, false)
         or v_dry_run.configuration_snapshot_id is distinct from v_snapshot_id
         or coalesce(v_dry_run.expires_at, v_dry_run.created_at + interval '24 hours') <= now() then
        v_blockers := v_blockers || jsonb_build_array('production_dry_run_invalid_or_stale');
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'company_id', p_company_id,
    'company_status', v_company_status,
    'target_state', p_target_state,
    'configuration_snapshot_id', v_snapshot_id,
    'configuration_hash', v_snapshot_hash,
    'readiness_check_id', p_readiness_check_id,
    'dry_run_id', p_dry_run_id,
    'active_production_profiles', v_active_profile_count,
    'active_production_routes', v_active_route_count,
    'blockers', v_blockers
  );
end;
$$;

revoke all on function public.canonical_company_readiness(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_company_readiness(uuid, uuid, uuid, uuid, text)
  to service_role;

alter function public.canonical_transition_tenant_lifecycle(uuid, text, bigint, text, uuid, text)
  rename to canonical_transition_tenant_lifecycle_v1_unchecked;
revoke all on function public.canonical_transition_tenant_lifecycle_v1_unchecked(uuid, text, bigint, text, uuid, text)
  from public, anon, authenticated, service_role;

create function public.canonical_transition_tenant_lifecycle(
  p_company_id uuid, p_target_status text, p_expected_state_version bigint,
  p_reason text, p_actor_user_id uuid, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request jsonb := jsonb_build_object(
    'target_status', p_target_status, 'expected_state_version', p_expected_state_version,
    'reason', p_reason
  );
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(p_company_id, p_actor_user_id, 'tenant.lifecycle.transition', true) then
    raise exception 'actor_not_authorized_for_tenant_lifecycle';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':tenant.lifecycle.transition:' || p_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = p_company_id and command_type = 'tenant.lifecycle.transition'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  v_result := public.canonical_transition_tenant_lifecycle_v1_unchecked(
    p_company_id, p_target_status, p_expected_state_version, p_reason, p_actor_user_id, p_idempotency_key
  );
  update public.canonical_command_results set request_payload = v_request
  where company_id = p_company_id and command_type = 'tenant.lifecycle.transition'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function public.canonical_transition_tenant_lifecycle(uuid, text, bigint, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_transition_tenant_lifecycle(uuid, text, bigint, text, uuid, text)
  to service_role;

alter function public.canonical_transition_ediel_production(uuid, text, bigint, uuid, uuid, uuid, text, uuid, text)
  rename to canonical_transition_ediel_production_v1_unchecked;
revoke all on function public.canonical_transition_ediel_production_v1_unchecked(uuid, text, bigint, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;

create function public.canonical_transition_ediel_production(
  p_company_id uuid, p_target_state text, p_expected_state_version bigint,
  p_configuration_snapshot_id uuid, p_readiness_check_id uuid, p_dry_run_id uuid,
  p_reason text, p_actor_user_id uuid, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permission text := case when p_target_state = 'paused' then 'ediel.production.pause' else 'ediel.production.activate' end;
  v_request jsonb := jsonb_build_object(
    'target_state', p_target_state, 'expected_state_version', p_expected_state_version,
    'configuration_snapshot_id', p_configuration_snapshot_id,
    'readiness_check_id', p_readiness_check_id, 'dry_run_id', p_dry_run_id,
    'reason', p_reason
  );
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_readiness jsonb;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(p_company_id, p_actor_user_id, v_permission, false) then
    raise exception 'actor_not_authorized_for_ediel_production_transition';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ediel.production.transition:' || p_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = p_company_id and command_type = 'ediel.production.transition'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  if p_target_state in ('prepared', 'live') then
    v_readiness := public.canonical_company_readiness(
      p_company_id, p_configuration_snapshot_id, p_readiness_check_id,
      p_dry_run_id, p_target_state
    );
    if coalesce((v_readiness->>'ready')::boolean, false) is not true then
      raise exception 'canonical_readiness_blocked:%', v_readiness->'blockers';
    end if;
  end if;
  v_result := public.canonical_transition_ediel_production_v1_unchecked(
    p_company_id, p_target_state, p_expected_state_version,
    p_configuration_snapshot_id, p_readiness_check_id, p_dry_run_id,
    p_reason, p_actor_user_id, p_idempotency_key
  );
  update public.canonical_command_results set request_payload = v_request
  where company_id = p_company_id and command_type = 'ediel.production.transition'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function public.canonical_transition_ediel_production(uuid, text, bigint, uuid, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_transition_ediel_production(uuid, text, bigint, uuid, uuid, uuid, text, uuid, text)
  to service_role;

alter function public.canonical_approve_first_live_send(uuid, uuid, uuid, text)
  rename to canonical_approve_first_live_send_v1_unchecked;
revoke all on function public.canonical_approve_first_live_send_v1_unchecked(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

create function public.canonical_approve_first_live_send(
  p_company_id uuid, p_readiness_check_id uuid, p_actor_user_id uuid, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request jsonb := jsonb_build_object('readiness_check_id', p_readiness_check_id);
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(p_company_id, p_actor_user_id, 'ediel.send', false) then
    raise exception 'actor_not_authorized_for_first_live_send';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':ediel.production.first_live_send.approve', 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = p_company_id and command_type = 'ediel.production.first_live_send.approve'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  if exists (
    select 1 from public.ediel_production_state
    where company_id = p_company_id and first_live_send_approved_at is not null
  ) then raise exception 'first_live_send_already_approved'; end if;
  v_result := public.canonical_approve_first_live_send_v1_unchecked(
    p_company_id, p_readiness_check_id, p_actor_user_id, p_idempotency_key
  );
  update public.canonical_command_results set request_payload = v_request
  where company_id = p_company_id and command_type = 'ediel.production.first_live_send.approve'
    and idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function public.canonical_approve_first_live_send(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_approve_first_live_send(uuid, uuid, uuid, text)
  to service_role;

alter function public.canonical_capture_ediel_configuration_snapshot(uuid, uuid, text)
  rename to canonical_capture_ediel_configuration_snapshot_v1_unchecked;
revoke all on function public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create function public.canonical_capture_ediel_configuration_snapshot(
  p_company_id uuid, p_actor_user_id uuid, p_reason text
)
returns public.ediel_configuration_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.canonical_actor_is_authorized(p_company_id, p_actor_user_id, 'ediel.profile.write', false) then
    raise exception 'actor_not_authorized_for_configuration_snapshot';
  end if;
  return public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
    p_company_id, p_actor_user_id, p_reason
  );
end;
$$;
revoke all on function public.canonical_capture_ediel_configuration_snapshot(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_capture_ediel_configuration_snapshot(uuid, uuid, text)
  to service_role;

alter function public.canonical_save_ediel_actor_profile(jsonb)
  rename to canonical_save_ediel_actor_profile_v1_unchecked;
revoke all on function public.canonical_save_ediel_actor_profile_v1_unchecked(jsonb)
  from public, anon, authenticated, service_role;

-- Replace the legacy single-profile-per-environment writer with a role-aware
-- implementation. A tenant can be both supplier and ESCO in the same
-- environment; one role must never deactivate another role's profile.
create or replace function public.canonical_save_ediel_actor_profile_v1_unchecked(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_actor_role text := lower(nullif(btrim(p_command->>'actor_role'), ''));
  v_environment text;
  v_ediel_id text;
  v_profile_id uuid;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_existing jsonb;
  v_result jsonb;
begin
  if v_company_id is null or nullif(btrim(v_idempotency_key), '') is null then
    raise exception 'company_id_and_idempotency_key_required';
  end if;
  if v_actor_role is null or v_actor_role not in (
    'supplier', 'electricity_supplier', 'grid_owner', 'energy_service_company',
    'balance_responsible_party', 'brp', 'system_supplier',
    'metering_point_operator', 'metering_data_responsible'
  ) then
    raise exception 'unsupported_actor_role:%', coalesce(v_actor_role, 'null');
  end if;

  select result_payload into v_existing
  from public.canonical_command_results
  where company_id = v_company_id
    and command_type = 'ediel.actor_profile.save'
    and idempotency_key = v_idempotency_key;
  if found then return v_existing; end if;

  perform 1 from public.companies where id = v_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  perform set_config('gridex.skip_ediel_snapshot_trigger', 'on', true);

  -- Company-level Ediel fields describe the primary supplier identity. Other
  -- market roles are stored in actor profiles and must not overwrite it.
  if v_actor_role in ('supplier', 'electricity_supplier') then
    update public.companies set
      org_number = nullif(p_command->>'organization_number', ''),
      market_role = v_actor_role,
      actor_role = v_actor_role,
      ediel_id = nullif(upper(p_command->>'ediel_id'), ''),
      test_ediel_id = nullif(upper(p_command->>'test_ediel_id'), ''),
      production_ediel_id = nullif(upper(p_command->>'production_ediel_id'), ''),
      test_sender_sub_address = nullif(p_command->>'test_sender_sub_address', ''),
      production_sender_sub_address = nullif(p_command->>'production_sender_sub_address', ''),
      test_mailbox = nullif(p_command->>'test_mailbox', ''),
      production_mailbox = nullif(p_command->>'production_mailbox', ''),
      test_application_reference = nullif(upper(p_command->>'test_application_reference'), ''),
      production_application_reference = nullif(upper(p_command->>'production_application_reference'), ''),
      test_counterparty_ediel_id = nullif(upper(p_command->>'test_counterparty_ediel_id'), ''),
      production_counterparty_ediel_id = nullif(upper(p_command->>'production_counterparty_ediel_id'), ''),
      brp_name = nullif(p_command->>'brp_name', ''),
      brp_ediel_id = nullif(upper(p_command->>'brp_ediel_id'), ''),
      brp_status = coalesce(nullif(p_command->>'brp_status', ''), 'missing'),
      esett_status = coalesce(nullif(p_command->>'esett_status', ''), 'missing'),
      technical_contact_name = nullif(p_command->>'technical_contact_name', ''),
      technical_contact_email = nullif(p_command->>'technical_contact_email', ''),
      support_email = nullif(p_command->>'support_email', ''),
      billing_contact_email = nullif(p_command->>'billing_contact_email', ''),
      updated_at = now()
    where id = v_company_id;
  end if;

  foreach v_environment in array array['test', 'production'] loop
    v_ediel_id := nullif(upper(p_command->>(v_environment || '_ediel_id')), '');

    select a.id into v_profile_id
    from public.canonical_ediel_profile_identities i
    join public.ediel_actor_settings a on a.id = i.profile_id
    where i.company_id = v_company_id
      and i.environment = v_environment
      and i.actor_role = v_actor_role
      and a.company_id = i.company_id
      and a.environment = i.environment
      and lower(coalesce(a.role, a.actor_role)) = i.actor_role
      and a.is_active = true
    for update of a;

    if v_profile_id is null then
      select id into v_profile_id
      from public.ediel_actor_settings
      where company_id = v_company_id
        and environment = v_environment
        and lower(coalesce(role, actor_role)) = v_actor_role
        and is_active = true
      order by updated_at desc, id desc
      limit 1
      for update;
    end if;

    update public.ediel_actor_settings
    set is_active = false, updated_by = v_actor_user_id, updated_at = now()
    where company_id = v_company_id
      and environment = v_environment
      and lower(coalesce(role, actor_role)) = v_actor_role
      and is_active = true
      and id is distinct from v_profile_id;

    if v_ediel_id is null then
      update public.ediel_actor_settings
      set is_active = false, updated_by = v_actor_user_id, updated_at = now()
      where id = v_profile_id and company_id = v_company_id;
      delete from public.canonical_ediel_profile_identities
      where company_id = v_company_id and environment = v_environment
        and actor_role = v_actor_role;
      v_profile_id := null;
      continue;
    end if;

    if v_profile_id is null then
      insert into public.ediel_actor_settings(
        company_id, actor_name, sender_name, actor_role, role,
        actor_ediel_id, ediel_id, environment, is_active,
        sender_sub_address, sender_subaddress,
        default_application_reference, application_reference, mailbox,
        default_charset, default_timezone, default_test_flag,
        smtp_from_email, smtp_reply_to_email,
        brp_name, brp_ediel_id, brp_status, esett_status,
        created_by, updated_by, created_at, updated_at
      ) values (
        v_company_id, coalesce(nullif(p_command->>'company_name', ''), 'Aktör'),
        coalesce(nullif(p_command->>'company_name', ''), 'Aktör'),
        v_actor_role, v_actor_role, v_ediel_id, v_ediel_id,
        v_environment, true,
        nullif(p_command->>(v_environment || '_sender_sub_address'), ''),
        nullif(p_command->>(v_environment || '_sender_sub_address'), ''),
        nullif(upper(p_command->>(v_environment || '_application_reference')), ''),
        nullif(upper(p_command->>(v_environment || '_application_reference')), ''),
        nullif(p_command->>(v_environment || '_mailbox'), ''),
        'UNOC', 1, case when v_environment = 'production' then 0 else 1 end,
        nullif(p_command->>'smtp_from_email', ''),
        nullif(p_command->>'smtp_from_email', ''),
        nullif(p_command->>'brp_name', ''),
        nullif(upper(p_command->>'brp_ediel_id'), ''),
        coalesce(nullif(p_command->>'brp_status', ''), 'missing'),
        coalesce(nullif(p_command->>'esett_status', ''), 'missing'),
        v_actor_user_id, v_actor_user_id, now(), now()
      ) returning id into v_profile_id;
    else
      update public.ediel_actor_settings set
        actor_name = coalesce(nullif(p_command->>'company_name', ''), 'Aktör'),
        sender_name = coalesce(nullif(p_command->>'company_name', ''), 'Aktör'),
        actor_role = v_actor_role,
        role = v_actor_role,
        actor_ediel_id = v_ediel_id,
        ediel_id = v_ediel_id,
        is_active = true,
        sender_sub_address = nullif(p_command->>(v_environment || '_sender_sub_address'), ''),
        sender_subaddress = nullif(p_command->>(v_environment || '_sender_sub_address'), ''),
        default_application_reference = nullif(upper(p_command->>(v_environment || '_application_reference')), ''),
        application_reference = nullif(upper(p_command->>(v_environment || '_application_reference')), ''),
        mailbox = nullif(p_command->>(v_environment || '_mailbox'), ''),
        default_test_flag = case when v_environment = 'production' then 0 else 1 end,
        smtp_from_email = nullif(p_command->>'smtp_from_email', ''),
        smtp_reply_to_email = nullif(p_command->>'smtp_from_email', ''),
        brp_name = nullif(p_command->>'brp_name', ''),
        brp_ediel_id = nullif(upper(p_command->>'brp_ediel_id'), ''),
        brp_status = coalesce(nullif(p_command->>'brp_status', ''), 'missing'),
        esett_status = coalesce(nullif(p_command->>'esett_status', ''), 'missing'),
        updated_by = v_actor_user_id,
        updated_at = now()
      where id = v_profile_id and company_id = v_company_id;
    end if;

    insert into public.canonical_ediel_profile_identities(
      company_id, environment, actor_role, profile_id, bound_by
    ) values (
      v_company_id, v_environment, v_actor_role, v_profile_id, v_actor_user_id
    )
    on conflict (company_id, environment, actor_role) do update
    set profile_id = excluded.profile_id, bound_at = now(), bound_by = excluded.bound_by;
  end loop;

  perform set_config('gridex.skip_ediel_snapshot_trigger', 'off', true);
  v_snapshot := public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
    v_company_id, v_actor_user_id, 'actor_profile_updated'
  );

  insert into public.canonical_audit_events(
    company_id, event_type, aggregate_type, aggregate_id, actor_user_id,
    reason, idempotency_key, after_state, metadata
  ) values (
    v_company_id, 'EDIEL_ACTOR_PROFILE_UPDATED', 'company', v_company_id,
    v_actor_user_id, 'Aktörsprofil uppdaterad atomiskt.', v_idempotency_key,
    jsonb_build_object(
      'actor_role', v_actor_role,
      'configuration_snapshot_id', v_snapshot.id,
      'configuration_hash', v_snapshot.configuration_hash
    ), p_command
  );

  v_result := jsonb_build_object(
    'changed', true,
    'company_id', v_company_id,
    'actor_role', v_actor_role,
    'configuration_snapshot_id', v_snapshot.id,
    'configuration_hash', v_snapshot.configuration_hash
  );
  insert into public.canonical_command_results(
    company_id, command_type, idempotency_key,
    request_payload, result_payload, actor_user_id
  ) values (
    v_company_id, 'ediel.actor_profile.save', v_idempotency_key,
    p_command, v_result, v_actor_user_id
  );
  return v_result;
end;
$$;
revoke all on function public.canonical_save_ediel_actor_profile_v1_unchecked(jsonb)
  from public, anon, authenticated, service_role;

create function public.canonical_save_ediel_actor_profile(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_company public.companies%rowtype;
  v_actor_role text;
  v_environment text;
  v_profile public.ediel_actor_settings%rowtype;
  v_profile_count bigint;
  v_requested_profile_id uuid;
  v_defaults jsonb;
  v_command jsonb;
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_latest_snapshot public.ediel_configuration_snapshots%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(v_company_id, v_actor_user_id, 'ediel.profile.write', false) then
    raise exception 'actor_not_authorized_for_ediel_profile';
  end if;
  if nullif(btrim(v_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':ediel.actor_profile.save:' || v_idempotency_key, 0));
  select * into v_company from public.companies where id = v_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  v_actor_role := lower(nullif(btrim(p_command->>'actor_role'), ''));
  if v_actor_role is null or v_actor_role not in (
    'supplier', 'electricity_supplier', 'grid_owner', 'energy_service_company',
    'balance_responsible_party', 'brp', 'system_supplier',
    'metering_point_operator', 'metering_data_responsible'
  ) then
    raise exception 'unsupported_actor_role:%', coalesce(v_actor_role, 'null');
  end if;

  v_defaults := jsonb_build_object(
    'company_id', v_company_id, 'company_name', v_company.name,
    'organization_number', v_company.org_number,
    'actor_role', v_actor_role,
    'ediel_id', v_company.ediel_id,
    'test_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_ediel_id end,
    'production_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_ediel_id end,
    'test_sender_sub_address', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_sender_sub_address end,
    'production_sender_sub_address', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_sender_sub_address end,
    'test_mailbox', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_mailbox end,
    'production_mailbox', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_mailbox end,
    'test_application_reference', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_application_reference end,
    'production_application_reference', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_application_reference end,
    'test_counterparty_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.test_counterparty_ediel_id end,
    'production_counterparty_ediel_id', case when v_actor_role in ('supplier', 'electricity_supplier') then v_company.production_counterparty_ediel_id end,
    'brp_name', v_company.brp_name, 'brp_ediel_id', v_company.brp_ediel_id,
    'brp_status', v_company.brp_status, 'esett_status', v_company.esett_status,
    'technical_contact_name', v_company.technical_contact_name,
    'technical_contact_email', v_company.technical_contact_email,
    'support_email', v_company.support_email,
    'billing_contact_email', v_company.billing_contact_email
  );

  foreach v_environment in array array['test', 'production'] loop
    select count(*) into v_profile_count from public.ediel_actor_settings
    where company_id = v_company_id and environment = v_environment and is_active = true
      and lower(coalesce(role, actor_role)) = v_actor_role;
    if v_profile_count > 1 then
      raise exception 'active_ediel_profile_identity_ambiguous:%', v_environment;
    end if;
    select a.* into v_profile
    from public.canonical_ediel_profile_identities i
    join public.ediel_actor_settings a on a.id = i.profile_id
    where i.company_id = v_company_id and i.environment = v_environment
      and i.actor_role = v_actor_role
      and a.company_id = i.company_id and a.environment = i.environment
      and lower(coalesce(a.role, a.actor_role)) = i.actor_role
      and a.is_active = true;
    if not found and v_profile_count = 1 then
      select * into v_profile from public.ediel_actor_settings
      where company_id = v_company_id and environment = v_environment and is_active = true
        and lower(coalesce(role, actor_role)) = v_actor_role;
      insert into public.canonical_ediel_profile_identities(company_id, environment, actor_role, profile_id, bound_by)
      values(v_company_id, v_environment, v_actor_role, v_profile.id, v_actor_user_id)
      on conflict (company_id, environment, actor_role) do update
      set profile_id = excluded.profile_id, bound_at = now(), bound_by = excluded.bound_by;
    end if;
    if p_command ? (v_environment || '_profile_id') then
      v_requested_profile_id := nullif(p_command->>(v_environment || '_profile_id'), '')::uuid;
      if v_profile.id is distinct from v_requested_profile_id then
        raise exception 'canonical_profile_identity_mismatch:%', v_environment;
      end if;
    end if;
    if v_profile.id is not null then
      v_defaults := v_defaults || jsonb_build_object(
        v_environment || '_profile_id', v_profile.id,
        v_environment || '_ediel_id', coalesce(v_profile.actor_ediel_id, v_profile.ediel_id),
        v_environment || '_sender_sub_address', coalesce(v_profile.sender_sub_address, v_profile.sender_subaddress),
        v_environment || '_application_reference', coalesce(v_profile.application_reference, v_profile.default_application_reference),
        v_environment || '_mailbox', v_profile.mailbox,
        'actor_role', coalesce(v_defaults->>'actor_role', v_profile.actor_role, v_profile.role),
        'brp_name', coalesce(v_defaults->>'brp_name', v_profile.brp_name),
        'brp_ediel_id', coalesce(v_defaults->>'brp_ediel_id', v_profile.brp_ediel_id),
        'brp_status', coalesce(v_defaults->>'brp_status', v_profile.brp_status),
        'esett_status', coalesce(v_defaults->>'esett_status', v_profile.esett_status),
        'smtp_from_email', v_profile.smtp_from_email
      );
    end if;
    v_profile := null;
    v_requested_profile_id := null;
  end loop;

  v_command := v_defaults || p_command;
  v_hash := public.canonical_json_sha256(v_command - 'actor_user_id');
  select * into v_existing from public.canonical_command_results
  where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from v_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;

  v_result := public.canonical_save_ediel_actor_profile_v1_unchecked(v_command);
  update public.canonical_command_results
  set request_payload = v_command - 'actor_user_id'
  where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
    and idempotency_key = v_idempotency_key;

  foreach v_environment in array array['test', 'production'] loop
    update public.ediel_actor_settings a
    set actor_name = case when v_command ? (v_environment || '_actor_name')
          then nullif(v_command->>(v_environment || '_actor_name'), '') else a.actor_name end,
        legal_name = case when v_command ? (v_environment || '_actor_name')
          then nullif(v_command->>(v_environment || '_actor_name'), '') else a.legal_name end,
        sender_name = case when v_command ? (v_environment || '_sender_name')
          then nullif(v_command->>(v_environment || '_sender_name'), '') else a.sender_name end,
        organization_number = case when v_command ? (v_environment || '_organization_number')
          then nullif(v_command->>(v_environment || '_organization_number'), '') else a.organization_number end,
        sender_subaddress_prodat = case when v_command ? (v_environment || '_sender_subaddress_prodat')
          then nullif(v_command->>(v_environment || '_sender_subaddress_prodat'), '') else a.sender_subaddress_prodat end,
        sender_subaddress_utilts = case when v_command ? (v_environment || '_sender_subaddress_utilts')
          then nullif(v_command->>(v_environment || '_sender_subaddress_utilts'), '') else a.sender_subaddress_utilts end,
        receiver_subaddress = case when v_command ? (v_environment || '_receiver_subaddress')
          then nullif(v_command->>(v_environment || '_receiver_subaddress'), '') else a.receiver_subaddress end,
        smtp_reply_to_email = case when v_command ? (v_environment || '_smtp_reply_to_email')
          then nullif(v_command->>(v_environment || '_smtp_reply_to_email'), '') else a.smtp_reply_to_email end,
        default_transport_channel = case when v_command ? (v_environment || '_default_transport_channel')
          then nullif(v_command->>(v_environment || '_default_transport_channel'), '') else a.default_transport_channel end,
        default_timezone = case when v_command ? (v_environment || '_default_timezone')
          then (v_command->>(v_environment || '_default_timezone'))::integer else a.default_timezone end,
        default_charset = case when v_command ? (v_environment || '_default_charset')
          then nullif(upper(v_command->>(v_environment || '_default_charset')), '') else a.default_charset end,
        default_test_flag = case when v_command ? (v_environment || '_default_test_flag')
          then (v_command->>(v_environment || '_default_test_flag'))::integer else a.default_test_flag end,
        production_status = case when v_command ? (v_environment || '_production_status')
          then nullif(v_command->>(v_environment || '_production_status'), '') else a.production_status end,
        test_status = case when v_command ? (v_environment || '_test_status')
          then nullif(v_command->>(v_environment || '_test_status'), '') else a.test_status end,
        notes = case when v_command ? (v_environment || '_notes')
          then nullif(v_command->>(v_environment || '_notes'), '') else a.notes end,
        valid_from = case when v_command ? (v_environment || '_valid_from')
          then nullif(v_command->>(v_environment || '_valid_from'), '')::date else a.valid_from end,
        valid_to = case when v_command ? (v_environment || '_valid_to')
          then nullif(v_command->>(v_environment || '_valid_to'), '')::date else a.valid_to end,
        is_active = case when v_command ? (v_environment || '_is_active')
          then coalesce((v_command->>(v_environment || '_is_active'))::boolean, false) else a.is_active end,
        updated_by = v_actor_user_id,
        updated_at = now()
    from public.canonical_ediel_profile_identities i
    where i.company_id = v_company_id and i.environment = v_environment
      and i.actor_role = v_actor_role
      and i.profile_id = a.id and a.company_id = i.company_id and a.environment = i.environment;

    select count(*) into v_profile_count from public.ediel_actor_settings
    where company_id = v_company_id and environment = v_environment and is_active = true
      and lower(coalesce(role, actor_role)) = v_actor_role;
    if v_profile_count > 1 then raise exception 'active_ediel_profile_identity_ambiguous:%', v_environment; end if;
    if v_profile_count = 1 then
      select * into v_profile from public.ediel_actor_settings
      where company_id = v_company_id and environment = v_environment and is_active = true
        and lower(coalesce(role, actor_role)) = v_actor_role;
      insert into public.canonical_ediel_profile_identities(company_id, environment, actor_role, profile_id, bound_by)
      values(v_company_id, v_environment, v_actor_role, v_profile.id, v_actor_user_id)
      on conflict (company_id, environment, actor_role) do update
      set profile_id = excluded.profile_id, bound_at = now(), bound_by = excluded.bound_by;
    else
      delete from public.canonical_ediel_profile_identities
      where company_id = v_company_id and environment = v_environment
        and actor_role = v_actor_role;
    end if;
    v_profile := null;
  end loop;
  if v_command ? 'production_primary_route_id' or v_command ? 'test_primary_route_id' then
    update public.companies
    set ediel_primary_production_route_profile_id = case
          when v_command ? 'production_primary_route_id'
            then nullif(v_command->>'production_primary_route_id', '')::uuid
          else ediel_primary_production_route_profile_id end,
        ediel_primary_test_route_profile_id = case
          when v_command ? 'test_primary_route_id'
            then nullif(v_command->>'test_primary_route_id', '')::uuid
          else ediel_primary_test_route_profile_id end,
        updated_at = now()
    where id = v_company_id;
    perform public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
      v_company_id, v_actor_user_id, 'canonical_primary_route_changed'
    );
  end if;
  select * into v_latest_snapshot from public.ediel_configuration_snapshots
  where company_id = v_company_id order by snapshot_version desc limit 1;
  if found then
    v_result := v_result || jsonb_build_object(
      'configuration_snapshot_id', v_latest_snapshot.id,
      'configuration_hash', v_latest_snapshot.configuration_hash
    );
    update public.canonical_command_results set result_payload = v_result
    where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
      and idempotency_key = v_idempotency_key;
  end if;
  return v_result;
end;
$$;
revoke all on function public.canonical_save_ediel_actor_profile(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_save_ediel_actor_profile(jsonb) to service_role;

alter function public.canonical_provision_company(jsonb)
  rename to canonical_provision_company_v1_unchecked;
revoke all on function public.canonical_provision_company_v1_unchecked(jsonb)
  from public, anon, authenticated, service_role;

create function public.canonical_provision_company(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_hash text;
  v_existing public.canonical_provisioning_requests%rowtype;
  v_command jsonb := p_command;
  v_result jsonb;
  v_company_id uuid;
begin
  if not public.canonical_actor_is_platform_admin(v_actor_user_id) then
    raise exception 'actor_not_authorized_for_tenant_provisioning';
  end if;
  if nullif(btrim(v_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('tenant.provision:' || v_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(p_command - 'actor_user_id');
  select * into v_existing from public.canonical_provisioning_requests
  where idempotency_key = v_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    if v_existing.result_payload is null then raise exception 'tenant_provisioning_request_in_progress'; end if;
    return v_existing.result_payload;
  end if;
  if nullif(v_command->>'company_id', '') is null then
    v_command := v_command || jsonb_build_object('company_id', gen_random_uuid());
  end if;
  v_result := public.canonical_provision_company_v1_unchecked(v_command);
  v_company_id := (v_result->>'company_id')::uuid;
  update public.companies
  set customer_number_prefix = nullif(upper(v_command->>'customer_number_prefix'), ''),
      updated_at = now()
  where id = v_company_id;
  update public.canonical_provisioning_requests
  set request_payload = p_command - 'actor_user_id', request_hash = v_hash
  where idempotency_key = v_idempotency_key;
  update public.canonical_command_results
  set request_payload = p_command - 'actor_user_id'
  where company_id = v_company_id and command_type = 'tenant.provision'
    and idempotency_key = v_idempotency_key;
  return v_result;
end;
$$;
revoke all on function public.canonical_provision_company(jsonb) from public, anon, authenticated;
grant execute on function public.canonical_provision_company(jsonb) to service_role;

alter function public.canonical_change_tenant_user_access(jsonb)
  rename to canonical_change_tenant_user_access_v1_unchecked;
revoke all on function public.canonical_change_tenant_user_access_v1_unchecked(jsonb)
  from public, anon, authenticated, service_role;

create function public.canonical_change_tenant_user_access(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
begin
  if not public.canonical_actor_is_authorized(v_company_id, v_actor_user_id, 'tenant.user.manage', false) then
    raise exception 'actor_not_authorized_for_tenant_user_management';
  end if;
  if nullif(btrim(v_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':tenant.user_access.change:' || v_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = v_company_id and command_type = 'tenant.user_access.change'
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from v_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  v_result := public.canonical_change_tenant_user_access_v1_unchecked(p_command);
  update public.canonical_command_results set request_payload = v_request
  where company_id = v_company_id and command_type = 'tenant.user_access.change'
    and idempotency_key = v_idempotency_key;
  return v_result;
end;
$$;
revoke all on function public.canonical_change_tenant_user_access(jsonb) from public, anon, authenticated;
grant execute on function public.canonical_change_tenant_user_access(jsonb) to service_role;

create or replace function public.guard_last_functioning_tenant_admin()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_company_id uuid := old.company_id;
  v_old_role text := old.membership_role;
  v_old_was_active boolean := old.status = 'active' and coalesce(old.is_active, true);
  v_owner_count bigint;
  v_admin_count bigint;
begin
  if not v_old_was_active or v_old_role not in ('owner', 'admin', 'company_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE'
     and new.status = 'active' and coalesce(new.is_active, true)
     and new.membership_role = v_old_role then
    return new;
  end if;
  if not exists (
    select 1 from auth.users u join public.user_profiles up on up.id = u.id
    where u.id = old.user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and u.email_confirmed_at is not null and up.user_status = 'active'
  ) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select count(*) into v_owner_count
  from public.company_memberships cm
  join auth.users u on u.id = cm.user_id
  join public.user_profiles up on up.id = u.id
  where cm.company_id = v_company_id and cm.status = 'active' and coalesce(cm.is_active, true)
    and cm.membership_role = 'owner' and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and u.email_confirmed_at is not null and up.user_status = 'active';
  select count(*) into v_admin_count
  from public.company_memberships cm
  join auth.users u on u.id = cm.user_id
  join public.user_profiles up on up.id = u.id
  where cm.company_id = v_company_id and cm.status = 'active' and coalesce(cm.is_active, true)
    and cm.membership_role in ('owner', 'admin', 'company_admin') and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and u.email_confirmed_at is not null and up.user_status = 'active';
  if v_old_role = 'owner' and v_owner_count = 0 then
    raise exception 'last_functioning_owner_cannot_be_removed_or_downgraded';
  end if;
  if v_admin_count = 0 then
    raise exception 'last_functioning_admin_cannot_be_removed_or_downgraded';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists company_memberships_last_functioning_admin_guard
  on public.company_memberships;
create constraint trigger company_memberships_last_functioning_admin_guard
after update or delete on public.company_memberships
deferrable initially immediate
for each row execute function public.guard_last_functioning_tenant_admin();

create or replace function public.ediel_configuration_change_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if current_setting('gridex.skip_ediel_snapshot_trigger', true) = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then v_company_id := old.company_id; else v_company_id := new.company_id; end if;
  if v_company_id is not null then
    perform public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
      v_company_id, auth.uid(), tg_table_name || '_changed'
    );
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.ediel_configuration_change_snapshot_trigger()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_ediel_configuration_snapshot_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_last_functioning_tenant_admin()
  from public, anon, authenticated, service_role;
revoke all on function public.canonical_company_capability_seed_trigger()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_tenant_invitation_acceptance()
  from public, anon, authenticated, service_role;

revoke all on public.ediel_production_state from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.ediel_production_state from authenticated;
grant select on public.ediel_production_state to authenticated;
revoke all on public.ediel_configuration_snapshots from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.ediel_configuration_snapshots from authenticated;
grant select on public.ediel_configuration_snapshots to authenticated;
revoke all on public.ediel_active_test_configurations from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.ediel_active_test_configurations from authenticated;
grant select on public.ediel_active_test_configurations to authenticated;
drop policy if exists gridex_mp_0db6bc318e08d4586e48 on public.company_memberships;
drop policy if exists gridex_mp_30847a1ab41593fc066f on public.company_memberships;
drop policy if exists gridex_mp_8145e6b88436abfa0 on public.company_memberships;
drop policy if exists gridex_mp_e6d93c8e62a555bcb2d0 on public.company_memberships;
revoke all on public.company_memberships from anon;
revoke all on public.canonical_command_results from anon, authenticated;
revoke all on public.canonical_audit_events from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.canonical_audit_events from authenticated;
grant select on public.canonical_audit_events to authenticated;
revoke all on public.canonical_domain_events from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.canonical_domain_events from authenticated;
grant select on public.canonical_domain_events to authenticated;
revoke all on public.canonical_event_outbox from anon, authenticated;
revoke all on public.canonical_provisioning_requests from anon;
revoke all on public.actor_test_attempts from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.actor_test_attempts from authenticated;
grant select on public.actor_test_attempts to authenticated;
revoke all on public.actor_test_attempt_evidence from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.actor_test_attempt_evidence from authenticated;
grant select on public.actor_test_attempt_evidence to authenticated;
revoke all on public.actor_test_manual_attestations from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.actor_test_manual_attestations from authenticated;
grant select on public.actor_test_manual_attestations to authenticated;

comment on function public.canonical_company_readiness(uuid, uuid, uuid, uuid, text)
is 'Read-only canonical production gate. Never creates snapshots or readiness evidence.';
comment on table public.canonical_readiness_shadow_comparisons
is 'Append-only comparison evidence; canonical readiness remains authoritative.';

commit;
