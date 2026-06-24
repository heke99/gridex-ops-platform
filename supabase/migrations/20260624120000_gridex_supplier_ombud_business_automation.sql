-- Gridex Supplier Ombud Business Automation foundation.
-- Adds an idempotent audit table for automatic month-end metering/billing runs.

create table if not exists public.billing_automation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_year integer,
  billing_month integer,
  period_month text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  locked_at timestamptz,
  total_customers integer,
  total_underlays integer,
  total_blocked integer,
  total_exported integer,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_automation_runs_period_month_chk check (period_month ~ '^\d{4}-\d{2}$'),
  constraint billing_automation_runs_status_chk check (status in ('running', 'completed', 'completed_with_blockers', 'failed', 'cancelled'))
);

create index if not exists billing_automation_runs_company_period_idx
  on public.billing_automation_runs(company_id, period_month, created_at desc);

create index if not exists billing_automation_runs_status_idx
  on public.billing_automation_runs(company_id, status, started_at desc);

alter table public.billing_automation_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_automation_runs'
      and policyname = 'billing_automation_runs_read_company_or_platform'
  ) then
    create policy billing_automation_runs_read_company_or_platform
      on public.billing_automation_runs
      for select
      using (
        ((select auth.role()) = 'service_role')
        or (select public.gridex_user_is_platform_admin())
        or public.gridex_can_read_company(company_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_automation_runs'
      and policyname = 'billing_automation_runs_write_company_or_service'
  ) then
    create policy billing_automation_runs_write_company_or_service
      on public.billing_automation_runs
      for all
      using (
        ((select auth.role()) = 'service_role')
        or (select public.gridex_user_is_platform_admin())
        or public.gridex_can_write_company(company_id)
      )
      with check (
        ((select auth.role()) = 'service_role')
        or (select public.gridex_user_is_platform_admin())
        or public.gridex_can_write_company(company_id)
      );
  end if;
end $$;

drop trigger if exists trg_billing_automation_runs_updated_at on public.billing_automation_runs;
create trigger trg_billing_automation_runs_updated_at
  before update on public.billing_automation_runs
  for each row execute function public.set_updated_at_timestamp();
