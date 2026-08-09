-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql
-- Purpose: restore only the source-defined customer_contracts energy-resolution columns
-- required by later launch/billing-readiness views on an empty database.
-- No contracts or tenant/customer data are seeded.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

alter table if exists public.customer_contracts
  add column if not exists requested_start_mode text not null default 'earliest_possible'
    check (requested_start_mode in ('earliest_possible','specific_date')),
  add column if not exists calculated_earliest_start_date date,
  add column if not exists price_area_used text,
  add column if not exists grid_area_code_used text,
  add column if not exists resolution_status text;
