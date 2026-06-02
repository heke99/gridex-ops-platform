-- Production Ediel operations platform core.
-- Idempotent patch for tenant-safe runtime tables used by the backend engines.

create extension if not exists pgcrypto;

create table if not exists public.ediel_message_payloads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  ediel_message_id uuid null,
  payload_kind text not null default 'raw_edifact',
  raw_payload text null,
  raw_payload_hash text null,
  encrypted_payload text null,
  encryption_mode text not null default 'none',
  certificate_fingerprint text null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'stored',
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_message_correlations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  ediel_message_id uuid null,
  related_ediel_message_id uuid null,
  correlation_type text not null,
  interchange_reference text null,
  message_reference text null,
  bgm_reference text null,
  transaction_reference text null,
  sender_ediel_id text null,
  receiver_ediel_id text null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_outbound_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ediel_message_id uuid null,
  route_profile_id uuid null,
  status text not null default 'queued',
  correlation_keys jsonb not null default '{}'::jsonb,
  expected_acknowledgements text[] not null default array[]::text[],
  raw_payload_hash text null,
  locked_at timestamptz null,
  locked_by text null,
  sent_at timestamptz null,
  retry_count integer not null default 0,
  next_retry_at timestamptz null,
  failure_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_send_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ediel_message_id uuid null,
  lock_key text not null,
  status text not null default 'active',
  locked_by text null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_send_locks_active_key_uidx
  on public.ediel_send_locks(company_id, lock_key)
  where status = 'active';

create table if not exists public.ediel_dedupe_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  dedupe_key text not null,
  raw_payload_hash text null,
  unb_interchange_reference text null,
  unh_message_reference text null,
  bgm_message_id text null,
  transaction_reference text null,
  sender_ediel_id text null,
  receiver_ediel_id text null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists ediel_dedupe_keys_company_key_uidx
  on public.ediel_dedupe_keys(coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key);

create table if not exists public.energy_service_permissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid null,
  metering_point_id uuid null,
  grid_owner_id uuid null,
  status text not null default 'draft',
  permission_state text not null default 'draft',
  permission_reference text null,
  agreement_reference text null,
  requested_start_date date null,
  requested_end_date date null,
  historical_start_date date null,
  historical_end_date date null,
  active_from date null,
  active_to date null,
  z13_message_id uuid null,
  z14_message_id uuid null,
  z15_message_id uuid null,
  z18_message_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.energy_service_permission_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  permission_id uuid null,
  event_type text not null,
  event_status text not null default 'info',
  message text null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.metering_value_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  metering_point_id uuid null,
  permission_id uuid null,
  utilts_message_id uuid null,
  status text not null default 'received',
  utilts_subtype text null,
  measurement_resolution text null,
  period_start timestamptz null,
  period_end timestamptz null,
  observation_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.metering_values
  add column if not exists company_id uuid null,
  add column if not exists permission_id uuid null,
  add column if not exists utilts_message_id uuid null,
  add column if not exists batch_id uuid null,
  add column if not exists "timestamp" timestamptz null,
  add column if not exists period_start timestamptz null,
  add column if not exists period_end timestamptz null,
  add column if not exists resolution text null,
  add column if not exists measurement_resolution text null,
  add column if not exists quantity numeric null,
  add column if not exists unit text null,
  add column if not exists status_code text null,
  add column if not exists quality_code text null,
  add column if not exists register_code text null,
  add column if not exists meter_number text null,
  add column if not exists source text null,
  add column if not exists utilts_subtype text null,
  add column if not exists status text not null default 'stored',
  add column if not exists created_by uuid null,
  add column if not exists updated_by uuid null,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.metering_value_errors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  metering_value_batch_id uuid null,
  metering_point_id uuid null,
  utilts_message_id uuid null,
  error_code text not null,
  error_message text not null,
  severity text not null default 'warning',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_communications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  template_id uuid null,
  event_type text not null,
  channel text not null default 'email',
  recipient text null,
  sender_identity text null,
  subject text null,
  body text null,
  status text not null default 'queued',
  provider_message_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_communication_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  event_type text not null,
  name text not null,
  sender_identity text null,
  subject_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_communication_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  communication_id uuid null,
  event_type text not null,
  event_status text not null default 'info',
  message text null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  certificate_fingerprint text not null,
  certificate_valid_from timestamptz null,
  certificate_valid_to timestamptz null,
  secret_reference text not null,
  encryption_status text not null default 'unknown',
  last_validation_at timestamptz null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_it_system_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  name text not null,
  approved_message_types text[] not null default array[]::text[],
  supports_encrypted boolean not null default false,
  supports_unencrypted boolean not null default true,
  status text not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.ediel_messages
  add column if not exists company_id uuid null,
  add column if not exists raw_payload_hash text null,
  add column if not exists tenant_resolution_status text null,
  add column if not exists business_match_status text null,
  add column if not exists ack_status text null,
  add column if not exists processing_status text null,
  add column if not exists utilts_subtype text null,
  add column if not exists measurement_resolution text null;

alter table if exists public.ediel_unresolved_items
  add column if not exists company_id uuid null,
  add column if not exists status text not null default 'open',
  add column if not exists created_by uuid null,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.supplier_switch_requests
  add column if not exists company_id uuid null,
  add column if not exists status text not null default 'draft',
  add column if not exists created_by uuid null,
  add column if not exists updated_by uuid null,
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ediel_message_payloads',
    'ediel_message_correlations',
    'ediel_outbound_queue',
    'ediel_send_locks',
    'ediel_dedupe_keys',
    'energy_service_permissions',
    'energy_service_permission_events',
    'metering_value_batches',
    'metering_value_errors',
    'customer_communications',
    'customer_communication_templates',
    'customer_communication_events',
    'ediel_certificates',
    'ediel_it_system_profiles'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create index if not exists ediel_message_payloads_company_idx on public.ediel_message_payloads(company_id, ediel_message_id);
create index if not exists ediel_outbound_queue_company_status_idx on public.ediel_outbound_queue(company_id, status, created_at desc);
create index if not exists energy_service_permissions_company_status_idx on public.energy_service_permissions(company_id, status, created_at desc);
create index if not exists metering_values_company_point_ts_idx on public.metering_values(company_id, metering_point_id, "timestamp");
create index if not exists customer_communications_company_customer_idx on public.customer_communications(company_id, customer_id, created_at desc);
