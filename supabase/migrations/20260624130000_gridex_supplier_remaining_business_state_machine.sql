-- Gridex supplier remaining business automation hardening.
-- Non-destructive foundation for inbound state-machine traces, supply-period matching
-- and monthly billing/export idempotency.

alter table if exists public.customer_supply_periods
  add column if not exists source_process text,
  add column if not exists source_switch_request_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists customer_supply_periods_company_customer_period_idx
  on public.customer_supply_periods(company_id, customer_id, start_date, end_date, status);

create unique index if not exists ux_customer_supply_periods_company_meter_start_active
  on public.customer_supply_periods(company_id, metering_point_id, start_date)
  where status in ('active', 'confirmed_by_grid_owner');

alter table if exists public.metering_values
  add column if not exists billing_match_status text,
  add column if not exists billing_match_checked_at timestamptz,
  add column if not exists billing_match_issues jsonb not null default '[]'::jsonb;

create index if not exists metering_values_company_billing_match_idx
  on public.metering_values(company_id, billing_match_status, period_start desc);

alter table if exists public.billing_export_runs
  add column if not exists idempotency_key text,
  add column if not exists billing_automation_run_id uuid,
  add column if not exists partner_locked_at timestamptz,
  add column if not exists partner_lock_reason text;

create unique index if not exists ux_billing_export_runs_company_idempotency
  on public.billing_export_runs(company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists billing_export_runs_company_automation_idx
  on public.billing_export_runs(company_id, billing_automation_run_id, created_at desc);

alter table if exists public.customer_cases
  add column if not exists source_ediel_message_id uuid,
  add column if not exists source_business_process text,
  add column if not exists tenant_visible boolean not null default true,
  add column if not exists technical_details_visible_to_tenant boolean not null default false;

create index if not exists customer_cases_company_source_message_idx
  on public.customer_cases(company_id, source_ediel_message_id)
  where source_ediel_message_id is not null;

create index if not exists customer_cases_company_business_process_idx
  on public.customer_cases(company_id, source_business_process, status, created_at desc);

-- Make the one-table run log idempotent for a month per company when a run is actively executing.
create unique index if not exists ux_billing_automation_runs_one_running_per_company_period
  on public.billing_automation_runs(company_id, period_month)
  where status = 'running';
