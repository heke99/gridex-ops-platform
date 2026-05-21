-- Batch 2C: end-to-end operations automation, row-level partner export, period gaps,
-- external contract intake, customer portal completion and live control queues.
-- Idempotent and additive. Does not alter approved Ediel payload generation/facit.

create extension if not exists pgcrypto;

-- 1) Fuller policy report support and RLS hardening for remaining risk tables.
do $$
declare
  t text;
  has_company boolean;
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
    'actor_test_results',
    'company_go_live_reviews',
    'customer_operation_tasks',
    'customer_info_requests',
    'billing_export_runs',
    'billing_export_run_items',
    'partner_exports',
    'billing_import_batches',
    'billing_import_rows',
    'customer_import_batches',
    'customer_import_rows'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = t || '_batch2c_service_role_all'
      ) then
        execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_batch2c_service_role_all', t);
      end if;

      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'company_id'
      ) into has_company;

      if has_company then
        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_batch2c_tenant_select'
        ) then
          execute format(
            'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))',
            t || '_batch2c_tenant_select',
            t
          );
        end if;

        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_batch2c_tenant_insert'
        ) then
          execute format(
            'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))',
            t || '_batch2c_tenant_insert',
            t
          );
        end if;

        if not exists (
          select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_batch2c_tenant_update'
        ) then
          execute format(
            'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id)) with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))',
            t || '_batch2c_tenant_update',
            t
          );
        end if;
      end if;
    end if;
  end loop;
end $$;

create or replace view public.gridex_batch_2c_rls_policy_report_v as
with risk_tables(table_name, expected_scope) as (
  values
    ('user_roles', 'user-or-company'),
    ('user_permission_overrides', 'user-or-company'),
    ('sites', 'company'),
    ('outbound_dispatch_events', 'company'),
    ('customer_notes', 'company'),
    ('customer_internal_notes', 'company'),
    ('access_logs', 'company-or-platform'),
    ('audit_logs', 'company'),
    ('actor_test_results', 'company'),
    ('company_go_live_reviews', 'company'),
    ('customer_operation_tasks', 'company'),
    ('customer_info_requests', 'company'),
    ('billing_export_runs', 'company'),
    ('billing_export_run_items', 'company'),
    ('partner_exports', 'company'),
    ('billing_import_batches', 'company'),
    ('billing_import_rows', 'company'),
    ('customer_import_batches', 'company'),
    ('customer_import_rows', 'company'),
    ('external_contract_intakes', 'company'),
    ('metering_period_gaps', 'company'),
    ('customer_portal_completions', 'company')
)
select
  rt.table_name,
  rt.expected_scope,
  n.nspname as schema_name,
  cls.relrowsecurity as rls_enabled,
  cls.relforcerowsecurity as rls_forced,
  exists (
    select 1 from information_schema.columns col
    where col.table_schema = 'public' and col.table_name = rt.table_name and col.column_name = 'company_id'
  ) as has_company_id,
  coalesce((select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = rt.table_name), 0)::integer as policy_count,
  coalesce((
    select jsonb_agg(jsonb_build_object('policy', p.policyname, 'command', p.cmd, 'roles', p.roles) order by p.policyname)
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = rt.table_name
  ), '[]'::jsonb) as policies,
  case
    when cls.oid is null then 'missing_table'
    when not cls.relrowsecurity then 'rls_disabled'
    when (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = rt.table_name) = 0 then 'missing_policy'
    when rt.expected_scope = 'company'
      and not exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public' and col.table_name = rt.table_name and col.column_name = 'company_id'
      ) then 'missing_company_scope'
    else 'ok'
  end as verification_status
from risk_tables rt
left join pg_class cls on cls.relname = rt.table_name and cls.relkind = 'r'
left join pg_namespace n on n.oid = cls.relnamespace and n.nspname = 'public'
order by
  case
    when cls.oid is null then 1
    when not cls.relrowsecurity then 2
    when (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = rt.table_name) = 0 then 3
    else 4
  end,
  rt.table_name;

-- 2) Row-level export lifecycle fields. Ready rows can be queued/sent/retried without changing blocked rows.
do $$
begin
  if to_regclass('public.billing_export_run_items') is not null then
    alter table public.billing_export_run_items add column if not exists export_status text not null default 'not_queued';
    alter table public.billing_export_run_items add column if not exists partner_export_id uuid null;
    alter table public.billing_export_run_items add column if not exists idempotency_key text null;
    alter table public.billing_export_run_items add column if not exists queued_at timestamptz null;
    alter table public.billing_export_run_items add column if not exists sent_at timestamptz null;
    alter table public.billing_export_run_items add column if not exists acknowledged_at timestamptz null;
    alter table public.billing_export_run_items add column if not exists failed_at timestamptz null;
    alter table public.billing_export_run_items add column if not exists retry_count integer not null default 0;
    alter table public.billing_export_run_items add column if not exists last_error text null;
    alter table public.billing_export_run_items add column if not exists blocker_case_id uuid null;
    alter table public.billing_export_run_items add column if not exists updated_at timestamptz not null default now();

    create unique index if not exists billing_export_run_items_company_idempotency_uidx
      on public.billing_export_run_items(company_id, idempotency_key)
      where idempotency_key is not null;

    create index if not exists billing_export_run_items_company_export_status_idx
      on public.billing_export_run_items(company_id, export_status, updated_at desc);
  end if;
