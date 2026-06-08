-- Metering -> Billing Underlay -> Price Engine foundation.
-- Idempotent SaaS-safe schema for spot, portfolio, campaigns, mix pricing and price preview.

create table if not exists public.spot_price_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source_name text not null,
  base_url text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.spot_price_sources(source_key, source_name, base_url, status, metadata)
values ('elprisetjustnu', 'Elpriset just nu', 'https://www.elprisetjustnu.se/api/v1/prices', 'active', '{"prices_ex_vat":true,"contains_fees":false}'::jsonb)
on conflict (source_key) do update set source_name = excluded.source_name, base_url = excluded.base_url, status = excluded.status, metadata = public.spot_price_sources.metadata || excluded.metadata;

create table if not exists public.spot_price_intervals (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'elprisetjustnu',
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  time_start timestamptz not null,
  time_end timestamptz not null,
  sek_per_kwh numeric not null,
  eur_per_kwh numeric,
  exchange_rate numeric,
  resolution text not null check (resolution in ('hourly','quarter_hour')),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spot_price_intervals_time_check check (time_end > time_start)
);

create unique index if not exists ux_spot_price_intervals_source_area_time
  on public.spot_price_intervals(source, price_area, time_start, time_end);
create index if not exists idx_spot_price_intervals_area_time on public.spot_price_intervals(price_area, time_start, time_end);

create table if not exists public.spot_price_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'elprisetjustnu',
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  price_date date not null,
  average_sek_per_kwh numeric not null,
  min_sek_per_kwh numeric not null,
  max_sek_per_kwh numeric not null,
  interval_count integer not null default 0,
  status text not null default 'complete' check (status in ('incomplete','complete','locked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_spot_price_daily_source_area_date on public.spot_price_daily_summaries(source, price_area, price_date);

create table if not exists public.spot_price_monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'elprisetjustnu',
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  billing_month text not null check (billing_month ~ '^\d{4}-\d{2}$'),
  average_sek_per_kwh numeric not null,
  min_sek_per_kwh numeric not null,
  max_sek_per_kwh numeric not null,
  interval_count integer not null default 0,
  expected_interval_count integer not null default 0,
  status text not null default 'incomplete' check (status in ('incomplete','complete','locked')),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_spot_price_monthly_source_area_month on public.spot_price_monthly_summaries(source, price_area, billing_month);

create table if not exists public.spot_price_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'elprisetjustnu',
  billing_month text not null check (billing_month ~ '^\d{4}-\d{2}$'),
  price_areas text[] not null default array['SE1','SE2','SE3','SE4'],
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  error_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.normalized_metering_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid,
  customer_site_id uuid,
  site_id uuid,
  metering_point_id uuid not null,
  facility_id text,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  grid_area text,
  period_start timestamptz not null,
  period_end timestamptz not null,
  resolution text,
  quantity_kwh numeric not null,
  quality_status text,
  source_type text not null,
  source_message_id uuid,
  source_transaction_reference text,
  source_line_reference text,
  source_metering_value_id uuid,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'stored',
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint normalized_metering_values_period_check check (period_end > period_start)
);
create unique index if not exists ux_normalized_metering_values_dedupe
  on public.normalized_metering_values(company_id, metering_point_id, period_start, period_end, source_type, coalesce(source_transaction_reference, source_line_reference, 'no-source-ref'));
create index if not exists idx_normalized_metering_values_company_period on public.normalized_metering_values(company_id, period_start, period_end);

alter table if exists public.metering_values
  add column if not exists customer_site_id uuid,
  add column if not exists price_area text,
  add column if not exists resolution text,
  add column if not exists source_transaction_reference text,
  add column if not exists source_line_reference text;

alter table if exists public.billing_underlays
  add column if not exists customer_site_id uuid,
  add column if not exists contract_id uuid,
  add column if not exists price_plan_id uuid,
  add column if not exists campaign_id uuid,
  add column if not exists price_area text,
  add column if not exists billing_period_start timestamptz,
  add column if not exists billing_period_end timestamptz,
  add column if not exists calculated_total_sek_ex_vat numeric,
  add column if not exists calculated_vat_sek numeric,
  add column if not exists calculated_total_sek_inc_vat numeric,
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb;

create unique index if not exists ux_billing_underlays_company_customer_point_month
  on public.billing_underlays(company_id, customer_id, metering_point_id, underlay_year, underlay_month);

create table if not exists public.billing_underlay_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_underlay_id uuid not null references public.billing_underlays(id) on delete cascade,
  meter_value_id uuid,
  customer_id uuid,
  customer_site_id uuid,
  site_id uuid,
  metering_point_id uuid,
  contract_id uuid,
  price_plan_id uuid,
  campaign_id uuid,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  period_start timestamptz,
  period_end timestamptz,
  quantity_kwh numeric,
  resolution text,
  status text not null default 'ready_for_pricing',
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_billing_underlay_items_meter_value on public.billing_underlay_items(company_id, billing_underlay_id, meter_value_id) where meter_value_id is not null;
create index if not exists idx_billing_underlay_items_company_underlay on public.billing_underlay_items(company_id, billing_underlay_id);

create table if not exists public.billing_underlay_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_underlay_id uuid references public.billing_underlays(id) on delete cascade,
  event_type text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.portfolio_monthly_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  billing_month text not null check (billing_month ~ '^\d{4}-\d{2}$'),
  price_ex_vat_sek_per_kwh numeric not null,
  currency text not null default 'SEK',
  status text not null default 'draft' check (status in ('draft','confirmed','locked')),
  source text not null default 'manual' check (source in ('manual','api','import')),
  notes text,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  locked_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_portfolio_monthly_prices_company_area_month on public.portfolio_monthly_prices(company_id, price_area, billing_month);

create table if not exists public.price_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  pricing_model text not null default 'spot' check (pricing_model in ('spot','fixed','portfolio','mixed','manual_override')),
  status text not null default 'draft',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index if not exists idx_price_plans_company_status on public.price_plans(company_id, status);

create table if not exists public.price_plan_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  price_plan_id uuid not null references public.price_plans(id) on delete cascade,
  version_label text not null default 'v1',
  status text not null default 'draft',
  valid_from date,
  valid_to date,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);
