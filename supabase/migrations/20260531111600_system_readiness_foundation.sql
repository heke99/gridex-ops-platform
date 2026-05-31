-- System readiness foundation: domain events, outbox, webhooks, partner API,
-- tenant email sender profiles, data quality findings, and performance guardrails.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

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
create unique index if not exists event_outbox_unique_destination_idx
  on public.event_outbox(domain_event_id, destination_type, coalesce(destination_key, ''));
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

create table if not exists public.integration_api_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  request_id text,
  method text not null,
  route text not null,
  status_code integer,
  duration_ms integer,
  ip_address inet,
  user_agent text,
  idempotency_key text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists integration_api_requests_company_created_idx
  on public.integration_api_requests(company_id, created_at desc);
create index if not exists integration_api_requests_client_created_idx
  on public.integration_api_requests(api_client_id, created_at desc);
create unique index if not exists integration_api_requests_idempotency_idx
  on public.integration_api_requests(api_client_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.tenant_email_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null,
  provider text not null default 'smtp',
  provider_domain_id text,
  status text not null default 'pending_dns',
  spf_status text not null default 'pending',
  dkim_status text not null default 'pending',
  dmarc_status text not null default 'pending',
  bounce_status text not null default 'pending',
  last_checked_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_email_domains_status_check check (status in ('pending_dns', 'verifying', 'verified', 'failed', 'disabled')),
  constraint tenant_email_domains_unique unique (company_id, domain)
);

create index if not exists tenant_email_domains_company_status_idx
  on public.tenant_email_domains(company_id, status, created_at desc);

create table if not exists public.tenant_email_sender_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email_domain_id uuid references public.tenant_email_domains(id) on delete set null,
  from_email text not null,
  from_name text not null,
  reply_to_email text,
  status text not null default 'pending',
  is_default boolean not null default false,
  provider_profile_id text,
  provider_secret_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_email_sender_profiles_status_check check (status in ('pending', 'verified', 'failed', 'disabled')),
  constraint tenant_email_sender_profiles_email_check check (from_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create unique index if not exists tenant_email_sender_profiles_default_idx
  on public.tenant_email_sender_profiles(company_id)
  where is_default = true and status = 'verified';
create index if not exists tenant_email_sender_profiles_company_status_idx
  on public.tenant_email_sender_profiles(company_id, status, created_at desc);

create table if not exists public.status_transition_rules (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  from_status text,
  to_status text not null,
  is_allowed boolean not null default true,
  requires_reason boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_transition_rules_unique unique (entity_type, from_status, to_status)
);

create index if not exists status_transition_rules_entity_idx
  on public.status_transition_rules(entity_type, from_status, to_status);

insert into public.status_transition_rules (entity_type, from_status, to_status, is_allowed, requires_reason, description)
values
  ('customer', null, 'draft', true, false, 'Initial kund skapas.'),
  ('customer', 'draft', 'pending_verification', true, false, 'Kund behöver verifieras.'),
  ('customer', 'pending_verification', 'active', true, false, 'Kund är aktiv.'),
  ('customer', 'active', 'blocked', true, true, 'Kund blockeras av data eller operationellt fel.'),
  ('customer', 'blocked', 'active', true, true, 'Blockering är löst.'),
  ('customer', 'active', 'terminated', true, true, 'Kund avslutas.'),
  ('power_of_attorney', null, 'draft', true, false, 'Fullmakt skapas.'),
  ('power_of_attorney', 'draft', 'sent', true, false, 'Fullmakt skickas.'),
  ('power_of_attorney', 'sent', 'signed', true, false, 'Fullmakt signeras.'),
  ('power_of_attorney', 'signed', 'revoked', true, true, 'Fullmakt återkallas.'),
  ('power_of_attorney', 'signed', 'expired', true, false, 'Fullmakt har gått ut.'),
  ('supplier_switch', null, 'draft', true, false, 'Byte initieras.'),
  ('supplier_switch', 'draft', 'queued', true, false, 'Byte köas för utskick.'),
  ('supplier_switch', 'queued', 'sent_to_grid_owner', true, false, 'Byte skickas till nätägare.'),
  ('supplier_switch', 'sent_to_grid_owner', 'sent_to_supplier', true, false, 'Byte skickas till leverantör.'),
  ('supplier_switch', 'sent_to_supplier', 'completed', true, false, 'Byte slutförs.'),
  ('supplier_switch', 'queued', 'failed', true, true, 'Byte misslyckas.'),
  ('supplier_switch', 'sent_to_grid_owner', 'failed', true, true, 'Svar från nätägare misslyckas.'),
  ('supplier_switch', 'sent_to_supplier', 'failed', true, true, 'Svar från leverantör misslyckas.'),
  ('webhook_delivery', 'queued', 'processing', true, false, 'Webhook tas av worker.'),
  ('webhook_delivery', 'processing', 'sent', true, false, 'Webhook levererad.'),
  ('webhook_delivery', 'processing', 'failed', true, false, 'Webhook kan testas igen.'),
  ('webhook_delivery', 'failed', 'dead_letter', true, true, 'Webhook kräver manuell hantering.')
on conflict (entity_type, from_status, to_status) do update set
  is_allowed = excluded.is_allowed,
  requires_reason = excluded.requires_reason,
  description = excluded.description,
  updated_at = now();

create table if not exists public.data_quality_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  customer_id uuid references public.customers(id) on delete set null,
  issue_key text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  message text not null,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_quality_findings_severity_check check (severity in ('info', 'warning', 'critical')),
  constraint data_quality_findings_status_check check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  constraint data_quality_findings_unique unique (company_id, entity_type, entity_id, issue_key)
);

