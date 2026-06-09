-- Batch 6: Superadmin API clients + secure customer portal identity linking.
-- SaaS-safe and idempotent. Does not expose customer data without strong portal identity.

create extension if not exists pgcrypto;

create table if not exists public.customer_portal_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  provider text not null default 'gridex_website',
  external_customer_id text not null,
  external_account_id text,
  email text,
  verified_identifier_hash text,
  status text not null default 'pending_review',
  match_strength text not null default 'none',
  match_method text,
  last_login_at timestamptz,
  linked_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_portal_identities
  add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.customer_portal_identities
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.customer_portal_identities
  add column if not exists provider text not null default 'gridex_website';
alter table public.customer_portal_identities
  add column if not exists external_customer_id text;
alter table public.customer_portal_identities
  add column if not exists external_account_id text;
alter table public.customer_portal_identities
  add column if not exists email text;
alter table public.customer_portal_identities
  add column if not exists verified_identifier_hash text;
alter table public.customer_portal_identities
  add column if not exists status text not null default 'pending_review';
alter table public.customer_portal_identities
  add column if not exists match_strength text not null default 'none';
alter table public.customer_portal_identities
  add column if not exists match_method text;
alter table public.customer_portal_identities
  add column if not exists last_login_at timestamptz;
alter table public.customer_portal_identities
  add column if not exists linked_at timestamptz;
alter table public.customer_portal_identities
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.customer_portal_identities
  add column if not exists reviewed_at timestamptz;
alter table public.customer_portal_identities
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.customer_portal_identities
  add column if not exists created_at timestamptz not null default now();
alter table public.customer_portal_identities
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists customer_portal_identities_external_uidx
  on public.customer_portal_identities(company_id, provider, external_customer_id);
create index if not exists customer_portal_identities_company_status_idx
  on public.customer_portal_identities(company_id, status, created_at desc);
create index if not exists customer_portal_identities_customer_idx
  on public.customer_portal_identities(customer_id, created_at desc);

create table if not exists public.customer_portal_api_access_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  portal_identity_id uuid references public.customer_portal_identities(id) on delete set null,
  route text not null,
  method text not null,
  status_code integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The table may already exist from earlier portal batches. CREATE TABLE IF NOT EXISTS
-- does not add missing columns, so keep this block before indexes/policies.
alter table public.customer_portal_api_access_logs
  add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.customer_portal_api_access_logs
  add column if not exists api_client_id uuid references public.integration_api_clients(id) on delete set null;
alter table public.customer_portal_api_access_logs
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.customer_portal_api_access_logs
  add column if not exists portal_identity_id uuid references public.customer_portal_identities(id) on delete set null;
alter table public.customer_portal_api_access_logs
  add column if not exists route text;
alter table public.customer_portal_api_access_logs
  add column if not exists method text;
alter table public.customer_portal_api_access_logs
  add column if not exists status_code integer;
alter table public.customer_portal_api_access_logs
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.customer_portal_api_access_logs
  add column if not exists created_at timestamptz not null default now();

create index if not exists customer_portal_api_access_logs_company_created_idx
  on public.customer_portal_api_access_logs(company_id, created_at desc);
create index if not exists customer_portal_api_access_logs_identity_created_idx
  on public.customer_portal_api_access_logs(portal_identity_id, created_at desc);

-- Existing integration_api_clients metadata is used for allowed_origins and Gridex website setup.
create index if not exists integration_api_clients_metadata_gin_idx
  on public.integration_api_clients using gin(metadata);

alter table public.customer_portal_identities enable row level security;
alter table public.customer_portal_api_access_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_portal_identities'
      and policyname = 'customer_portal_identities_service_role_all'
  ) then
    create policy customer_portal_identities_service_role_all
      on public.customer_portal_identities
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_portal_identities'
      and policyname = 'customer_portal_identities_tenant_read'
  ) then
    create policy customer_portal_identities_tenant_read
      on public.customer_portal_identities
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_portal_api_access_logs'
      and policyname = 'customer_portal_api_access_logs_service_role_all'
  ) then
    create policy customer_portal_api_access_logs_service_role_all
      on public.customer_portal_api_access_logs
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_portal_api_access_logs'
      and policyname = 'customer_portal_api_access_logs_tenant_read'
  ) then
    create policy customer_portal_api_access_logs_tenant_read
      on public.customer_portal_api_access_logs
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;
