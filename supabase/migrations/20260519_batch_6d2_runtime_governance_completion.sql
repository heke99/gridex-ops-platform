-- Batch 6D-2: Complete runtime governance, RLS hardening, Control Tower helpers,
-- UTILTS/billing audit foundations, task transfer and session revocation support.
-- Idempotent and guarded for partially upgraded local/Supabase databases.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- User lifecycle/session revocation compatibility
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.user_roles') is not null then
    alter table public.user_roles add column if not exists status text not null default 'active';
    alter table public.user_roles add column if not exists is_active boolean not null default true;
    alter table public.user_roles add column if not exists disabled_at timestamptz null;
    alter table public.user_roles add column if not exists disabled_by uuid null references auth.users(id) on delete set null;
    alter table public.user_roles add column if not exists status_reason text null;

    update public.user_roles
       set is_active = case when status in ('disabled', 'removed_from_company', 'invitation_revoked', 'locked_security') then false else coalesce(is_active, true) end;

    alter table public.user_roles drop constraint if exists user_roles_status_check;
    alter table public.user_roles
      add constraint user_roles_status_check
      check (status in ('active', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security'));

    create index if not exists user_roles_user_status_idx
      on public.user_roles(user_id, status, is_active);
  end if;

  if to_regclass('public.user_profiles') is not null then
    alter table public.user_profiles add column if not exists user_status text not null default 'active';
    alter table public.user_profiles add column if not exists disabled_at timestamptz null;
    alter table public.user_profiles add column if not exists disabled_by uuid null references auth.users(id) on delete set null;
    alter table public.user_profiles add column if not exists disabled_reason text null;
    alter table public.user_profiles add column if not exists reactivated_at timestamptz null;
    alter table public.user_profiles add column if not exists reactivated_by uuid null references auth.users(id) on delete set null;
    alter table public.user_profiles add column if not exists session_revoked_at timestamptz null;

    alter table public.user_profiles drop constraint if exists user_profiles_user_status_check;
    alter table public.user_profiles
      add constraint user_profiles_user_status_check
      check (user_status in ('active', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security'));
  end if;
end $$;

create table if not exists public.platform_session_revocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revoked_by uuid null references auth.users(id) on delete set null,
  reason text null,
  revoked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists platform_session_revocations_user_idx
  on public.platform_session_revocations(user_id, revoked_at desc);

create or replace function public.gridex_is_current_session_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_disabled_at timestamptz;
begin
  if v_user_id is null then
    return false;
  end if;

  if to_regclass('public.user_profiles') is null then
    return true;
  end if;

  select user_status, disabled_at
    into v_status, v_disabled_at
  from public.user_profiles
  where id = v_user_id;

  if coalesce(v_status, 'active') in ('disabled', 'locked_security', 'removed_from_company', 'invitation_revoked') then
    return false;
  end if;

  if v_disabled_at is not null then
    return false;
  end if;

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Operational tenant helpers used by RLS and runtime. Superadmin can read/write;
-- company users can read their tenant; writes require active/onboarding tenant.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_auth_has_any_role(p_role_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.key = any(p_role_keys)
      and coalesce(ur.is_active, true) = true
      and coalesce(ur.status, 'active') = 'active'
  );
$$;

create or replace function public.gridex_user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.gridex_auth_has_any_role(array['super_admin', 'admin', 'platform_admin']);
$$;

create or replace function public.gridex_company_status_is_writable(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.status in ('active', 'onboarding') from public.companies c where c.id = p_company_id), false);
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
    and coalesce(c.status, 'active') not in ('deleted_test_only')
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

create or replace function public.gridex_can_write_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select (public.gridex_user_is_platform_admin()
      or exists (
        select 1
        from public.company_memberships cm
        where cm.company_id = p_company_id
          and cm.user_id = auth.uid()
          and cm.status = 'active'
          and coalesce(cm.membership_role, 'member') in ('owner', 'admin', 'company_admin', 'operations')
      ))
    and public.gridex_company_status_is_writable(p_company_id);
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

-- -----------------------------------------------------------------------------
-- RLS policy refresh for company-scoped tables. Service role still bypasses RLS.
-- -----------------------------------------------------------------------------
do $$
declare
  target_table text;
  target_tables text[] := array[
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'customer_authorization_documents',
    'customer_documents',
    'customer_contracts',
    'customer_contract_events',
    'contract_offers',
    'contract_offer_versions',
    'powers_of_attorney',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'customer_operation_tasks',
    'outbound_requests',
    'ediel_messages',
    'ediel_message_events',
    'metering_values',
    'billing_underlays',
    'partner_exports',
    'communication_routes',
    'ediel_actor_settings',
    'ediel_route_profiles',
    'customer_sync_events',
    'customer_import_batches',
    'customer_import_rows',
    'audit_logs'
  ];
  has_company_id boolean;
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = target_table and column_name = 'company_id'
    ) into has_company_id;

    if has_company_id then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_select', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_insert', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_update', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_delete', target_table);
      execute format('drop policy if exists %I on public.%I', target_table || '_tenant_write', target_table);

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
        'create policy %I on public.%I for update using (public.gridex_can_read_company(company_id)) with check (public.gridex_can_write_company(company_id))',
        target_table || '_tenant_update',
        target_table
      );
      execute format(
        'create policy %I on public.%I for delete using (public.gridex_user_is_platform_admin())',
        target_table || '_tenant_delete',
        target_table
      );
    end if;
  end loop;
