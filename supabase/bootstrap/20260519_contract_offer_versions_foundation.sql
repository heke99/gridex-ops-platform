-- Derived clean-replay prerequisite from checksum-pinned 20260519 Final SaaS Hardening.
-- Restores only contract_offer_versions required by later canonical contract/invoice
-- completion flows. No offer versions or tenant/product data are seeded.
create table if not exists public.contract_offer_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  contract_offer_id uuid not null,
  version_number integer not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists contract_offer_versions_company_offer_idx
  on public.contract_offer_versions(company_id, contract_offer_id, created_at desc);
