-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260526_batch_3a_3b_customer_intake_blockers_documents.sql
-- Purpose: restore only the source-defined customer_blockers workflow relation,
-- base indexes and service-role RLS required by tracked bulk blocker operations.
-- No blocker rows, documents or tenant/customer data are seeded.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

create table if not exists public.customer_blockers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid null,
  metering_point_id uuid null,
  contract_id uuid null,
  blocker_type text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  title text not null,
  description text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  resolved_by uuid null references auth.users(id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_blockers_severity_check check (severity in ('info', 'warning', 'blocking', 'critical')),
  constraint customer_blockers_status_check check (status in ('open', 'pending_review', 'resolved', 'dismissed', 'cancelled'))
);

create index if not exists customer_blockers_company_customer_status_idx
  on public.customer_blockers(company_id, customer_id, status);
create index if not exists customer_blockers_company_type_status_idx
  on public.customer_blockers(company_id, blocker_type, status);
create index if not exists customer_blockers_customer_created_idx
  on public.customer_blockers(customer_id, created_at desc);

alter table public.customer_blockers enable row level security;

drop policy if exists customer_blockers_service_role_all on public.customer_blockers;
create policy customer_blockers_service_role_all
  on public.customer_blockers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
