-- Ediel operations completion hardening.
-- Creates missing evidence/dead-letter/runtime tables and tightens schema added
-- by earlier Ediel operations patches. All statements are additive/idempotent.

create extension if not exists pgcrypto;

do $$
begin
  if to_regtype('public.ediel_environment_type') is null then
    create type public.ediel_environment_type as enum (
      'tgt_test',
      'agt_test',
      'bilateral_test',
      'production'
    );
  end if;
end $$;

create table if not exists public.ediel_exchange_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  environment_type public.ediel_environment_type null,
  ediel_message_id uuid null,
  outbound_queue_id uuid null,
  route_profile_id uuid null,
  direction text not null,
  exchange_kind text not null default 'message',
  sent_at timestamptz null,
  received_at timestamptz null,
  sender_ediel_id text null,
  receiver_ediel_id text null,
  interchange_reference text null,
  message_reference text null,
  message_type text null,
  business_code text null,
  ack_status text null,
  internal_system text null,
  conversion_status text null,
  certificate_fingerprint text null,
  raw_payload_ref text null,
  parsed_payload_ref text null,
  payload_ref text null,
  payload_hash text null,
  payload_size_bytes integer null,
  smime_status text null,
  correlation_keys jsonb not null default '{}'::jsonb,
  route_snapshot jsonb not null default '{}'::jsonb,
  certificate_snapshot jsonb not null default '{}'::jsonb,
  sender_receiver_snapshot jsonb not null default '{}'::jsonb,
  application_reference_snapshot jsonb not null default '{}'::jsonb,
  brp_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  evidence_retention_until timestamptz not null default (now() + interval '30 days'),
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists ediel_exchange_logs_company_created_idx
  on public.ediel_exchange_logs(company_id, created_at desc);

create index if not exists ediel_exchange_logs_message_idx
  on public.ediel_exchange_logs(ediel_message_id);

create index if not exists ediel_exchange_logs_references_idx
  on public.ediel_exchange_logs(company_id, interchange_reference, message_reference);

create table if not exists public.ediel_dead_letter_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  environment_type public.ediel_environment_type null,
  source text not null,
  source_table text null,
  source_id uuid null,
  ediel_message_id uuid null,
  outbound_queue_id uuid null,
  raw_payload_ref text null,
  error_code text not null,
  error_message text not null,
  retryable boolean not null default false,
  retry_count integer not null default 0,
  last_retry_at timestamptz null,
  status text not null default 'open',
  replay_requires_approval boolean not null default false,
  high_risk_approval_id uuid null,
  resolved_by uuid null,
  resolved_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ediel_dead_letter_items_open_idx
  on public.ediel_dead_letter_items(environment_type, source, created_at desc)
  where status in ('open', 'retrying');

create table if not exists public.ediel_high_risk_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  scope_type text not null,
  scope_id uuid null,
  action_type text not null,
  approval_required boolean not null default true,
  approved_by uuid null,
  approved_at timestamptz null,
  reason text not null,
  expires_at timestamptz null,
  revoked_by uuid null,
  revoked_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ediel_high_risk_approvals_scope_idx
  on public.ediel_high_risk_approvals(company_id, scope_type, scope_id, action_type, expires_at);

alter table if exists public.ediel_dead_letter_items
  add column if not exists high_risk_approval_id uuid;

do $$
begin
  if to_regclass('public.ediel_high_risk_approvals') is not null
     and to_regclass('public.ediel_dead_letter_items') is not null
     and not exists (select 1 from pg_constraint where conname = 'ediel_dead_letter_high_risk_approval_fkey') then
    alter table public.ediel_dead_letter_items
      add constraint ediel_dead_letter_high_risk_approval_fkey
      foreign key (high_risk_approval_id) references public.ediel_high_risk_approvals(id) on delete set null;
  end if;
end $$;

create table if not exists public.ediel_ack_sla_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  environment_type public.ediel_environment_type null,
  ediel_message_id uuid null,
  outbound_queue_id uuid null,
  ack_family text not null,
  due_at timestamptz not null,
  breached_at timestamptz null,
  resolved_at timestamptz null,
  severity text not null default 'warning',
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_ack_sla_events_open_uidx
  on public.ediel_ack_sla_events(coalesce(ediel_message_id, '00000000-0000-0000-0000-000000000000'::uuid), ack_family)
  where status = 'open';

