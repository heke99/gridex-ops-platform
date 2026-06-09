-- Batch 7A-7F: Website integration foundation.
-- Additive/idempotent foundation for customer numbers, external website onboarding,
-- webhooks, communication events, Capway reference mapping and public developer docs.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 7A: Customer number foundation
-- -----------------------------------------------------------------------------
alter table if exists public.companies
  add column if not exists customer_number_prefix text;

alter table if exists public.customers
  add column if not exists customer_number text;

create table if not exists public.company_customer_number_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  prefix text not null default 'GDX',
  next_number bigint not null default 100001,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_customer_number_sequences_next_check check (next_number > 0),
  constraint company_customer_number_sequences_prefix_check check (prefix ~ '^[A-Z0-9]{2,12}$')
);

create unique index if not exists customers_company_customer_number_uidx
  on public.customers(company_id, customer_number)
  where customer_number is not null;

create or replace function public.gridex_default_customer_number_prefix(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
begin
  select upper(regexp_replace(coalesce(nullif(c.customer_number_prefix, ''), left(regexp_replace(coalesce(c.name, 'GDX'), '[^A-Za-z0-9]', '', 'g'), 3), 'GDX'), '[^A-Z0-9]', '', 'g'))
    into v_prefix
  from public.companies c
  where c.id = p_company_id;

  v_prefix := coalesce(nullif(v_prefix, ''), 'GDX');
  if length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;
  return left(v_prefix, 12);
end;
$$;

create or replace function public.gridex_next_customer_number(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_existing_next bigint;
  v_number bigint;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  v_prefix := public.gridex_default_customer_number_prefix(p_company_id);

  select coalesce(max(nullif(substring(customer_number from '([0-9]+)$'), '')::bigint) + 1, 100001)
    into v_existing_next
  from public.customers
  where company_id = p_company_id
    and customer_number is not null;

  insert into public.company_customer_number_sequences(company_id, prefix, next_number)
  values (p_company_id, v_prefix, v_existing_next)
  on conflict (company_id) do nothing;

  update public.company_customer_number_sequences
     set next_number = greatest(next_number, v_existing_next) + 1,
         prefix = coalesce(nullif(prefix, ''), v_prefix),
         updated_at = now()
   where company_id = p_company_id
   returning prefix, next_number - 1 into v_prefix, v_number;

  if v_number is null then
    raise exception 'customer number sequence could not be reserved';
  end if;

  return v_prefix || '-' || v_number::text;
end;
$$;

-- Backfill existing customers safely. Existing customer_number values are preserved.
do $$
declare
  r record;
begin
  if to_regclass('public.customers') is null then
    return;
  end if;

  for r in
    select id, company_id
    from public.customers
    where company_id is not null
      and customer_number is null
    order by created_at, id
  loop
    update public.customers
       set customer_number = public.gridex_next_customer_number(r.company_id),
           updated_at = now()
     where id = r.id
       and customer_number is null;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7B: Website customer onboarding API foundation
-- -----------------------------------------------------------------------------
create table if not exists public.website_customer_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  metering_point_id uuid references public.metering_points(id) on delete set null,
  contract_id uuid references public.customer_contracts(id) on delete set null,
  external_customer_id text not null,
  external_account_id text,
  customer_number text,
  source text not null default 'external_website',
  status text not null default 'application_received',
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_customer_applications_status_check check (status in ('application_received','linked_existing_customer','pending_review','rejected','failed','cancelled'))
);

create unique index if not exists website_customer_applications_company_idempotency_uidx
  on public.website_customer_applications(company_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists website_customer_applications_company_external_idx
  on public.website_customer_applications(company_id, external_customer_id, created_at desc);
create index if not exists website_customer_applications_customer_idx
  on public.website_customer_applications(company_id, customer_id, created_at desc)
  where customer_id is not null;

alter table if exists public.customer_portal_identities
  add column if not exists api_client_id uuid references public.integration_api_clients(id) on delete set null;

create index if not exists customer_portal_identities_api_client_idx
  on public.customer_portal_identities(api_client_id, created_at desc)
  where api_client_id is not null;


-- Compatibility repair: create webhook/domain-event foundation if older live DB
-- has not run the readiness foundation migration yet. Fully idempotent.
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

-- -----------------------------------------------------------------------------
-- 7C: Webhook/event foundation
-- Existing webhook_subscriptions/webhook_deliveries may already exist from readiness foundation.
-- This patch links webhook subscriptions to API-clients and standardizes metadata.
-- -----------------------------------------------------------------------------
alter table if exists public.webhook_subscriptions
  add column if not exists api_client_id uuid references public.integration_api_clients(id) on delete set null,
  add column if not exists description text,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists webhook_subscriptions_api_client_idx
  on public.webhook_subscriptions(api_client_id, status, created_at desc)
  where api_client_id is not null;


-- Compatibility repair: create tenant email/communication foundation when the
-- live DB has not run the older Resend tenant email engine migration yet.
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

create table if not exists public.company_email_dns_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email_setting_id uuid not null references public.company_email_settings(id) on delete cascade,
  record_type text not null,
  name text not null,
  value text not null,
  priority integer,
  status text not null default 'pending',
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_email_dns_records_company_id
  on public.company_email_dns_records(company_id);
create index if not exists idx_company_email_dns_records_setting_id
  on public.company_email_dns_records(email_setting_id);
create index if not exists idx_company_email_dns_records_status
  on public.company_email_dns_records(status);

create table if not exists public.company_email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_key text not null,
  name text not null,
  subject text not null,
  body_html text not null,
  body_text text,
  language text not null default 'sv',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, template_key, language)
);

