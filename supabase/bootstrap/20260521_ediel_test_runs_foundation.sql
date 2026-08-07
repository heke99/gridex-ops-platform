-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260521_actor_testing_go_live_module.sql
-- Purpose: create only the ediel_test_runs prerequisite required by the
-- checksum-pinned Ediel rulebook migration on an empty database.
-- The immutable source migration remains checksum-pinned.

create table if not exists public.ediel_test_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  approval_version text null,
  role_code text not null,
  test_suite text not null,
  test_case_code text not null,
  title text null,
  status text not null default 'draft',
  customer_id uuid null,
  site_id uuid null,
  metering_point_id uuid null,
  grid_owner_id uuid null,
  started_at timestamptz null,
  completed_at timestamptz null,
  failure_reason text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.ediel_test_runs
  add column if not exists company_id uuid null references public.companies(id) on delete cascade;

create index if not exists ediel_test_runs_company_suite_case_status_idx
  on public.ediel_test_runs(company_id, test_suite, role_code, test_case_code, status, created_at desc);