create index if not exists data_quality_findings_company_status_idx
  on public.data_quality_findings(company_id, status, severity, detected_at desc);
create index if not exists data_quality_findings_customer_idx
  on public.data_quality_findings(company_id, customer_id, status, detected_at desc)
  where customer_id is not null;

create table if not exists public.page_performance_budgets (
  id uuid primary key default gen_random_uuid(),
  route_key text not null unique,
  route_path text not null,
  target_first_content_ms integer not null,
  target_full_data_ms integer not null,
  max_page_size integer not null default 100,
  requires_database_filtering boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_performance_budgets_positive_check check (
    target_first_content_ms > 0 and target_full_data_ms >= target_first_content_ms and max_page_size > 0
  )
);

insert into public.page_performance_budgets (
  route_key,
  route_path,
  target_first_content_ms,
  target_full_data_ms,
  max_page_size,
  requires_database_filtering,
  notes
)
values
  ('admin.dashboard', '/admin', 1200, 2500, 50, true, 'Översikt ska visa första användbara status snabbt även med stora tenants.'),
  ('admin.customers', '/admin/customers', 1500, 3000, 100, true, 'Kundlista ska filtrera/söka i databasen och aldrig kräva full kundhämtning.'),
  ('admin.operations.switches', '/admin/operations/switches', 1500, 3500, 100, true, 'Byten ska pagineras och summeras via index/vyer.'),
  ('admin.audit', '/admin/audit', 1500, 3500, 100, true, 'Audit ska alltid sidindelas och filtreras server-side.'),
  ('api.v1.events', '/api/v1/events', 800, 1500, 100, true, 'Partner-API ska vara snabbt och hårt paginerat.')
on conflict (route_key) do update set
  route_path = excluded.route_path,
  target_first_content_ms = excluded.target_first_content_ms,
  target_full_data_ms = excluded.target_full_data_ms,
  max_page_size = excluded.max_page_size,
  requires_database_filtering = excluded.requires_database_filtering,
  notes = excluded.notes,
  updated_at = now();

create or replace view public.customer_data_quality_open_issues
with (security_invoker = true)
as
select
  c.company_id,
  c.id::text as entity_id,
  c.id as customer_id,
  'customer'::text as entity_type,
  issue.issue_key,
  issue.severity,
  issue.message,
  issue.evidence
from public.customers c
cross join lateral (
  values
    (
      case when c.personal_number is not null and regexp_replace(c.personal_number, '\D', '', 'g') !~ '^\d{10}$|^\d{12}$' then 'invalid_personal_number' end,
      'critical',
      'Personnummer har ogiltigt format.',
      jsonb_build_object('personal_number', c.personal_number)
    ),
    (
      case when c.org_number is not null and regexp_replace(c.org_number, '\D', '', 'g') !~ '^\d{10}$|^\d{12}$' then 'invalid_org_number' end,
      'critical',
      'Organisationsnummer har ogiltigt format.',
      jsonb_build_object('org_number', c.org_number)
    ),
    (
      case when c.email is not null and c.email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'invalid_email' end,
      'warning',
      'E-post har ogiltigt format.',
      jsonb_build_object('email', c.email)
    )
) as issue(issue_key, severity, message, evidence)
where issue.issue_key is not null
union all
select
  a.company_id,
  a.id::text as entity_id,
  a.customer_id,
  'customer_address'::text as entity_type,
  'invalid_postal_code'::text as issue_key,
  'warning'::text as severity,
  'Postnummer ska anges som 12345 eller 123 45.'::text as message,
  jsonb_build_object('postal_code', a.postal_code) as evidence
from public.customer_addresses a
where a.postal_code is not null
  and a.postal_code !~ '^\d{3}\s?\d{2}$'
union all
select
  c.company_id,
  c.id::text as entity_id,
  c.id as customer_id,
  'customer'::text as entity_type,
  'missing_signed_power_of_attorney'::text as issue_key,
  'warning'::text as severity,
  'Kunden saknar signerad fullmakt.'::text as message,
  '{}'::jsonb as evidence
from public.customers c
where not exists (
  select 1
  from public.powers_of_attorney p
  where p.customer_id = c.id
    and p.company_id = c.company_id
    and p.status = 'signed'
);

create or replace view public.customer_timeline_events
with (security_invoker = true)
as
select
  e.company_id,
  e.subject_customer_id as customer_id,
  e.id,
  e.event_type,
  e.aggregate_type,
  e.aggregate_id,
  e.source,
  e.payload,
  e.occurred_at,
  e.actor_user_id
