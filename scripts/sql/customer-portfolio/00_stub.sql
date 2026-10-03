-- Minimal schema stub for running the customer-portfolio migration in isolation.
-- Usage: see scripts/sql/customer-portfolio/README.md
create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true),'') $$;
create extension if not exists pgcrypto;
create table public.companies(id uuid primary key default gen_random_uuid(), name text, status text default 'active', white_label_platform_id uuid, updated_at timestamptz);
create table public.company_memberships(user_id uuid, company_id uuid);
create table public.platform_admins(user_id uuid);
create function public.gridex_is_current_session_allowed() returns boolean language sql as $$ select true $$;
create function public.gridex_user_is_platform_admin() returns boolean language sql stable as $$ select exists(select 1 from public.platform_admins where user_id = auth.uid()) $$;
create function public.gridex_can_read_company(p uuid) returns boolean language sql stable as $$ select exists(select 1 from public.company_memberships where user_id = auth.uid() and company_id = p) or public.gridex_user_is_platform_admin() $$;
create table public.company_monthly_metrics (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), month date not null, total_customers integer default 0, active_customers integer default 0, new_customers integer default 0, ended_customers integer default 0, active_metering_points integer default 0, forecast_kwh numeric default 0, created_at timestamptz default now(), updated_at timestamptz default now(), unique(company_id, month));
create table public.customer_supply_periods (id uuid primary key default gen_random_uuid(), company_id uuid not null, customer_id uuid not null, metering_point_id uuid not null, start_date date not null, end_date date, status text not null default 'active');
create table public.powers_of_attorney (id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, status text default 'draft', signed_at timestamptz, valid_from date, valid_to date, created_at timestamptz default now());
create table public.grid_owner_data_requests (id uuid primary key default gen_random_uuid(), company_id uuid, request_scope text, status text default 'pending', requested_period_start date, requested_at timestamptz default now());
create table public.metering_values (id uuid primary key default gen_random_uuid(), company_id uuid, metering_point_id uuid, reading_type text default 'consumption', value_kwh numeric, period_start timestamptz, is_current boolean default true);
create table public.consumption_profiles (id uuid primary key default gen_random_uuid(), company_id uuid, is_default boolean, created_at timestamptz default now());
create table public.consumption_profile_month_weights (profile_id uuid, month_number int, weight_percent numeric);
create table public.white_label_platforms (id uuid primary key default gen_random_uuid(), name text, slug text, status text default 'active');
create table public.white_label_platform_memberships (white_label_platform_id uuid, user_id uuid, membership_role text, status text default 'active');
create table public.audit_logs (id uuid primary key default gen_random_uuid(), company_id uuid, actor_user_id uuid, entity_type text, entity_id text, action text, old_values jsonb, new_values jsonb, metadata jsonb, created_at timestamptz default now());
-- phase 2 (20261003120000)
create table public.customers (id uuid primary key, company_id uuid, full_name text, company_name text, first_name text, last_name text, customer_number text);
create table public.metering_points (id uuid primary key, company_id uuid, bidding_zone_code text);
create table public.customer_contracts (id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, ends_at date, termination_reason text);
create table public.customer_lifecycle_events (id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, event_type text, event_status text default 'completed', effective_date date, reason text, created_at timestamptz default now());
alter table public.powers_of_attorney add column scope text default 'supplier_switch';