alter table if exists public.ediel_outbound_queue
  add column if not exists ack_due_at timestamptz,
  add column if not exists ack_sla_status text not null default 'pending',
  add column if not exists high_risk_approval_id uuid,
  add column if not exists split_index integer,
  add column if not exists split_total integer,
  add column if not exists split_strategy text;

create table if not exists public.ediel_runtime_health_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  environment_type public.ediel_environment_type null,
  check_type text not null,
  status text not null,
  measured_offset_ms integer null,
  reference_source text null,
  details jsonb not null default '{}'::jsonb,
  checked_by uuid null,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ediel_runtime_health_latest_idx
  on public.ediel_runtime_health_checks(check_type, environment_type, checked_at desc);

alter table if exists public.ediel_mailboxes
  add column if not exists clock_skew_ms integer,
  add column if not exists last_time_sync_check_at timestamptz;

alter table if exists public.ediel_route_profiles
  add column if not exists max_payload_bytes integer not null default 10485760,
  add column if not exists split_strategy text not null default 'none',
  add column if not exists production_mode text not null default 'disabled';

do $$
begin
  if to_regclass('public.ediel_route_profiles') is not null
     and not exists (select 1 from pg_constraint where conname = 'ediel_route_profiles_production_mode_check') then
    alter table public.ediel_route_profiles
      add constraint ediel_route_profiles_production_mode_check
      check (production_mode in ('disabled', 'shadow', 'dry_run', 'live', 'active'));
  end if;
end $$;

alter table if exists public.companies
  add column if not exists ediel_production_shadow_mode boolean not null default false,
  add column if not exists ediel_production_shadow_enabled_at timestamptz,
  add column if not exists ediel_production_shadow_enabled_by uuid;

create table if not exists public.ediel_message_splits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  parent_outbound_queue_id uuid null,
  child_outbound_queue_id uuid null,
  split_reason text not null,
  split_strategy text not null default 'by_transaction',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_market_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'electricity',
  country text not null default 'SE',
  calendar_date date not null,
  entry_type text not null,
  label text not null,
  is_business_day boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(market, country, calendar_date)
);

