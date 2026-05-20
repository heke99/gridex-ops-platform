-- Batch 6E fix: server-side RBAC support, company metadata backfill and tenant-scope cleanup.
-- Idempotent. Intended to be run after 20260520_batch_6e_rbac_tenant_stats_whitelabel.sql.

create extension if not exists pgcrypto;

-- Keep the full company settings field set available even on environments that missed the first 6E migration.
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies add column if not exists billing_contact_email text null;
    alter table public.companies add column if not exists support_email text null;
    alter table public.companies add column if not exists address_line_1 text null;
    alter table public.companies add column if not exists address_line_2 text null;
    alter table public.companies add column if not exists postal_code text null;
    alter table public.companies add column if not exists city text null;
    alter table public.companies add column if not exists country_code text null default 'SE';
    alter table public.companies add column if not exists ediel_id text null;
    alter table public.companies add column if not exists actor_role text null;
    alter table public.companies add column if not exists sender_sub_address text null;
    alter table public.companies add column if not exists ediel_mailbox text null;
    alter table public.companies add column if not exists operating_environment text null default 'test';
    alter table public.companies add column if not exists branding jsonb not null default '{}'::jsonb;
    alter table public.companies add column if not exists billing_settings jsonb not null default '{}'::jsonb;

    update public.companies
      set status = coalesce(nullif(status, ''), 'active'),
          country_code = coalesce(nullif(country_code, ''), 'SE'),
          operating_environment = case when operating_environment = 'production' then 'production' else 'test' end
      where status is null
         or status = ''
         or country_code is null
         or country_code = ''
         or operating_environment is null
         or operating_environment not in ('test', 'production');

    alter table public.companies drop constraint if exists companies_operating_environment_check;
    alter table public.companies
      add constraint companies_operating_environment_check
      check (operating_environment in ('test', 'production'));

    create index if not exists companies_ediel_id_idx on public.companies(ediel_id);
    create index if not exists companies_operating_environment_idx on public.companies(operating_environment);
  end if;
end $$;

-- Backfill active memberships from user_profiles.active_company_id when older environments have users tied to a company but no membership row.
do $$
declare
  has_user_profiles boolean;
  has_active_company_id boolean;
  has_company_memberships boolean;
  has_company_role_column boolean;
begin
  has_user_profiles := to_regclass('public.user_profiles') is not null;
  has_company_memberships := to_regclass('public.company_memberships') is not null;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'active_company_id'
  ) into has_active_company_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_memberships' and column_name = 'membership_role'
  ) into has_company_role_column;

  if has_user_profiles and has_company_memberships and has_active_company_id and has_company_role_column then
    execute $sql$
      insert into public.company_memberships (company_id, user_id, membership_role, status, accepted_at, metadata)
      select up.active_company_id, up.id, 'admin', 'active', now(), jsonb_build_object('backfill', 'batch_6e_fix_user_profiles_active_company')
      from public.user_profiles up
      where up.active_company_id is not null
        and not exists (
          select 1 from public.company_memberships cm
          where cm.company_id = up.active_company_id and cm.user_id = up.id
        )
    $sql$;
  end if;
end $$;

-- Backfill active_company_id from memberships so login/dashboard can resolve tenant context for older users.
do $$
declare
  has_user_profiles boolean;
  has_active_company_id boolean;
  has_company_memberships boolean;
begin
  has_user_profiles := to_regclass('public.user_profiles') is not null;
  has_company_memberships := to_regclass('public.company_memberships') is not null;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'active_company_id'
  ) into has_active_company_id;

  if has_user_profiles and has_company_memberships and has_active_company_id then
    execute $sql$
      update public.user_profiles up
      set active_company_id = chosen.company_id
      from (
        select distinct on (user_id) user_id, company_id
        from public.company_memberships
        where status = 'active'
        order by user_id, accepted_at nulls last, invited_at nulls last
      ) chosen
      where up.id = chosen.user_id
        and up.active_company_id is null
    $sql$;
  end if;
end $$;

-- Normalize membership status and create useful indexes for tenant checks.
do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships add column if not exists status text null default 'active';
    update public.company_memberships set status = 'active' where status is null or status = '';
    create index if not exists company_memberships_user_status_idx on public.company_memberships(user_id, status);
    create index if not exists company_memberships_company_status_idx on public.company_memberships(company_id, status);
  end if;
end $$;

-- Ensure owner/admin memberships have a company_admin role if the install has the RBAC tables.
do $$
declare
  company_admin_role_id uuid;
begin
  if to_regclass('public.roles') is null or to_regclass('public.user_roles') is null or to_regclass('public.company_memberships') is null then
    return;
  end if;

  select id into company_admin_role_id from public.roles where key = 'company_admin' limit 1;
  if company_admin_role_id is null then
    return;
  end if;

  insert into public.user_roles (user_id, role_id, status)
  select distinct cm.user_id, company_admin_role_id, 'active'
  from public.company_memberships cm
  where cm.status = 'active'
    and cm.membership_role in ('owner', 'admin', 'company_admin')
    and not exists (
      select 1 from public.user_roles ur
      where ur.user_id = cm.user_id and ur.role_id = company_admin_role_id
    )
  on conflict do nothing;
exception when undefined_column then
  insert into public.user_roles (user_id, role_id)
  select distinct cm.user_id, company_admin_role_id
  from public.company_memberships cm
  where cm.status = 'active'
    and cm.membership_role in ('owner', 'admin', 'company_admin')
    and not exists (
      select 1 from public.user_roles ur
      where ur.user_id = cm.user_id and ur.role_id = company_admin_role_id
    )
  on conflict do nothing;
end $$;

-- A small DB-side audit view for manual tenant-scope verification in Supabase SQL editor.
create or replace view public.gridex_rbac_tenant_audit_summary as
select
  'companies'::text as area,
  count(*)::bigint as total_rows,
  count(*) filter (where status in ('paused', 'suspended', 'archived', 'pending_deletion'))::bigint as blocked_rows
from public.companies
where to_regclass('public.companies') is not null
union all
select
  'company_memberships'::text as area,
  count(*)::bigint as total_rows,
  count(*) filter (where status is distinct from 'active')::bigint as blocked_rows
from public.company_memberships
where to_regclass('public.company_memberships') is not null;