end $$;

-- Company/admin tables need bespoke policies because they either use id as tenant
-- key or must be manageable by platform/company admins.
do $$
begin
  if to_regclass('public.companies') is not null then
    execute 'alter table public.companies enable row level security';
    execute 'drop policy if exists companies_tenant_select on public.companies';
    execute 'create policy companies_tenant_select on public.companies for select using (public.gridex_user_is_platform_admin() or id in (select * from public.gridex_user_company_ids()))';
    execute 'drop policy if exists companies_super_admin_write on public.companies';
    execute 'create policy companies_super_admin_write on public.companies for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())';
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

  if to_regclass('public.tenant_governance_events') is not null then
    execute 'alter table public.tenant_governance_events enable row level security';
    execute 'drop policy if exists tenant_governance_events_select on public.tenant_governance_events';
    execute 'create policy tenant_governance_events_select on public.tenant_governance_events for select using (public.gridex_user_is_platform_admin() or company_id in (select * from public.gridex_user_company_ids()))';
    execute 'drop policy if exists tenant_governance_events_write on public.tenant_governance_events';
    execute 'create policy tenant_governance_events_write on public.tenant_governance_events for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Runtime guard extended to all operational create/update flows with company_id.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_assert_company_operational_for_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_status text;
begin
  if new.company_id is null then
    return new;
  end if;

  select status into v_company_status
  from public.companies
  where id = new.company_id;

  if coalesce(v_company_status, 'active') not in ('active', 'onboarding') then
    raise exception 'Tenant % is %, write is blocked for operational data', new.company_id, v_company_status
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