end $$;

-- 3) Metering period gap table: one row per missing metering point + period.
create table if not exists public.metering_period_gaps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_id uuid null,
  metering_point_id uuid not null,
  grid_owner_id uuid null,
  period_month text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'open',
  severity text not null default 'warning',
  outbound_request_id uuid null,
  customer_case_id uuid null,
  detected_by text not null default 'batch_2c_period_motor',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metering_period_gaps_status_check check (status in ('open', 'request_queued', 'waiting_for_data', 'resolved', 'ignored', 'failed')),
  constraint metering_period_gaps_severity_check check (severity in ('info', 'warning', 'critical')),
  unique(company_id, metering_point_id, period_month)
);

create index if not exists metering_period_gaps_company_status_idx
  on public.metering_period_gaps(company_id, status, period_month desc);
create index if not exists metering_period_gaps_company_point_idx
  on public.metering_period_gaps(company_id, metering_point_id, period_month desc);

alter table public.metering_period_gaps enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'metering_period_gaps' and policyname = 'metering_period_gaps_service_role_all') then
    create policy metering_period_gaps_service_role_all on public.metering_period_gaps for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'metering_period_gaps' and policyname = 'metering_period_gaps_tenant_select') then
    create policy metering_period_gaps_tenant_select on public.metering_period_gaps for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'metering_period_gaps' and policyname = 'metering_period_gaps_tenant_write') then
    create policy metering_period_gaps_tenant_write on public.metering_period_gaps for all using (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id)) with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;
end $$;

-- 4) External contract intake from public website.
create table if not exists public.external_contract_intakes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'received',
  source_channel text not null default 'public_contract_form',
  idempotency_key text not null,
  customer_type text not null default 'private',
  first_name text null,
  last_name text null,
  company_name text null,
  email text null,
  phone text null,
  personal_number text null,
  org_number text null,
  facility_id text null,
  meter_point_id text null,
  street text null,
  postal_code text null,
  city text null,
  move_in_date date null,
  price_area_code text null,
  contract_offer_id uuid null,
  requested_start_date date null,
  created_customer_id uuid null,
  created_site_id uuid null,
  created_metering_point_id uuid null,
  created_contract_id uuid null,
  created_case_id uuid null,
  created_info_request_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_contract_intakes_status_check check (status in ('received', 'created', 'needs_review', 'duplicate', 'failed', 'cancelled')),
  unique(company_id, idempotency_key)
);

create index if not exists external_contract_intakes_company_status_idx
  on public.external_contract_intakes(company_id, status, created_at desc);

alter table public.external_contract_intakes enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'external_contract_intakes' and policyname = 'external_contract_intakes_service_role_all') then
    create policy external_contract_intakes_service_role_all on public.external_contract_intakes for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'external_contract_intakes' and policyname = 'external_contract_intakes_tenant_select') then
    create policy external_contract_intakes_tenant_select on public.external_contract_intakes for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- 5) Portal customer completions. Customers can submit missing data without direct table writes.
create table if not exists public.customer_portal_completions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_id uuid null,
  metering_point_id uuid null,
  completion_type text not null default 'missing_information',
  status text not null default 'submitted',
  submitted_payload jsonb not null default '{}'::jsonb,
  linked_case_id uuid null,
  linked_info_request_id uuid null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_portal_completions_status_check check (status in ('submitted', 'in_review', 'accepted', 'rejected', 'cancelled'))
);

create index if not exists customer_portal_completions_company_status_idx
  on public.customer_portal_completions(company_id, status, created_at desc);
create index if not exists customer_portal_completions_customer_idx
  on public.customer_portal_completions(customer_id, created_at desc);

alter table public.customer_portal_completions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_portal_completions' and policyname = 'customer_portal_completions_service_role_all') then
    create policy customer_portal_completions_service_role_all on public.customer_portal_completions for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_portal_completions' and policyname = 'customer_portal_completions_tenant_select') then
    create policy customer_portal_completions_tenant_select on public.customer_portal_completions for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- 6) Link blockers to customer cases.
do $$
begin
  if to_regclass('public.customer_cases') is not null then
    alter table public.customer_cases add column if not exists blocker_source_table text null;
    alter table public.customer_cases add column if not exists blocker_source_id uuid null;
    alter table public.customer_cases add column if not exists linked_outbound_request_id uuid null;
    alter table public.customer_cases add column if not exists linked_partner_export_id uuid null;
    alter table public.customer_cases add column if not exists linked_metering_gap_id uuid null;
    alter table public.customer_cases add column if not exists linked_external_intake_id uuid null;
    create index if not exists customer_cases_company_blocker_source_idx on public.customer_cases(company_id, blocker_source_table, blocker_source_id);
  end if;
end $$;

