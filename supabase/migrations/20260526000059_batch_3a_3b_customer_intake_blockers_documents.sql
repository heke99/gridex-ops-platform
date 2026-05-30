-- Batch 3A/3B: customer intake blockers + signed agreement/POA document upload foundation.
-- Goal: customer creation must not fail just because operational data is missing.

create extension if not exists pgcrypto;

-- Blockers are a workflow object, not a hard stop on customer creation.
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

alter table public.customer_blockers add column if not exists customer_site_id uuid;
alter table public.customer_blockers add column if not exists metering_point_id uuid;
alter table public.customer_blockers add column if not exists contract_id uuid;
alter table public.customer_blockers add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.customer_blockers add column if not exists resolved_by uuid;
alter table public.customer_blockers add column if not exists resolved_at timestamptz;

create index if not exists customer_blockers_company_customer_status_idx
  on public.customer_blockers(company_id, customer_id, status);
create index if not exists customer_blockers_company_type_status_idx
  on public.customer_blockers(company_id, blocker_type, status);
create index if not exists customer_blockers_customer_created_idx
  on public.customer_blockers(customer_id, created_at desc);

-- Existing authorization-document table already exists in several migrations. Add the links needed by customer intake.
alter table public.customer_authorization_documents add column if not exists company_id uuid;
alter table public.customer_authorization_documents add column if not exists metering_point_id uuid;
alter table public.customer_authorization_documents add column if not exists customer_contract_id uuid;
alter table public.customer_authorization_documents add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists customer_authorization_documents_company_customer_idx
  on public.customer_authorization_documents(company_id, customer_id, uploaded_at desc);
create index if not exists customer_authorization_documents_contract_idx
  on public.customer_authorization_documents(customer_contract_id) where customer_contract_id is not null;
create index if not exists customer_authorization_documents_metering_point_idx
  on public.customer_authorization_documents(metering_point_id) where metering_point_id is not null;

-- Generic customer documents may be used by later UI sections. Keep it linkable to the same intake graph.
alter table public.customer_documents add column if not exists customer_site_id uuid;
alter table public.customer_documents add column if not exists metering_point_id uuid;
alter table public.customer_documents add column if not exists contract_id uuid;
alter table public.customer_documents add column if not exists power_of_attorney_id uuid;
alter table public.customer_documents add column if not exists status text not null default 'uploaded';
alter table public.customer_documents add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists customer_documents_company_customer_idx
  on public.customer_documents(company_id, customer_id, created_at desc);
create index if not exists customer_documents_customer_site_idx
  on public.customer_documents(customer_site_id) where customer_site_id is not null;
create index if not exists customer_documents_contract_idx
  on public.customer_documents(contract_id) where contract_id is not null;
create index if not exists customer_documents_poa_idx
  on public.customer_documents(power_of_attorney_id) where power_of_attorney_id is not null;

-- Intake statuses now reflect workflow state instead of only ready/not-ready.
do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists intake_status text;
    alter table public.customers add column if not exists intake_missing_fields text[] not null default array[]::text[];
    alter table public.customers add column if not exists intake_quality_score integer;
    alter table public.customers add column if not exists intake_warnings text[] not null default array[]::text[];
    alter table public.customers add column if not exists possible_duplicate boolean not null default false;
    alter table public.customers add column if not exists duplicate_review_status text not null default 'clear';

    alter table public.customers drop constraint if exists customers_intake_status_check;
    alter table public.customers add constraint customers_intake_status_check
      check (
        intake_status is null or intake_status in (
          'draft',
          'incomplete',
          'needs_completion',
          'pending_information',
          'pending_power_of_attorney',
          'pending_duplicate_review',
          'blocked',
          'ready_for_contract',
          'ready_for_operations'
        )
      );
  end if;
end $$;

-- Storage bucket used by signed agreements and signed POA uploads in the customer intake.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-documents',
  'customer-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.customer_blockers enable row level security;

-- Service role policy keeps server actions functional. User-facing policies can be tightened later with tenant membership helpers.
drop policy if exists customer_blockers_service_role_all on public.customer_blockers;
create policy customer_blockers_service_role_all
  on public.customer_blockers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists customer_documents_storage_service_role_all on storage.objects';
    execute $policy$
      create policy customer_documents_storage_service_role_all
        on storage.objects
        for all
        using (bucket_id = 'customer-documents' and auth.role() = 'service_role')
        with check (bucket_id = 'customer-documents' and auth.role() = 'service_role')
    $policy$;
  end if;
end $$;
