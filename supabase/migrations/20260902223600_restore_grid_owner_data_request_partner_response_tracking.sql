-- Converge live production with the canonical grid_owner_data_requests contract.
-- Clean replays already contain these partner-response tracking columns from the
-- foundational schema; IF NOT EXISTS keeps the migration idempotent everywhere.

alter table public.grid_owner_data_requests
  add column if not exists partner_response_log jsonb not null default '[]'::jsonb;

alter table public.grid_owner_data_requests
  add column if not exists last_partner_response_at timestamptz;
