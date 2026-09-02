-- Restore canonical customer-site supplier organization identity in clean replays.
-- Production already carries this column and application/Ediel code uses it.
-- The IF NOT EXISTS form is idempotent for live production and converges empty
-- database reconstruction to the same contract.

alter table public.customer_sites
  add column if not exists current_supplier_org_number text;
