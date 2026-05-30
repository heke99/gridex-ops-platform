-- DB3 tenant isolation and RBAC enforcement
-- Safe intent: no data deletion, no table drops, no constraint drops.
-- This migration tightens platform-admin detection, removes legacy broad/delete RLS policies
-- from tenant-sensitive tables, and adds validation views for tenant isolation.

create or replace function public.gridex_user_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_result boolean := false;
begin
  -- Explicit platform roles only. Legacy role "admin" must not unlock platform-wide data.
  if auth.uid() is null then
    return false;
  end if;

  if to_regclass('public.admin_users') is not null then
    select exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
        and coalesce(au.is_active, true) = true
        and lower(coalesce(au.role, '')) in ('super_admin','superadmin','platform_admin')
    ) into v_result;

    if coalesce(v_result, false) then
      return true;
    end if;
  end if;

  if to_regclass('public.user_roles') is not null then
    select exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and coalesce(ur.is_active, true) = true
        and lower(coalesce(ur.role, '')) in ('super_admin','superadmin','platform_admin')
    ) into v_result;

    if coalesce(v_result, false) then
      return true;
    end if;
  end if;

  return false;
exception when others then
  return false;
end;
$$;

create or replace function public.gridex_get_user_permissions(p_user_id uuid)
returns text[]
language sql
security definer
set search_path = public
as $$
  with role_based as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_roles ur
    join public.roles r
      on lower(coalesce(r.key, r.name, '')) = lower(coalesce(ur.role, ''))
    join public.role_permissions rp
      on rp.role_id = r.id
    join public.permissions p
      on p.id = rp.permission_id
    where ur.user_id = p_user_id
      and coalesce(ur.is_active, true) = true
      and coalesce(p.key, p.name) is not null
  ),
  direct_permissions as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_permissions up
    join public.permissions p
      on p.id = up.permission_id
    where up.user_id = p_user_id
      and coalesce(p.key, p.name) is not null
  ),
  explicit_platform_admin_fallback as (
    select 'admin.access'::text as permission_name
    where exists (
      select 1
      from public.admin_users au
      where au.user_id = p_user_id
        and coalesce(au.is_active, true) = true
        and lower(coalesce(au.role, '')) in ('super_admin','superadmin','platform_admin')
    )
  )
  select coalesce(array_agg(distinct permission_name order by permission_name), '{}'::text[])
  from (
    select permission_name from role_based
    union
    select permission_name from direct_permissions
    union
    select permission_name from explicit_platform_admin_fallback
  ) q
  where permission_name is not null;
$$;

create or replace function public.gridex_has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_permission is not null
    and p_permission = any(public.gridex_get_user_permissions(p_user_id));
$$;

