-- Billing underlay alignment for normalized metering values.
-- This migration keeps the existing billing_underlays.status contract intact:
-- pending / received / validated / exported / failed.
-- Readiness is represented by readiness_status instead of unsupported status values.

alter table public.billing_underlay_items
  add column if not exists source_normalized_metering_value_id uuid,
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
  add column if not exists source_transaction_reference text,
  add column if not exists source_line_reference text,
  add column if not exists quantity_kwh numeric,
  add column if not exists resolution text,
  add column if not exists status text not null default 'ready_for_pricing',
  add column if not exists warnings jsonb not null default '[]'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_billing_underlays_company_customer_point_month
  on public.billing_underlays(company_id, customer_id, metering_point_id, underlay_year, underlay_month);

create index if not exists idx_billing_underlays_company_month_readiness
  on public.billing_underlays(company_id, underlay_year, underlay_month, readiness_status);

create unique index if not exists ux_billing_underlay_items_normalized_source
  on public.billing_underlay_items(company_id, billing_underlay_id, source_normalized_metering_value_id)
  where source_normalized_metering_value_id is not null;

create unique index if not exists ux_billing_underlay_items_legacy_source
  on public.billing_underlay_items(company_id, billing_underlay_id, meter_value_id)
  where meter_value_id is not null;

update public.billing_underlays
set status = case
  when status in ('ready_for_pricing', 'price_preview_ready') then 'validated'
  when status in ('needs_review') then 'pending'
  when status in ('pricing_failed') then 'failed'
  else status
end
where status in ('ready_for_pricing', 'price_preview_ready', 'needs_review', 'pricing_failed');

comment on column public.billing_underlay_items.source_normalized_metering_value_id is
  'References normalized_metering_values.id when billing underlay item is generated from normalized meter data.';

comment on column public.billing_underlay_items.source_table is
  'Source table used for this billing line, normally normalized_metering_values with metering_values as legacy fallback.';
