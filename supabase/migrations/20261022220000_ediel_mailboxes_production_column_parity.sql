-- FINDINGS RPL-01 (reality simulation 2026-10-22): the shared Ediel mailbox code writes five columns that the
-- production database has but the canonical history does not create. 20260601070000 adds them, yet the clean
-- replay substitutes that file with the derived bootstrap artifact
-- (scripts/gridex-aud-003-legacy-foundation.json, bootstrap/20260601_ediel_production_readiness_foundation.sql),
-- which omits them, and supabase/schema.sql has none of them either. On a replayed database every successful
-- poll fails in markMailboxPollFinished (PGRST204 'last_successful_poll_at'), the success is recorded as a
-- failure, and /admin/inbound-mail can neither list nor save a shared mailbox profile (smtp_host/smtp_port).
-- Additive and idempotent: production already has these exact columns and types, so there it changes nothing.
alter table if exists public.ediel_mailboxes
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer,
  add column if not exists last_poll_at timestamptz,
  add column if not exists last_successful_poll_at timestamptz,
  add column if not exists last_poll_status text;

notify pgrst, 'reload schema';
