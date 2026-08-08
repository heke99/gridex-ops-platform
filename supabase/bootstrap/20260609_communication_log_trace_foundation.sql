-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260609162000_batch_7_website_integration_foundation.sql
-- Purpose: restore only the source-defined communication log identity/trace columns and
-- customer-number index required by the later Batch 8 admin operations migration.
-- No communication rows or tenant/customer data are seeded.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

alter table if exists public.communication_logs
  add column if not exists customer_number text,
  add column if not exists external_customer_id text,
  add column if not exists contract_id uuid,
  add column if not exists template_version_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists communication_logs_customer_number_idx
  on public.communication_logs(company_id, customer_number, created_at desc)
  where customer_number is not null;
