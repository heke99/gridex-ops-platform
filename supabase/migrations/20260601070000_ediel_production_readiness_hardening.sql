-- Ediel production readiness hardening.
-- Idempotent, additive, and tenant-safe. Reuses existing actor-testing/go-live tables.

begin;

create extension if not exists pgcrypto;

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
       ediel_production_enabled_by = coalesce(ediel_production_enabled_by, live_approved_by)
 where to_regclass('public.companies') is not null;

do $$
begin
  if to_regclass('public.companies') is not null
     and not exists (select 1 from pg_constraint where conname = 'companies_ediel_production_status_check') then
    alter table public.companies
      add constraint companies_ediel_production_status_check
      check (ediel_production_status in ('not_ready','production_prepared','blocked','live','paused','not_configured'));
  end if;
end $$;

create index if not exists companies_ediel_production_status_idx
  on public.companies(ediel_production_status, ediel_production_enabled);

alter table if exists public.ediel_actor_settings
  add column if not exists contact_email text,
  add column if not exists operations_contact_email text,
  add column if not exists brp_ediel_id text,
  add column if not exists brp_name text,
  add column if not exists brp_status text,
  add column if not exists esett_status text;

alter table if exists public.ediel_route_profiles
  add column if not exists actor_setting_id uuid,
  add column if not exists transport_type text,
  add column if not exists is_production_ready boolean not null default false;

alter table if exists public.ediel_mailboxes
  add column if not exists mailbox_type text,
  add column if not exists provider text,
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer,
  add column if not exists last_poll_at timestamptz,
  add column if not exists last_successful_poll_at timestamptz,
  add column if not exists last_poll_status text,
  add column if not exists is_shared_platform_mailbox boolean not null default false;

update public.ediel_mailboxes
   set last_poll_at = coalesce(last_poll_at, last_polled_at),
       is_shared_platform_mailbox = coalesce(is_shared_platform_mailbox, metadata->>'scope' = 'platform_shared')
 where to_regclass('public.ediel_mailboxes') is not null;

do $$
begin
  if to_regclass('public.ediel_mailboxes') is not null
     and not exists (select 1 from pg_constraint where conname = 'ediel_mailboxes_no_plaintext_secret_check') then
    alter table public.ediel_mailboxes
      add constraint ediel_mailboxes_no_plaintext_secret_check
      check (
        secret_reference is null
        or secret_reference !~* '^(pass|password|pwd)=|://[^/]*:[^/@]+@'
      );
  end if;
end $$;

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

create table if not exists public.ediel_send_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'production',
  locked boolean not null default true,
  locked_reason text,
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz not null default now(),
  unlocked_by uuid references auth.users(id) on delete set null,
  unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ediel_send_locks_environment_check check (environment in ('test','production')),
  constraint ediel_send_locks_company_environment_key unique (company_id, environment)
);

create index if not exists ediel_send_locks_company_env_locked_idx
  on public.ediel_send_locks(company_id, environment, locked);

insert into public.ediel_send_locks(company_id, environment, locked, locked_reason)
select c.id, 'production', true, 'Default production lock. Superadmin must pass readiness and activate production.'
from public.companies c
where to_regclass('public.companies') is not null
on conflict (company_id, environment) do nothing;

alter table if exists public.ediel_unresolved_items
  alter column company_id drop not null,
  add column if not exists raw_sender text,
  add column if not exists raw_receiver text,
  add column if not exists raw_interchange_reference text,
  add column if not exists raw_message_type text,
  add column if not exists suggested_company_id uuid references public.companies(id) on delete set null,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolved_at timestamptz;

create index if not exists ediel_unresolved_items_environment_status_idx
  on public.ediel_unresolved_items(environment, coalesce(resolution_status, status), created_at desc);

create index if not exists ediel_unresolved_items_company_environment_status_idx
  on public.ediel_unresolved_items(company_id, environment, coalesce(resolution_status, status), created_at desc);

create index if not exists ediel_actor_settings_company_environment_active_idx
  on public.ediel_actor_settings(company_id, environment, is_active, updated_at desc);

create index if not exists ediel_route_profiles_company_environment_active_idx
  on public.ediel_route_profiles(company_id, environment, is_active, is_enabled, updated_at desc);

create index if not exists ediel_mailboxes_environment_active_idx
  on public.ediel_mailboxes(environment, is_active, last_poll_at desc);

alter table public.ediel_production_readiness_checks enable row level security;
alter table public.ediel_go_live_events enable row level security;
alter table public.ediel_send_locks enable row level security;

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
    'ediel_go_live_events',
    'ediel_send_locks'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_select_company', t);
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_insert_company', t);
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_update_company', t);

    execute format(
      'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))',
      'gridex_' || t || '_select_company',
      t
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin())',
      'gridex_' || t || '_insert_company',
      t
    );
    execute format(
      'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
      'gridex_' || t || '_update_company',
      t
    );
  end loop;
end $$;

commit;
