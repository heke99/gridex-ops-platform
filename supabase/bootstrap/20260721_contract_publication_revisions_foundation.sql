-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260721170000_contract_graph_api_revision_hardening.sql
-- Restores only the contract publication revision ledger relation required by
-- the tracked shared public-contract snapshot migrations. No revision rows or
-- publication events are seeded.

create extension if not exists pgcrypto;

create table if not exists public.contract_publication_revisions (
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null check (channel in ('website','api','internal','phone','partner')),
  revision bigint not null default 0,
  revision_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key(company_id,channel)
);

alter table public.contract_publication_revisions enable row level security;

drop policy if exists contract_publication_revisions_service_role_all
  on public.contract_publication_revisions;
create policy contract_publication_revisions_service_role_all
  on public.contract_publication_revisions
  for all to service_role
  using(true) with check(true);

drop policy if exists contract_publication_revisions_tenant_read
  on public.contract_publication_revisions;
create policy contract_publication_revisions_tenant_read
  on public.contract_publication_revisions
  for select to authenticated
  using(public.gridex_can_read_company(company_id));
