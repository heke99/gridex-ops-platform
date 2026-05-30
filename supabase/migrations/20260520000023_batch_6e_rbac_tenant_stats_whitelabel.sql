-- Batch 6E: RBAC, tenant isolation, company statistics and white-label foundation.
-- Idempotent. Keeps approved Ediel generation/runtime intact and only tightens SaaS access/data scope.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Company-level metadata used by company settings, billing statistics and future white-label.
-- -----------------------------------------------------------------------------
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

    alter table public.companies drop constraint if exists companies_operating_environment_check;
    alter table public.companies
      add constraint companies_operating_environment_check
      check (operating_environment in ('test', 'production'));

    create index if not exists companies_ediel_id_idx on public.companies(ediel_id);
    create index if not exists companies_operating_environment_idx on public.companies(operating_environment);
  end if;
end $$;

-- Keep tenant actor profiles linked to company_id where the table exists.
do $$
begin
  if to_regclass('public.ediel_actor_settings') is not null then
    alter table public.ediel_actor_settings
      add column if not exists company_id uuid null references public.companies(id) on delete set null;
    create index if not exists ediel_actor_settings_company_env_idx
      on public.ediel_actor_settings(company_id, environment, is_active);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Robust platform/company helper functions for RLS and route-level checks.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_user_has_role_key(p_role_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if p_role_key is null then
    return false;
  end if;

  if to_regclass('public.user_roles') is null or to_regclass('public.roles') is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.key = p_role_key
  );
exception when undefined_table or undefined_column then
  return false;
end;
$$;

create or replace function public.gridex_user_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if public.gridex_user_has_role_key('super_admin') or public.gridex_user_has_role_key('platform_admin') then
    return true;
  end if;

  if to_regclass('public.user_roles') is null
     or to_regclass('public.roles') is null
     or to_regclass('public.role_permissions') is null
     or to_regclass('public.permissions') is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and p.key in ('tenants.write', 'permissions.manage')
  );
exception when undefined_table or undefined_column then
  return false;
end;
$$;

create or replace function public.gridex_company_is_writable(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_company_id is null then
    return false;
  end if;

  if to_regclass('public.companies') is null then
    return false;
  end if;

  select coalesce(status, 'active') into v_status
  from public.companies
  where id = p_company_id;

  return coalesce(v_status, 'missing') in ('active', 'onboarding');
exception when undefined_table or undefined_column then
  return false;
end;
$$;

create or replace function public.gridex_user_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select cm.company_id
  from public.company_memberships cm
  join public.companies c on c.id = cm.company_id
  where cm.user_id = auth.uid()
    and cm.status = 'active'
    and coalesce(c.status, 'active') <> 'deleted_test_only';
$$;

create or replace function public.gridex_can_read_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.gridex_user_is_platform_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    );
$$;

create or replace function public.gridex_user_can_manage_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.gridex_user_is_platform_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and coalesce(cm.membership_role, 'member') in ('owner', 'admin', 'company_admin')
    );
$$;

create or replace function public.gridex_can_write_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.gridex_company_is_writable(p_company_id)
    and (
      public.gridex_user_is_platform_admin()
      or exists (
        select 1
        from public.company_memberships cm
        where cm.company_id = p_company_id
          and cm.user_id = auth.uid()
          and cm.status = 'active'
          and coalesce(cm.membership_role, 'member') in ('owner', 'admin', 'company_admin', 'operations')
      )
    );
$$;

-- -----------------------------------------------------------------------------
-- Tenant indexes and RLS refresh for all known company-scoped tables.
-- -----------------------------------------------------------------------------
do $$
declare
  target_table text;
  target_tables text[] := array[
    'audit_logs',
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'customer_authorization_documents',
    'customer_documents',
    'power_of_attorneys',
    'powers_of_attorney',
    'customer_contracts',
    'customer_contract_events',
    'contract_offers',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'customer_operation_tasks',
    'outbound_requests',
    'ediel_messages',
    'ediel_message_events',
    'ediel_actor_settings',
    'ediel_route_profiles',
    'communication_routes',
    'metering_values',
    'meter_readings',
    'billing_underlays',
    'partner_exports',
    'files',
    'attachments'
  ];
  has_company_id boolean;
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'company_id'
    ) into has_company_id;

    if not has_company_id then
      continue;
    end if;

    execute format('create index if not exists %I on public.%I(company_id)', target_table || '_company_id_idx', target_table);
    execute format('alter table public.%I enable row level security', target_table);

    execute format('drop policy if exists %I on public.%I', target_table || '_tenant_select', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_tenant_insert', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_tenant_update', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_tenant_delete', target_table);

    execute format(
      'create policy %I on public.%I for select using (public.gridex_can_read_company(company_id))',
      target_table || '_tenant_select',
      target_table
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.gridex_can_write_company(company_id))',
      target_table || '_tenant_insert',
      target_table
    );
    execute format(
      'create policy %I on public.%I for update using (public.gridex_can_write_company(company_id)) with check (public.gridex_can_write_company(company_id))',
      target_table || '_tenant_update',
      target_table
    );
    execute format(
      'create policy %I on public.%I for delete using (public.gridex_user_is_platform_admin())',
      target_table || '_tenant_delete',
      target_table
    );
  end loop;
end $$;