-- 7) Batch 2C control queues: one action list for Control Tower.
create or replace view public.gridex_batch_2c_drift_queue_v as
select
  'billing_export_item'::text as queue_type,
  bei.company_id,
  bei.id as source_id,
  bei.customer_id,
  bei.site_id,
  bei.metering_point_id,
  case when bei.status = 'blocked' then 'critical' else 'info' end as severity,
  bei.status as status,
  'Faktureringsrad blockerad'::text as title,
  'Raden är blockerad och ska hanteras utan att stoppa övriga rader i exportkörningen.'::text as description,
  bei.created_at,
  coalesce(bei.updated_at, bei.created_at) as updated_at,
  jsonb_build_object(
    'billing_export_run_id', bei.billing_export_run_id,
    'billing_underlay_id', bei.billing_underlay_id,
    'export_status', bei.export_status,
    'blocker_reasons', bei.blocker_reasons
  ) as payload
from public.billing_export_run_items bei
where bei.status = 'blocked'

union all

select
  'metering_period_gap'::text as queue_type,
  mpg.company_id,
  mpg.id as source_id,
  mpg.customer_id,
  mpg.site_id,
  mpg.metering_point_id,
  mpg.severity,
  mpg.status,
  'Saknade mätvärden'::text as title,
  'Perioden saknar mätvärden och behöver begäras eller kompletteras.'::text as description,
  mpg.created_at,
  mpg.updated_at,
  jsonb_build_object(
    'period_month', mpg.period_month,
    'period_start', mpg.period_start,
    'period_end', mpg.period_end,
    'outbound_request_id', mpg.outbound_request_id,
    'customer_case_id', mpg.customer_case_id
  ) as payload
from public.metering_period_gaps mpg
where mpg.status in ('open', 'request_queued', 'waiting_for_data', 'failed')

union all

select
  'customer_case'::text as queue_type,
  cc.company_id,
  cc.id as source_id,
  cc.customer_id,
  cc.site_id,
  cc.metering_point_id,
  case when cc.priority in ('high', 'urgent') then 'critical' else 'warning' end as severity,
  cc.status,
  coalesce(cc.title, 'Kundärende') as title,
  coalesce(cc.description, 'Kundärende kräver handläggning.') as description,
  cc.created_at,
  cc.updated_at,
  jsonb_build_object('case_type', cc.case_type, 'reason_category', cc.reason_category, 'billing_blocked', cc.billing_blocked) as payload
from public.customer_cases cc
where cc.status not in ('resolved', 'closed', 'cancelled')

union all

select
  'partner_export'::text as queue_type,
  pe.company_id,
  pe.id as source_id,
  pe.customer_id,
  pe.site_id,
  pe.metering_point_id,
  case when pe.status = 'failed' then 'critical' else 'warning' end as severity,
  pe.status,
  'Partnerexport kräver uppföljning'::text as title,
  coalesce(pe.failure_reason, 'Exporten har inte kvitterats färdigt.') as description,
  pe.created_at,
  pe.updated_at,
  jsonb_build_object('target_system', pe.target_system, 'external_reference', pe.external_reference, 'export_batch_key', pe.export_batch_key) as payload
from public.partner_exports pe
where pe.status in ('queued', 'failed')

union all

select
  'external_contract_intake'::text as queue_type,
  eci.company_id,
  eci.id as source_id,
  eci.created_customer_id as customer_id,
  eci.created_site_id as site_id,
  eci.created_metering_point_id as metering_point_id,
  case when eci.status = 'failed' then 'critical' else 'warning' end as severity,
  eci.status,
  'Externt avtal kräver kontroll'::text as title,
  'Ett avtal från extern ingång behöver granskas, kompletteras eller kopplas vidare.'::text as description,
  eci.created_at,
  eci.updated_at,
  jsonb_build_object('email', eci.email, 'facility_id', eci.facility_id, 'issues', eci.issues) as payload
from public.external_contract_intakes eci
where eci.status in ('received', 'needs_review', 'failed');

create or replace view public.gridex_batch_2c_control_tower_summary_v as
select
  c.id as company_id,
  c.name as company_name,
  coalesce((select count(*) from public.gridex_batch_2c_drift_queue_v q where q.company_id = c.id), 0)::integer as open_queue_count,
  coalesce((select count(*) from public.gridex_batch_2c_drift_queue_v q where q.company_id = c.id and q.severity = 'critical'), 0)::integer as critical_queue_count,
  coalesce((select count(*) from public.metering_period_gaps g where g.company_id = c.id and g.status in ('open', 'request_queued', 'waiting_for_data', 'failed')), 0)::integer as open_metering_gap_count,
  coalesce((select count(*) from public.billing_export_run_items bei where bei.company_id = c.id and bei.status = 'blocked'), 0)::integer as blocked_export_row_count,
  coalesce((select count(*) from public.external_contract_intakes eci where eci.company_id = c.id and eci.status in ('received', 'needs_review', 'failed')), 0)::integer as open_external_intake_count,
  coalesce((select count(*) from public.customer_portal_completions cpc where cpc.company_id = c.id and cpc.status in ('submitted', 'in_review')), 0)::integer as open_portal_completion_count,
  c.production_status,
  c.live_ediel_enabled,
  c.updated_at
from public.companies c;
