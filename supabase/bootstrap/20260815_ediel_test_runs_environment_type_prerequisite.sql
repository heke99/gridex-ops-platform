alter table if exists public.ediel_test_runs
  add column if not exists environment_type public.ediel_environment_type not null default 'agt_test';