create or replace function public.gridex_can(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if p_permission is null or auth.uid() is null then
    return false;
  end if;

  if public.gridex_user_is_platform_admin() then
    return true;
  end if;

  return public.gridex_has_permission(auth.uid(), p_permission);
exception when others then
  return false;
end;
$$;

-- Keep tenant read/write checks simple and strictly company-scoped.
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
    and coalesce(cm.status, 'active') = 'active'
    and coalesce(cm.is_active, true) = true
    and coalesce(c.is_active, true) = true
    and coalesce(c.status, 'active') not in ('archived','suspended','pending_deletion')
$$;

create or replace function public.gridex_can_read_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_company_id is not null and (
    public.gridex_user_is_platform_admin()
    or exists (
      select 1
      from public.gridex_user_company_ids() as c(company_id)
      where c.company_id = p_company_id
    )
  )
$$;

create or replace function public.gridex_can_write_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_company_id is not null and (
    public.gridex_user_is_platform_admin()
    or exists (
      select 1
      from public.company_memberships cm
      join public.companies c on c.id = cm.company_id
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and coalesce(cm.status, 'active') = 'active'
        and coalesce(cm.is_active, true) = true
        and coalesce(c.is_active, true) = true
        and coalesce(c.status, 'active') in ('active','onboarding')
        and lower(coalesce(cm.membership_role, cm.role, '')) in (
          'owner','admin','company_admin','company_owner','tenant_admin','operations_manager','customer_service_manager'
        )
    )
  )
$$;

-- Remove permissive legacy admin.access policies and DB1 hard-delete policies from tenant-sensitive tables.
-- Dropping policies does not remove data; it removes unsafe access paths.
do $$
declare
  r record;
  v_tables text[] := array[
    'audit_logs',
    'billing_export_runs',
    'billing_underlays',
    'communication_routes',
    'companies',
    'company_invitations',
    'company_memberships',
    'customer_contracts',
    'customer_sites',
    'customers',
    'ediel_actor_settings',
    'ediel_message_events',
    'ediel_messages',
    'ediel_route_profiles',
    'metering_points',
    'outbound_requests',
    'powers_of_attorney',
    'supplier_switch_requests'
  ];
begin
  for r in
    select schemaname, tablename, policyname, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
    from pg_policies
    where schemaname = 'public'
      and tablename = any(v_tables)
      and (
        cmd = 'DELETE'
        or coalesce(qual, '') ilike '%gridex_can(''admin.access''%'
        or coalesce(with_check, '') ilike '%gridex_can(''admin.access''%'
        or coalesce(qual, '') ilike '%admin_users%'
        or coalesce(with_check, '') ilike '%admin_users%'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Ensure the company-scoped policies exist for key tenant tables. Existing policies with the same
-- names are kept; the DO block only creates missing policies.
do $$
declare
  t text;
  v_tables text[] := array[
    'audit_logs',
    'billing_export_runs',
    'billing_underlays',
    'communication_routes',
    'company_invitations',
    'company_memberships',
    'customer_contracts',
    'customer_sites',
    'customers',
    'ediel_actor_settings',
    'ediel_message_events',
    'ediel_messages',
    'ediel_route_profiles',
    'metering_points',
    'outbound_requests',
    'powers_of_attorney',
    'supplier_switch_requests'
  ];
begin
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='gridex_db3_' || t || '_select_company') then
      execute format('create policy %I on public.%I for select using (gridex_user_is_platform_admin() or (company_id is not null and gridex_can_read_company(company_id)))', 'gridex_db3_' || t || '_select_company', t);
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='gridex_db3_' || t || '_insert_company') then
      execute format('create policy %I on public.%I for insert with check (gridex_user_is_platform_admin() or (company_id is not null and gridex_can_write_company(company_id)))', 'gridex_db3_' || t || '_insert_company', t);
    end if;

    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='gridex_db3_' || t || '_update_company') then
      execute format('create policy %I on public.%I for update using (gridex_user_is_platform_admin() or (company_id is not null and gridex_can_read_company(company_id))) with check (gridex_user_is_platform_admin() or (company_id is not null and gridex_can_write_company(company_id)))', 'gridex_db3_' || t || '_update_company', t);
    end if;
  end loop;
end $$;

-- Companies is special: members may read their own company, platform admins may manage companies.
alter table if exists public.companies enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='gridex_db3_companies_member_select') then
    create policy gridex_db3_companies_member_select
      on public.companies
      for select
      using (gridex_user_is_platform_admin() or id in (select c.company_id from public.gridex_user_company_ids() as c(company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='gridex_db3_companies_platform_insert') then
    create policy gridex_db3_companies_platform_insert
      on public.companies
      for insert
      with check (gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='gridex_db3_companies_platform_update') then
    create policy gridex_db3_companies_platform_update
      on public.companies
      for update
      using (gridex_user_is_platform_admin())
      with check (gridex_user_is_platform_admin());
  end if;
end $$;

create or replace view public.gridex_db3_tenant_policy_gaps_v as
with expected(table_name) as (
  values
    ('companies'),
    ('company_memberships'),
    ('company_invitations'),
    ('customers'),
    ('customer_sites'),
    ('metering_points'),
    ('customer_contracts'),
    ('powers_of_attorney'),
    ('supplier_switch_requests'),
    ('ediel_messages'),
    ('ediel_message_events'),
    ('ediel_actor_settings'),
    ('ediel_route_profiles'),
    ('communication_routes'),
    ('billing_underlays'),
    ('billing_export_runs'),
    ('outbound_requests'),
    ('audit_logs')
), live_tables as (
  select e.table_name
  from expected e
  join information_schema.tables t on t.table_schema = 'public' and t.table_name = e.table_name
), policy_summary as (
  select
    lt.table_name,
    exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=lt.table_name and p.cmd='SELECT') as has_select_policy,
    exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=lt.table_name and p.cmd='INSERT') as has_insert_policy,
    exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=lt.table_name and p.cmd='UPDATE') as has_update_policy,
    exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=lt.table_name and p.cmd='DELETE') as has_delete_policy,
    exists(
      select 1 from pg_policies p
      where p.schemaname='public'
        and p.tablename=lt.table_name
        and (coalesce(p.qual,'') ilike '%gridex_can(''admin.access''%' or coalesce(p.with_check,'') ilike '%gridex_can(''admin.access''%')
    ) as has_legacy_admin_access_policy
  from live_tables lt
)
select *
from policy_summary
where not has_select_policy
   or not has_insert_policy
   or not has_update_policy
   or has_delete_policy
   or has_legacy_admin_access_policy;

