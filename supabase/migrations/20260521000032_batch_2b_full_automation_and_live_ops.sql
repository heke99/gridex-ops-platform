-- Batch 2B: full automation and live operations foundation.
-- Idempotent SaaS-safe migration. Keeps approved Ediel payload/test behavior untouched.

create extension if not exists pgcrypto;

-- 1) Harden remaining risk tables with tenant-aware RLS where possible.
do $$
declare
  t text;
  has_company_id boolean;
  has_user_id boolean;
begin
  foreach t in array array[
    'user_roles',
    'user_permission_overrides',
    'sites',
    'outbound_dispatch_events',
    'customer_notes',
    'customer_internal_notes',
    'access_logs',
    'audit_logs',
    'customer_operation_tasks',
    'customer_info_requests',
    'customer_info_request_events',
    'billing_export_runs',
    'billing_export_run_items',
    'partner_exports',
    'customer_import_batches',
    'customer_import_rows'
  ] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);

      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'company_id'
      ) into has_company_id;

      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'user_id'
      ) into has_user_id;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = t || '_service_role_all'
      ) then
        execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service_role_all', t);
      end if;

      if has_company_id then
        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_tenant_select'
        ) then
          execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))', t || '_tenant_select', t);
        end if;

        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_tenant_insert'
        ) then
          execute format('create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))', t || '_tenant_insert', t);
        end if;

        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_tenant_update'
        ) then
          execute format('create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id)) with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))', t || '_tenant_update', t);
        end if;
      elsif has_user_id then
        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_self_or_platform_select'
        ) then
          execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or user_id = auth.uid())', t || '_self_or_platform_select', t);
        end if;
      else
        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_platform_select'
        ) then
          execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin())', t || '_platform_select', t);
        end if;
      end if;
    end if;
  end loop;
end $$;

-- 2) Production route wizard history.
create table if not exists public.production_route_wizard_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'validated', 'created', 'blocked', 'failed')),
  communication_route_id uuid null,
  ediel_route_profile_id uuid null,
  blocker_summary jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists production_route_wizard_runs_company_created_idx
  on public.production_route_wizard_runs(company_id, created_at desc);

alter table public.production_route_wizard_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'production_route_wizard_runs' and policyname = 'production_route_wizard_runs_service_role_all') then
    create policy production_route_wizard_runs_service_role_all on public.production_route_wizard_runs for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'production_route_wizard_runs' and policyname = 'production_route_wizard_runs_tenant_select') then
    create policy production_route_wizard_runs_tenant_select on public.production_route_wizard_runs for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- 3) Automation run/audit tables.
create table if not exists public.operations_automation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_type text not null default 'batch_2b_operations',
  status text not null default 'completed' check (status in ('running', 'completed', 'completed_with_flags', 'failed')),
  customers_scanned integer not null default 0,
  tasks_created integer not null default 0,
  requests_created integer not null default 0,
  cases_created integer not null default 0,
  exports_created integer not null default 0,
  blockers_found integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists operations_automation_runs_company_created_idx
  on public.operations_automation_runs(company_id, created_at desc);

alter table public.operations_automation_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'operations_automation_runs' and policyname = 'operations_automation_runs_service_role_all') then
    create policy operations_automation_runs_service_role_all on public.operations_automation_runs for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'operations_automation_runs' and policyname = 'operations_automation_runs_tenant_select') then
    create policy operations_automation_runs_tenant_select on public.operations_automation_runs for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- 4) Billing import tables for structured billing/metering underlays.
create table if not exists public.billing_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text null,
  source_type text not null default 'manual_upload',
  status text not null default 'previewed' check (status in ('previewed', 'imported', 'partially_imported', 'failed')),
  rows_total integer not null default 0,
  rows_imported integer not null default 0,
  rows_failed integer not null default 0,
  issues jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  imported_at timestamptz null
);

create table if not exists public.billing_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.billing_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  row_number integer not null,
  status text not null default 'pending' check (status in ('pending', 'imported', 'skipped', 'failed')),
  billing_underlay_id uuid null,
  normalized_payload jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_import_batches_company_created_idx on public.billing_import_batches(company_id, created_at desc);
create index if not exists billing_import_rows_batch_idx on public.billing_import_rows(import_batch_id, row_number);
create index if not exists billing_import_rows_company_status_idx on public.billing_import_rows(company_id, status);

