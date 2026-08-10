-- GRIDEX-AUD-003 derived interleaved bootstrap prerequisite.
-- Source: supabase/migrations/20260522_batch4_multisite_duplicate_billing_hardening.sql
-- Restore the source-defined Batch 4 tables required by BL-001; no rows seeded.

create table if not exists public.customer_duplicate_resolution_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, customer_id uuid,
  existing_customer_id uuid, import_row_id uuid, resolution text not null, severity text,
  match_payload jsonb not null default '[]'::jsonb, note text, reason text, created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.power_of_attorney_scopes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  power_of_attorney_id uuid not null, customer_id uuid, site_id uuid, metering_point_id uuid,
  customer_contract_id uuid, scope_type text not null default 'customer', created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.customer_duplicate_resolution_events enable row level security;
alter table public.power_of_attorney_scopes enable row level security;
