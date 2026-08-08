-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260520_batch_3_4_onboarding_pricing_billing_engine.sql
-- Purpose: create only the metering_permissions prerequisite required by ediel_rules.sql
-- on an empty database, without replaying the source migration's unrelated billing objects.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

create table if not exists public.metering_permissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_id uuid null,
  metering_point_id uuid null,
  grid_owner_id uuid null,
  authorization_document_id uuid null,
  permission_reference text null,
  case_reference text null,
  status text not null default 'draft',
  requested_start_date date null,
  requested_end_date date null,
  approved_start_date date null,
  approved_end_date date null,
  resolution_code text null,
  report_frequency text null,
  source_z13_message_id uuid null,
  source_z14_message_id uuid null,
  last_blocker text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metering_permissions_status_check check (status in (
    'draft',
    'missing_authorization',
    'z13_ready',
    'z13_sent',
    'waiting_for_customer_approval',
    'partially_approved',
    'approved',
    'rejected_active',
    'rejected_passive_timeout',
    'z14_received',
    'active',
    'ended',
    'cancelled',
    'blocked'
  ))
);

create index if not exists metering_permissions_company_status_idx
  on public.metering_permissions(company_id, status, created_at desc);
create index if not exists metering_permissions_customer_idx
  on public.metering_permissions(company_id, customer_id, created_at desc);
create index if not exists metering_permissions_case_reference_idx
  on public.metering_permissions(company_id, case_reference);
create index if not exists metering_permissions_permission_reference_idx
  on public.metering_permissions(company_id, permission_reference);
