-- GRIDEX-AUD-003 derived bootstrap: restore only the legacy company Ediel production projection fields.
-- Source: supabase/migrations/20260521_actor_testing_go_live_module.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- These fields are still read by the later canonical Ediel production-state migration.

alter table if exists public.companies
  add column if not exists production_status text null default 'not_ready',
  add column if not exists live_ediel_enabled boolean not null default false,
  add column if not exists live_approved_by uuid null references auth.users(id) on delete set null,
  add column if not exists live_approved_at timestamptz null,
  add column if not exists live_blocked_reason text null;

create index if not exists companies_production_status_idx
  on public.companies(production_status, live_ediel_enabled);
