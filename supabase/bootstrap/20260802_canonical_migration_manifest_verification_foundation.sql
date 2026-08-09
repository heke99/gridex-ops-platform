-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260802232000_migration_truth_readiness.sql
-- Restores only canonical migration-manifest verification metadata required by
-- the tracked v3 governance view. No manifest rows or verification evidence are seeded.

alter table public.canonical_migration_manifest
  add column if not exists verified_at timestamptz,
  add column if not exists verification_source text,
  add column if not exists release_identifier text,
  add column if not exists schema_fingerprint text;