create table if not exists public.ediel_business_deadline_rules (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'electricity',
  company_role text null,
  actor_role text null,
  message_family text not null,
  business_code text null,
  action_type text not null,
  min_lead_business_days integer not null default 0,
  max_history_years integer null,
  cutoff_time_local time null,
  timezone text not null default 'Europe/Stockholm',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ediel_business_deadline_rules_lookup_idx
  on public.ediel_business_deadline_rules(market, message_family, business_code, action_type)
  where is_active = true;

create unique index if not exists ediel_business_deadline_rules_default_uidx
  on public.ediel_business_deadline_rules(market, message_family, coalesce(business_code, ''), action_type)
  where coalesce((metadata ->> 'default')::boolean, false) = true;

insert into public.ediel_business_deadline_rules (
  message_family,
  business_code,
  action_type,
  min_lead_business_days,
  max_history_years,
  metadata
)
values
  ('PRODAT', 'Z13', 'request_metering_access', 0, null, '{"default": true}'::jsonb),
  ('PRODAT', 'Z13VH', 'request_historical_metering_access', 0, 3, '{"default": true}'::jsonb),
  ('PRODAT', 'Z18', 'terminate_metering_access', 0, null, '{"default": true}'::jsonb),
  ('PRODAT', 'Z03', 'start_supplier_switch', 0, null, '{"default": true}'::jsonb)
on conflict do nothing;

alter table if exists public.ediel_agt_readiness
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_by uuid,
  add column if not exists invalidation_source text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_checked_by uuid,
  add column if not exists blocking_issues jsonb not null default '[]'::jsonb,
  add column if not exists readiness_snapshot jsonb not null default '{}'::jsonb;

create table if not exists public.ediel_retest_invalidations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_role text null,
  message_family text null,
  source_type text not null,
  source_id uuid null,
  previous_approval_version text null,
  new_approval_version text null,
  affected_test_run_ids uuid[] not null default array[]::uuid[],
  affected_actor_test_result_ids uuid[] not null default array[]::uuid[],
  reason text not null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists ediel_retest_invalidations_company_idx
  on public.ediel_retest_invalidations(company_id, created_at desc);

alter table if exists public.ediel_unlinked_test_messages
  add column if not exists ediel_message_id uuid,
  add column if not exists inbound_mail_item_id uuid,
  add column if not exists resolution_notes text;

alter table if exists public.communication_routes
  add column if not exists environment_type public.ediel_environment_type,
  add column if not exists market_party_role text,
  add column if not exists counterparty_ediel_id text;

create table if not exists public.company_market_party_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  market_party_id uuid null,
  message_family text not null,
  route_profile_id uuid null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists company_market_party_routes_active_uidx
  on public.company_market_party_routes(company_id, market_party_id, message_family)
  where active = true;

create table if not exists public.ediel_test_run_snapshots (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid not null,
  snapshot_kind text not null,
  snapshot jsonb not null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists ediel_test_run_snapshots_run_idx
  on public.ediel_test_run_snapshots(test_run_id, created_at desc);

-- Add foreign keys only when both sides exist and the constraint has not been
-- created by an earlier patch.
do $$
begin
  if to_regclass('public.companies') is not null then
    if to_regclass('public.ediel_exchange_logs') is not null
       and not exists (select 1 from pg_constraint where conname = 'ediel_exchange_logs_company_fkey') then
      alter table public.ediel_exchange_logs add constraint ediel_exchange_logs_company_fkey foreign key (company_id) references public.companies(id) on delete set null;
    end if;
    if to_regclass('public.ediel_dead_letter_items') is not null
       and not exists (select 1 from pg_constraint where conname = 'ediel_dead_letter_items_company_fkey') then
      alter table public.ediel_dead_letter_items add constraint ediel_dead_letter_items_company_fkey foreign key (company_id) references public.companies(id) on delete set null;
    end if;
    if to_regclass('public.ediel_agt_readiness') is not null
       and not exists (select 1 from pg_constraint where conname = 'ediel_agt_readiness_company_fkey') then
      alter table public.ediel_agt_readiness add constraint ediel_agt_readiness_company_fkey foreign key (company_id) references public.companies(id) on delete cascade;
    end if;
    if to_regclass('public.ediel_test_run_locks') is not null
       and not exists (select 1 from pg_constraint where conname = 'ediel_test_run_locks_company_fkey') then
      alter table public.ediel_test_run_locks add constraint ediel_test_run_locks_company_fkey foreign key (company_id) references public.companies(id) on delete cascade;
    end if;
  end if;
end $$;

-- RLS: service-role/server code can still manage operations; authenticated
-- users only read tenant-scoped rows through existing company membership.
alter table if exists public.ediel_exchange_logs enable row level security;
alter table if exists public.ediel_dead_letter_items enable row level security;
alter table if exists public.ediel_ack_sla_events enable row level security;
alter table if exists public.ediel_runtime_health_checks enable row level security;
alter table if exists public.ediel_test_run_locks enable row level security;
alter table if exists public.ediel_agt_readiness enable row level security;
alter table if exists public.ediel_unlinked_test_messages enable row level security;
alter table if exists public.ediel_retest_invalidations enable row level security;

do $$
declare
  rel_name text;
  policy_name text;
begin
  foreach rel_name in array array[
    'ediel_exchange_logs',
    'ediel_dead_letter_items',
    'ediel_ack_sla_events',
    'ediel_runtime_health_checks',
    'ediel_test_run_locks',
    'ediel_agt_readiness',
    'ediel_unlinked_test_messages',
    'ediel_retest_invalidations'
  ] loop
    policy_name := rel_name || '_service_role_all';
    if to_regclass('public.' || rel_name) is not null
       and not exists (
         select 1
           from pg_policies
          where schemaname = 'public'
            and tablename = rel_name
            and policyname = policy_name
       ) then
      execute format(
        'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
        policy_name,
        rel_name
      );
    end if;
  end loop;
end $$;
