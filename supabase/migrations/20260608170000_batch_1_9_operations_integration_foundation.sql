-- Gridex Batch 1-9 structured foundation
-- Safe/idempotent migration for pricing units, billing integrations, tenant portal sync,
-- dashboard snapshots and controlled Ediel cleanup.

-- Batch 1: pricing unit metadata and allowed future units.
alter table if exists public.price_components
  add column if not exists unit_display_label text,
  add column if not exists unit_conversion_basis text,
  add column if not exists external_component_code text;

create index if not exists price_components_company_unit_idx
  on public.price_components(company_id, unit, calculation_type, status);

-- Batch 5: provider-neutral billing/faktura integration accounts.
create table if not exists public.integration_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  provider text not null,
  provider_account_name text,
  external_account_id text,
  status text not null default 'draft',
  direction text not null default 'outbound',
  capabilities jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  secret_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint integration_provider_accounts_status_check check (status in ('draft','active','paused','disabled','needs_review')),
  constraint integration_provider_accounts_direction_check check (direction in ('inbound','outbound','both'))
);

create unique index if not exists integration_provider_accounts_company_provider_external_uidx
  on public.integration_provider_accounts(company_id, provider, coalesce(external_account_id, ''));
create index if not exists integration_provider_accounts_company_status_idx
  on public.integration_provider_accounts(company_id, provider, status, created_at desc);

create table if not exists public.billing_provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  company_id uuid,
  external_event_id text,
  idempotency_key text,
  event_type text not null,
  signature_valid boolean,
  status text not null default 'received',
  headers_snapshot jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  processing_result jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  constraint billing_provider_webhook_events_status_check check (status in ('received','processed','needs_review','rejected','failed','dead_letter'))
);

create unique index if not exists billing_provider_webhook_events_provider_idempotency_uidx
  on public.billing_provider_webhook_events(provider, idempotency_key)
  where idempotency_key is not null;
create index if not exists billing_provider_webhook_events_company_status_idx
  on public.billing_provider_webhook_events(company_id, status, received_at desc);
create index if not exists billing_provider_webhook_events_provider_event_idx
  on public.billing_provider_webhook_events(provider, event_type, received_at desc);

-- Batch 6: tenant customer-portal/Mina sidor sync from external tenant sites.
create table if not exists public.tenant_customer_sync_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  api_client_id uuid,
  provider text not null default 'tenant_portal',
  external_customer_id text,
  external_account_id text,
  email text,
  customer_number text,
  facility_id text,
  metering_point_id text,
  matched_customer_id uuid,
  match_method text not null default 'none',
  status text not null default 'pending_review',
  idempotency_key text,
  request_id text,
  input_payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_customer_sync_requests_status_check check (status in ('linked','pending_review','no_match','rejected','cancelled'))
);

create unique index if not exists tenant_customer_sync_requests_company_idempotency_uidx
  on public.tenant_customer_sync_requests(company_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists tenant_customer_sync_requests_company_status_idx
  on public.tenant_customer_sync_requests(company_id, status, created_at desc);
create index if not exists tenant_customer_sync_requests_customer_idx
  on public.tenant_customer_sync_requests(company_id, matched_customer_id, created_at desc)
  where matched_customer_id is not null;

create table if not exists public.tenant_portal_customer_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  provider text not null default 'tenant_portal',
  external_customer_id text,
  external_account_id text,
  status text not null default 'active',
  match_method text not null default 'manual',
  verified_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_portal_customer_links_status_check check (status in ('active','pending_review','revoked','disabled'))
);

create unique index if not exists tenant_portal_customer_links_company_provider_external_uidx
  on public.tenant_portal_customer_links(company_id, provider, external_customer_id)
  where external_customer_id is not null;
create index if not exists tenant_portal_customer_links_company_customer_idx
  on public.tenant_portal_customer_links(company_id, customer_id, status);

-- Batch 7: cached dashboard/statistics snapshots.
create table if not exists public.company_dashboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  period_month text,
  snapshot_date date not null default current_date,
  scope text not null default 'company',
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  generated_by uuid,
  constraint company_dashboard_snapshots_scope_check check (scope in ('company','platform'))
);

create unique index if not exists company_dashboard_snapshots_company_period_scope_uidx
  on public.company_dashboard_snapshots(company_id, period_month, snapshot_date, scope);
