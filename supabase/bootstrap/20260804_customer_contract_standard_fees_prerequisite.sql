-- GRIDEX-AUD-003 derived interleaved bootstrap prerequisite.
-- Source: supabase/migrations/20260521_batch3_pricing_billing_audit_roles_completion.sql
-- Source checksum is pinned by scripts/migration-history-manifest.json.
-- Restore only the source-defined customer-contract standard-fee compatibility
-- columns consumed by canonical 20260804003000; no contract rows are modified.

begin;

alter table public.customer_contracts
  add column if not exists discount_value numeric,
  add column if not exists discount_unit text,
  add column if not exists start_fee_sek numeric,
  add column if not exists admin_fee_sek numeric,
  add column if not exists break_fee_sek numeric,
  add column if not exists vat_rate numeric default 0.25;

commit;
