-- Analytics & Forecasting module foundation.
-- Safe intent: idempotent, non-destructive, company-scoped analytics tables.

create table if not exists public.bidding_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  country_code text default 'SE',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.bidding_zones add column if not exists updated_at timestamptz default now();

create table if not exists public.grid_owners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  name text not null,
  organization_number text,
  ediel_id text,
  contact_email text,
  contact_phone text,
  website text,
  default_bidding_zone_code text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Some live databases have a generic set_updated_at() trigger attached to legacy
-- tables that were created before updated_at existed. Add the column before any
-- backfill write so the trigger cannot fail with "NEW has no field updated_at".
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and pg_get_functiondef(p.oid) ilike '%new.updated_at%'
      and not exists (
        select 1
        from information_schema.columns col
        where col.table_schema = n.nspname
          and col.table_name = c.relname
          and col.column_name = 'updated_at'
      )
  loop
    execute format('alter table %I.%I add column if not exists updated_at timestamptz default now()', r.schema_name, r.table_name);
  end loop;
end $$;

insert into public.bidding_zones (code, name, country_code)
values
  ('SE1', 'Lulea', 'SE'),
  ('SE2', 'Sundsvall', 'SE'),
  ('SE3', 'Stockholm', 'SE'),
  ('SE4', 'Malmo', 'SE')
on conflict (code) do nothing;

alter table if exists public.customers add column if not exists onboarding_status text;
alter table if exists public.customers add column if not exists activated_at timestamptz;
alter table if exists public.customers add column if not exists ended_at timestamptz;
alter table if exists public.customers add column if not exists acquisition_channel text;
alter table if exists public.customers add column if not exists campaign_id uuid;
alter table if exists public.customers add column if not exists sales_agent_id uuid;
alter table if exists public.customers add column if not exists partner_id uuid;
alter table if exists public.customers add column if not exists company_id uuid;
alter table if exists public.customers add column if not exists updated_at timestamptz default now();

alter table if exists public.grid_owners add column if not exists company_id uuid;
alter table if exists public.grid_owners add column if not exists organization_number text;
alter table if exists public.grid_owners add column if not exists contact_email text;
alter table if exists public.grid_owners add column if not exists contact_phone text;
alter table if exists public.grid_owners add column if not exists website text;
alter table if exists public.grid_owners add column if not exists default_bidding_zone_code text;
alter table if exists public.grid_owners add column if not exists updated_at timestamptz default now();

update public.grid_owners
set organization_number = coalesce(organization_number, org_number),
    contact_email = coalesce(contact_email, email),
    contact_phone = coalesce(contact_phone, phone)
where to_regclass('public.grid_owners') is not null;

alter table if exists public.customer_sites add column if not exists bidding_zone_code text;
alter table if exists public.customer_sites add column if not exists company_id uuid;
alter table if exists public.customer_sites add column if not exists municipality text;
alter table if exists public.customer_sites add column if not exists address text;
alter table if exists public.customer_sites add column if not exists updated_at timestamptz default now();

update public.customer_sites
set bidding_zone_code = coalesce(bidding_zone_code, price_area_code),
    address = coalesce(address, street)
where to_regclass('public.customer_sites') is not null;

alter table if exists public.metering_points add column if not exists bidding_zone_code text;
alter table if exists public.metering_points add column if not exists company_id uuid;
alter table if exists public.metering_points add column if not exists metering_method text;
alter table if exists public.metering_points add column if not exists settlement_method text;
alter table if exists public.metering_points add column if not exists estimated_annual_consumption_kwh numeric;
alter table if exists public.metering_points add column if not exists consumption_profile_id uuid;
alter table if exists public.metering_points add column if not exists updated_at timestamptz default now();

update public.metering_points mp
set bidding_zone_code = coalesce(mp.bidding_zone_code, mp.price_area_code),
    metering_method = coalesce(mp.metering_method, mp.reading_frequency),
    estimated_annual_consumption_kwh = coalesce(mp.estimated_annual_consumption_kwh, cs.annual_consumption_kwh)
from public.customer_sites cs
where mp.site_id = cs.id
  and to_regclass('public.metering_points') is not null
  and to_regclass('public.customer_sites') is not null;

alter table if exists public.metering_values add column if not exists bidding_zone_code text;
alter table if exists public.metering_values add column if not exists company_id uuid;
alter table if exists public.metering_values add column if not exists resolution text;
alter table if exists public.metering_values add column if not exists quantity_kwh numeric;
alter table if exists public.metering_values add column if not exists quality text;
alter table if exists public.metering_values add column if not exists source text;
alter table if exists public.metering_values add column if not exists received_at timestamptz;
alter table if exists public.metering_values add column if not exists updated_at timestamptz default now();

