-- Customer information request P0 hardening:
-- - structured blockers on customer_info_requests
-- - customer_operation_jobs lock/status consistency
-- - idempotent route materialization provenance guards
-- - JSONB contract hardening for customer card fields
-- - route readiness diagnostics split by readiness concept

create extension if not exists pgcrypto;

alter table if exists public.customer_info_requests
  add column if not exists blocker_code text,
  add column if not exists blocker_details jsonb not null default '{}'::jsonb;

create index if not exists customer_info_requests_blocker_code_idx
  on public.customer_info_requests(company_id, blocker_code, updated_at desc)
  where blocker_code is not null;

do $$
declare
  constraint_row record;
begin
  if to_regclass('public.customer_operation_jobs') is not null then
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.customer_operation_jobs'::regclass
        and contype = 'c'
        and conname like '%status%'
    loop
      execute format('alter table public.customer_operation_jobs drop constraint if exists %I', constraint_row.conname);
    end loop;

    alter table public.customer_operation_jobs
      add constraint customer_operation_jobs_status_check
      check (status in (
        'queued',
        'running',
        'waiting_response',
        'completed',
        'needs_review',
        'blocked',
        'delivery_uncertain',
        'failed',
        'skipped',
        'cancelled'
      ))
      not valid;
    alter table public.customer_operation_jobs validate constraint customer_operation_jobs_status_check;

    update public.customer_operation_jobs
       set locked_at = null,
           locked_by = null,
           lock_token = null,
           updated_at = now()
     where status in ('queued','needs_review','blocked','completed','failed','cancelled','delivery_uncertain')
       and (locked_at is not null or locked_by is not null or lock_token is not null);
  end if;
end $$;

create or replace function public.gridex_claim_customer_operation_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.customer_operation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.customer_operation_jobs
    where (
      status = 'queued'
      and run_after <= now()
      and (
        locked_at is null
        or lock_token is null
        or locked_at < now() - interval '15 minutes'
      )
    ) or (
      status = 'running'
      and (
        locked_at is null
        or lock_token is null
        or locked_at < now() - interval '15 minutes'
      )
    )
    order by priority asc, run_after asc, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.customer_operation_jobs jobs
  set status = 'running',
      attempts = case when jobs.status = 'queued' then jobs.attempts + 1 else jobs.attempts end,
      locked_at = now(),
      locked_by = nullif(trim(p_worker_id), ''),
      lock_token = gen_random_uuid(),
      last_error = case
        when jobs.status = 'running' then coalesce(jobs.last_error, 'stale_customer_operation_lock_reclaimed')
        else jobs.last_error
      end,
      updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from public;
revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from anon;
revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from authenticated;
grant execute on function public.gridex_claim_customer_operation_jobs(text, integer) to service_role;

do $$
begin
  if to_regclass('public.communication_routes') is not null
     and not exists (
       select 1
       from (
         select company_id, auth_config->>'platform_actor_route_id' as platform_actor_route_id, route_scope, count(*) as row_count
         from public.communication_routes
         where auth_config ? 'platform_actor_route_id'
         group by company_id, auth_config->>'platform_actor_route_id', route_scope
         having count(*) > 1
       ) duplicates
     ) then
    create unique index if not exists communication_routes_platform_actor_route_uidx
      on public.communication_routes(
        company_id,
        ((auth_config->>'platform_actor_route_id')),
        route_scope
      )
      where auth_config ? 'platform_actor_route_id';
  end if;

  if to_regclass('public.ediel_route_profiles') is not null
     and not exists (
       select 1
       from (
         select company_id, metadata->>'platform_actor_route_id' as platform_actor_route_id, environment, coalesce(message_family, '') as message_family, count(*) as row_count
         from public.ediel_route_profiles
         where metadata ? 'platform_actor_route_id'
         group by company_id, metadata->>'platform_actor_route_id', environment, coalesce(message_family, '')
         having count(*) > 1
       ) duplicates
     ) then
    create unique index if not exists ediel_route_profiles_platform_actor_route_uidx
      on public.ediel_route_profiles(
        company_id,
        ((metadata->>'platform_actor_route_id')),
        environment,
        coalesce(message_family, '')
      )
      where metadata ? 'platform_actor_route_id';
  end if;
end $$;

do $$
declare
  target_row record;
  type_name text;
