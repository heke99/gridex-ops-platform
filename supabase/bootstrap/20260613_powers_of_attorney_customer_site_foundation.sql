-- GRIDEX-AUD-003 derived bootstrap: restore the historical powers_of_attorney customer-site reference.
-- Source: supabase/migrations/20260613090000_batch_m_ops_master_legal_readiness.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the prerequisite used by later tracked grid-owner pipeline migrations.

alter table if exists public.powers_of_attorney
  add column if not exists customer_site_id uuid references public.customer_sites(id) on delete set null;

update public.powers_of_attorney
set customer_site_id = coalesce(customer_site_id, site_id)
where customer_site_id is null;
