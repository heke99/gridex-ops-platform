-- Keep the canonical invoice draft's legacy export graph writable on clean databases.
-- These are the defaults of the original billing export adapter contract.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.billing_export_runs
  ADD COLUMN IF NOT EXISTS adapter_key text NOT NULL DEFAULT 'gridex_billing_partner_v1',
  ADD COLUMN IF NOT EXISTS payload_version text NOT NULL DEFAULT 'billing_export_v4c',
  ADD COLUMN IF NOT EXISTS retry_policy jsonb NOT NULL DEFAULT '{"maxAttempts":3,"strategy":"manual_retry"}'::jsonb;

RESET statement_timeout;
RESET lock_timeout;
