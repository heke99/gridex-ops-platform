-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260520_batch_3_4_onboarding_pricing_billing_engine.sql
-- Purpose: restore the remaining source-defined schema-only onboarding/billing
-- prerequisites omitted by the narrower metering/pricing derived artifacts.
-- No customer requests, scopes, export rows or tenant/product data are seeded.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

create table if not exists public.customer_info_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_id uuid null,
  metering_point_id uuid null,
  authorization_document_id uuid null,
  request_type text not null default 'z01_customer_masterdata',
  target_party_type text not null default 'grid_owner',
  target_party_name text null,
  grid_owner_id uuid null,
  current_supplier_name text null,
  status text not null default 'draft',
  requested_data_categories jsonb not null default '[]'::jsonb,
  verified_payload jsonb not null default '{}'::jsonb,
  blocker_reason text null,
  notes text null,
  requested_at timestamptz null,
  sent_at timestamptz null,
  received_at timestamptz null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_info_requests_status_check check (status in (
    'draft','missing_authorization','ready_to_send','sent_to_grid_owner',
    'waiting_for_contrl','waiting_for_aperak','waiting_for_z02','z02_received',
    'negative_aperak','manual_review_required','missing_binding_info',
    'missing_termination_info','ready_for_switch','cancelled','rejected',
    'completed','blocked'
  ))
);

create index if not exists customer_info_requests_company_status_idx
  on public.customer_info_requests(company_id, status, created_at desc);
create index if not exists customer_info_requests_customer_idx
  on public.customer_info_requests(company_id, customer_id, created_at desc);

create table if not exists public.customer_info_request_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_info_request_id uuid not null references public.customer_info_requests(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  event_type text not null,
  message text null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists customer_info_request_events_request_idx
  on public.customer_info_request_events(customer_info_request_id, created_at desc);
create index if not exists customer_info_request_events_company_idx
  on public.customer_info_request_events(company_id, created_at desc);

create table if not exists public.authorization_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  authorization_document_id uuid null,
  scope_type text not null default 'customer_onboarding',
  status text not null default 'active',
  covers_grid_owner_data boolean not null default false,
  covers_current_supplier_contract boolean not null default false,
  covers_metering_data boolean not null default false,
  valid_from date null,
  valid_to date null,
  revoked_at timestamptz null,
  evidence_note text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authorization_scopes_status_check
    check (status in ('draft', 'active', 'expired', 'revoked', 'blocked'))
);

create index if not exists authorization_scopes_company_customer_idx
  on public.authorization_scopes(company_id, customer_id, status, created_at desc);

create table if not exists public.metering_permission_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metering_permission_id uuid not null references public.metering_permissions(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_id uuid null,
  metering_point_id uuid null,
  facility_id text null,
  grid_area_code text null,
  status text not null default 'pending',
  start_date date null,
  end_date date null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists metering_permission_sites_permission_idx
  on public.metering_permission_sites(metering_permission_id, status);
create index if not exists metering_permission_sites_company_facility_idx
  on public.metering_permission_sites(company_id, facility_id);

create table if not exists public.billing_export_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_month text not null,
  target_system text not null default 'billing_partner',
  export_format text not null default 'json',
  status text not null default 'draft',
  rows_total integer not null default 0,
  rows_ready integer not null default 0,
  rows_blocked integer not null default 0,
  rows_exported integer not null default 0,
  blocker_summary jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_export_runs
  add column if not exists company_id uuid,
  add column if not exists period_month text,
  add column if not exists target_system text,
  add column if not exists export_format text,
  add column if not exists status text,
  add column if not exists rows_total integer,
  add column if not exists rows_ready integer,
  add column if not exists rows_blocked integer,
  add column if not exists rows_exported integer,
  add column if not exists blocker_summary jsonb,
  add column if not exists metadata jsonb,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.billing_export_runs
  alter column company_id set not null,
  alter column period_month set not null,
  alter column target_system set default 'billing_partner',
  alter column target_system set not null,
  alter column export_format set default 'json',
  alter column export_format set not null,
  alter column status set default 'draft',
  alter column rows_total set default 0,
  alter column rows_ready set default 0,
  alter column rows_blocked set default 0,
  alter column rows_exported set default 0,
  alter column blocker_summary set default '[]'::jsonb,
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.billing_export_runs
  drop constraint if exists billing_export_runs_status_check;
alter table public.billing_export_runs
  add constraint billing_export_runs_status_check
  check (status in ('draft','ready','ready_with_flags','blocked','sent','acknowledged','failed','cancelled'));

create index if not exists billing_export_runs_company_period_idx
  on public.billing_export_runs(company_id, period_month, created_at desc);

create table if not exists public.billing_export_run_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_export_run_id uuid not null references public.billing_export_runs(id) on delete cascade,
  billing_underlay_id uuid null references public.billing_underlays(id) on delete set null,
  customer_id uuid null,
  site_id uuid null,
  metering_point_id uuid null,
  status text not null default 'blocked',
  readiness_status text not null default 'blocked',
  blocker_reasons jsonb not null default '[]'::jsonb,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.billing_export_run_items
  add column if not exists company_id uuid,
  add column if not exists billing_export_run_id uuid,
  add column if not exists billing_underlay_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists site_id uuid,
  add column if not exists metering_point_id uuid,
  add column if not exists status text,
  add column if not exists readiness_status text,
  add column if not exists blocker_reasons jsonb,
  add column if not exists payload_snapshot jsonb,
  add column if not exists created_at timestamptz;

alter table public.billing_export_run_items
  alter column company_id set not null,
  alter column billing_export_run_id set not null,
  alter column status set default 'blocked',
  alter column status set not null,
  alter column readiness_status set default 'blocked',
  alter column readiness_status set not null,
  alter column blocker_reasons set default '[]'::jsonb,
  alter column blocker_reasons set not null,
  alter column payload_snapshot set default '{}'::jsonb,
  alter column payload_snapshot set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.billing_export_run_items'::regclass
      and conname = 'billing_export_run_items_billing_export_run_id_fkey'
  ) then
    alter table public.billing_export_run_items
      add constraint billing_export_run_items_billing_export_run_id_fkey
      foreign key (billing_export_run_id)
      references public.billing_export_runs(id)
      on delete cascade;
  end if;
end $$;

create index if not exists billing_export_run_items_run_status_idx
  on public.billing_export_run_items(billing_export_run_id, status);
create index if not exists billing_export_run_items_company_underlay_idx
  on public.billing_export_run_items(company_id, billing_underlay_id);

do $$
begin
  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney
      add column if not exists scope_summary jsonb not null default '{}'::jsonb,
      add column if not exists revoked_at timestamptz null,
      add column if not exists evidence_note text null;
    create index if not exists powers_of_attorney_company_customer_status_idx
      on public.powers_of_attorney(company_id, customer_id, status);
  end if;

  if to_regclass('public.contract_offers') is not null then
    alter table public.contract_offers
      add column if not exists pricing_components jsonb not null default '[]'::jsonb,
      add column if not exists billing_validation_rules jsonb not null default '{}'::jsonb;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customer_info_requests',
    'customer_info_request_events',
    'authorization_scopes',
    'metering_permission_sites',
    'billing_export_runs',
    'billing_export_run_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = t || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
        t || '_service_role_all',
        t
      );
    end if;
  end loop;
end $$;
