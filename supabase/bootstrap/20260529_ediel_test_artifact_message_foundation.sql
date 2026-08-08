-- GRIDEX-AUD-003 derived bootstrap: restore the historical Ediel test-artifact message link.
-- Source: supabase/migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the historical message relation used by tenant-qualified test evidence v2.

alter table if exists public.ediel_test_artifacts
  add column if not exists ediel_message_id uuid references public.ediel_messages(id) on delete set null;
