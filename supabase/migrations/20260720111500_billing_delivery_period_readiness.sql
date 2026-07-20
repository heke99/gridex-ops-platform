-- Canonical billing delivery-period readiness.
-- Supply periods remain the source of truth for actual delivery. The nullable
-- actual dates let inbound grid-owner confirmation narrow a scheduled period
-- without overwriting the originally requested dates.

alter table if exists public.customer_supply_periods
  add column if not exists actual_start_date date,
  add column if not exists actual_end_date date;

do $$
begin
  if to_regclass('public.customer_supply_periods') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.customer_supply_periods'::regclass
         and conname = 'customer_supply_periods_valid_actual_dates'
     ) then
    alter table public.customer_supply_periods
      add constraint customer_supply_periods_valid_actual_dates
      check (
        actual_end_date is null
        or coalesce(actual_start_date, start_date) is null
        or actual_end_date >= coalesce(actual_start_date, start_date)
      );
  end if;
end $$;

create index if not exists customer_supply_periods_company_actual_period_idx
  on public.customer_supply_periods(
    company_id,
    metering_point_id,
    coalesce(actual_start_date, start_date),
    coalesce(actual_end_date, end_date),
    status
  );

comment on column public.customer_supply_periods.actual_start_date is
  'Grid-owner confirmed actual delivery start; billing uses this before scheduled start_date.';
comment on column public.customer_supply_periods.actual_end_date is
  'Actual delivery end; billing uses this before scheduled end_date.';
