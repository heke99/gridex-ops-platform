-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260609162000_batch_7_website_integration_foundation.sql
-- Restores only the historical website customer application relation required
-- by later workflow provenance. No customer applications are seeded.

create extension if not exists pgcrypto;

create table if not exists public.website_customer_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  metering_point_id uuid references public.metering_points(id) on delete set null,
  contract_id uuid references public.customer_contracts(id) on delete set null,
  external_customer_id text not null,
  external_account_id text,
  customer_number text,
  source text not null default 'external_website',
  status text not null default 'application_received',
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_customer_applications_status_check check (status in ('application_received','linked_existing_customer','pending_review','rejected','failed','cancelled'))
);

create unique index if not exists website_customer_applications_company_idempotency_uidx
  on public.website_customer_applications(company_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists website_customer_applications_company_external_idx
  on public.website_customer_applications(company_id, external_customer_id, created_at desc);
create index if not exists website_customer_applications_customer_idx
  on public.website_customer_applications(company_id, customer_id, created_at desc)
  where customer_id is not null;
