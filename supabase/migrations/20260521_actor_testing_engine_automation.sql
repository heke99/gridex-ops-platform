-- Actor testing automation hardening.
-- Idempotent addendum for projects that already ran 20260521_actor_testing_go_live_module.sql.

alter table if exists public.actor_test_results
  add column if not exists contrl_message_id uuid null,
  add column if not exists aperak_message_id uuid null,
  add column if not exists utilts_err_message_id uuid null,
  add column if not exists ediel_test_run_id uuid null,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

create index if not exists actor_test_results_message_refs_idx
  on public.actor_test_results(company_id, contrl_message_id, aperak_message_id, utilts_err_message_id);

create index if not exists actor_test_results_run_idx
  on public.actor_test_results(company_id, ediel_test_run_id);

create index if not exists ediel_test_runs_company_case_idx
  on public.ediel_test_runs(company_id, test_suite, role_code, test_case_code, status, created_at desc);

create index if not exists ediel_test_run_messages_message_idx
  on public.ediel_test_run_messages(ediel_message_id);

create index if not exists ediel_messages_actor_testing_lookup_idx
  on public.ediel_messages(company_id, direction, message_family, message_code, created_at desc);
