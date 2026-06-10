-- Customer application review flow: incomplete website applications must become a work queue,
-- not a failed API request or a prematurely confirmed contract.

create extension if not exists pgcrypto;

alter table if exists public.website_customer_applications
  add column if not exists missing_fields text[] not null default '{}'::text[],
  add column if not exists blocking_reasons jsonb not null default '[]'::jsonb,
  add column if not exists next_step text,
  add column if not exists requested_start_date date,
  add column if not exists confirmed_start_date date,
  add column if not exists actual_start_date date,
  add column if not exists timeline jsonb not null default '[]'::jsonb,
  add column if not exists audit_log jsonb not null default '[]'::jsonb,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists grid_owner_id uuid,
  add column if not exists electricity_supplier_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if to_regclass('public.website_customer_applications') is not null then
    alter table public.website_customer_applications drop constraint if exists website_customer_applications_status_check;
    alter table public.website_customer_applications
      add constraint website_customer_applications_status_check check (
        status in (
          'received',
          'customer_created',
          'customer_matched',
          'contract_created',
          'confirmation_pending',
          'confirmation_sent',
          'cooling_off_sent',
          'webhook_pending',
          'completed',
          'application_received',
          'linked_existing_customer',
          'needs_information',
          'pending_validation',
          'ready_for_switch',
          'switch_requested',
          'switch_confirmed',
          'switch_rejected',
          'active',
          'pending_review',
          'manual_review',
          'rejected',
          'failed',
          'cancelled'
        )
      );
  end if;
end $$;

create index if not exists website_customer_applications_review_idx
  on public.website_customer_applications(company_id, status, created_at desc)
  where status in ('needs_information','pending_review','manual_review','pending_validation','ready_for_switch');

create index if not exists website_customer_applications_missing_fields_gin_idx
  on public.website_customer_applications using gin(missing_fields);

create index if not exists website_customer_applications_assigned_idx
  on public.website_customer_applications(company_id, assigned_to, created_at desc)
  where assigned_to is not null;

alter table if exists public.customers
  add column if not exists intake_status text,
  add column if not exists intake_missing_fields text[] not null default '{}'::text[],
  add column if not exists intake_quality_score integer,
  add column if not exists intake_warnings text[] not null default '{}'::text[];

create index if not exists customers_company_intake_status_idx
  on public.customers(company_id, intake_status, updated_at desc)
  where intake_status is not null;

alter table if exists public.customer_contracts
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists expected_start_at date,
  add column if not exists requested_start_date date,
  add column if not exists confirmed_start_date date,
  add column if not exists actual_start_date date,
  add column if not exists agreement_channel text,
  add column if not exists campaign_code text,
  add column if not exists price_version text,
  add column if not exists terms_version text;

-- Keep legacy DB/UI code compatible. Runtime keeps using enabled as canonical, is_active mirrors it for older checks.
alter table if exists public.email_event_rules
  add column if not exists is_active boolean not null default true;

update public.email_event_rules
set is_active = enabled
where enabled is not null
  and is_active is distinct from enabled;

-- Optional normalized manual review items for future dedicated queues. The current UI also stores timeline/audit on the application.
create table if not exists public.website_application_review_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  application_id uuid not null references public.website_customer_applications(id) on delete cascade,
  customer_id uuid,
  issue_type text not null,
  severity text not null default 'blocking',
  field_key text,
  title text not null,
  recommended_action text,
  status text not null default 'open',
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_application_review_items_severity_check check (severity in ('blocking','warning','info')),
  constraint website_application_review_items_status_check check (status in ('open','in_progress','resolved','cancelled'))
);

create index if not exists website_application_review_items_company_status_idx
  on public.website_application_review_items(company_id, status, created_at desc);
create index if not exists website_application_review_items_application_idx
  on public.website_application_review_items(application_id, status, created_at desc);

alter table public.website_application_review_items enable row level security;

do $$
begin
  if to_regclass('public.website_application_review_items') is not null then
    drop policy if exists website_application_review_items_select on public.website_application_review_items;
    drop policy if exists website_application_review_items_service on public.website_application_review_items;

    create policy website_application_review_items_select
      on public.website_application_review_items
      for select
      using (
        exists (
          select 1
          from public.company_memberships cm
          where cm.company_id = website_application_review_items.company_id
            and cm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
          where ur.user_id = auth.uid()
            and r.key in ('super_admin','platform_admin','superadmin')
        )
      );

    create policy website_application_review_items_service
      on public.website_application_review_items
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
