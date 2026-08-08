-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260618110000_customer_operation_automation_jobs.sql
-- Restores only the historical customer operation job relation required by the
-- later application continuation schema. No jobs are seeded and no worker RPC
-- behavior is replayed.

create extension if not exists pgcrypto;

create table if not exists public.customer_operation_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid null references public.customer_sites(id) on delete cascade,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  job_type text not null,
  status text not null default 'queued',
  priority smallint not null default 100,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  last_error text null,
  created_by uuid null references auth.users(id) on delete set null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_operation_jobs_status_check check (status in ('queued','running','waiting_response','completed','needs_review','failed','skipped','cancelled')),
  constraint customer_operation_jobs_attempts_check check (attempts >= 0 and max_attempts > 0)
);

create unique index if not exists customer_operation_jobs_active_idempotency_uidx
  on public.customer_operation_jobs(company_id, job_type, idempotency_key)
  where status in ('queued','running','waiting_response');

create index if not exists customer_operation_jobs_claim_idx
  on public.customer_operation_jobs(status, run_after, priority, created_at)
  where status = 'queued';

create index if not exists customer_operation_jobs_customer_idx
  on public.customer_operation_jobs(company_id, customer_id, created_at desc);

alter table public.customer_operation_jobs enable row level security;
