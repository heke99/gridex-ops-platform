-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260609162000_batch_7_website_integration_foundation.sql
-- Restores only the webhook delivery chain and tenant email settings read by
-- tracked canonical migrations. No product rows are seeded.

create extension if not exists pgcrypto;

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  subject_customer_id uuid references public.customers(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'application',
  event_version integer not null default 1,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint domain_events_event_type_check check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint domain_events_version_check check (event_version > 0)
);

create unique index if not exists domain_events_idempotency_key_idx
  on public.domain_events(idempotency_key)
  where idempotency_key is not null;
create index if not exists domain_events_company_occurred_idx
  on public.domain_events(company_id, occurred_at desc);
create index if not exists domain_events_company_type_occurred_idx
  on public.domain_events(company_id, event_type, occurred_at desc);
create index if not exists domain_events_customer_occurred_idx
  on public.domain_events(company_id, subject_customer_id, occurred_at desc)
  where subject_customer_id is not null;
create index if not exists domain_events_aggregate_idx
  on public.domain_events(company_id, aggregate_type, aggregate_id, occurred_at desc);

create table if not exists public.event_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  domain_event_id uuid not null references public.domain_events(id) on delete cascade,
  destination_type text not null,
  destination_key text,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_outbox_destination_type_check check (destination_type in ('webhook', 'email', 'api', 'internal')),
  constraint event_outbox_status_check check (status in ('queued', 'processing', 'sent', 'failed', 'dead_letter', 'skipped')),
  constraint event_outbox_attempts_check check (attempts >= 0 and max_attempts > 0)
);

create index if not exists event_outbox_due_idx
  on public.event_outbox(status, available_at, created_at)
  where status in ('queued', 'failed');
create index if not exists event_outbox_company_status_idx
  on public.event_outbox(company_id, status, created_at desc);
create unique index if not exists event_outbox_unique_named_destination_idx
  on public.event_outbox(domain_event_id, destination_type, destination_key)
  where destination_key is not null;

create table if not exists public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  endpoint_url text not null,
  event_types text[] not null default array[]::text[],
  status text not null default 'active',
  signing_algorithm text not null default 'hmac-sha256',
  signing_secret_ref text,
  signing_secret_hash text,
  custom_headers jsonb not null default '{}'::jsonb,
  timeout_ms integer not null default 10000,
  max_attempts integer not null default 8,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_subscriptions_status_check check (status in ('active', 'paused', 'disabled')),
  constraint webhook_subscriptions_timeout_check check (timeout_ms between 1000 and 30000),
  constraint webhook_subscriptions_max_attempts_check check (max_attempts between 1 and 20),
  constraint webhook_subscriptions_endpoint_check check (endpoint_url ~ '^https://')
);

create index if not exists webhook_subscriptions_company_status_idx
  on public.webhook_subscriptions(company_id, status, created_at desc);
create index if not exists webhook_subscriptions_event_types_idx
  on public.webhook_subscriptions using gin(event_types);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  webhook_subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  domain_event_id uuid not null references public.domain_events(id) on delete cascade,
  event_type text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  response_status integer,
  response_body text,
  failure_reason text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_deliveries_status_check check (status in ('queued', 'processing', 'sent', 'failed', 'dead_letter', 'skipped')),
  constraint webhook_deliveries_attempts_check check (attempts >= 0 and max_attempts > 0),
  constraint webhook_deliveries_idempotency_unique unique (idempotency_key)
);

create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries(status, next_attempt_at, created_at)
  where status in ('queued', 'failed');
create index if not exists webhook_deliveries_company_status_idx
  on public.webhook_deliveries(company_id, status, created_at desc);
create unique index if not exists webhook_deliveries_subscription_event_idx
  on public.webhook_deliveries(webhook_subscription_id, domain_event_id);

create table if not exists public.company_email_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  sender_name text,
  sender_email text,
  reply_to_email text,
  support_email text,
  domain text,
  provider text not null default 'resend',
  provider_domain_id text,
  verification_status text not null default 'not_started',
  verified_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_company_email_settings_company_id
  on public.company_email_settings(company_id);
create index if not exists idx_company_email_settings_provider_domain_id
  on public.company_email_settings(provider_domain_id);
create index if not exists idx_company_email_settings_verification_status
  on public.company_email_settings(verification_status);
