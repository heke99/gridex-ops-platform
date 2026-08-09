-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260521_batch_2c_end_to_end_operations.sql
-- Purpose: restore only the source-defined external_contract_intakes relation,
-- base index and source RLS policies required by later launch-readiness views.
-- No intake rows or tenant/customer data are seeded.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

create table if not exists public.external_contract_intakes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'received',
  source_channel text not null default 'public_contract_form',
  idempotency_key text not null,
  customer_type text not null default 'private',
  first_name text null,
  last_name text null,
  company_name text null,
  email text null,
  phone text null,
  personal_number text null,
  org_number text null,
  facility_id text null,
  meter_point_id text null,
  street text null,
  postal_code text null,
  city text null,
  move_in_date date null,
  price_area_code text null,
  contract_offer_id uuid null,
  requested_start_date date null,
  created_customer_id uuid null,
  created_site_id uuid null,
  created_metering_point_id uuid null,
  created_contract_id uuid null,
  created_case_id uuid null,
  created_info_request_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_contract_intakes_status_check check (status in ('received', 'created', 'needs_review', 'duplicate', 'failed', 'cancelled')),
  unique(company_id, idempotency_key)
);

create index if not exists external_contract_intakes_company_status_idx
  on public.external_contract_intakes(company_id, status, created_at desc);

alter table public.external_contract_intakes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'external_contract_intakes'
      and policyname = 'external_contract_intakes_service_role_all'
  ) then
    create policy external_contract_intakes_service_role_all
      on public.external_contract_intakes
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'external_contract_intakes'
      and policyname = 'external_contract_intakes_tenant_select'
  ) then
    create policy external_contract_intakes_tenant_select
      on public.external_contract_intakes
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;