create index if not exists idx_company_email_templates_company_id
  on public.company_email_templates(company_id);
create index if not exists idx_company_email_templates_template_key
  on public.company_email_templates(company_id, template_key);

create table if not exists public.email_event_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null,
  template_key text not null,
  enabled boolean not null default true,
  delay_minutes integer not null default 0,
  send_to_customer boolean not null default true,
  send_to_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, event_key, template_key)
);

create index if not exists idx_email_event_rules_company_id
  on public.email_event_rules(company_id);
create index if not exists idx_email_event_rules_event_key
  on public.email_event_rules(company_id, event_key);
create index if not exists idx_email_event_rules_enabled
  on public.email_event_rules(company_id, enabled);

create table if not exists public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  metering_point_id uuid references public.metering_points(id) on delete set null,
  channel text not null default 'email',
  event_key text,
  template_key text,
  recipient_email text not null,
  sender_email text,
  reply_to_email text,
  subject text,
  status text not null default 'queued',
  provider text,
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  customer_number text,
  external_customer_id text,
  contract_id uuid,
  template_version_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_communication_logs_company_id
  on public.communication_logs(company_id);
create index if not exists idx_communication_logs_customer_id
  on public.communication_logs(company_id, customer_id);
create index if not exists idx_communication_logs_status
  on public.communication_logs(company_id, status);
create index if not exists idx_communication_logs_event_key
  on public.communication_logs(company_id, event_key);