create or replace view public.gridex_db3_tenant_data_gaps_v as
select 'customers'::text as table_name, count(*)::integer as rows_without_company_id from public.customers where company_id is null
union all select 'customer_sites', count(*)::integer from public.customer_sites where company_id is null
union all select 'metering_points', count(*)::integer from public.metering_points where company_id is null
union all select 'customer_contracts', count(*)::integer from public.customer_contracts where company_id is null
union all select 'powers_of_attorney', count(*)::integer from public.powers_of_attorney where company_id is null
union all select 'supplier_switch_requests', count(*)::integer from public.supplier_switch_requests where company_id is null
union all select 'ediel_messages', count(*)::integer from public.ediel_messages where company_id is null
union all select 'ediel_message_events', count(*)::integer from public.ediel_message_events where company_id is null
union all select 'ediel_actor_settings', count(*)::integer from public.ediel_actor_settings where company_id is null
union all select 'ediel_route_profiles', count(*)::integer from public.ediel_route_profiles where company_id is null
union all select 'communication_routes', count(*)::integer from public.communication_routes where company_id is null
union all select 'billing_underlays', count(*)::integer from public.billing_underlays where company_id is null
union all select 'billing_export_runs', count(*)::integer from public.billing_export_runs where company_id is null
union all select 'outbound_requests', count(*)::integer from public.outbound_requests where company_id is null;

create or replace view public.gridex_db3_rbac_snapshot_v as
select
  'admin_users'::text as source_table,
  au.user_id,
  null::uuid as company_id,
  null::text as company_name,
  au.role,
  coalesce(au.is_active, true) as is_active,
  au.created_at,
  jsonb_build_object('scope','platform','is_platform_admin_role', lower(coalesce(au.role,'')) in ('super_admin','superadmin','platform_admin')) as details
from public.admin_users au
union all
select
  'company_memberships'::text as source_table,
  cm.user_id,
  cm.company_id,
  c.name as company_name,
  coalesce(cm.membership_role, cm.role, 'member') as role,
  coalesce(cm.is_active, true) as is_active,
  cm.created_at,
  jsonb_build_object('scope','tenant','status',cm.status,'company_slug',c.company_slug) as details
from public.company_memberships cm
left join public.companies c on c.id = cm.company_id;

create or replace view public.gridex_db3_final_readiness_v as
select
  'platform_admin_strict'::text as check_key,
  count(*) filter (
    where lower(coalesce(role,'')) = 'admin' and coalesce(is_active,true) = true
  )::integer as issue_count,
  'active admin_users.role=admin no longer counts as platform admin; review and convert to superadmin/platform_admin or tenant membership'::text as description
from public.admin_users
union all
select
  'active_company_memberships'::text,
  case when count(*) filter (where coalesce(status,'active')='active' and coalesce(is_active,true)=true) > 0 then 0 else 1 end::integer,
  'at least one active company membership should exist for tenant operations'::text
from public.company_memberships
union all
select
  'tenant_rows_without_company_id'::text,
  coalesce(sum(rows_without_company_id),0)::integer,
  'tenant-owned operational rows must have company_id'::text
from public.gridex_db3_tenant_data_gaps_v
union all
select
  'policy_gaps'::text,
  count(*)::integer,
  'missing select/insert/update company policies, remaining delete policies, or remaining broad admin.access policies'::text
from public.gridex_db3_tenant_policy_gaps_v
union all
select
  'companies_count'::text,
  case when count(*) > 0 then 0 else 1 end::integer,
  'at least one company/tenant must exist'::text
from public.companies;

insert into public.audit_logs(company_id, actor_user_id, entity_type, entity_id, action, metadata)
select
  null,
  null,
  'system_migration',
  'db3_tenant_isolation_rbac_enforcement',
  'db3_tenant_isolation_applied',
  jsonb_build_object(
    'safe', true,
    'data_delete_operations', false,
    'table_drops', false,
    'constraint_drops', false,
    'policy_cleanup', 'removed unsafe delete and broad legacy admin.access policies from tenant-sensitive tables',
    'applied_at', now()
  )
where to_regclass('public.audit_logs') is not null;
