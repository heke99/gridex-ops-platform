-- Batch 8: Admin Operations UI for Website Onboarding, Webhooks,
-- Tenant Email Verification & Communication Logs.
-- Additive/idempotent schema hardening for website applications and admin traceability.

create extension if not exists pgcrypto;

-- Website applications must keep enough information to debug failed live onboarding calls.
alter table if exists public.website_customer_applications
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists error_stage text,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists processed_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists admin_note text;

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
          'pending_review',
          'manual_review',
          'rejected',
          'failed',
          'cancelled'
        )
      );
  end if;
end $$;

create index if not exists website_customer_applications_company_status_idx
  on public.website_customer_applications(company_id, status, created_at desc);
create index if not exists website_customer_applications_error_stage_idx
  on public.website_customer_applications(company_id, error_stage, created_at desc)
  where error_stage is not null;
create index if not exists website_customer_applications_api_client_idx
  on public.website_customer_applications(api_client_id, created_at desc)
  where api_client_id is not null;

-- Communication logs: make sender mode, template version and mail traceability first-class.
alter table if exists public.communication_logs
  add column if not exists sender_mode text,
  add column if not exists from_name text,
  add column if not exists domain_verified_at timestamptz,
  add column if not exists template_version text,
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by uuid references auth.users(id) on delete set null,
  add column if not exists handled_note text;

create index if not exists communication_logs_customer_number_created_idx
  on public.communication_logs(company_id, customer_number, created_at desc)
  where customer_number is not null;
create index if not exists communication_logs_external_customer_created_idx
  on public.communication_logs(company_id, external_customer_id, created_at desc)
  where external_customer_id is not null;
create index if not exists communication_logs_contract_created_idx
  on public.communication_logs(company_id, contract_id, created_at desc)
  where contract_id is not null;

-- Tenant email settings: explicit sender policy/readiness metadata for legal communication.
alter table if exists public.company_email_settings
  add column if not exists sender_mode text not null default 'fallback_platform_sender',
  add column if not exists fallback_allowed boolean not null default true,
  add column if not exists block_legal_mail_when_unverified boolean not null default false,
  add column if not exists dkim_status text,
  add column if not exists spf_status text,
  add column if not exists dmarc_status text,
  add column if not exists last_verification_checked_at timestamptz,
  add column if not exists readiness_status text,
  add column if not exists readiness_notes jsonb not null default '[]'::jsonb;

do $$
begin
  if to_regclass('public.company_email_settings') is not null then
    alter table public.company_email_settings drop constraint if exists company_email_settings_sender_mode_check;
    alter table public.company_email_settings
      add constraint company_email_settings_sender_mode_check check (sender_mode in ('verified_domain','fallback_platform_sender','disabled'));
  end if;
end $$;

-- Webhook subscriptions/deliveries: explicit operational fields for UI and manual retry.
alter table if exists public.webhook_subscriptions
  add column if not exists failure_count integer not null default 0,
  add column if not exists last_tested_at timestamptz,
  add column if not exists rotated_at timestamptz,
  add column if not exists rotated_by uuid references auth.users(id) on delete set null;

alter table if exists public.webhook_deliveries
  add column if not exists manual_status text,
  add column if not exists manual_note text,
  add column if not exists resent_by uuid references auth.users(id) on delete set null,
  add column if not exists resent_at timestamptz;

create index if not exists webhook_deliveries_customer_number_idx
  on public.webhook_deliveries(company_id, ((payload ->> 'customer_number')), created_at desc)
  where payload ? 'customer_number';
create index if not exists webhook_deliveries_external_customer_idx
  on public.webhook_deliveries(company_id, ((payload ->> 'external_customer_id')), created_at desc)
  where payload ? 'external_customer_id';

-- Billing references should be visible without joining deeply into provider payloads.
alter table if exists public.billing_partner_customers
  add column if not exists last_synced_at timestamptz,
  add column if not exists dispute_count integer not null default 0;

-- Admin audit helper rows are inserted by actions using existing audit_logs table.
