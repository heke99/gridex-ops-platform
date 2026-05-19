-- 20260519_customer_move_out_lifecycle.sql
-- Soft customer move-out / termination lifecycle.
-- Real customer records must be retained for Ediel, metering, billing, audit and support traceability.
-- This migration is guarded and idempotent so it is safe on partially upgraded databases.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists moved_out_at date;
    alter table public.customers add column if not exists lifecycle_closed_at timestamptz;
    alter table public.customers add column if not exists lifecycle_closed_by uuid references auth.users(id) on delete set null;
    alter table public.customers add column if not exists lifecycle_status_reason text;
    create index if not exists customers_company_moved_out_idx on public.customers (company_id, moved_out_at) where moved_out_at is not null;
    create index if not exists customers_company_lifecycle_closed_idx on public.customers (company_id, lifecycle_closed_at desc) where lifecycle_closed_at is not null;
  end if;

  if to_regclass('public.customer_sites') is not null then
    alter table public.customer_sites add column if not exists move_out_date date;
    alter table public.customer_sites add column if not exists closed_at timestamptz;
    alter table public.customer_sites add column if not exists closed_reason text;
    create index if not exists customer_sites_company_move_out_idx on public.customer_sites (company_id, move_out_date) where move_out_date is not null;
  end if;

  if to_regclass('public.metering_points') is not null then
    alter table public.metering_points add column if not exists closed_at timestamptz;
    alter table public.metering_points add column if not exists closed_reason text;
    create index if not exists metering_points_company_end_date_idx on public.metering_points (company_id, end_date) where end_date is not null;
  end if;
end $$;

create table if not exists public.customer_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  event_type text not null,
  event_status text not null default 'completed',
  effective_date date,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_lifecycle_events_type_check check (event_type in ('move_out', 'terminate', 'restore', 'note')),
  constraint customer_lifecycle_events_status_check check (event_status in ('draft', 'completed', 'cancelled'))
);

create index if not exists customer_lifecycle_events_company_created_idx
  on public.customer_lifecycle_events (company_id, created_at desc);

create index if not exists customer_lifecycle_events_customer_created_idx
  on public.customer_lifecycle_events (customer_id, created_at desc);

alter table public.customer_lifecycle_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_lifecycle_events'
      and policyname = 'customer_lifecycle_events_service_role_all'
  ) then
    create policy customer_lifecycle_events_service_role_all
      on public.customer_lifecycle_events
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

comment on table public.customer_lifecycle_events is 'Soft lifecycle journal for move-out and customer termination. Never use hard delete for real moved customers; retain customer, Ediel, metering and billing history.';
comment on column public.customers.moved_out_at is 'Move-out/termination effective date for soft-closed customers. Does not delete operational history.';