update public.metering_values
set quantity_kwh = coalesce(quantity_kwh, value_kwh),
    quality = coalesce(quality, quality_code),
    source = coalesce(source, source_system),
    received_at = coalesce(received_at, created_at)
where to_regclass('public.metering_values') is not null;

create table if not exists public.grid_area_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  postal_code_from text,
  postal_code_to text,
  postal_code text,
  city text,
  municipality text,
  grid_owner_id uuid references public.grid_owners(id),
  bidding_zone_code text,
  confidence_score numeric default 0.70,
  source text,
  valid_from date,
  valid_to date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  entity_type text not null,
  entity_id uuid,
  issue_type text not null,
  severity text default 'warning',
  message text not null,
  status text default 'open',
  detected_at timestamptz default now(),
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, entity_type, entity_id, issue_type, status)
);

create table if not exists public.dashboard_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  alert_type text not null,
  severity text default 'info',
  title text not null,
  message text,
  entity_type text,
  entity_id uuid,
  status text default 'open',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  resolved_at timestamptz,
  unique(company_id, alert_type, entity_type, entity_id, status)
);

create table if not exists public.company_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  month date not null,
  total_customers integer default 0,
  active_customers integer default 0,
  new_customers integer default 0,
  ended_customers integer default 0,
  total_sites integer default 0,
  active_sites integer default 0,
  total_metering_points integer default 0,
  active_metering_points integer default 0,
  metering_values_received integer default 0,
  metering_values_missing integer default 0,
  requested_metering_values integer default 0,
  successful_metering_requests integer default 0,
  failed_metering_requests integer default 0,
  forecast_kwh numeric default 0,
  actual_kwh numeric default 0,
  diff_kwh numeric default 0,
  diff_percent numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, month)
);

create table if not exists public.bidding_zone_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  bidding_zone_code text not null,
  month date not null,
  customers_count integer default 0,
  sites_count integer default 0,
  metering_points_count integer default 0,
  forecast_kwh numeric default 0,
  actual_kwh numeric default 0,
  diff_kwh numeric default 0,
  diff_percent numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, bidding_zone_code, month)
);

create table if not exists public.grid_owner_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  grid_owner_id uuid,
  month date not null,
  customers_count integer default 0,
  sites_count integer default 0,
  metering_points_count integer default 0,
  metering_values_requested integer default 0,
  metering_values_received integer default 0,
  metering_values_missing integer default 0,
  average_response_time_hours numeric,
  failed_requests_count integer default 0,
  forecast_kwh numeric default 0,
  actual_kwh numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists grid_owner_monthly_metrics_company_owner_month_uidx
on public.grid_owner_monthly_metrics(company_id, coalesce(grid_owner_id, '00000000-0000-0000-0000-000000000000'::uuid), month);

create table if not exists public.customer_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  month date not null,
  sites_count integer default 0,
  metering_points_count integer default 0,
  forecast_kwh numeric default 0,
  actual_kwh numeric default 0,
  diff_kwh numeric default 0,
  diff_percent numeric,
  estimated_revenue numeric default 0,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(company_id, customer_id, month)
);

create table if not exists public.consumption_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  name text not null,
  customer_type text,
  heating_type text,
  metering_method text,
  is_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.consumption_profile_month_weights (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.consumption_profiles(id) on delete cascade,
  month_number integer not null check (month_number between 1 and 12),
  weight_percent numeric not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(profile_id, month_number)
);

alter table if exists public.consumption_profile_month_weights add column if not exists updated_at timestamptz default now();

do $$
declare
  v_profile_id uuid;
begin
  insert into public.consumption_profiles(company_id, name, customer_type, heating_type, metering_method, is_default)
  select null, 'Svensk standardprofil', null, null, null, true
  where not exists (
    select 1
    from public.consumption_profiles
    where company_id is null
      and name = 'Svensk standardprofil'
  );

  select id into v_profile_id
  from public.consumption_profiles
  where company_id is null
    and name = 'Svensk standardprofil'
  order by created_at asc
  limit 1;

  if v_profile_id is not null then
    insert into public.consumption_profile_month_weights(profile_id, month_number, weight_percent)
    values
      (v_profile_id, 1, 13),
      (v_profile_id, 2, 12),
      (v_profile_id, 3, 10),
      (v_profile_id, 4, 8),
      (v_profile_id, 5, 6),
      (v_profile_id, 6, 5),
      (v_profile_id, 7, 4),
      (v_profile_id, 8, 5),
      (v_profile_id, 9, 6),
      (v_profile_id, 10, 8),
      (v_profile_id, 11, 10),
      (v_profile_id, 12, 13)
    on conflict (profile_id, month_number) do update
    set weight_percent = excluded.weight_percent;
  end if;
