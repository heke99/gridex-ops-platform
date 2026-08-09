-- GRIDEX-AUD-003 derived bootstrap: restore the historical Ediel test-run message relation.
-- Source: supabase/migrations/20260521_actor_testing_go_live_module.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the original relation and uniqueness index; the later v2
-- evidence migration remains responsible for tenant-qualified ownership and composite FKs.

create table if not exists public.ediel_test_run_messages (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid not null references public.ediel_test_runs(id) on delete cascade,
  ediel_message_id uuid not null,
  step_no integer null,
  expected_direction text null,
  expected_family text null,
  expected_code text null,
  created_at timestamptz not null default now()
);

create unique index if not exists ediel_test_run_messages_unique_step_message_idx
  on public.ediel_test_run_messages(test_run_id, ediel_message_id, coalesce(step_no, -1));
