-- Source-derived Batch 2C replay foundation.
-- Restores the historical metering-gap queue and the exact control-tower drift projection
-- consumed by the canonical Ediel production projection. No operational rows are seeded.

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
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'metering_period_gaps'
      and policyname = 'metering_period_gaps_service_role_all'
  ) then
    create policy metering_period_gaps_service_role_all
      on public.metering_period_gaps
      for all to service_role using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'metering_period_gaps'
      and policyname = 'metering_period_gaps_tenant_select'
  ) then
    create policy metering_period_gaps_tenant_select
      on public.metering_period_gaps
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'metering_period_gaps'
      and policyname = 'metering_period_gaps_tenant_write'
  ) then
    create policy metering_period_gaps_tenant_write
      on public.metering_period_gaps
      for all
      using (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;
end $$;

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
  jsonb_build_object(
    'case_type', cc.case_type,
    'reason_category', cc.reason_category,
    'billing_blocked', cc.billing_blocked
  ) as payload
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
  jsonb_build_object(
    'target_system', pe.target_system,
    'external_reference', pe.external_reference,
    'export_batch_key', pe.export_batch_key
  ) as payload
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
  jsonb_build_object(
    'email', eci.email,
    'facility_id', eci.facility_id,
    'issues', eci.issues
  ) as payload
from public.external_contract_intakes eci
where eci.status in ('received', 'needs_review', 'failed');
