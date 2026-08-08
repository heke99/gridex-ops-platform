-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260527_fix_company_user_invite_runtime_columns.sql
-- Purpose: restore only company_memberships.role_key, required by canonical
-- tenant write-access helpers in the tracked performance hardening migration.
-- Empty replay has no membership rows to backfill.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

alter table if exists public.company_memberships
  add column if not exists role_key text;