end $$;

do $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
  from public.consumption_profiles
  where company_id is null
    and is_default = true
  order by created_at asc
  limit 1;

  if v_profile_id is not null then
    update public.metering_points
    set consumption_profile_id = coalesce(consumption_profile_id, v_profile_id)
    where consumption_profile_id is null
      and to_regclass('public.metering_points') is not null;
  end if;
end $$;

create table if not exists public.forecast_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  forecast_type text not null,
  period_start date not null,
  period_end date not null,
  status text default 'draft',
  method text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists public.forecast_run_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  forecast_run_id uuid not null references public.forecast_runs(id) on delete cascade,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  bidding_zone_code text,
  period_start date not null,
  period_end date not null,
  forecast_kwh numeric,
  actual_kwh numeric,
  diff_kwh numeric,
  diff_percent numeric,
  confidence_score numeric,
  method text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.forecast_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  forecast_run_id uuid references public.forecast_runs(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  adjustment_type text not null,
  adjustment_value numeric not null,
  reason text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.bidding_zones add column if not exists updated_at timestamptz default now();
alter table if exists public.grid_area_mappings add column if not exists updated_at timestamptz default now();
alter table if exists public.data_quality_issues add column if not exists updated_at timestamptz default now();
alter table if exists public.dashboard_alerts add column if not exists updated_at timestamptz default now();
alter table if exists public.consumption_profile_month_weights add column if not exists updated_at timestamptz default now();
alter table if exists public.forecast_runs add column if not exists updated_at timestamptz default now();
alter table if exists public.forecast_run_items add column if not exists updated_at timestamptz default now();
alter table if exists public.forecast_adjustments add column if not exists updated_at timestamptz default now();

do $$
begin
  if to_regclass('public.metering_points') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'metering_points_consumption_profile_id_fkey'
         and conrelid = 'public.metering_points'::regclass
     ) then
    alter table public.metering_points
      add constraint metering_points_consumption_profile_id_fkey
      foreign key (consumption_profile_id) references public.consumption_profiles(id)
      not valid;
  end if;
end $$;

create index if not exists idx_customers_company_created_at on public.customers(company_id, created_at);
create index if not exists idx_customers_company_status on public.customers(company_id, status);
create index if not exists idx_customer_sites_company_bidding_zone on public.customer_sites(company_id, bidding_zone_code);
create index if not exists idx_customer_sites_grid_owner on public.customer_sites(company_id, grid_owner_id);
create index if not exists idx_customer_sites_company_status on public.customer_sites(company_id, status);
create index if not exists idx_metering_points_company_bidding_zone on public.metering_points(company_id, bidding_zone_code);
create index if not exists idx_metering_points_grid_owner on public.metering_points(company_id, grid_owner_id);
create index if not exists idx_metering_points_company_status on public.metering_points(company_id, status);
create index if not exists idx_metering_values_company_bidding_zone on public.metering_values(company_id, bidding_zone_code);
create index if not exists idx_metering_values_grid_owner on public.metering_values(company_id, grid_owner_id);
create index if not exists idx_metering_values_company_period on public.metering_values(company_id, period_start, period_end);
create index if not exists idx_metering_values_metering_point_period on public.metering_values(company_id, metering_point_id, period_start);
create index if not exists idx_metering_values_grid_owner_period on public.metering_values(company_id, grid_owner_id, period_start);
create index if not exists idx_metering_values_bidding_zone_period on public.metering_values(company_id, bidding_zone_code, period_start);
create index if not exists idx_grid_owners_company_id on public.grid_owners(company_id);
create index if not exists idx_grid_owners_ediel_id on public.grid_owners(ediel_id);
create index if not exists idx_grid_owners_default_bidding_zone on public.grid_owners(default_bidding_zone_code);
create index if not exists idx_grid_area_mappings_company_postal_code on public.grid_area_mappings(company_id, postal_code);
create index if not exists idx_grid_area_mappings_postal_code on public.grid_area_mappings(postal_code);
create index if not exists idx_grid_area_mappings_city on public.grid_area_mappings(city);
create index if not exists idx_grid_area_mappings_grid_owner on public.grid_area_mappings(grid_owner_id);
create index if not exists idx_grid_area_mappings_bidding_zone on public.grid_area_mappings(bidding_zone_code);
create index if not exists idx_data_quality_company_status on public.data_quality_issues(company_id, status);
create index if not exists idx_data_quality_company_issue_type on public.data_quality_issues(company_id, issue_type);
create index if not exists idx_data_quality_entity on public.data_quality_issues(entity_type, entity_id);
create index if not exists idx_dashboard_alerts_company_status on public.dashboard_alerts(company_id, status);
create index if not exists idx_company_monthly_metrics_company_month on public.company_monthly_metrics(company_id, month);
create index if not exists idx_bidding_zone_monthly_metrics_company_month on public.bidding_zone_monthly_metrics(company_id, month);
create index if not exists idx_grid_owner_monthly_metrics_company_month on public.grid_owner_monthly_metrics(company_id, month);
create index if not exists idx_customer_monthly_metrics_company_month on public.customer_monthly_metrics(company_id, month);
create index if not exists idx_consumption_profiles_company_default on public.consumption_profiles(company_id, is_default);
create index if not exists idx_forecast_runs_company_period on public.forecast_runs(company_id, period_start, period_end);
create index if not exists idx_forecast_run_items_company_run on public.forecast_run_items(company_id, forecast_run_id);
create index if not exists idx_forecast_run_items_company_bidding_zone on public.forecast_run_items(company_id, bidding_zone_code);
create index if not exists idx_forecast_run_items_company_grid_owner on public.forecast_run_items(company_id, grid_owner_id);
create index if not exists idx_forecast_run_items_company_customer on public.forecast_run_items(company_id, customer_id);
create index if not exists idx_forecast_run_items_company_metering_point on public.forecast_run_items(company_id, metering_point_id);
create index if not exists idx_forecast_adjustments_company_run on public.forecast_adjustments(company_id, forecast_run_id);

