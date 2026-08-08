-- GRIDEX-AUD-003 derived bootstrap: restore the historical Ediel test-run step relation.
-- Source: supabase/migrations/20260528_batch_2_completion_rulebook_actions_regression.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the original step relation, indexes and RLS enablement; the
-- later v2 evidence migration remains responsible for tenant-qualified ownership and composite FKs.

alter table if exists public.ediel_test_runs
  add column if not exists actor_profile_id uuid null,
  add column if not exists environment text null default 'test',
  add column if not exists rule_version_id uuid null,
  add column if not exists timeline jsonb not null default '[]'::jsonb;

create table if not exists public.ediel_test_run_steps (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid not null references public.ediel_test_runs(id) on delete cascade,
  step_no integer not null,
  name text not null,
  status text not null default 'pending',
  expected_family text null,
  expected_code text null,
  expected_direction text null,
  expected_ack text null,
  actual_family text null,
  actual_code text null,
  ediel_message_id uuid null,
  validation_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_test_run_steps_unique_step_idx
  on public.ediel_test_run_steps(test_run_id, step_no);

create index if not exists ediel_test_run_steps_status_idx
  on public.ediel_test_run_steps(test_run_id, status, step_no);

alter table public.ediel_test_run_steps enable row level security;