create index if not exists idx_communication_logs_created_at
  on public.communication_logs(company_id, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_email_settings_verification_status_check') then
    alter table public.company_email_settings
      add constraint company_email_settings_verification_status_check
      check (verification_status in ('not_started', 'pending_dns', 'verified', 'failed', 'disabled'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_email_dns_records_status_check') then
    alter table public.company_email_dns_records
      add constraint company_email_dns_records_status_check
      check (status in ('pending', 'verified', 'failed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'communication_logs_status_check') then
    alter table public.communication_logs
      add constraint communication_logs_status_check
      check (status in ('queued', 'sent', 'delivered', 'bounced', 'failed', 'cancelled'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7D: Communication foundation extensions
-- -----------------------------------------------------------------------------
alter table if exists public.communication_logs
  add column if not exists customer_number text,
  add column if not exists external_customer_id text,
  add column if not exists contract_id uuid,
  add column if not exists template_version_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists communication_logs_customer_number_idx
  on public.communication_logs(company_id, customer_number, created_at desc)
  where customer_number is not null;

-- Ensure automatic rules exist for website-originated contract flows. These are safe
-- no-op inserts until each company has templates seeded.
do $$
begin
  if to_regclass('public.email_event_rules') is not null and to_regclass('public.companies') is not null then
    insert into public.email_event_rules(company_id, event_key, template_key, enabled, delay_minutes, send_to_customer, send_to_admin, updated_at)
    select c.id, rule.event_key, rule.template_key, true, 0, true, false, now()
    from public.companies c
    cross join (values
      ('contract.application_received', 'contract_confirmation'),
      ('contract.confirmation_sent', 'contract_confirmation'),
      ('contract.cooling_off_sent', 'cancellation_right'),
      ('invoice.created', 'missing_information'),
      ('invoice.disputed', 'missing_information')
    ) as rule(event_key, template_key)
    on conflict (company_id, event_key, template_key) do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7E: Billing/Capway reference mapping and dispute traceability
-- -----------------------------------------------------------------------------
create table if not exists public.billing_partner_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_number text,
  provider text not null default 'capway_aptic',
  provider_customer_id text,
  provider_debtor_id text,
  provider_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_partner_customers_company_provider_customer_uidx
  on public.billing_partner_customers(company_id, provider, customer_id);
create index if not exists billing_partner_customers_provider_debtor_idx
  on public.billing_partner_customers(provider, provider_debtor_id)
  where provider_debtor_id is not null;
create index if not exists billing_partner_customers_customer_number_idx
  on public.billing_partner_customers(company_id, customer_number)
  where customer_number is not null;

alter table if exists public.invoice_export_items
  add column if not exists customer_number text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_debtor_id text,
  add column if not exists dispute_status text,
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_reason text;

do $$
begin
  if to_regclass('public.invoice_export_items') is not null then
    create index if not exists invoice_export_items_customer_number_idx
      on public.invoice_export_items(company_id, customer_number, created_at desc)
      where customer_number is not null;
    create index if not exists invoice_export_items_provider_customer_idx
      on public.invoice_export_items(provider, provider_customer_id)
      where provider_customer_id is not null;
    create index if not exists invoice_export_items_dispute_status_idx
      on public.invoice_export_items(company_id, dispute_status, created_at desc)
      where dispute_status is not null;
  end if;
end $$;

create table if not exists public.billing_disputes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_number text,
  invoice_export_item_id uuid references public.invoice_export_items(id) on delete set null,
  provider text not null default 'capway_aptic',
  provider_invoice_id text,
  provider_debtor_id text,
  status text not null default 'received',
  reason text,
  amount_ex_vat numeric,
  vat_amount numeric,
  amount_inc_vat numeric,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_disputes_status_check check (status in ('received','reviewing','accepted','rejected','resolved','needs_customer_response'))
);

create index if not exists billing_disputes_company_status_idx
  on public.billing_disputes(company_id, status, received_at desc);
create index if not exists billing_disputes_customer_number_idx
  on public.billing_disputes(company_id, customer_number, received_at desc)
  where customer_number is not null;

-- -----------------------------------------------------------------------------
-- Tenant-safe RLS. Service role can always operate; tenant/platform users can read
-- through existing helper functions if available.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'company_customer_number_sequences',
    'website_customer_applications',
    'billing_partner_customers',
    'billing_disputes'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_service_role_all'
    ) then
      execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service_role_all', t);
    end if;

    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_tenant_read'
    ) then
      execute format('create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))', t || '_tenant_read', t);
    end if;

    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_tenant_write'
    ) then
      execute format('create policy %I on public.%I for all using (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id)) with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id))', t || '_tenant_write', t);
    end if;
  end loop;
end $$;
