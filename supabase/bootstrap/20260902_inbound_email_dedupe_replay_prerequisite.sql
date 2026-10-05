-- GRIDEX-REM-002 replay-only prerequisite.
-- Source: migrations/20260615_multitenant_integrity_and_claim_locks.sql
-- Reconstruct the source-defined inbound dedupe columns needed by later
-- canonical migrations without rewriting already-applied migration history.

alter table if exists public.inbound_email_messages add column if not exists raw_message_sha256 text;
alter table if exists public.inbound_email_messages add column if not exists dedupe_scope text;
alter table if exists public.inbound_email_messages add column if not exists dedupe_reason text;
alter table if exists public.inbound_email_messages add column if not exists duplicate_of_id uuid;
