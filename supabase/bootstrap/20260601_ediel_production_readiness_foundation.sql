-- GRIDEX-AUD-003 derived bootstrap: restore the historical Ediel production-readiness core.
-- Source: supabase/migrations/20260601070000_ediel_production_readiness_hardening.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to company production-state fields plus readiness/go-live evidence
-- required by the later canonical Ediel production-state migration.

alter table if exists public.companies
  add column if not exists ediel_production_status text not null default 'not_ready',
  add column if not exists ediel_production_enabled boolean not null default false,
  add column if not exists ediel_production_enabled_at timestamptz,
  add column if not exists ediel_production_enabled_by uuid references auth.users(id) on delete set null,
  add column if not exists ediel_production_paused_at timestamptz,
  add column if not exists ediel_production_paused_by uuid references auth.users(id) on delete set null,
  add column if not exists ediel_production_pause_reason text,
  add column if not exists ediel_first_live_send_approved_at timestamptz,
  add column if not exists ediel_first_live_send_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists ediel_primary_actor_setting_id uuid,
  add column if not exists ediel_primary_production_route_profile_id uuid,
  add column if not exists ediel_primary_test_route_profile_id uuid;

update public.companies
   set ediel_production_status = coalesce(nullif(ediel_production_status, ''), production_status, 'not_ready'),
       ediel_production_enabled = coalesce(ediel_production_enabled, live_ediel_enabled, false),
       ediel_production_enabled_at = coalesce(ediel_production_enabled_at, live_approved_at),
       ediel_production_enabled_by = coalesce(ediel_production_enabled_by, live_approved_by);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_ediel_production_status_check'
  ) then
    alter table public.companies
      add constraint companies_ediel_production_status_check
      check (ediel_production_status in ('not_ready','production_prepared','blocked','live','paused','not_configured'));
  end if;
end $$;

create index if not exists companies_ediel_production_status_idx
  on public.companies(ediel_production_status, ediel_production_enabled);

create table if not exists public.ediel_production_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null,
  score integer not null default 0,
  blocking_issues jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  passed_checks jsonb not null default '[]'::jsonb,
  missing_items jsonb not null default '[]'::jsonb,
  next_actions jsonb not null default '[]'::jsonb,
  readiness_snapshot jsonb not null default '{}'::jsonb,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ediel_production_readiness_checks_status_check
    check (status in ('ready','not_ready','warning','live','paused','blocked'))
);

create index if not exists ediel_production_readiness_checks_company_checked_idx
  on public.ediel_production_readiness_checks(company_id, checked_at desc);

create table if not exists public.ediel_go_live_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  readiness_check_id uuid references public.ediel_production_readiness_checks(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ediel_go_live_events_company_created_idx
  on public.ediel_go_live_events(company_id, created_at desc);

create index if not exists ediel_go_live_events_type_created_idx
  on public.ediel_go_live_events(event_type, created_at desc);

alter table public.ediel_production_readiness_checks enable row level security;
alter table public.ediel_go_live_events enable row level security;

do $$
declare
  t text;
begin
  if to_regprocedure('public.gridex_user_is_platform_admin()') is null
     or to_regprocedure('public.gridex_can_read_company(uuid)') is null
     or to_regprocedure('public.gridex_can_write_company(uuid)') is null then
    return;
  end if;

  foreach t in array array[
    'ediel_production_readiness_checks',
    'ediel_go_live_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_select_company', t);
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_insert_company', t);
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_update_company', t);

    execute format(
      'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))',
      'gridex_' || t || '_select_company', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin())',
      'gridex_' || t || '_insert_company', t
    );
    execute format(
      'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
      'gridex_' || t || '_update_company', t
    );
  end loop;
end $$;
