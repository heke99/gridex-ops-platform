-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260609150000_batch_6_sync_status_origin_fix.sql
-- Restores only integration API client origin/runtime columns and the historical
-- origin index needed by later runtime capability checks. No clients are seeded.

alter table public.integration_api_clients
  add column if not exists allowed_origins text[] not null default '{}';

alter table public.integration_api_clients
  add column if not exists allowed_ips text[] not null default '{}';

alter table public.integration_api_clients
  add column if not exists rate_limit_per_minute integer not null default 60;

alter table public.integration_api_clients
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists integration_api_clients_company_status_idx
  on public.integration_api_clients(company_id, status);

create index if not exists integration_api_clients_allowed_origins_gin_idx
  on public.integration_api_clients using gin(allowed_origins);