from public.domain_events e
where e.subject_customer_id is not null
union all
select
  s.company_id,
  r.customer_id,
  s.id,
  s.event_type,
  'supplier_switch'::text as aggregate_type,
  s.switch_request_id::text as aggregate_id,
  'supplier_switch_events'::text as source,
  coalesce(s.payload, '{}'::jsonb) as payload,
  s.created_at as occurred_at,
  s.created_by as actor_user_id
from public.supplier_switch_events s
join public.supplier_switch_requests r on r.id = s.switch_request_id
union all
select
  o.company_id,
  o.customer_id,
  e.id,
  e.event_type,
  'outbound_request'::text as aggregate_type,
  e.outbound_request_id::text as aggregate_id,
  'outbound_dispatch_events'::text as source,
  coalesce(e.payload, '{}'::jsonb) as payload,
  e.created_at as occurred_at,
  e.created_by as actor_user_id
from public.outbound_dispatch_events e
join public.outbound_requests o on o.id = e.outbound_request_id;

create or replace function public.gridex_emit_domain_event(
  p_company_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_subject_customer_id uuid default null,
  p_actor_user_id uuid default null,
  p_source text default 'application',
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
as $$
declare
  v_event_id uuid;
begin
  if p_idempotency_key is not null then
    select id into v_event_id
    from public.domain_events
    where idempotency_key = p_idempotency_key;

    if v_event_id is not null then
      return v_event_id;
    end if;
  end if;

  insert into public.domain_events (
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    subject_customer_id,
    actor_user_id,
    source,
    payload,
    idempotency_key
  )
  values (
    p_company_id,
    p_event_type,
    p_aggregate_type,
    p_aggregate_id,
    p_subject_customer_id,
    p_actor_user_id,
    coalesce(nullif(p_source, ''), 'application'),
    coalesce(p_payload, '{}'::jsonb),
    p_idempotency_key
  )
  returning id into v_event_id;

  insert into public.event_outbox (company_id, domain_event_id, destination_type, destination_key, payload)
  values (
    p_company_id,
    v_event_id,
    'webhook',
    'all_active_webhooks',
    jsonb_build_object('event_id', v_event_id, 'event_type', p_event_type)
  )
  on conflict do nothing;

  return v_event_id;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'domain_events',
    'event_outbox',
    'webhook_subscriptions',
    'webhook_deliveries',
    'integration_api_clients',
    'integration_api_requests',
    'tenant_email_domains',
    'tenant_email_sender_profiles',
    'status_transition_rules',
    'data_quality_findings',
    'page_performance_budgets'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = t || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
        t || '_service_role_all',
        t
      );
    end if;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.customers') is not null then
    create index if not exists customers_company_status_created_perf_idx
      on public.customers(company_id, status, created_at desc)
      where company_id is not null;
    create index if not exists customers_company_type_status_created_perf_idx
      on public.customers(company_id, customer_type, status, created_at desc)
      where company_id is not null;
    create index if not exists customers_company_email_trgm_idx
      on public.customers using gin (lower(coalesce(email, '')) gin_trgm_ops);
    create index if not exists customers_company_name_trgm_idx
      on public.customers using gin (lower(coalesce(full_name, '') || ' ' || coalesce(company_name, '')) gin_trgm_ops);
    create index if not exists customers_company_identity_idx
      on public.customers(company_id, personal_number, org_number)
      where company_id is not null;
  end if;

  if to_regclass('public.customer_sites') is not null then
    create index if not exists customer_sites_company_customer_status_perf_idx
      on public.customer_sites(company_id, customer_id, status);
    create index if not exists customer_sites_company_facility_perf_idx
      on public.customer_sites(company_id, facility_id)
      where facility_id is not null;
  end if;

  if to_regclass('public.metering_points') is not null then
    create index if not exists metering_points_company_site_status_perf_idx
      on public.metering_points(company_id, site_id, status);
    create index if not exists metering_points_company_meter_point_perf_idx
      on public.metering_points(company_id, meter_point_id)
      where meter_point_id is not null;
  end if;

  if to_regclass('public.powers_of_attorney') is not null then
    create index if not exists powers_of_attorney_company_customer_status_perf_idx
      on public.powers_of_attorney(company_id, customer_id, status, created_at desc);
  end if;

  if to_regclass('public.supplier_switch_requests') is not null then
    create index if not exists supplier_switch_requests_company_status_created_perf_idx
      on public.supplier_switch_requests(company_id, status, created_at desc);
    create index if not exists supplier_switch_requests_company_customer_status_perf_idx
      on public.supplier_switch_requests(company_id, customer_id, status, created_at desc);
  end if;

  if to_regclass('public.outbound_requests') is not null then
    create index if not exists outbound_requests_company_status_created_perf_idx
      on public.outbound_requests(company_id, status, created_at desc);
    create index if not exists outbound_requests_company_source_perf_idx
      on public.outbound_requests(company_id, source_type, source_id, created_at desc);
  end if;

  if to_regclass('public.audit_logs') is not null then
    create index if not exists audit_logs_company_action_created_perf_idx
      on public.audit_logs(company_id, action, created_at desc);
  end if;
end $$;

commit;
