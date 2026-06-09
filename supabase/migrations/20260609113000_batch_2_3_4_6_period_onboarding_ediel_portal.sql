-- Gridex Batch 2, 3, 4 and 6 completion foundation
-- Period locks, invoice readiness, verified customer onboarding, inbound Ediel request automation and tenant customer portal API.

create table if not exists public.billing_period_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_year integer not null check (billing_year between 2000 and 2100),
  billing_month integer not null check (billing_month between 1 and 12),
  status text not null default 'open' check (status in ('open','locked','exported','closed','reopened')),
  locked_at timestamptz,
  locked_by uuid,
  unlocked_at timestamptz,
  unlocked_by uuid,
  lock_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_period_locks_company_month_uidx
  on public.billing_period_locks(company_id, billing_year, billing_month);
create index if not exists billing_period_locks_company_status_idx
  on public.billing_period_locks(company_id, status, billing_year desc, billing_month desc);

alter table if exists public.billing_underlays
  add column if not exists invoice_readiness_status text,
  add column if not exists invoice_readiness_issues jsonb not null default '[]'::jsonb,
  add column if not exists invoice_export_locked_at timestamptz,
  add column if not exists invoice_export_run_id uuid;

create index if not exists billing_underlays_company_invoice_readiness_v2_idx
  on public.billing_underlays(company_id, underlay_year, underlay_month, invoice_readiness_status, readiness_status);

-- Batch 3: make onboarding state explicit on customer objects and verified actors selectable in customer flow.
alter table if exists public.customers
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb,
  add column if not exists next_action text,
  add column if not exists ready_for_billing_at timestamptz;

alter table if exists public.customer_sites
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb,
  add column if not exists next_action text;

alter table if exists public.metering_points
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb,
  add column if not exists next_action text;

alter table if exists public.customer_contracts
  add column if not exists onboarding_status text,
  add column if not exists onboarding_issues jsonb not null default '[]'::jsonb;

alter table if exists public.grid_owners
  add column if not exists verified_for_customer_flow boolean not null default false,
  add column if not exists technical_owner_only boolean not null default true,
  add column if not exists actor_registry_status text not null default 'under_review';

alter table if exists public.electricity_suppliers
  add column if not exists verified_for_customer_flow boolean not null default false,
  add column if not exists technical_owner_only boolean not null default true,
  add column if not exists actor_registry_status text not null default 'under_review';

create index if not exists customers_onboarding_company_status_idx on public.customers(company_id, onboarding_status, created_at desc);
create index if not exists customer_sites_onboarding_company_status_idx on public.customer_sites(company_id, onboarding_status, created_at desc);
create index if not exists metering_points_onboarding_company_status_idx on public.metering_points(company_id, onboarding_status, created_at desc);
create index if not exists grid_owners_customer_flow_verified_v2_idx on public.grid_owners(verified_for_customer_flow, actor_registry_status, is_active);
create index if not exists electricity_suppliers_customer_flow_verified_v2_idx on public.electricity_suppliers(verified_for_customer_flow, actor_registry_status, is_active);

-- Batch 4: incoming Ediel request automation. Tenant must be resolved before any customer/metering match.
create table if not exists public.ediel_inbound_request_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  ediel_message_id uuid not null,
  sender_ediel_id text,
  receiver_ediel_id text,
  receiver_subaddress text,
  message_family text,
  message_code text,
  application_reference text,
  actor_role text,
  decision_status text not null default 'pending_review' check (decision_status in ('ready_to_answer','pending_review','not_applicable')),
  recommended_ack text,
  matched_customer_id uuid,
  matched_customer_site_id uuid,
  matched_metering_point_id uuid,
  authorization_status text,
  identifiers jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_inbound_request_decisions_message_uidx
  on public.ediel_inbound_request_decisions(ediel_message_id);
create index if not exists ediel_inbound_request_decisions_company_status_idx
  on public.ediel_inbound_request_decisions(company_id, decision_status, updated_at desc);

create table if not exists public.ediel_manual_review_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  ediel_message_id uuid,
  issue_type text not null,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_review','resolved','ignored')),
  payload jsonb not null default '{}'::jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_manual_review_items_message_issue_uidx
  on public.ediel_manual_review_items(ediel_message_id, issue_type)
  where ediel_message_id is not null;
create index if not exists ediel_manual_review_items_company_status_idx
  on public.ediel_manual_review_items(company_id, status, created_at desc);

-- Batch 6: tenant customer portal identity/API foundation.
create table if not exists public.customer_portal_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  provider text not null default 'tenant_portal',
  external_customer_id text,
  external_account_id text,
  email text,
  verified_identifier_hash text,
  status text not null default 'pending_review' check (status in ('active','pending_review','rejected','disabled')),
  match_strength text not null default 'weak' check (match_strength in ('strong','weak','manual')),
  match_method text,
  last_login_at timestamptz,
  linked_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_portal_identities_company_provider_external_uidx
  on public.customer_portal_identities(company_id, provider, external_customer_id)
  where external_customer_id is not null;
create index if not exists customer_portal_identities_company_status_idx
  on public.customer_portal_identities(company_id, status, created_at desc);

create table if not exists public.customer_portal_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  external_customer_id text,
  request_type text not null check (request_type in ('profile_update','move_out','support_case')),
  status text not null default 'submitted' check (status in ('submitted','in_review','accepted','rejected','cancelled','completed')),
  source text not null default 'customer_portal_api',
  payload jsonb not null default '{}'::jsonb,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_portal_requests_company_status_idx
  on public.customer_portal_requests(company_id, status, created_at desc);
create index if not exists customer_portal_requests_customer_idx
  on public.customer_portal_requests(company_id, customer_id, created_at desc);

create table if not exists public.customer_portal_api_access_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  external_customer_id text,
  route text not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists customer_portal_api_access_logs_company_customer_idx
  on public.customer_portal_api_access_logs(company_id, customer_id, created_at desc);

-- Ensure integration API infrastructure exists for tenant website APIs.
create table if not exists public.integration_api_clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  key_prefix text not null,
  secret_hash text not null,
  scopes text[] not null default '{}',
  allowed_ips text[] not null default '{}',
  rate_limit_per_minute integer not null default 120,
  expires_at timestamptz,
  last_used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_api_clients_status_check check (status in ('active','paused','disabled','expired'))
);
create unique index if not exists integration_api_clients_key_prefix_uidx on public.integration_api_clients(key_prefix);
create index if not exists integration_api_clients_company_status_idx on public.integration_api_clients(company_id, status, created_at desc);

create table if not exists public.integration_api_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  request_id text,
  method text,
  route text,
  status_code integer,
  duration_ms integer,
  ip_address text,
  user_agent text,
  idempotency_key text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists integration_api_requests_company_route_idx on public.integration_api_requests(company_id, route, created_at desc);

alter table public.billing_period_locks enable row level security;
alter table public.ediel_inbound_request_decisions enable row level security;
alter table public.ediel_manual_review_items enable row level security;
alter table public.customer_portal_identities enable row level security;
alter table public.customer_portal_requests enable row level security;
alter table public.customer_portal_api_access_logs enable row level security;
alter table public.integration_api_clients enable row level security;
alter table public.integration_api_requests enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'billing_period_locks',
    'ediel_inbound_request_decisions',
    'ediel_manual_review_items',
    'customer_portal_identities',
    'customer_portal_requests',
    'customer_portal_api_access_logs',
    'integration_api_clients',
    'integration_api_requests'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename=table_name and policyname=table_name || '_service_role_all'
    ) then
      execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
    end if;
  end loop;
end $$;
