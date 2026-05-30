-- Batch 6D: Production validation, tenant governance and end-to-end hardening.
-- Idempotent. Adds superadmin controls without hard-deleting operational history.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tenant lifecycle states and governance metadata
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies drop constraint if exists companies_status_check;
    alter table public.companies
      add constraint companies_status_check
      check (status in ('active', 'onboarding', 'paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only'));

    alter table public.companies add column if not exists status_reason text null;
    alter table public.companies add column if not exists paused_at timestamptz null;
    alter table public.companies add column if not exists paused_by uuid null references auth.users(id) on delete set null;
    alter table public.companies add column if not exists suspended_at timestamptz null;
    alter table public.companies add column if not exists suspended_by uuid null references auth.users(id) on delete set null;
    alter table public.companies add column if not exists archived_at timestamptz null;
    alter table public.companies add column if not exists archived_by uuid null references auth.users(id) on delete set null;
    alter table public.companies add column if not exists deletion_requested_at timestamptz null;
    alter table public.companies add column if not exists deletion_requested_by uuid null references auth.users(id) on delete set null;
    alter table public.companies add column if not exists reactivated_at timestamptz null;
    alter table public.companies add column if not exists reactivated_by uuid null references auth.users(id) on delete set null;

    create index if not exists companies_governance_status_idx
      on public.companies(status, updated_at desc);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- User/member lifecycle states. These keep audit/history intact.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships drop constraint if exists company_memberships_role_check;
    alter table public.company_memberships
      add constraint company_memberships_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_memberships drop constraint if exists company_memberships_status_check;
    alter table public.company_memberships
      add constraint company_memberships_status_check
      check (status in ('active', 'invited', 'pending', 'suspended', 'disabled', 'removed', 'removed_from_company', 'invitation_revoked', 'locked_security', 'revoked'));

    alter table public.company_memberships add column if not exists disabled_at timestamptz null;
    alter table public.company_memberships add column if not exists disabled_by uuid null references auth.users(id) on delete set null;
    alter table public.company_memberships add column if not exists removed_at timestamptz null;
    alter table public.company_memberships add column if not exists removed_by uuid null references auth.users(id) on delete set null;
    alter table public.company_memberships add column if not exists status_reason text null;
  end if;

  if to_regclass('public.company_invitations') is not null then
    alter table public.company_invitations drop constraint if exists company_invitations_membership_role_check;
    alter table public.company_invitations
      add constraint company_invitations_membership_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_invitations drop constraint if exists company_invitations_status_check;
    alter table public.company_invitations
      add constraint company_invitations_status_check
      check (status in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked'));
  end if;

  if to_regclass('public.user_profiles') is not null then
    alter table public.user_profiles add column if not exists user_status text not null default 'active';
    alter table public.user_profiles add column if not exists disabled_at timestamptz null;
    alter table public.user_profiles add column if not exists disabled_by uuid null references auth.users(id) on delete set null;
    alter table public.user_profiles add column if not exists disabled_reason text null;
    alter table public.user_profiles add column if not exists reactivated_at timestamptz null;
    alter table public.user_profiles add column if not exists reactivated_by uuid null references auth.users(id) on delete set null;
    alter table public.user_profiles drop constraint if exists user_profiles_user_status_check;
    alter table public.user_profiles
      add constraint user_profiles_user_status_check
      check (user_status in ('active', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Governance event journal. Audit logs can still receive a copy, but this table is
-- intentionally narrow and stable for platform operations.
-- -----------------------------------------------------------------------------
create table if not exists public.tenant_governance_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete set null,
  target_user_id uuid null references auth.users(id) on delete set null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null,
  reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenant_governance_events_company_created_idx
  on public.tenant_governance_events(company_id, created_at desc);

create index if not exists tenant_governance_events_target_user_created_idx
  on public.tenant_governance_events(target_user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Runtime guard: paused/suspended/archived tenants keep read history but cannot
-- create new operational production rows. Superadmin actions update companies and
-- governance logs outside this trigger scope.
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

  if v_company_status in ('paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only') then
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
    'customer_contracts',
    'customer_contract_events',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'customer_operation_tasks',
    'outbound_requests',
    'ediel_messages',
    'metering_values',
    'billing_underlays',
    'partner_exports'
  ];
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = target_table
           and column_name = 'company_id'
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
-- Superadmin control-tower view for tenant blockers. Guarded because some local
-- dev databases may not have every operations table yet.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.companies') is not null
     and to_regclass('public.company_memberships') is not null
     and to_regclass('public.company_invitations') is not null
     and to_regclass('public.customers') is not null
     and to_regclass('public.ediel_messages') is not null
     and to_regclass('public.billing_underlays') is not null
  then
    execute $view$
      create or replace view public.platform_tenant_governance_overview as
      select
        c.id as company_id,
        c.name,
        c.org_number,
        c.status,
        c.status_reason,
        c.updated_at,
        coalesce(active_memberships.count, 0) as active_user_count,
        coalesce(customers.count, 0) as customer_count,
        coalesce(ediel_messages.count, 0) as ediel_message_count,
        coalesce(blocked_underlays.count, 0) as blocked_billing_underlay_count,
        coalesce(pending_invitations.count, 0) as pending_invitation_count
      from public.companies c
      left join lateral (
        select count(*)::integer as count
        from public.company_memberships cm
        where cm.company_id = c.id and cm.status = 'active'
      ) active_memberships on true
      left join lateral (
        select count(*)::integer as count
        from public.company_invitations ci
        where ci.company_id = c.id and ci.status = 'pending'
      ) pending_invitations on true
      left join lateral (
        select count(*)::integer as count
        from public.customers cu
        where cu.company_id = c.id
      ) customers on true
      left join lateral (
        select count(*)::integer as count
        from public.ediel_messages em
        where em.company_id = c.id
      ) ediel_messages on true
      left join lateral (
        select count(*)::integer as count
        from public.billing_underlays bu
        where bu.company_id = c.id
          and coalesce(bu.readiness_status, 'not_checked') not in ('ready', 'export_ready', 'exported')
      ) blocked_underlays on true;
    $view$;

      end if;
end $$;

comment on table public.tenant_governance_events is 'Superadmin tenant/user governance event journal for pause, suspend, archive, deletion checks and user disable/remove actions.';
