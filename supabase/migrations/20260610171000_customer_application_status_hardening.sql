-- Customer application status hardening.
-- Keep website_customer_applications.status as the process lifecycle and customers.intake_status
-- as a compact customer-readiness/status flag. This prevents website application statuses
-- such as needs_information/ready_for_switch from violating customers_intake_status_check.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists intake_status text;
    alter table public.customers add column if not exists intake_quality_score integer;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customers'
        and column_name = 'intake_missing_fields'
    ) then
      alter table public.customers add column intake_missing_fields text[] not null default '{}'::text[];
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customers'
        and column_name = 'intake_warnings'
    ) then
      alter table public.customers add column intake_warnings text[] not null default '{}'::text[];
    end if;

    update public.customers
    set intake_status = case
      when intake_status in ('missing_fields', 'needs_information', 'manual_review', 'pending_review') then 'needs_completion'
      when intake_status in ('ready_for_switch', 'switch_requested', 'switch_confirmed', 'active') then 'ready_for_operations'
      when intake_status in ('application_received', 'pending_validation') then 'ready_for_contract'
      when intake_status = 'failed' then 'blocked'
      else intake_status
    end
    where intake_status in (
      'missing_fields',
      'needs_information',
      'manual_review',
      'pending_review',
      'ready_for_switch',
      'switch_requested',
      'switch_confirmed',
      'active',
      'application_received',
      'pending_validation',
      'failed'
    );

    alter table public.customers drop constraint if exists customers_intake_status_check;
    alter table public.customers
      add constraint customers_intake_status_check
      check (
        intake_status is null or intake_status in (
          'draft',
          'incomplete',
          'needs_completion',
          'pending_information',
          'pending_power_of_attorney',
          'pending_duplicate_review',
          'blocked',
          'rejected',
          'ready_for_contract',
          'ready_for_operations'
        )
      );

    alter table public.customers drop constraint if exists customers_intake_quality_score_check;
    alter table public.customers
      add constraint customers_intake_quality_score_check
      check (intake_quality_score is null or (intake_quality_score >= 0 and intake_quality_score <= 100));

    create index if not exists customers_company_intake_status_idx
      on public.customers(company_id, intake_status, updated_at desc)
      where intake_status is not null;
  end if;
end $$;

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

    create index if not exists website_customer_applications_failed_review_idx
      on public.website_customer_applications(company_id, status, created_at desc)
      where status in ('failed','needs_information','pending_review','manual_review','pending_validation','ready_for_switch');
  end if;
end $$;

-- These columns are required for safe failure/review visibility even when later processing fails.
alter table if exists public.website_customer_applications
  add column if not exists missing_fields text[] not null default '{}'::text[],
  add column if not exists blocking_reasons jsonb not null default '[]'::jsonb,
  add column if not exists next_step text,
  add column if not exists requested_start_date date,
  add column if not exists confirmed_start_date date,
  add column if not exists actual_start_date date,
  add column if not exists timeline jsonb not null default '[]'::jsonb,
  add column if not exists audit_log jsonb not null default '[]'::jsonb;

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

-- Keep old checks compatible with the canonical email rules table.
alter table if exists public.email_event_rules
  add column if not exists is_active boolean not null default true;

update public.email_event_rules
set is_active = enabled
where enabled is not null
  and is_active is distinct from enabled;
