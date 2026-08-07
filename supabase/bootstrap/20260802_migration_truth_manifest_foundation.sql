-- GRIDEX-AUD-003 derived bootstrap prerequisite.
-- Source: supabase/migrations/20260802232000_migration_truth_readiness.sql
-- Restores only canonical_migration_manifest verification metadata required by
-- later migration governance. It does not populate the manifest or modify the
-- Supabase migration ledger.

alter table public.canonical_migration_manifest
  add column if not exists verified_at timestamptz,
  add column if not exists verification_source text,
  add column if not exists release_identifier text,
  add column if not exists schema_fingerprint text;