-- Company/user governance policies.
do $$
begin
  if to_regclass('public.companies') is not null then
    execute 'alter table public.companies enable row level security';
    execute 'drop policy if exists companies_tenant_select on public.companies';
    execute 'create policy companies_tenant_select on public.companies for select using (public.gridex_user_is_platform_admin() or id in (select * from public.gridex_user_company_ids()))';
    execute 'drop policy if exists companies_superadmin_insert on public.companies';
    execute 'create policy companies_superadmin_insert on public.companies for insert with check (public.gridex_user_is_platform_admin())';
    execute 'drop policy if exists companies_superadmin_update on public.companies';
    execute 'create policy companies_superadmin_update on public.companies for update using (public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(id)) with check (public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(id))';
    execute 'drop policy if exists companies_superadmin_delete on public.companies';
    execute 'create policy companies_superadmin_delete on public.companies for delete using (public.gridex_user_is_platform_admin())';
  end if;

  if to_regclass('public.company_memberships') is not null then
    execute 'alter table public.company_memberships enable row level security';
    execute 'drop policy if exists company_memberships_tenant_select on public.company_memberships';
    execute 'create policy company_memberships_tenant_select on public.company_memberships for select using (public.gridex_user_is_platform_admin() or user_id = auth.uid() or public.gridex_can_read_company(company_id))';
    execute 'drop policy if exists company_memberships_tenant_write on public.company_memberships';
    execute 'create policy company_memberships_tenant_write on public.company_memberships for all using (public.gridex_user_can_manage_company(company_id)) with check (public.gridex_user_can_manage_company(company_id))';
  end if;

  if to_regclass('public.company_invitations') is not null then
    execute 'alter table public.company_invitations enable row level security';
    execute 'drop policy if exists company_invitations_tenant_select on public.company_invitations';
    execute 'create policy company_invitations_tenant_select on public.company_invitations for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))';
    execute 'drop policy if exists company_invitations_tenant_write on public.company_invitations';
    execute 'create policy company_invitations_tenant_write on public.company_invitations for all using (public.gridex_user_can_manage_company(company_id)) with check (public.gridex_user_can_manage_company(company_id))';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Billing/statistics view. This is read-only support data; UI still computes live
-- counts defensively, but the view gives a stable SQL surface for future billing.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.companies') is not null then
    execute $view$
      create or replace view public.company_billing_volume_overview as
      select
        c.id as company_id,
        c.name as company_name,
        c.org_number,
        c.status,
        coalesce(users.active_user_count, 0)::integer as active_user_count,
        coalesce(customers.total_count, 0)::integer as customer_count,
        coalesce(sites.total_count, 0)::integer as site_count,
        coalesce(metering_points.total_count, 0)::integer as metering_point_count,
        coalesce(ediel_messages.total_count, 0)::integer as ediel_message_count,
        coalesce(metering_values.total_count, 0)::integer as metering_value_count,
        coalesce(authorizations.total_count, 0)::integer as authorization_count,
        coalesce(billing_underlays.total_count, 0)::integer as billing_underlay_count,
        coalesce(partner_exports.total_count, 0)::integer as partner_export_count,
        now() as generated_at
      from public.companies c
      left join lateral (
        select count(*) as active_user_count
        from public.company_memberships cm
        where to_regclass('public.company_memberships') is not null
          and cm.company_id = c.id
          and cm.status = 'active'
      ) users on true
      left join lateral (
        select count(*) as total_count
        from public.customers t
        where to_regclass('public.customers') is not null and t.company_id = c.id
      ) customers on true
      left join lateral (
        select count(*) as total_count
        from public.customer_sites t
        where to_regclass('public.customer_sites') is not null and t.company_id = c.id
      ) sites on true
      left join lateral (
        select count(*) as total_count
        from public.metering_points t
        where to_regclass('public.metering_points') is not null and t.company_id = c.id
      ) metering_points on true
      left join lateral (
        select count(*) as total_count
        from public.ediel_messages t
        where to_regclass('public.ediel_messages') is not null and t.company_id = c.id
      ) ediel_messages on true
      left join lateral (
        select count(*) as total_count
        from public.metering_values t
        where to_regclass('public.metering_values') is not null and t.company_id = c.id
      ) metering_values on true
      left join lateral (
        select count(*) as total_count
        from public.customer_authorization_documents t
        where to_regclass('public.customer_authorization_documents') is not null and t.company_id = c.id
      ) authorizations on true
      left join lateral (
        select count(*) as total_count
        from public.billing_underlays t
        where to_regclass('public.billing_underlays') is not null and t.company_id = c.id
      ) billing_underlays on true
      left join lateral (
        select count(*) as total_count
        from public.partner_exports t
        where to_regclass('public.partner_exports') is not null and t.company_id = c.id
      ) partner_exports on true;
    $view$;
  end if;
exception when undefined_table or undefined_column then
  -- Some early dev databases do not have every operations table yet. The UI uses
  -- defensive live counts, so the migration should not block deployment.
  null;
end $$;

do $$
begin
  if to_regclass('public.company_billing_volume_overview') is not null then
    execute 'alter view public.company_billing_volume_overview set (security_invoker = true)';
  end if;
exception when others then
  null;
end $$;

do $$
begin
  if to_regclass('public.company_billing_volume_overview') is not null then
    comment on view public.company_billing_volume_overview is 'Read-only company volume overview used as foundation for future tenant billing/pricing.';
  end if;

  if to_regclass('public.companies') is not null then
    comment on column public.companies.branding is 'White-label foundation: logo, primary color, support copy, portal branding and later custom domain metadata.';
    comment on column public.companies.billing_settings is 'Future pricing model settings such as fixed fee, per-customer, per-metering-point, per-Ediel-message and export pricing.';
  end if;
end $$;