do $$
declare
  t text;
  v_company_tables text[] := array[
    'grid_area_mappings',
    'data_quality_issues',
    'dashboard_alerts',
    'company_monthly_metrics',
    'bidding_zone_monthly_metrics',
    'grid_owner_monthly_metrics',
    'customer_monthly_metrics',
    'consumption_profiles',
    'forecast_runs',
    'forecast_run_items',
    'forecast_adjustments'
  ];
begin
  foreach t in array v_company_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'gridex_analytics_' || t || '_select') then
      if t = 'consumption_profiles' then
        execute format('create policy %I on public.%I for select using (company_id is null or gridex_user_is_platform_admin() or gridex_can_read_company(company_id))', 'gridex_analytics_' || t || '_select', t);
      else
        execute format('create policy %I on public.%I for select using (gridex_user_is_platform_admin() or gridex_can_read_company(company_id))', 'gridex_analytics_' || t || '_select', t);
      end if;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'gridex_analytics_' || t || '_insert') then
      if t = 'consumption_profiles' then
        execute format('create policy %I on public.%I for insert with check (gridex_user_is_platform_admin() or (company_id is not null and gridex_can_write_company(company_id)))', 'gridex_analytics_' || t || '_insert', t);
      else
        execute format('create policy %I on public.%I for insert with check (gridex_user_is_platform_admin() or gridex_can_write_company(company_id))', 'gridex_analytics_' || t || '_insert', t);
      end if;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'gridex_analytics_' || t || '_update') then
      if t = 'consumption_profiles' then
        execute format('create policy %I on public.%I for update using (gridex_user_is_platform_admin() or (company_id is not null and gridex_can_read_company(company_id))) with check (gridex_user_is_platform_admin() or (company_id is not null and gridex_can_write_company(company_id)))', 'gridex_analytics_' || t || '_update', t);
      else
        execute format('create policy %I on public.%I for update using (gridex_user_is_platform_admin() or gridex_can_read_company(company_id)) with check (gridex_user_is_platform_admin() or gridex_can_write_company(company_id))', 'gridex_analytics_' || t || '_update', t);
      end if;
    end if;
  end loop;
end $$;

alter table public.bidding_zones enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bidding_zones' and policyname = 'gridex_analytics_bidding_zones_select') then
    create policy gridex_analytics_bidding_zones_select
      on public.bidding_zones
      for select
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bidding_zones' and policyname = 'gridex_analytics_bidding_zones_platform_write') then
    create policy gridex_analytics_bidding_zones_platform_write
      on public.bidding_zones
      for all
      using (gridex_user_is_platform_admin())
      with check (gridex_user_is_platform_admin());
  end if;
end $$;

create or replace view public.analytics_forecasting_readiness_v
with (security_invoker = true)
as
select 'bidding_zones'::text as check_key, count(*)::integer as row_count from public.bidding_zones
union all select 'company_monthly_metrics', count(*)::integer from public.company_monthly_metrics
union all select 'forecast_runs', count(*)::integer from public.forecast_runs
union all select 'data_quality_issues', count(*)::integer from public.data_quality_issues;
