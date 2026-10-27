-- FINDINGS J2-B7 (reality J2-9, batch 5e, after J2-B6). gridex_billing_source.gridex_create_billing_export_run_before_source_v2
-- (20261014103422, via public.gridex_create_billing_export_run) inserts billing_export_runs.adapter_key, payload_version
-- and retry_policy, and lib/billing/invoiceReviewPrepare.ts and exportCenter.ts send them. The columns were meant to come
-- from 20260522_batch4c_billing_export_audit_quality_ai.sql, but that migration adds them only when billing_export_runs
-- already exists, and in the migration chain the table is created later. So neither the replay nor the captured schema
-- (supabase/schema.sql) has them, and every invoice draft failed with 42703 ("column adapter_key of relation
-- billing_export_runs does not exist"): "Draftfakturan kunde inte skapas." for every priced underlay.
--
-- Additive and idempotent: the three columns with exactly the defaults of 20260522 (and of the function's own
-- coalesce). Existing rows get the defaults. No other table, grant or body changes.
begin;

alter table public.billing_export_runs
  add column if not exists adapter_key text not null default 'gridex_billing_partner_v1',
  add column if not exists payload_version text not null default 'billing_export_v4c',
  add column if not exists retry_policy jsonb not null default '{"maxAttempts":3,"strategy":"manual_retry"}'::jsonb;

commit;
