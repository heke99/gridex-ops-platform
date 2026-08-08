-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260528_batch_1_completion_customer_flow.sql
-- Purpose: restore only the pre-ledger route_decision_logs current-supplier
-- trace column and index observed in the canonical live schema. The immutable
-- source migration remains checksum-pinned.

alter table if exists public.route_decision_logs
  add column if not exists current_supplier_id uuid;

create index if not exists route_decision_logs_current_supplier_idx
  on public.route_decision_logs(company_id, current_supplier_id, created_at desc)
  where current_supplier_id is not null;
