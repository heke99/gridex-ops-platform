-- Restore canonical customer-site current-supplier identity in clean replays.
-- Production already carries these columns and application/Ediel code uses them.
-- The IF NOT EXISTS form is idempotent for live production and converges empty
-- database reconstruction to the same contract.

alter table public.customer_sites
  add column if not exists current_supplier_id uuid,
  add column if not exists current_supplier_org_number text,
  add column if not exists current_supplier_unknown boolean not null default false;
