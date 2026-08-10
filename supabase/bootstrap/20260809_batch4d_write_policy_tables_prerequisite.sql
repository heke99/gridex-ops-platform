-- GRIDEX-AUD-003 derived interleaved bootstrap prerequisite.
-- Source: supabase/migrations/20260522_batch4d_merge_poa_lifecycle_hardening.sql
-- Restore the source-defined Batch 4D tables required by BL-001; no rows seeded.

create table if not exists public.customer_merge_events (
  id uuid primary key default gen_random_uuid(), company_id uuid null,
  primary_customer_id uuid not null, merged_customer_id uuid not null, reason text null,
  moved_counts jsonb not null default '{}'::jsonb, source_snapshot jsonb null,
  created_by uuid null, created_at timestamptz not null default now()
);
create index if not exists customer_merge_events_company_primary_idx on public.customer_merge_events(company_id, primary_customer_id, created_at desc);
create index if not exists customer_merge_events_company_merged_idx on public.customer_merge_events(company_id, merged_customer_id, created_at desc);

create table if not exists public.customer_lifecycle_decisions (
  id uuid primary key default gen_random_uuid(), company_id uuid null, customer_id uuid not null,
  decision_type text not null check (decision_type in ('withdrawal','rejected')),
  scope_type text not null default 'customer' check (scope_type in ('customer','contract','site','metering_point')),
  scope_id uuid null, reason text not null, billing_blocked boolean not null default true,
  created_by uuid null, created_at timestamptz not null default now()
);
create index if not exists customer_lifecycle_decisions_company_customer_idx on public.customer_lifecycle_decisions(company_id, customer_id, created_at desc);
create index if not exists customer_lifecycle_decisions_company_scope_idx on public.customer_lifecycle_decisions(company_id, scope_type, scope_id) where scope_id is not null;
alter table public.customer_merge_events enable row level security;
alter table public.customer_lifecycle_decisions enable row level security;
