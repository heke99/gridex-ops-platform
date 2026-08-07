-- AUD-003 historical bootstrap: customer cases + tenant email outbox.
-- Source: supabase/migrations/20260520_batch_5_cases_audit_email_ux.sql
-- Deliberately restores only the directly connected historical relations required
-- by later canonical tenant-state hardening. No product rows are seeded.

create extension if not exists pgcrypto;

create table if not exists public.customer_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  site_id uuid null,
  metering_point_id uuid null,
  customer_contract_id uuid null,
  supplier_switch_request_id uuid null,
  outbound_request_id uuid null,
  cancellation_ediel_message_id uuid null,
  case_type text not null default 'other',
  status text not null default 'open',
  priority text not null default 'normal',
  title text not null,
  description text null,
  reason_category text null,
  agreement_channel text null,
  is_distance_agreement boolean not null default false,
  agreement_created_at timestamptz null,
  withdrawal_information_sent_at timestamptz null,
  withdrawal_deadline_at timestamptz null,
  withdrawal_requested_at timestamptz null,
  withdrawal_possible boolean not null default false,
  switch_can_be_stopped boolean not null default false,
  delivery_start_at timestamptz null,
  withdrawal_scenario text not null default 'not_withdrawal',
  cancellation_required boolean not null default false,
  cancellation_status text not null default 'not_required',
  cancellation_reference text null,
  billing_blocked boolean not null default false,
  billing_manual_review boolean not null default false,
  break_fee_flagged boolean not null default false,
  customer_contacted_at timestamptz null,
  next_action text null,
  next_action_due_at timestamptz null,
  assigned_to uuid references auth.users(id) on delete set null,
  source text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  closed_at timestamptz null,
  constraint customer_cases_type_check check (case_type in (
    'withdrawal',
    'rejected_customer',
    'onboarding_aborted',
    'supplier_switch_aborted',
    'sales_misunderstanding',
    'dual_invoice_concern',
    'binding_period_too_long',
    'incorrect_identity',
    'incorrect_site_data',
    'missing_authorization',
    'credit_risk',
    'technical_blocker',
    'other'
  )),
  constraint customer_cases_status_check check (status in (
    'open',
    'action_required',
    'awaiting_external_response',
    'billing_blocked',
    'manual_follow_up',
    'resolved',
    'cancelled',
    'closed'
  )),
  constraint customer_cases_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint customer_cases_withdrawal_scenario_check check (withdrawal_scenario in (
    'not_withdrawal',
    'before_prodat_sent',
    'after_prodat_before_start',
    'cannot_stop_switch'
  )),
  constraint customer_cases_cancellation_status_check check (cancellation_status in (
    'not_required',
    'draft_required',
    'draft_created',
    'sent',
    'accepted',
    'rejected',
    'not_possible',
    'manual_review'
  ))
);

create index if not exists customer_cases_company_status_idx on public.customer_cases(company_id, status, created_at desc);
create index if not exists customer_cases_customer_idx on public.customer_cases(company_id, customer_id, created_at desc);
create index if not exists customer_cases_type_idx on public.customer_cases(company_id, case_type, status);
create index if not exists customer_cases_contract_idx on public.customer_cases(company_id, customer_contract_id);
create index if not exists customer_cases_switch_idx on public.customer_cases(company_id, supplier_switch_request_id);

create table if not exists public.tenant_email_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  customer_case_id uuid null references public.customer_cases(id) on delete set null,
  email_type text not null,
  to_email text not null,
  from_email text null,
  reply_to_email text null,
  subject text not null,
  html_body text not null,
  text_body text null,
  status text not null default 'queued',
  provider_message_id text null,
  failure_reason text null,
  branding_snapshot jsonb not null default '{}'::jsonb,
  redirect_url text null,
  created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_email_outbox_status_check check (status in ('queued', 'sent', 'failed', 'cancelled'))
);

create index if not exists tenant_email_outbox_company_status_idx on public.tenant_email_outbox(company_id, status, created_at desc);
create index if not exists tenant_email_outbox_case_idx on public.tenant_email_outbox(company_id, customer_case_id, created_at desc);

alter table public.customer_cases enable row level security;
alter table public.tenant_email_outbox enable row level security;

drop policy if exists customer_cases_service_role_all on public.customer_cases;
create policy customer_cases_service_role_all on public.customer_cases
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists tenant_email_outbox_service_role_all on public.tenant_email_outbox;
create policy tenant_email_outbox_service_role_all on public.tenant_email_outbox
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
