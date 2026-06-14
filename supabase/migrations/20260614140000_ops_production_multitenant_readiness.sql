-- Migration: ops production multitenant readiness
-- This migration introduces canonical legal bundles, price books and
-- associated snapshot structures, readiness tracking and improved billing
-- underlay schema. All new columns are added conditionally to allow
-- idempotent execution.

-- Legal bundles
create table if not exists legal_bundles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists legal_bundle_items (
  id uuid primary key default gen_random_uuid(),
  legal_bundle_id uuid not null references legal_bundles(id) on delete cascade,
  legal_text_version_id uuid not null references legal_text_versions(id) on delete cascade,
  type text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Canonical price books
create table if not exists price_books (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text,
  status text not null default 'draft',
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists price_book_lines (
  id uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references price_books(id) on delete cascade,
  sort_order integer not null default 0,
  component_key text,
  value numeric,
  unit text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tenant launch states
create table if not exists tenant_launch_states (
  company_id uuid primary key references companies(id) on delete cascade,
  status text not null default 'draft',
  blockers jsonb,
  updated_at timestamptz not null default now()
);

-- Customer application intakes with idempotency
create table if not exists customer_application_intakes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  api_client_id uuid references integration_api_clients(id) on delete set null,
  route text,
  method text,
  idempotency_key text,
  payload_hash text,
  stage text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_customer_application_intake_idem unique (company_id, api_client_id, route, method, idempotency_key)
);

-- Additional profile table (optional). Keys defined in code, so table is for runtime configuration.
create table if not exists integration_api_client_profiles (
  key text primary key,
  label text not null,
  default_scopes text[] not null default '{}',
  require_allowed_origins boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Column additions to support readiness and canonical snapshots
alter table public_contract_offers add column if not exists legal_bundle_id uuid references legal_bundles(id);
alter table public_contract_offers add column if not exists price_book_id uuid references price_books(id);
alter table public_contract_offers add column if not exists readiness_status text;
alter table public_contract_offers add column if not exists readiness_blockers jsonb;

alter table customer_contracts add column if not exists legal_bundle_id uuid references legal_bundles(id);
alter table customer_contracts add column if not exists price_book_id uuid references price_books(id);
alter table customer_contracts add column if not exists snapshot_quality text;
alter table customer_contracts add column if not exists snapshot_hash text;
alter table customer_contracts add column if not exists billing_blocked_reason text;

alter table contract_price_snapshots add column if not exists price_book_id uuid references price_books(id);
alter table contract_price_snapshots add column if not exists price_plan_id uuid;
alter table contract_price_snapshots add column if not exists legal_bundle_id uuid references legal_bundles(id);
alter table contract_price_snapshots add column if not exists snapshot_hash text;
alter table contract_price_snapshots add column if not exists snapshot_quality text;
alter table contract_price_snapshots add column if not exists price_book_hash text;
alter table contract_price_snapshots add column if not exists accepted_request_id text;
alter table contract_price_snapshots add column if not exists accepted_trace_id text;

alter table billing_underlays add column if not exists price_plan_version_id uuid;
alter table billing_underlays add column if not exists price_book_id uuid references price_books(id);
alter table billing_underlays add column if not exists contract_price_snapshot_id uuid references contract_price_snapshots(id);
alter table billing_underlays add column if not exists billing_block_reason text;

alter table billing_underlay_items add column if not exists price_plan_version_id uuid;
alter table billing_underlay_items add column if not exists price_book_id uuid references price_books(id);
alter table billing_underlay_items add column if not exists price_book_line_id uuid references price_book_lines(id);
alter table billing_underlay_items add column if not exists snapshot_line_hash text;
alter table billing_underlay_items add column if not exists legal_snapshot_ref text;

alter table customer_legal_acceptances add column if not exists legal_bundle_id uuid references legal_bundles(id);
alter table customer_legal_acceptances add column if not exists request_id text;
alter table customer_legal_acceptances add column if not exists trace_id text;

alter table integration_api_clients add column if not exists profile_key text;
alter table integration_api_clients add column if not exists launch_ready boolean;
alter table integration_api_clients add column if not exists launch_blockers jsonb;

alter table tenant_email_outbox add column if not exists attempts integer default 0;
alter table tenant_email_outbox add column if not exists max_attempts integer default 5;
alter table tenant_email_outbox add column if not exists next_attempt_at timestamptz;
alter table tenant_email_outbox add column if not exists dead_letter_at timestamptz;
alter table tenant_email_outbox add column if not exists last_error text;
alter table tenant_email_outbox add column if not exists request_id text;
alter table tenant_email_outbox add column if not exists trace_id text;

alter table website_customer_applications add column if not exists payload_hash text;
alter table website_customer_applications add column if not exists request_id text;
alter table website_customer_applications add column if not exists trace_id text;
alter table website_customer_applications add column if not exists intake_id uuid references customer_application_intakes(id);

alter table external_contract_intakes add column if not exists payload_hash text;
alter table external_contract_intakes add column if not exists request_id text;
alter table external_contract_intakes add column if not exists trace_id text;
alter table external_contract_intakes add column if not exists intake_id uuid references customer_application_intakes(id);

-- Indexes to optimise readiness and idempotency queries
create index if not exists idx_public_contract_offers_readiness on public_contract_offers (company_id, is_public, readiness_status, published_at desc);
create unique index if not exists idx_customer_application_intakes_idem on customer_application_intakes(company_id, api_client_id, route, method, idempotency_key);
create index if not exists idx_price_books_status on price_books (company_id, status, valid_from desc);
create index if not exists idx_price_book_lines_book on price_book_lines (price_book_id, sort_order);
create index if not exists idx_tenant_launch_states_status on tenant_launch_states (company_id, status);
create index if not exists idx_tenant_email_outbox_next_attempt on tenant_email_outbox (company_id, next_attempt_at);