-- Ediel actor identity source-of-truth hardening.
-- Additive migration: no hardcoded Ediel-ID assumptions, inbound tenant resolution by UNB receiver.

begin;

create extension if not exists pgcrypto;


-- Compatibility: live companies schema uses org_number in some installs, not organization_number.
-- Add organization_number as a safe compatibility column and backfill it when org_number exists.
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies add column if not exists organization_number text;

    if exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'companies'
         and column_name = 'org_number'
    ) then
      execute 'update public.companies set organization_number = coalesce(organization_number, org_number) where organization_number is null and org_number is not null';
    end if;
  end if;
end $$;

alter table if exists public.ediel_actor_settings
  add column if not exists legal_name text,
  add column if not exists organization_number text,
  add column if not exists market_roles jsonb not null default '[]'::jsonb,
  add column if not exists test_status text,
  add column if not exists production_status text,
  add column if not exists production_send_lock_enabled boolean not null default true,
  add column if not exists first_production_send_approved boolean not null default false,
  add column if not exists first_production_message_id uuid,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

update public.ediel_actor_settings eas
   set legal_name = coalesce(eas.legal_name, eas.actor_name, c.name),
       organization_number = coalesce(eas.organization_number, c.organization_number),
       market_roles = case
         when jsonb_array_length(coalesce(eas.market_roles, '[]'::jsonb)) > 0 then eas.market_roles
         when coalesce(eas.role, eas.actor_role) is not null then jsonb_build_array(coalesce(eas.role, eas.actor_role))
         else '[]'::jsonb
       end,
       test_status = coalesce(eas.test_status, case when eas.environment = 'test' then 'configured' end),
       production_status = coalesce(eas.production_status, case when eas.environment = 'production' then 'draft' end)
  from public.companies c
 where eas.company_id = c.id
   and to_regclass('public.ediel_actor_settings') is not null;

alter table if exists public.ediel_route_profiles
  add column if not exists actor_setting_id uuid references public.ediel_actor_settings(id) on delete set null,
  add column if not exists message_family text,
  add column if not exists message_code text,
  add column if not exists direction text,
  add column if not exists counterparty_role text,
  add column if not exists counterparty_id uuid,
  add column if not exists receiver_email text,
  add column if not exists transport_profile_id uuid,
  add column if not exists route_version integer not null default 1,
  add column if not exists is_test_route boolean,
  add column if not exists is_production_route boolean,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_to timestamptz;

update public.ediel_route_profiles
   set is_test_route = coalesce(is_test_route, environment = 'test'),
       is_production_route = coalesce(is_production_route, environment = 'production'),
       receiver_email = coalesce(receiver_email, mailbox)
 where to_regclass('public.ediel_route_profiles') is not null;

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
   set name = coalesce(name, counterparty_name),
       ediel_id = coalesce(ediel_id, counterparty_ediel_id),
       role = coalesce(role, counterparty_role),
       email_address = coalesce(email_address, email),
       lifecycle_status = coalesce(lifecycle_status, case when is_active then 'active' else 'deprecated' end)
 where to_regclass('public.ediel_counterparties') is not null;

create table if not exists public.ediel_transport_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  environment text not null default 'test',
  name text,
  transport_channel text not null default 'smtp',
  direction text not null default 'both',
  mailbox_id uuid,
  sender_email text,
  receiver_email text,
  host text,
  port integer,
  secret_reference text,
  is_platform_shared boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint ediel_transport_profiles_environment_check check (environment in ('test','production')),
  constraint ediel_transport_profiles_direction_check check (direction in ('inbound','outbound','both')),
  constraint ediel_transport_profiles_no_plaintext_secret_check check (
    secret_reference is null
    or secret_reference !~* '^(pass|password|pwd)=|://[^/]*:[^/@]+@'
  )
);

create index if not exists ediel_transport_profiles_company_env_active_idx
  on public.ediel_transport_profiles(company_id, environment, is_active, updated_at desc);

