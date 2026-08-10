-- GRIDEX-AUD-003 derived interleaved bootstrap prerequisite.
-- Source: supabase/migrations/20260522_batch4c_billing_export_audit_quality_ai.sql
-- Restore the source-defined Batch 4C tables required by BL-001; no rows seeded.

create table if not exists public.customer_readiness_snapshots (
  id uuid primary key default gen_random_uuid(), company_id uuid null, customer_id uuid not null,
  customer_score integer not null default 0, contract_score integer not null default 0,
  power_of_attorney_score integer not null default 0, site_score integer not null default 0,
  billing_score integer not null default 0, ready_for_contract boolean not null default false,
  ready_for_switch boolean not null default false, ready_for_billing boolean not null default false,
  ready_for_export boolean not null default false, blockers jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb, calculated_by uuid null,
  calculated_at timestamptz not null default now()
);
create index if not exists customer_readiness_snapshots_company_customer_idx on public.customer_readiness_snapshots(company_id, customer_id, calculated_at desc);
create index if not exists customer_readiness_snapshots_company_ready_idx on public.customer_readiness_snapshots(company_id, ready_for_contract, ready_for_switch, ready_for_billing, ready_for_export);

create table if not exists public.document_ai_extractions (
  id uuid primary key default gen_random_uuid(), company_id uuid null, customer_id uuid null,
  source_file_name text null, source_document_id uuid null,
  extraction_type text not null default 'contract_or_poa_review', status text not null default 'needs_review',
  raw_text text null, extracted_fields jsonb not null default '{}'::jsonb,
  field_confidence jsonb not null default '{}'::jsonb, detected_signatures jsonb not null default '[]'::jsonb,
  detected_authorizations jsonb not null default '[]'::jsonb, detected_sites jsonb not null default '[]'::jsonb,
  detected_invoice_address jsonb not null default '{}'::jsonb, review_notes text null,
  reviewed_by uuid null, reviewed_at timestamptz null, created_by uuid null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists document_ai_extractions_company_status_idx on public.document_ai_extractions(company_id, status, created_at desc);
create index if not exists document_ai_extractions_company_customer_idx on public.document_ai_extractions(company_id, customer_id, created_at desc) where customer_id is not null;

create table if not exists public.batch4c_security_checks (
  id uuid primary key default gen_random_uuid(), company_id uuid null, check_key text not null,
  check_area text not null, expected_result text not null, actual_result text null,
  status text not null default 'not_run', evidence jsonb not null default '{}'::jsonb,
  checked_by uuid null, checked_at timestamptz null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists batch4c_security_checks_company_key_uidx on public.batch4c_security_checks(coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), check_key);
alter table public.customer_readiness_snapshots enable row level security;
alter table public.document_ai_extractions enable row level security;
alter table public.batch4c_security_checks enable row level security;