alter table public.billing_import_batches enable row level security;
alter table public.billing_import_rows enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'billing_import_batches' and policyname = 'billing_import_batches_service_role_all') then
    create policy billing_import_batches_service_role_all on public.billing_import_batches for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'billing_import_batches' and policyname = 'billing_import_batches_tenant_select') then
    create policy billing_import_batches_tenant_select on public.billing_import_batches for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'billing_import_rows' and policyname = 'billing_import_rows_service_role_all') then
    create policy billing_import_rows_service_role_all on public.billing_import_rows for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'billing_import_rows' and policyname = 'billing_import_rows_tenant_select') then
    create policy billing_import_rows_tenant_select on public.billing_import_rows for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- 5) Add automation metadata columns required by Batch 2B runtime where older schemas are missing them.
do $$
begin
  if to_regclass('public.customer_info_requests') is not null then
    alter table public.customer_info_requests add column if not exists automation_origin text null;
    alter table public.customer_info_requests add column if not exists automation_key text null;
  end if;

  if to_regclass('public.outbound_requests') is not null then
    alter table public.outbound_requests add column if not exists automation_origin text null;
    alter table public.outbound_requests add column if not exists automation_key text null;
  end if;
end $$;

-- 6) Helpful indexes for Batch 2B operations.
do $$
begin
  if to_regclass('public.customer_contracts') is not null then
    create index if not exists customer_contracts_company_status_starts_idx on public.customer_contracts(company_id, status, starts_at);
  end if;
  if to_regclass('public.customer_info_requests') is not null then
    create index if not exists customer_info_requests_company_auto_key_idx on public.customer_info_requests(company_id, automation_key);
  end if;
  if to_regclass('public.outbound_requests') is not null then
    create index if not exists outbound_requests_company_auto_key_idx on public.outbound_requests(company_id, automation_key);
    create index if not exists outbound_requests_company_status_type_idx on public.outbound_requests(company_id, status, request_type, created_at desc);
  end if;
  if to_regclass('public.billing_export_run_items') is not null then
    create index if not exists billing_export_run_items_company_status_idx on public.billing_export_run_items(company_id, status, created_at desc);
  end if;
  if to_regclass('public.metering_values') is not null then
    create index if not exists metering_values_company_point_period_idx on public.metering_values(company_id, metering_point_id, period_start, period_end);
  end if;
end $$;

-- 7) Live operations Control Tower view.
create or replace view public.gridex_batch_2b_live_control_tower_v as
select
  c.id as company_id,
  c.name as company_name,
  c.status as company_status,
  c.production_status,
  c.live_ediel_enabled,
  coalesce((select count(*) from public.outbound_requests o where o.company_id = c.id and o.status in ('failed', 'queued', 'prepared')), 0)::integer as open_outbound_count,
  coalesce((select count(*) from public.customer_cases cc where cc.company_id = c.id and cc.status not in ('resolved', 'closed', 'cancelled')), 0)::integer as open_case_count,
  coalesce((select count(*) from public.billing_export_run_items bei where bei.company_id = c.id and bei.status = 'blocked'), 0)::integer as blocked_export_rows,
  coalesce((select count(*) from public.billing_import_rows bir where bir.company_id = c.id and bir.status = 'failed'), 0)::integer as failed_import_rows,
  coalesce((select count(*) from public.operations_automation_runs ar where ar.company_id = c.id), 0)::integer as automation_run_count,
  coalesce((select max(ar.created_at) from public.operations_automation_runs ar where ar.company_id = c.id), null) as last_automation_run_at,
  c.updated_at
from public.companies c;

-- 8) Risk table RLS status view for platform security page/control tower.
create or replace view public.gridex_batch_2b_rls_status_v as
select
  n.nspname as schema_name,
  cls.relname as table_name,
  cls.relrowsecurity as rls_enabled,
  cls.relforcerowsecurity as rls_forced,
  exists (
    select 1 from information_schema.columns col
    where col.table_schema = n.nspname and col.table_name = cls.relname and col.column_name = 'company_id'
  ) as has_company_id,
  (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = cls.relname)::integer as policy_count
from pg_class cls
join pg_namespace n on n.oid = cls.relnamespace
where n.nspname = 'public'
  and cls.relkind = 'r'
  and cls.relname in (
    'user_roles', 'user_permission_overrides', 'sites', 'outbound_dispatch_events',
    'customer_notes', 'customer_internal_notes', 'access_logs', 'audit_logs',
    'actor_test_results', 'company_go_live_reviews', 'customer_operation_tasks',
    'customer_info_requests', 'billing_export_runs', 'billing_export_run_items',
    'partner_exports', 'billing_import_batches', 'billing_import_rows'
  );