do $$
declare
  target_table text;
  target_tables text[] := array[
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'customer_authorization_documents',
    'customer_documents',
    'customer_contracts',
    'customer_contract_events',
    'contract_offers',
    'contract_offer_versions',
    'powers_of_attorney',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'customer_operation_tasks',
    'outbound_requests',
    'ediel_messages',
    'ediel_message_events',
    'metering_values',
    'billing_underlays',
    'partner_exports',
    'communication_routes',
    'ediel_actor_settings',
    'ediel_route_profiles',
    'customer_sync_events',
    'customer_import_batches',
    'customer_import_rows'
  ];
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is not null
       and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = target_table and column_name = 'company_id'
       ) then
      execute format('drop trigger if exists %I on public.%I', target_table || '_tenant_operational_guard_trg', target_table);
      execute format(
        'create trigger %I before insert or update of company_id on public.%I for each row execute function public.gridex_assert_company_operational_for_write()',
        target_table || '_tenant_operational_guard_trg',
        target_table
      );
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Operational completion columns: task reassignment, partner export v1 and audits.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customer_operation_tasks') is not null then
    alter table public.customer_operation_tasks add column if not exists assigned_to uuid null references auth.users(id) on delete set null;
    alter table public.customer_operation_tasks add column if not exists reassigned_at timestamptz null;
    alter table public.customer_operation_tasks add column if not exists reassigned_by uuid null references auth.users(id) on delete set null;
    alter table public.customer_operation_tasks add column if not exists assignment_reason text null;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_operation_tasks' and column_name = 'company_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_operation_tasks' and column_name = 'assigned_to')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_operation_tasks' and column_name = 'status')
    then
      create index if not exists customer_operation_tasks_assigned_company_status_idx
        on public.customer_operation_tasks(company_id, assigned_to, status);
    end if;
  end if;

  if to_regclass('public.partner_exports') is not null then
    alter table public.partner_exports add column if not exists payload_version text not null default 'partner_export_v1';
    alter table public.partner_exports add column if not exists prepared_payload jsonb not null default '{}'::jsonb;
    alter table public.partner_exports add column if not exists prepared_at timestamptz null;
    alter table public.partner_exports add column if not exists export_error_summary text null;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_exports' and column_name = 'company_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_exports' and column_name = 'status')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_exports' and column_name = 'export_batch_key')
    then
      create index if not exists partner_exports_company_status_batch_idx
        on public.partner_exports(company_id, status, export_batch_key);
    end if;
  end if;

  if to_regclass('public.metering_values') is not null then
    alter table public.metering_values add column if not exists source_order integer null;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'metering_values' and column_name = 'company_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'metering_values' and column_name = 'metering_point_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'metering_values' and column_name = 'period_start')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'metering_values' and column_name = 'period_end')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'metering_values' and column_name = 'is_current')
    then
      create index if not exists metering_values_company_period_current_idx
        on public.metering_values(company_id, metering_point_id, period_start, period_end, is_current);
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Control Tower RPC helpers and audit views. These are guarded in code too, but
-- DB-level helpers keep admin pages fast and consistent.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_companies_missing_ediel_profile()
returns table(id uuid, name text, org_number text, status text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.companies') is null or to_regclass('public.ediel_actor_settings') is null then
    return;
  end if;

  return query execute $sql$
    select c.id, c.name::text, c.org_number::text, c.status::text, c.updated_at
    from public.companies c
    where coalesce(c.status, 'active') not in ('archived', 'deleted_test_only')
      and not exists (
        select 1
        from public.ediel_actor_settings eas
        where eas.company_id = c.id
          and coalesce(eas.is_active, true) = true
      )
    order by c.updated_at desc nulls last
  $sql$;
exception
  when undefined_table or undefined_column then
    return;
end;
$$;

create or replace function public.gridex_companies_missing_route_setup()
returns table(id uuid, name text, org_number text, status text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_has_communication_routes boolean := to_regclass('public.communication_routes') is not null;
  v_has_ediel_route_profiles boolean := to_regclass('public.ediel_route_profiles') is not null;
begin
  if to_regclass('public.companies') is null then
    return;
  end if;

  v_sql := 'select c.id, c.name::text, c.org_number::text, c.status::text, c.updated_at from public.companies c where coalesce(c.status, ''active'') not in (''archived'', ''deleted_test_only'')';

  if v_has_communication_routes then
    v_sql := v_sql || ' and not exists (select 1 from public.communication_routes cr where cr.company_id = c.id and coalesce(cr.is_active, true) = true)';
  end if;

  if v_has_ediel_route_profiles then
    v_sql := v_sql || ' and not exists (select 1 from public.ediel_route_profiles erp where erp.company_id = c.id and coalesce(erp.is_enabled, true) = true)';
  end if;

  if not v_has_communication_routes and not v_has_ediel_route_profiles then
    return query execute v_sql || ' order by c.updated_at desc nulls last';
    return;
  end if;

  return query execute v_sql || ' order by c.updated_at desc nulls last';
exception
  when undefined_table or undefined_column then
    return;
end;
$$;

-- Metering/billing audit view. Created only when core tables exist.
do $$
begin
  if to_regclass('public.companies') is not null
     and to_regclass('public.metering_values') is not null
     and to_regclass('public.billing_underlays') is not null
     and to_regclass('public.partner_exports') is not null
  then
    execute $view$
      create or replace view public.metering_billing_audit_overview as
      select
        c.id as company_id,
        c.name as company_name,
        c.status as company_status,
        coalesce(mv.total_metering_values, 0) as total_metering_values,
        coalesce(mv.current_metering_values, 0) as current_metering_values,
        coalesce(mv.replaced_metering_values, 0) as replaced_metering_values,
        coalesce(bu.total_billing_underlays, 0) as total_billing_underlays,
        coalesce(bu.ready_underlays, 0) as ready_underlays,
        coalesce(bu.blocked_underlays, 0) as blocked_underlays,
        coalesce(pe.total_partner_exports, 0) as total_partner_exports,
        greatest(coalesce(mv.latest_metering_at, c.updated_at), coalesce(bu.latest_underlay_at, c.updated_at), coalesce(pe.latest_export_at, c.updated_at)) as latest_activity_at
      from public.companies c
      left join lateral (
        select
          count(*)::integer as total_metering_values,
          count(*) filter (where coalesce(is_current, true) = true)::integer as current_metering_values,
          count(*) filter (where coalesce(value_status, '') = 'replaced')::integer as replaced_metering_values,
          max(created_at) as latest_metering_at
        from public.metering_values mv
        where mv.company_id = c.id
      ) mv on true
      left join lateral (
        select
          count(*)::integer as total_billing_underlays,
          count(*) filter (where coalesce(readiness_status, status, '') in ('ready', 'export_ready', 'exported', 'validated'))::integer as ready_underlays,
          count(*) filter (where coalesce(readiness_status, status, '') in ('blocked', 'requires_correction', 'failed'))::integer as blocked_underlays,
          max(created_at) as latest_underlay_at
        from public.billing_underlays bu
        where bu.company_id = c.id
      ) bu on true
      left join lateral (
        select count(*)::integer as total_partner_exports, max(created_at) as latest_export_at
        from public.partner_exports pe
        where pe.company_id = c.id
      ) pe on true;
    $view$;
  end if;
end $$;