begin
  for target_row in
    select *
    from (values
      ('customer_sites','address_quality_warnings'),
      ('customers','onboarding_issues'),
      ('customer_sites','onboarding_issues'),
      ('metering_points','onboarding_issues'),
      ('customer_contracts','onboarding_issues')
    ) as targets(table_name, column_name)
  loop
    if to_regclass('public.' || target_row.table_name) is not null then
      select udt_name into type_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_row.table_name
        and column_name = target_row.column_name;

      if type_name is null then
        execute format('alter table public.%I add column %I jsonb not null default ''[]''::jsonb', target_row.table_name, target_row.column_name);
      elsif type_name <> 'jsonb' then
        execute format('alter table public.%I alter column %I drop default', target_row.table_name, target_row.column_name);
        execute format('alter table public.%I alter column %I type jsonb using to_jsonb(%I)', target_row.table_name, target_row.column_name, target_row.column_name);
        execute format('alter table public.%I alter column %I set default ''[]''::jsonb', target_row.table_name, target_row.column_name);
        execute format('update public.%I set %I = ''[]''::jsonb where %I is null', target_row.table_name, target_row.column_name, target_row.column_name);
        execute format('alter table public.%I alter column %I set not null', target_row.table_name, target_row.column_name);
      else
        execute format('alter table public.%I alter column %I set default ''[]''::jsonb', target_row.table_name, target_row.column_name);
        execute format('update public.%I set %I = ''[]''::jsonb where %I is null', target_row.table_name, target_row.column_name, target_row.column_name);
      end if;
    end if;
  end loop;
end $$;

create or replace view public.gridex_route_materialization_readiness_v
with (security_invoker = true)
as
select
  g.company_id,
  g.id as grid_owner_id,
  g.name as grid_owner_name,
  g.platform_market_actor_id,
  r.id as platform_actor_route_id,
  upper(coalesce(r.message_family, 'PRODAT')) as message_family,
  coalesce(r.environment, 'production') as environment,
  (
    g.platform_market_actor_id is not null
    and coalesce(g.verification_status, '') in ('verified','needs_route','needs_certificate','needs_contact','needs_subaddress')
  ) as actor_registry_ready,
  (
    r.id is not null
    and coalesce(r.status, '') = 'active'
    and coalesce(r.is_verified, false) = true
  ) as platform_route_ready,
  (
    cr.id is not null
    and coalesce(cr.is_active, true) = true
    and rp.id is not null
    and coalesce(rp.is_enabled, true) = true
    and coalesce(rp.is_active, true) = true
  ) as operational_route_ready,
  (
    cr.id is not null
    and rp.id is not null
    and nullif(btrim(coalesce(rp.sender_ediel_id, '')), '') is not null
    and nullif(btrim(coalesce(rp.receiver_ediel_id, g.ediel_id, '')), '') is not null
    and nullif(btrim(coalesce(cr.target_email, '')), '') is not null
    and not (
      coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and coalesce(r.environment, 'production') = 'production'
    )
  ) as send_ready,
  case
    when r.id is not null and cr.id is null then 'platform_route_exists_but_not_materialized'
    when cr.id is null then 'operational_route_missing'
    when rp.id is null then 'operational_route_missing'
    when coalesce(eas.production_send_lock_enabled, false) = true
      and coalesce(eas.first_production_send_approved, false) = false
      and coalesce(r.environment, 'production') = 'production' then 'production_send_locked'
    else null
  end as blocker_code,
  cr.id as communication_route_id,
  rp.id as ediel_route_profile_id,
  cmpr.id as company_market_party_route_id,
  eas.id as sender_settings_id
from public.grid_owners g
left join public.platform_actor_routes r
  on r.actor_id = g.platform_market_actor_id
 and coalesce(r.status, '') = 'active'
 and coalesce(r.is_verified, false) = true
left join public.communication_routes cr
  on cr.company_id = g.company_id
 and cr.grid_owner_id = g.id
 and cr.auth_config->>'platform_actor_route_id' = r.id::text
left join public.ediel_route_profiles rp
  on rp.company_id = g.company_id
 and rp.communication_route_id = cr.id
 and rp.metadata->>'platform_actor_route_id' = r.id::text
left join public.company_market_party_routes cmpr
  on cmpr.company_id = g.company_id
 and cmpr.market_party_id = g.platform_market_actor_id
 and upper(cmpr.message_family) = upper(coalesce(r.message_family, 'PRODAT'))
 and cmpr.active = true
left join public.ediel_actor_settings eas
  on eas.company_id = g.company_id
 and eas.environment = coalesce(r.environment, 'production')
 and coalesce(eas.is_active, true) = true
where g.platform_market_actor_id is not null;

grant select on public.gridex_route_materialization_readiness_v to authenticated, service_role;
