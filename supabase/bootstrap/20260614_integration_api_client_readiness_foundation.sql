-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260614140000_ops_production_multitenant_readiness.sql
-- Restores only integration API client readiness columns used by later
-- canonical runtime capability checks. No clients are seeded.

alter table public.integration_api_clients
  add column if not exists profile_key text;

alter table public.integration_api_clients
  add column if not exists launch_ready boolean;

alter table public.integration_api_clients
  add column if not exists launch_blockers jsonb;