create index if not exists company_dashboard_snapshots_company_generated_idx
  on public.company_dashboard_snapshots(company_id, generated_at desc);

-- Batch 4: incoming business request decision log for Ediel automation.
create table if not exists public.ediel_inbound_business_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  ediel_message_id uuid,
  sender_ediel_id text,
  receiver_ediel_id text,
  message_family text,
  message_code text,
  application_reference text,
  decision_status text not null default 'pending_review',
  decision_type text,
  matched_customer_id uuid,
  matched_customer_site_id uuid,
  matched_metering_point_id uuid,
  actor_id uuid,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  recommended_action text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ediel_inbound_business_decisions_status_check check (decision_status in ('auto_answered','ready_to_answer','pending_review','rejected','failed'))
);

create unique index if not exists ediel_inbound_business_decisions_message_uidx
  on public.ediel_inbound_business_decisions(ediel_message_id)
  where ediel_message_id is not null;
create index if not exists ediel_inbound_business_decisions_company_status_idx
  on public.ediel_inbound_business_decisions(company_id, decision_status, created_at desc);

-- Batch 9: controlled Ediel cleanup runs. Hard delete must be audited and scoped.
create table if not exists public.ediel_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  environment text,
  scope text not null default 'test_only',
  dry_run boolean not null default true,
  status text not null default 'draft',
  filter jsonb not null default '{}'::jsonb,
  affected_count integer not null default 0,
  actor_user_id uuid,
  reason text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ediel_cleanup_runs_scope_check check (scope in ('test_only','tenant_period','failed_only','all_platform')),
  constraint ediel_cleanup_runs_status_check check (status in ('draft','dry_run','completed','failed','cancelled')),
  constraint ediel_cleanup_runs_affected_count_check check (affected_count >= 0)
);

create index if not exists ediel_cleanup_runs_created_idx
  on public.ediel_cleanup_runs(created_at desc);
create index if not exists ediel_cleanup_runs_company_idx
  on public.ediel_cleanup_runs(company_id, created_at desc);

-- Performance indexes for the flows in this batch.
create index if not exists normalized_metering_values_company_period_idx
  on public.normalized_metering_values(company_id, period_start, period_end, status);
create index if not exists normalized_metering_values_company_customer_month_idx
  on public.normalized_metering_values(company_id, customer_id, metering_point_id, period_start);
create index if not exists customers_company_email_lower_idx
  on public.customers(company_id, lower(email));
create index if not exists customer_sites_company_facility_idx
  on public.customer_sites(company_id, facility_id);
create index if not exists metering_points_company_external_idx
  on public.metering_points(company_id, metering_point_id, normalized_metering_point_id, site_facility_id);

alter table if exists public.integration_provider_accounts enable row level security;
alter table if exists public.billing_provider_webhook_events enable row level security;
alter table if exists public.tenant_customer_sync_requests enable row level security;
alter table if exists public.tenant_portal_customer_links enable row level security;
alter table if exists public.company_dashboard_snapshots enable row level security;
alter table if exists public.ediel_inbound_business_decisions enable row level security;
alter table if exists public.ediel_cleanup_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='integration_provider_accounts' and policyname='integration_provider_accounts_service_role_all') then
    create policy integration_provider_accounts_service_role_all on public.integration_provider_accounts for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='billing_provider_webhook_events' and policyname='billing_provider_webhook_events_service_role_all') then
    create policy billing_provider_webhook_events_service_role_all on public.billing_provider_webhook_events for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_customer_sync_requests' and policyname='tenant_customer_sync_requests_service_role_all') then
    create policy tenant_customer_sync_requests_service_role_all on public.tenant_customer_sync_requests for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tenant_portal_customer_links' and policyname='tenant_portal_customer_links_service_role_all') then
    create policy tenant_portal_customer_links_service_role_all on public.tenant_portal_customer_links for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_dashboard_snapshots' and policyname='company_dashboard_snapshots_service_role_all') then
    create policy company_dashboard_snapshots_service_role_all on public.company_dashboard_snapshots for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_inbound_business_decisions' and policyname='ediel_inbound_business_decisions_service_role_all') then
    create policy ediel_inbound_business_decisions_service_role_all on public.ediel_inbound_business_decisions for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_cleanup_runs' and policyname='ediel_cleanup_runs_service_role_all') then
    create policy ediel_cleanup_runs_service_role_all on public.ediel_cleanup_runs for all to service_role using (true) with check (true);
  end if;
end $$;
