-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260531111600_system_readiness_foundation.sql
-- Restores only the integration API client relation required by the historical
-- website application schema. No API clients or secrets are seeded.

create extension if not exists pgcrypto;

create table if not exists public.integration_api_clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  key_prefix text not null,
  secret_hash text not null,
  scopes text[] not null default array[]::text[],
  allowed_ips text[] not null default array[]::text[],
  rate_limit_per_minute integer not null default 120,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_api_clients_status_check check (status in ('active', 'paused', 'revoked', 'expired')),
  constraint integration_api_clients_rate_limit_check check (rate_limit_per_minute between 1 and 5000),
  constraint integration_api_clients_key_prefix_unique unique (key_prefix)
);

create index if not exists integration_api_clients_company_status_idx
  on public.integration_api_clients(company_id, status, created_at desc);
create index if not exists integration_api_clients_scopes_idx
  on public.integration_api_clients using gin(scopes);
