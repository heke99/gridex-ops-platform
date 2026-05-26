-- Debug Batch 2 — Tenant/RBAC/server actions
-- Adds tenant RLS coverage for the newer customer onboarding/fullmakt/request tables
-- so direct DB access follows the same company boundary as the hardened server actions.

create or replace function public.gridex_table_has_company_id(p_table_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table_name
      and column_name = 'company_id'
  );
$$;

do $$
declare
  t text;
  tables text[] := array[
    'customer_blockers',
    'customer_authorization_documents',
    'customer_documents',
    'customer_contacts',
    'customer_internal_notes',
    'customer_info_requests',
    'customer_info_request_events',
    'authorization_scopes',
    'metering_permissions',
    'power_of_attorney_scopes',
    'customer_lifecycle_events',
    'customer_lifecycle_decisions',
    'customer_cases',
    'grid_owner_data_requests',
    'partner_exports',
    'outbound_dispatch_events',
    'supplier_switch_events'
  ];
  select_policy text;
  insert_policy text;
  update_policy text;
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is not null and public.gridex_table_has_company_id(t) then
      execute format('alter table public.%I enable row level security', t);

      select_policy := 'gridex_debug2_' || t || '_tenant_select';
      insert_policy := 'gridex_debug2_' || t || '_tenant_insert';
      update_policy := 'gridex_debug2_' || t || '_tenant_update';

      execute format('drop policy if exists %I on public.%I', select_policy, t);
      execute format('drop policy if exists %I on public.%I', insert_policy, t);
      execute format('drop policy if exists %I on public.%I', update_policy, t);

      execute format(
        'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))',
        select_policy,
        t
      );
      execute format(
        'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))',
        insert_policy,
        t
      );
      execute format(
        'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id)) with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))',
        update_policy,
        t
      );
    end if;
  end loop;
end $$;

create or replace view public.gridex_debug_batch2_tenant_policy_gaps_v as
with expected(table_name) as (
  values
    ('customer_blockers'),
    ('customer_authorization_documents'),
    ('customer_documents'),
    ('customer_contacts'),
    ('customer_internal_notes'),
    ('customer_info_requests'),
    ('customer_info_request_events'),
    ('authorization_scopes'),
    ('metering_permissions'),
    ('power_of_attorney_scopes'),
    ('customer_lifecycle_events'),
    ('customer_lifecycle_decisions'),
    ('customer_cases'),
    ('grid_owner_data_requests'),
    ('partner_exports'),
    ('outbound_dispatch_events'),
    ('supplier_switch_events')
), existing as (
  select e.table_name
  from expected e
  where to_regclass(format('public.%I', e.table_name)) is not null
    and public.gridex_table_has_company_id(e.table_name)
), policies as (
  select schemaname, tablename, policyname
  from pg_policies
  where schemaname = 'public'
)
select
  e.table_name,
  case when c.relrowsecurity then 'enabled' else 'disabled' end as rls_status,
  not exists (
    select 1 from policies p
    where p.tablename = e.table_name
      and p.policyname = 'gridex_debug2_' || e.table_name || '_tenant_select'
  ) as missing_select_policy,
  not exists (
    select 1 from policies p
    where p.tablename = e.table_name
      and p.policyname = 'gridex_debug2_' || e.table_name || '_tenant_insert'
  ) as missing_insert_policy,
  not exists (
    select 1 from policies p
    where p.tablename = e.table_name
      and p.policyname = 'gridex_debug2_' || e.table_name || '_tenant_update'
  ) as missing_update_policy
from existing e
join pg_class c on c.oid = to_regclass(format('public.%I', e.table_name))
where not c.relrowsecurity
   or not exists (
    select 1 from policies p
    where p.tablename = e.table_name
      and p.policyname = 'gridex_debug2_' || e.table_name || '_tenant_select'
  )
   or not exists (
    select 1 from policies p
    where p.tablename = e.table_name
      and p.policyname = 'gridex_debug2_' || e.table_name || '_tenant_insert'
  )
   or not exists (
    select 1 from policies p
    where p.tablename = e.table_name
      and p.policyname = 'gridex_debug2_' || e.table_name || '_tenant_update'
  );
