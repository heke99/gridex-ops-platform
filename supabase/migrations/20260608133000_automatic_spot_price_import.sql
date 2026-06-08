-- Automatic spot price import hardening.
-- Keeps Elpriset just nu as global market data while pricing remains tenant-specific through contracts and company price components.

alter table if exists public.spot_price_import_runs
  add column if not exists trigger_source text not null default 'manual' check (trigger_source in ('manual','cron','pricing_preview','billing_underlay','manual_retry')),
  add column if not exists requested_by text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_spot_price_import_runs_month_trigger
  on public.spot_price_import_runs(billing_month, trigger_source, created_at desc);

create table if not exists public.pricing_automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_key text not null,
  billing_month text check (billing_month is null or billing_month ~ '^\d{4}-\d{2}$'),
  status text not null default 'running' check (status in ('running','completed','completed_with_warnings','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  error_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pricing_automation_runs_key_month
  on public.pricing_automation_runs(automation_key, billing_month, started_at desc);

insert into public.spot_price_sources(source_key, source_name, base_url, status, metadata)
values (
  'elprisetjustnu',
  'Elpriset just nu',
  'https://www.elprisetjustnu.se/api/v1/prices',
  'active',
  '{"prices_ex_vat":true,"contains_fees":false,"automatic_import":true,"default_cron":"daily_previous_month"}'::jsonb
)
on conflict (source_key) do update
set metadata = public.spot_price_sources.metadata || excluded.metadata,
    updated_at = now();
