-- Batch 1 + 2: SaaS/white-label hardening and Ediel Control Center support.
-- Idempotent. Does not change approved Ediel message generation logic.

create extension if not exists pgcrypto;

-- Keep tenant profile and white-label metadata available on all environments.
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies add column if not exists branding jsonb not null default '{}'::jsonb;
    alter table public.companies add column if not exists billing_settings jsonb not null default '{}'::jsonb;
    alter table public.companies add column if not exists ediel_id text null;
    alter table public.companies add column if not exists actor_role text null;
    alter table public.companies add column if not exists sender_sub_address text null;
    alter table public.companies add column if not exists ediel_mailbox text null;
    alter table public.companies add column if not exists operating_environment text null default 'test';

    update public.companies
      set branding = coalesce(branding, '{}'::jsonb),
          billing_settings = coalesce(billing_settings, '{}'::jsonb),
          operating_environment = case when operating_environment = 'production' then 'production' else 'test' end
      where branding is null
         or billing_settings is null
         or operating_environment is null
         or operating_environment not in ('test', 'production');

    alter table public.companies drop constraint if exists companies_operating_environment_check;
    alter table public.companies
      add constraint companies_operating_environment_check
      check (operating_environment in ('test', 'production'));

    create index if not exists companies_branding_gin_idx on public.companies using gin (branding);
    create index if not exists companies_ediel_id_idx on public.companies(ediel_id);
    create index if not exists companies_status_idx on public.companies(status);
  end if;
end $$;

-- Runtime must never be forced to use global actor profiles for tenant live flows.
do $$
begin
  if to_regclass('public.ediel_actor_settings') is not null then
    alter table public.ediel_actor_settings
      add column if not exists company_id uuid null references public.companies(id) on delete set null;

    create index if not exists ediel_actor_settings_company_environment_active_idx
      on public.ediel_actor_settings(company_id, environment, is_active);
  end if;
end $$;

-- Route/profile lookup performance for Control Tower and tenant-scoped Ediel pages.
do $$
begin
  if to_regclass('public.communication_routes') is not null then
    create index if not exists communication_routes_company_active_idx
      on public.communication_routes(company_id, is_active);
  end if;

  if to_regclass('public.ediel_route_profiles') is not null then
    create index if not exists ediel_route_profiles_company_enabled_idx
      on public.ediel_route_profiles(company_id, is_enabled);
  end if;

  if to_regclass('public.ediel_messages') is not null then
    create index if not exists ediel_messages_company_status_idx
      on public.ediel_messages(company_id, status);
    create index if not exists ediel_messages_company_family_status_idx
      on public.ediel_messages(company_id, message_family, status);
  end if;

  if to_regclass('public.audit_logs') is not null then
    create index if not exists audit_logs_company_created_idx
      on public.audit_logs(company_id, created_at desc);
  end if;
end $$;

-- Optional platform helper used by Control Tower/manual SQL checks.
do $$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.ediel_actor_settings') is null
     or to_regclass('public.communication_routes') is null
     or to_regclass('public.ediel_route_profiles') is null then
    return;
  end if;

  execute $view$
    create or replace view public.gridex_tenant_runtime_readiness as
    select
      c.id as company_id,
      c.name as company_name,
      c.org_number,
      coalesce(c.status, 'active') as company_status,
      c.ediel_id as tenant_ediel_id,
      c.operating_environment,
      exists (
        select 1 from public.ediel_actor_settings eas
        where eas.company_id = c.id
          and eas.is_active = true
      ) as has_active_actor_profile,
      exists (
        select 1 from public.communication_routes cr
        where cr.company_id = c.id
          and cr.is_active = true
      ) or exists (
        select 1 from public.ediel_route_profiles erp
        where erp.company_id = c.id
          and coalesce(erp.is_enabled, false) = true
      ) as has_active_route,
      case
        when coalesce(c.status, 'active') in ('paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only') then 'blocked_company_status'
        when c.ediel_id is null and not exists (
          select 1 from public.ediel_actor_settings eas where eas.company_id = c.id and eas.is_active = true
        ) then 'missing_actor_profile'
        when not (
          exists (select 1 from public.communication_routes cr where cr.company_id = c.id and cr.is_active = true)
          or exists (select 1 from public.ediel_route_profiles erp where erp.company_id = c.id and coalesce(erp.is_enabled, false) = true)
        ) then 'missing_route'
        else 'ready'
      end as readiness_status
    from public.companies c
    where coalesce(c.status, '') <> 'deleted_test_only'
  $view$;
end $$;
