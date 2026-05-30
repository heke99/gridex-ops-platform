-- Ediel Operations Engine Batch
-- Idempotent SaaS-safe support tables for engine audit, mätvärdeskrav and normalized meter values.

create table if not exists public.ediel_engine_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete set null,
  ediel_message_id uuid null references public.ediel_messages(id) on delete set null,
  engine_name text not null,
  engine_version text not null,
  mode text not null default 'production' check (mode in ('production', 'test')),
  suite text null,
  test_case_code text null,
  status text not null default 'completed' check (status in ('started', 'completed', 'blocked', 'failed')),
  decision jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ediel_engine_runs_company_created_idx
  on public.ediel_engine_runs(company_id, created_at desc);

create index if not exists ediel_engine_runs_message_idx
  on public.ediel_engine_runs(ediel_message_id);

create table if not exists public.metering_requirements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  customer_site_id uuid null references public.customer_sites(id) on delete set null,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  source_ediel_message_id uuid null references public.ediel_messages(id) on delete set null,
  source_type text not null default 'contract',
  requirement_status text not null default 'active' check (requirement_status in ('draft', 'active', 'ended', 'cancelled')),
  required_resolution text not null default 'PT15M',
  effective_from date null,
  effective_to date null,
  supplier_reason text null,
  grid_owner_decision_state text not null default 'pending' check (grid_owner_decision_state in ('pending', 'confirmed', 'rejected', 'not_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists metering_requirements_company_status_idx
  on public.metering_requirements(company_id, requirement_status, effective_from desc);

create index if not exists metering_requirements_metering_point_idx
  on public.metering_requirements(metering_point_id, effective_from desc);

create table if not exists public.meter_reading_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  source_ediel_message_id uuid null references public.ediel_messages(id) on delete set null,
  external_metering_point_id text null,
  grid_area_id text null,
  period_start timestamptz null,
  period_end timestamptz null,
  resolution text not null default 'UNKNOWN',
  unit text not null default 'KWH',
  quality_status text not null default 'received',
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique(company_id, dedupe_key)
);

create index if not exists meter_reading_series_company_period_idx
  on public.meter_reading_series(company_id, period_start desc, period_end desc);

create index if not exists meter_reading_series_source_message_idx
  on public.meter_reading_series(source_ediel_message_id);

create table if not exists public.meter_reading_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  series_id uuid not null references public.meter_reading_series(id) on delete cascade,
  reading_at timestamptz null,
  quantity numeric null,
  unit text not null default 'KWH',
  quality text not null default 'unknown',
  source_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(series_id, source_order)
);

create index if not exists meter_reading_values_series_order_idx
  on public.meter_reading_values(series_id, source_order);
