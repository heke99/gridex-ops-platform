-- Gridex OPS API performance, tenant isolation and idempotency hardening.
-- Safe to run after 20260713100000_ediel_completion_and_platform_contract.sql.
-- This migration is intentionally schema-drift tolerant because older deployed
-- environments may contain an earlier customer_portal_write_idempotency shape.

create table if not exists public.integration_api_rate_limit_buckets (
  api_client_id uuid not null,
  route text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (api_client_id, route, window_started_at)
);

alter table public.integration_api_rate_limit_buckets enable row level security;
revoke all on table public.integration_api_rate_limit_buckets from anon, authenticated;
grant select, insert, update, delete on table public.integration_api_rate_limit_buckets to service_role;

create or replace function public.integration_api_rate_limit_check(
  p_api_client_id uuid,
  p_route text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table (
  allowed boolean,
  request_count integer,
  limit_value integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_limit integer := greatest(0, coalesce(p_limit, 0));
  v_window_start timestamptz;
  v_count integer;
begin
  if p_api_client_id is null or nullif(trim(p_route), '') is null then
    raise exception 'api_client_id and route are required' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.integration_api_rate_limit_buckets (
    api_client_id, route, window_started_at, request_count, updated_at
  ) values (
    p_api_client_id, left(p_route, 300), v_window_start, 1, clock_timestamp()
  )
  on conflict (api_client_id, route, window_started_at)
  do update set
    request_count = public.integration_api_rate_limit_buckets.request_count + 1,
    updated_at = clock_timestamp()
  returning integration_api_rate_limit_buckets.request_count into v_count;

  delete from public.integration_api_rate_limit_buckets
  where window_started_at < clock_timestamp() - interval '2 hours';

  return query select
    (v_limit > 0 and v_count <= v_limit),
    v_count,
    v_limit,
    v_window_start + make_interval(secs => v_window_seconds);
end;
$$;

revoke all on function public.integration_api_rate_limit_check(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.integration_api_rate_limit_check(uuid, text, integer, integer) to service_role;

-- Repair the older idempotency-table shape before creating customer-bound indexes.
-- Existing legacy rows are retained with customer_id = null. New application writes
-- always provide customer_id and are protected by the partial unique index below.
create table if not exists public.customer_portal_write_idempotency (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  api_client_id uuid,
  customer_id uuid,
  route text,
  idempotency_key text,
  request_hash text,
  status text,
  response_status integer,
  response_body jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_portal_write_idempotency
  add column if not exists company_id uuid,
  add column if not exists api_client_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists route text,
  add column if not exists idempotency_key text,
  add column if not exists request_hash text,
  add column if not exists status text,
  add column if not exists response_status integer,
  add column if not exists response_body jsonb,
  add column if not exists error_code text,
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.customer_portal_write_idempotency
  drop constraint if exists customer_portal_write_idempotency_company_client_route_idempotency_key_key;
drop index if exists public.customer_portal_write_idempotency_company_client_route_key_uidx;
drop index if exists public.customer_portal_write_idempotency_lookup_idx;
drop index if exists public.customer_portal_write_idempotency_company_client_customer_route_key_uidx;

create unique index if not exists customer_portal_write_idempotency_company_client_customer_route_key_uidx
  on public.customer_portal_write_idempotency
  (company_id, api_client_id, customer_id, route, idempotency_key)
  where customer_id is not null;
create index if not exists customer_portal_write_idempotency_lookup_idx
  on public.customer_portal_write_idempotency
  (company_id, api_client_id, customer_id, route, idempotency_key);
create index if not exists customer_portal_write_idempotency_processing_idx
  on public.customer_portal_write_idempotency (status, started_at)
  where status = 'processing';

alter table public.customer_portal_write_idempotency enable row level security;
revoke all on table public.customer_portal_write_idempotency from public, anon, authenticated;
grant select, insert, update on table public.customer_portal_write_idempotency to service_role;

-- Common tenant-bound access paths used by the customer portal and API.
-- Each index is guarded by the actual deployed columns so a historical schema
-- variant cannot abort the whole production migration.
do $$
begin
  if to_regclass('public.integration_api_requests') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='integration_api_requests' and column_name='api_client_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='integration_api_requests' and column_name='created_at') then
    execute 'create index if not exists integration_api_requests_client_created_idx on public.integration_api_requests (api_client_id, created_at desc)';
  end if;

  if to_regclass('public.integration_api_requests') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='integration_api_requests' and column_name='company_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='integration_api_requests' and column_name='route')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='integration_api_requests' and column_name='created_at') then
    execute 'create index if not exists integration_api_requests_company_route_created_idx on public.integration_api_requests (company_id, route, created_at desc)';
  end if;

  if to_regclass('public.customer_portal_identities') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_portal_identities' and column_name='company_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_portal_identities' and column_name='auth_user_id') then
    execute 'create index if not exists customer_portal_identities_company_auth_user_idx on public.customer_portal_identities (company_id, auth_user_id) where auth_user_id is not null';
  end if;

  if to_regclass('public.customer_portal_identities') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_portal_identities' and column_name='company_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_portal_identities' and column_name='customer_portal_user_id') then
    execute 'create index if not exists customer_portal_identities_company_portal_user_idx on public.customer_portal_identities (company_id, customer_portal_user_id) where customer_portal_user_id is not null';
  end if;

  if to_regclass('public.customer_portal_identities') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_portal_identities' and column_name='company_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_portal_identities' and column_name='email') then
    execute 'create index if not exists customer_portal_identities_company_email_idx on public.customer_portal_identities (company_id, lower(email)) where email is not null';
  end if;

  if to_regclass('public.customer_sites') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_sites' and column_name='company_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_sites' and column_name='customer_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_sites' and column_name='created_at') then
    execute 'create index if not exists customer_sites_company_customer_created_idx on public.customer_sites (company_id, customer_id, created_at desc)';
  end if;

  if to_regclass('public.customer_invoices') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_invoices' and column_name='company_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_invoices' and column_name='customer_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_invoices' and column_name='period_start') then
    execute 'create index if not exists customer_invoices_company_customer_period_idx on public.customer_invoices (company_id, customer_id, period_start desc)';
  end if;

  if to_regclass('public.normalized_metering_values') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='normalized_metering_values' and column_name='company_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='normalized_metering_values' and column_name='customer_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='normalized_metering_values' and column_name='period_start') then
    execute 'create index if not exists normalized_metering_values_company_customer_period_idx on public.normalized_metering_values (company_id, customer_id, period_start desc)';
  end if;
end;
$$;

-- Keep readiness monotonic: this migration is compatible with all later builds.
update public.platform_schema_state
set current_version = '20260713150000-api-performance-tenant-hardening',
    is_ready = true,
    blocking_issues = '[]'::jsonb,
    verified_at = now(),
    updated_at = now()
where id = true;
