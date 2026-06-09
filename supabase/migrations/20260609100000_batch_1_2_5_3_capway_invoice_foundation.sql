-- Gridex Batch 1, 2, 5 and 3 production foundation
-- Pricing units, invoice readiness, Capway/Aptic export foundation and customer/actor onboarding hardening.

-- Batch 1: preserve explicit admin-selected units on both active pricing tables.
alter table if exists public.pricing_component_rules
  add column if not exists unit_display_label text,
  add column if not exists unit_conversion_basis text,
  add column if not exists external_component_code text;

alter table if exists public.price_components
  add column if not exists unit_display_label text,
  add column if not exists unit_conversion_basis text,
  add column if not exists external_component_code text;

create index if not exists pricing_component_rules_company_unit_idx
  on public.pricing_component_rules(company_id, calculation_unit, component_type, is_active)
  where is_active = true;

-- Batch 2: period export readiness and locked-period metadata.
alter table if exists public.billing_underlays
  add column if not exists invoice_readiness_status text,
  add column if not exists invoice_readiness_issues jsonb not null default '[]'::jsonb,
  add column if not exists invoice_export_locked_at timestamptz,
  add column if not exists invoice_export_run_id uuid;

create index if not exists billing_underlays_company_invoice_readiness_idx
  on public.billing_underlays(company_id, underlay_year, underlay_month, invoice_readiness_status, readiness_status);

-- Batch 5: provider-neutral invoice export foundation with Capway/Aptic as first adapter.
create table if not exists public.billing_provider_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  environment text not null default 'test',
  status text not null default 'incomplete',
  display_name text,
  settings jsonb not null default '{}'::jsonb,
  secret_reference jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  readiness_issues jsonb not null default '[]'::jsonb,
  last_tested_at timestamptz,
  last_test_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint billing_provider_connections_provider_check check (provider in ('capway_aptic','fortnox','billogram','manual_export','custom')),
  constraint billing_provider_connections_environment_check check (environment in ('test','production')),
  constraint billing_provider_connections_status_check check (status in ('incomplete','ready','active','paused','disabled','needs_review'))
);

create unique index if not exists billing_provider_connections_company_provider_env_uidx
  on public.billing_provider_connections(company_id, provider, environment);
create index if not exists billing_provider_connections_company_status_idx
  on public.billing_provider_connections(company_id, provider, status, updated_at desc);

create table if not exists public.invoice_export_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null default 'capway_aptic',
  environment text not null default 'test',
  billing_month text not null check (billing_month ~ '^\d{4}-\d{2}$'),
  financing_mode text not null default 'invoice_service',
  status text not null default 'draft',
  total_items integer not null default 0,
  sent_items integer not null default 0,
  failed_items integer not null default 0,
  total_ex_vat numeric not null default 0,
  vat_amount numeric not null default 0,
  total_inc_vat numeric not null default 0,
  readiness_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  requested_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_export_runs_status_check check (status in ('draft','processing','sent','partial_failed','failed','cancelled')),
  constraint invoice_export_runs_environment_check check (environment in ('test','production')),
  constraint invoice_export_runs_financing_mode_check check (financing_mode in ('invoice_service','factoring_without_recourse','factoring_with_recourse','manual'))
);

create index if not exists invoice_export_runs_company_month_idx
  on public.invoice_export_runs(company_id, billing_month, provider, status, created_at desc);

create table if not exists public.invoice_export_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  export_run_id uuid not null references public.invoice_export_runs(id) on delete cascade,
  customer_id uuid,
  billing_underlay_id uuid,
  pricing_run_id uuid,
  provider text not null default 'capway_aptic',
  environment text not null default 'test',
  status text not null default 'pending',
  financing_mode text not null default 'invoice_service',
  provider_invoice_guid text,
  provider_invoice_number text,
  provider_payment_reference text,
  provider_ocr text,
  provider_imp_stock_id integer,
  provider_status text,
  purchase_status text,
  recourse_status text,
  amount_ex_vat numeric not null default 0,
  vat_amount numeric not null default 0,
  amount_inc_vat numeric not null default 0,
  rounding_amount numeric not null default 0,
  idempotency_key text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_payload jsonb not null default '{}'::jsonb,
  status_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_export_items_status_check check (status in ('pending','sent','failed','cancelled','credited','disputed')),
  constraint invoice_export_items_environment_check check (environment in ('test','production')),
  constraint invoice_export_items_financing_mode_check check (financing_mode in ('invoice_service','factoring_without_recourse','factoring_with_recourse','manual'))
);

create unique index if not exists invoice_export_items_company_provider_idempotency_uidx
  on public.invoice_export_items(company_id, provider, idempotency_key)
  where idempotency_key is not null;
