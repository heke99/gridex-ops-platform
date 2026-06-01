-- Ediel tenant/systemtest/dynamic receiver hardening.
-- Additive and idempotent. Makes AGT/TGT/systemtest counterparties DB-configurable and keeps company Ediel-ID as source of truth.

begin;

create extension if not exists pgcrypto;

alter table if exists public.ediel_actor_settings
  add column if not exists ediel_id text,
  add column if not exists legal_name text,
  add column if not exists organization_number text,
  add column if not exists market_roles jsonb not null default '[]'::jsonb,
  add column if not exists sender_subaddress text,
  add column if not exists receiver_subaddress text,
  add column if not exists contact_email text,
  add column if not exists operations_contact_email text,
  add column if not exists production_status text,
  add column if not exists test_status text,
  add column if not exists production_send_lock_enabled boolean not null default true,
  add column if not exists first_production_send_approved boolean not null default false,
  add column if not exists first_production_message_id uuid,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

update public.ediel_actor_settings
   set ediel_id = coalesce(nullif(ediel_id, ''), nullif(actor_ediel_id, '')),
       sender_subaddress = coalesce(nullif(sender_subaddress, ''), nullif(sender_sub_address, '')),
       legal_name = coalesce(nullif(legal_name, ''), nullif(actor_name, '')),
       production_status = coalesce(production_status, case when environment = 'production' then 'draft' end),
       test_status = coalesce(test_status, case when environment = 'test' then 'configured' end)
 where to_regclass('public.ediel_actor_settings') is not null;

alter table if exists public.ediel_counterparties
  add column if not exists name text,
  add column if not exists organization_number text,
  add column if not exists ediel_id text,
  add column if not exists role text,
  add column if not exists subaddress_prodat text,
  add column if not exists subaddress_utilts text,
  add column if not exists transport_channel text,
  add column if not exists email_address text,
  add column if not exists source text,
  add column if not exists source_verified_at timestamptz,
  add column if not exists lifecycle_status text not null default 'draft',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

update public.ediel_counterparties
   set name = coalesce(nullif(name, ''), counterparty_name),
       ediel_id = coalesce(nullif(ediel_id, ''), counterparty_ediel_id),
       role = coalesce(nullif(role, ''), counterparty_role),
       email_address = coalesce(nullif(email_address, ''), email),
       lifecycle_status = coalesce(nullif(lifecycle_status, ''), case when coalesce(is_active, true) then 'active' else 'deprecated' end)
 where to_regclass('public.ediel_counterparties') is not null;

create table if not exists public.ediel_system_test_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'test',
  test_suite text not null default 'AGT',
  test_portal_counterparty_id uuid references public.ediel_counterparties(id) on delete set null,
  test_brp_counterparty_id uuid references public.ediel_counterparties(id) on delete set null,
  sender_actor_setting_id uuid references public.ediel_actor_settings(id) on delete set null,
  default_receiver_subaddress text,
  default_sender_subaddress text,
  route_profile_id uuid references public.ediel_route_profiles(id) on delete set null,
  transport_profile_id uuid references public.ediel_transport_profiles(id) on delete set null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint ediel_system_test_settings_environment_check check (environment = 'test'),
  constraint ediel_system_test_settings_suite_check check (test_suite in ('AGT','TGT','PRODAT','UTILTS','NBS','AI_LIST','OTHER'))
);

create index if not exists ediel_system_test_settings_company_suite_active_idx
  on public.ediel_system_test_settings(company_id, test_suite, is_active, updated_at desc);

create unique index if not exists ediel_system_test_settings_one_active_per_suite_idx
  on public.ediel_system_test_settings(company_id, test_suite)
  where is_active = true;

create index if not exists ediel_counterparties_test_actor_idx
  on public.ediel_counterparties(company_id, environment, role, ediel_id)
  where coalesce(is_active, true) = true;

-- Production may not have active test portal/test-BRP counterparties with the known Edielportal IDs.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ediel_counterparties_no_known_test_ids_in_production_check') then
    alter table public.ediel_counterparties
      add constraint ediel_counterparties_no_known_test_ids_in_production_check
      check (
        environment <> 'production'
        or coalesce(is_active, true) = false
        or coalesce(ediel_id, counterparty_ediel_id, '') not in ('91100','91109')
      );
  end if;
end $$;

-- Active production Ediel identity must be unique across companies for the same environment.
do $$
begin
  if not exists (
    select 1
      from public.ediel_actor_settings
     where environment = 'production'
       and coalesce(is_active, true) = true
       and nullif(coalesce(ediel_id, actor_ediel_id), '') is not null
     group by environment, upper(coalesce(ediel_id, actor_ediel_id))
     having count(distinct company_id) > 1
  ) then
    create unique index if not exists ediel_actor_settings_unique_active_production_ediel_idx
      on public.ediel_actor_settings(environment, upper(coalesce(ediel_id, actor_ediel_id)))
      where environment = 'production'
        and coalesce(is_active, true) = true
        and nullif(coalesce(ediel_id, actor_ediel_id), '') is not null;
  end if;
end $$;

alter table public.ediel_system_test_settings enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_user_is_platform_admin()') is null
     or to_regprocedure('public.gridex_can_read_company(uuid)') is null then
    return;
  end if;

  drop policy if exists gridex_ediel_system_test_settings_select_company on public.ediel_system_test_settings;
  drop policy if exists gridex_ediel_system_test_settings_write_platform on public.ediel_system_test_settings;

  create policy gridex_ediel_system_test_settings_select_company
    on public.ediel_system_test_settings
    for select
    using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));

  create policy gridex_ediel_system_test_settings_write_platform
    on public.ediel_system_test_settings
    for all
    using (public.gridex_user_is_platform_admin())
    with check (public.gridex_user_is_platform_admin());
end $$;

commit;
