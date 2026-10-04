-- The canonical clean replay derives only route_decision_logs and
-- inbound_processing_jobs from the legacy 20260528 batch 7A foundation. The
-- outbound_requests route/process columns that batch added are therefore
-- absent from the canonical schema, yet lib/cis/db-outbound.ts writes every
-- one of them. On the canonical schema that insert fails ("Could not find
-- the 'ack_policy' column of 'outbound_requests'"). This repeats exactly the
-- batch 7A column definitions for outbound_requests. It is idempotent: a
-- no-op where the legacy batch already ran, additive on the canonical replay.
-- No rows are written.
BEGIN;
ALTER TABLE public.outbound_requests
  ADD COLUMN IF NOT EXISTS agreement_id uuid,
  ADD COLUMN IF NOT EXISTS grid_owner_access_agreement_id uuid,
  ADD COLUMN IF NOT EXISTS route_decision_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS business_process text,
  ADD COLUMN IF NOT EXISTS message_intent text,
  ADD COLUMN IF NOT EXISTS message_family text,
  ADD COLUMN IF NOT EXISTS message_code text,
  ADD COLUMN IF NOT EXISTS message_version text,
  ADD COLUMN IF NOT EXISTS ediel_route_profile_id uuid,
  ADD COLUMN IF NOT EXISTS application_reference text,
  ADD COLUMN IF NOT EXISTS sender_ediel_id text,
  ADD COLUMN IF NOT EXISTS sender_sub_address text,
  ADD COLUMN IF NOT EXISTS receiver_ediel_id text,
  ADD COLUMN IF NOT EXISTS receiver_sub_address text,
  ADD COLUMN IF NOT EXISTS ack_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS required_admin_actions jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
