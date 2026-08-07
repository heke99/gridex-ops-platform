-- GRIDEX-AUD-003 derived bootstrap: restore the historical actor test result ledger.
-- Source: supabase/migrations/20260521_actor_testing_go_live_module.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to actor_test_results and its original indexes; later canonical
-- configuration migrations remain responsible for snapshot/staleness fields.

create table if not exists public.actor_test_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  test_key text not null,
  test_name text null,
  test_id text null,
  package_key text null,
  message_family text null,
  message_code text null,
  direction text null,
  status text not null default 'not_started',
  latest_run_at timestamptz null,
  passed_at timestamptz null,
  failure_reason text null,
  portal_status text null,
  raw_payload text null,
  contrl_message_id uuid null,
  aperak_message_id uuid null,
  utilts_err_message_id uuid null,
  ediel_test_run_id uuid null,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint actor_test_results_status_check
    check (status in ('not_started', 'running', 'passed', 'failed', 'blocked', 'manual_verified')),
  constraint actor_test_results_direction_check
    check (direction is null or direction in ('actor_to_portal', 'portal_to_actor')),
  constraint actor_test_results_company_test_key
    unique (company_id, test_key)
);

create index if not exists actor_test_results_company_status_idx
  on public.actor_test_results(company_id, status, latest_run_at desc);

create index if not exists actor_test_results_package_idx
  on public.actor_test_results(company_id, package_key, status);