create unique index if not exists ux_price_plan_versions_plan_label on public.price_plan_versions(price_plan_id, version_label);

create table if not exists public.base_price_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  price_plan_version_id uuid references public.price_plan_versions(id) on delete cascade,
  campaign_version_id uuid,
  contract_price_snapshot_id uuid,
  source_type text not null check (source_type in ('spot','fixed','portfolio','manual')),
  label text,
  weight_percent numeric not null default 100,
  fixed_price_sek_per_kwh numeric,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  valid_from date,
  valid_to date,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint base_price_weight_check check (weight_percent > 0 and weight_percent <= 100)
);
create index if not exists idx_base_price_components_company on public.base_price_components(company_id, price_plan_version_id, campaign_version_id, contract_price_snapshot_id);

create table if not exists public.price_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  price_plan_version_id uuid references public.price_plan_versions(id) on delete cascade,
  campaign_version_id uuid,
  contract_price_snapshot_id uuid,
  component_type text not null,
  name text not null,
  description text,
  calculation_type text not null,
  amount numeric not null,
  unit text,
  vat_applicable boolean not null default true,
  invoice_line_visible boolean not null default true,
  periodization_mode text not null default 'none',
  priority integer not null default 100,
  valid_from date,
  valid_to date,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists idx_price_components_company_status on public.price_components(company_id, status, priority);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  campaign_code text,
  description text,
  status text not null default 'draft',
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index if not exists idx_campaigns_company_status on public.campaigns(company_id, status);

create table if not exists public.campaign_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version_label text not null default 'v1',
  status text not null default 'draft',
  snapshot_json jsonb not null default '{}'::jsonb,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid
);
create unique index if not exists ux_campaign_versions_campaign_label on public.campaign_versions(campaign_id, version_label);

create table if not exists public.campaign_price_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_version_id uuid not null references public.campaign_versions(id) on delete cascade,
  component_type text not null,
  name text not null,
  calculation_type text not null,
  amount numeric not null,
  unit text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists idx_campaign_price_components_company_version on public.campaign_price_components(company_id, campaign_version_id);

create table if not exists public.contract_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_id uuid not null,
  customer_id uuid,
  price_plan_version_id uuid,
  campaign_version_id uuid,
  pricing_model text not null default 'spot',
  base_price_components_snapshot jsonb not null default '[]'::jsonb,
  price_components_snapshot jsonb not null default '[]'::jsonb,
  snapshot_json jsonb not null default '{}'::jsonb,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now()
);
create index if not exists idx_contract_price_snapshots_company_contract on public.contract_price_snapshots(company_id, contract_id, valid_from desc);

create table if not exists public.pricing_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_underlay_id uuid references public.billing_underlays(id) on delete set null,
  customer_id uuid,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  status text not null default 'success',
  total_ex_vat numeric not null default 0,
  vat_amount numeric not null default 0,
  total_inc_vat numeric not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists idx_pricing_runs_company_underlay on public.pricing_runs(company_id, billing_underlay_id, created_at desc);

create table if not exists public.pricing_run_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pricing_run_id uuid not null references public.pricing_runs(id) on delete cascade,
  billing_underlay_item_id uuid,
  status text not null default 'priced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pricing_preview_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pricing_run_id uuid not null references public.pricing_runs(id) on delete cascade,
  billing_underlay_id uuid,
  billing_underlay_item_id uuid,
  line_type text not null,
  description text not null,
  quantity numeric,
  unit text,
  unit_price_ex_vat numeric,
  amount_ex_vat numeric not null default 0,
  vat_rate numeric not null default 0.25,
  vat_amount numeric not null default 0,
  amount_inc_vat numeric not null default 0,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_pricing_preview_lines_run on public.pricing_preview_lines(company_id, pricing_run_id, sort_order);

create table if not exists public.price_period_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_month text not null check (billing_month ~ '^\d{4}-\d{2}$'),
  lock_scope text not null,
  status text not null default 'locked',
  locked_by uuid,
  locked_at timestamptz not null default now(),
  reason text,
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists ux_price_period_locks_company_month_scope on public.price_period_locks(company_id, billing_month, lock_scope);

create table if not exists public.pricing_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pricing_audit_logs_company_entity on public.pricing_audit_logs(company_id, entity_type, entity_id, created_at desc);

do $$
declare
  t text;
  select_policy text;
  insert_policy text;
  update_policy text;
begin
  foreach t in array array[
    'normalized_metering_values',
    'billing_underlay_items',
    'billing_underlay_events',
    'portfolio_monthly_prices',
    'price_plans',
    'price_plan_versions',
    'base_price_components',
    'price_components',
    'campaigns',
    'campaign_versions',
    'campaign_price_components',
    'contract_price_snapshots',
    'pricing_runs',
    'pricing_run_items',
    'pricing_preview_lines',
    'price_period_locks',
    'pricing_audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    select_policy := t || '_tenant_select';
    insert_policy := t || '_tenant_insert';
    update_policy := t || '_tenant_update';

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = select_policy) then
      execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))', select_policy, t);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = insert_policy) then
      execute format('create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))', insert_policy, t);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = update_policy) then
      execute format('create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id)) with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))', update_policy, t);
    end if;
  end loop;
end $$;