create index if not exists invoice_export_items_run_status_idx
  on public.invoice_export_items(company_id, export_run_id, status);
create index if not exists invoice_export_items_provider_guid_idx
  on public.invoice_export_items(provider, provider_invoice_guid)
  where provider_invoice_guid is not null;

create table if not exists public.invoice_provider_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  provider text not null,
  provider_event_id text,
  provider_invoice_guid text,
  event_type text not null,
  status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  matched_invoice_export_item_id uuid,
  idempotency_hash text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invoice_provider_events_status_check check (status in ('received','processed','needs_review','failed','dead_letter'))
);
create unique index if not exists invoice_provider_events_provider_idempotency_uidx
  on public.invoice_provider_events(provider, idempotency_hash)
  where idempotency_hash is not null;
create index if not exists invoice_provider_events_company_status_idx
  on public.invoice_provider_events(company_id, status, received_at desc);

create table if not exists public.invoice_purchase_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_export_item_id uuid references public.invoice_export_items(id) on delete cascade,
  event_type text not null,
  purchase_status text,
  finance_status text,
  purchase_fee_amount numeric,
  purchase_fee_percentage numeric,
  deposit_amount numeric,
  recourse_days integer,
  recourse_fee numeric,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists invoice_purchase_events_item_idx
  on public.invoice_purchase_events(company_id, invoice_export_item_id, created_at desc);

create table if not exists public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_export_item_id uuid references public.invoice_export_items(id) on delete cascade,
  provider_document_guid text,
  document_type text,
  file_name text,
  storage_path text,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists invoice_documents_item_idx
  on public.invoice_documents(company_id, invoice_export_item_id, created_at desc);

create table if not exists public.invoice_dead_letters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  provider text not null default 'capway_aptic',
  export_run_id uuid,
  export_item_id uuid,
  status text not null default 'open',
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0,
  next_action text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invoice_dead_letters_status_check check (status in ('open','retrying','resolved','ignored'))
);
create index if not exists invoice_dead_letters_company_status_idx
  on public.invoice_dead_letters(company_id, status, created_at desc);

-- Batch 3: actor/onboarding metadata. Tenant admins select verified actors; platform admins manage technical route data.
alter table if exists public.grid_owners
  add column if not exists verified_for_customer_flow boolean not null default false,
  add column if not exists technical_owner_only boolean not null default true,
  add column if not exists actor_registry_status text not null default 'under_review';

alter table if exists public.electricity_suppliers
  add column if not exists verified_for_customer_flow boolean not null default false,
  add column if not exists technical_owner_only boolean not null default true,
  add column if not exists actor_registry_status text not null default 'under_review';

create index if not exists grid_owners_customer_flow_verified_idx
  on public.grid_owners(verified_for_customer_flow, is_active, actor_registry_status);
create index if not exists electricity_suppliers_customer_flow_verified_idx
  on public.electricity_suppliers(verified_for_customer_flow, is_active, actor_registry_status);

alter table if exists public.customer_sites
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb;

alter table if exists public.metering_points
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb;

-- RLS service-role policies for new integration tables.
alter table if exists public.billing_provider_connections enable row level security;
alter table if exists public.invoice_export_runs enable row level security;
alter table if exists public.invoice_export_items enable row level security;
alter table if exists public.invoice_provider_events enable row level security;
alter table if exists public.invoice_purchase_events enable row level security;
alter table if exists public.invoice_documents enable row level security;
alter table if exists public.invoice_dead_letters enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='billing_provider_connections' and policyname='billing_provider_connections_service_role_all') then
    create policy billing_provider_connections_service_role_all on public.billing_provider_connections for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoice_export_runs' and policyname='invoice_export_runs_service_role_all') then
    create policy invoice_export_runs_service_role_all on public.invoice_export_runs for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoice_export_items' and policyname='invoice_export_items_service_role_all') then
    create policy invoice_export_items_service_role_all on public.invoice_export_items for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoice_provider_events' and policyname='invoice_provider_events_service_role_all') then
    create policy invoice_provider_events_service_role_all on public.invoice_provider_events for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoice_purchase_events' and policyname='invoice_purchase_events_service_role_all') then
    create policy invoice_purchase_events_service_role_all on public.invoice_purchase_events for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoice_documents' and policyname='invoice_documents_service_role_all') then
    create policy invoice_documents_service_role_all on public.invoice_documents for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='invoice_dead_letters' and policyname='invoice_dead_letters_service_role_all') then
    create policy invoice_dead_letters_service_role_all on public.invoice_dead_letters for all to service_role using (true) with check (true);
  end if;
end $$;
