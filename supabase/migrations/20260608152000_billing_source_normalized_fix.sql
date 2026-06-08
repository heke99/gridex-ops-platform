-- Billing Source Fix
-- normalized_metering_values is the primary billing source. metering_values is legacy fallback only.
-- This migration is idempotent and repairs older installs where billing_underlay_items already existed
-- before the full item traceability columns were introduced.

alter table if exists public.billing_underlay_items
  add column if not exists customer_id uuid,
  add column if not exists customer_site_id uuid,
  add column if not exists site_id uuid,
  add column if not exists metering_point_id uuid,
  add column if not exists contract_id uuid,
  add column if not exists price_plan_id uuid,
  add column if not exists campaign_id uuid,
  add column if not exists facility_id text,
  add column if not exists price_area text,
  add column if not exists grid_area text,
  add column if not exists source_table text,
  add column if not exists source_normalized_metering_value_id uuid,
  add column if not exists source_transaction_reference text,
  add column if not exists source_line_reference text,
  add column if not exists quantity_kwh numeric,
  add column if not exists resolution text,
  add column if not exists status text not null default 'ready_for_pricing',
  add column if not exists warnings jsonb not null default '[]'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.billing_underlay_items
   set quantity_kwh = coalesce(quantity_kwh, quantity),
       unit = coalesce(unit, 'kWh'),
       source_table = coalesce(source_table, case when meter_value_id is not null then 'metering_values' else null end),
       metadata = coalesce(metadata, '{}'::jsonb),
       warnings = coalesce(warnings, '[]'::jsonb),
       status = coalesce(status, 'ready_for_pricing'),
       updated_at = coalesce(updated_at, now())
 where quantity_kwh is null
    or unit is null
    or metadata is null
    or warnings is null
    or status is null
    or updated_at is null;

create index if not exists idx_billing_underlay_items_normalized_source
  on public.billing_underlay_items(company_id, source_normalized_metering_value_id)
  where source_normalized_metering_value_id is not null;

create index if not exists idx_billing_underlay_items_source_trace
  on public.billing_underlay_items(company_id, source_table, source_transaction_reference);

create index if not exists idx_billing_underlay_items_metering_point_period
  on public.billing_underlay_items(company_id, metering_point_id, period_start, period_end);

alter table if exists public.billing_underlays
  add column if not exists source_meter_value_count integer,
  add column if not exists missing_values_count integer,
  add column if not exists pricing_snapshot_id uuid,
  add column if not exists customer_site_id uuid,
  add column if not exists price_plan_id uuid,
  add column if not exists campaign_id uuid,
  add column if not exists price_area text,
  add column if not exists billing_period_start date,
  add column if not exists billing_period_end date,
  add column if not exists pricing_snapshot jsonb default '{}'::jsonb;

update public.customer_contracts cc
   set company_id = c.company_id
  from public.customers c
 where cc.company_id is null
   and cc.customer_id = c.id
   and c.company_id is not null;

create or replace function public.gridex_customer_contracts_set_company_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null and new.customer_id is not null then
    select c.company_id
      into new.company_id
      from public.customers c
     where c.id = new.customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gridex_customer_contracts_set_company_id on public.customer_contracts;
create trigger trg_gridex_customer_contracts_set_company_id
before insert or update of customer_id, company_id
on public.customer_contracts
for each row
execute function public.gridex_customer_contracts_set_company_id();