create table if not exists public.ediel_route_history (
  id uuid primary key default gen_random_uuid(),
  route_profile_id uuid references public.ediel_route_profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  route_version integer not null,
  snapshot jsonb not null default '{}'::jsonb,
  change_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists ediel_route_history_route_version_idx
  on public.ediel_route_history(route_profile_id, route_version);

create table if not exists public.ediel_routing_decisions (
  id uuid primary key default gen_random_uuid(),
  ediel_message_id uuid references public.ediel_messages(id) on delete set null,
  route_decision_log_id uuid references public.route_decision_logs(id) on delete set null,
  company_id uuid references public.companies(id) on delete cascade,
  environment text not null default 'test',
  message_family text,
  message_code text,
  direction text,
  sender_ediel_id text,
  sender_subaddress text,
  receiver_ediel_id text,
  receiver_subaddress text,
  receiver_source text,
  route_profile_id uuid,
  route_version integer,
  transport_profile_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  counterparty_id uuid,
  validation_status text not null default 'warning',
  validation_errors jsonb not null default '[]'::jsonb,
  validation_warnings jsonb not null default '[]'::jsonb,
  decision_trace jsonb not null default '[]'::jsonb,
  is_dry_run boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists ediel_routing_decisions_company_created_idx
  on public.ediel_routing_decisions(company_id, created_at desc);

alter table if exists public.ediel_messages
  add column if not exists route_profile_id uuid,
  add column if not exists route_version integer,
  add column if not exists transport_profile_id uuid,
  add column if not exists routing_decision_id uuid references public.ediel_routing_decisions(id) on delete set null,
  add column if not exists routing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists parsed_unb_sender_ediel_id text,
  add column if not exists parsed_unb_receiver_ediel_id text,
  add column if not exists resolved_company_id uuid references public.companies(id) on delete set null;

update public.ediel_messages
   set parsed_unb_sender_ediel_id = coalesce(parsed_unb_sender_ediel_id, sender_ediel_id),
       parsed_unb_receiver_ediel_id = coalesce(parsed_unb_receiver_ediel_id, receiver_ediel_id),
       resolved_company_id = coalesce(resolved_company_id, company_id)
 where to_regclass('public.ediel_messages') is not null;

alter table if exists public.ediel_unresolved_items
  alter column company_id drop not null,
  add column if not exists raw_sender text,
  add column if not exists raw_receiver text,
  add column if not exists raw_interchange_reference text,
  add column if not exists raw_message_type text,
  add column if not exists suggested_company_id uuid references public.companies(id) on delete set null,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolved_at timestamptz;

create index if not exists ediel_actor_settings_unb_receiver_resolution_idx
  on public.ediel_actor_settings(environment, ediel_id, receiver_subaddress, application_reference, company_id)
  where coalesce(is_active, true) = true and ediel_id is not null;

create index if not exists ediel_messages_parsed_unb_receiver_idx
  on public.ediel_messages(environment, parsed_unb_receiver_ediel_id, resolved_company_id, created_at desc)
  where parsed_unb_receiver_ediel_id is not null;

create index if not exists ediel_unresolved_items_raw_receiver_idx
  on public.ediel_unresolved_items(environment, raw_receiver, status, created_at desc)
  where raw_receiver is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ediel_counterparties_lifecycle_status_check') then
    alter table public.ediel_counterparties
      add constraint ediel_counterparties_lifecycle_status_check
      check (lifecycle_status in ('draft','verified','active','deprecated','blocked'));
  end if;
end $$;

alter table public.ediel_transport_profiles enable row level security;
alter table public.ediel_route_history enable row level security;
alter table public.ediel_routing_decisions enable row level security;

do $$
declare
  t text;
begin
  if to_regprocedure('public.gridex_user_is_platform_admin()') is null
     or to_regprocedure('public.gridex_can_read_company(uuid)') is null then
    return;
  end if;

  foreach t in array array['ediel_transport_profiles','ediel_route_history','ediel_routing_decisions'] loop
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_select_company', t);
    execute format('drop policy if exists %I on public.%I', 'gridex_' || t || '_write_platform', t);

    execute format(
      'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or company_id is not null and public.gridex_can_read_company(company_id))',
      'gridex_' || t || '_select_company',
      t
    );

    execute format(
      'create policy %I on public.%I for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
      'gridex_' || t || '_write_platform',
      t
    );
  end loop;
end $$;

commit;
