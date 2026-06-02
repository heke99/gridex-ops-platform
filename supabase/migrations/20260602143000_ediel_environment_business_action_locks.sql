-- Ediel operations hardening: strict environment types, business action
-- idempotency metadata and AGT run locking. Safe/idempotent additions only.

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

alter table if exists public.ediel_route_profiles
  add column if not exists environment_type public.ediel_environment_type,
  add column if not exists production_mode text not null default 'disabled',
  add column if not exists high_risk_approval_required boolean not null default false,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_reason text,
  add column if not exists approval_expires_at timestamptz;

update public.ediel_route_profiles
   set environment_type = case
     when coalesce(environment_type::text, '') <> '' then environment_type
     when lower(coalesce(environment, '')) = 'production' then 'production'::public.ediel_environment_type
     when lower(coalesce(environment, '')) like '%bilateral%' then 'bilateral_test'::public.ediel_environment_type
     when lower(coalesce(environment, '')) like '%tgt%' then 'tgt_test'::public.ediel_environment_type
     else 'agt_test'::public.ediel_environment_type
   end
 where to_regclass('public.ediel_route_profiles') is not null
   and environment_type is null;

alter table if exists public.ediel_test_runs
  add column if not exists environment_type public.ediel_environment_type not null default 'agt_test',
  add column if not exists production_mode text not null default 'disabled',
  add column if not exists unlinked_message_count integer not null default 0;

alter table if exists public.ediel_outbound_queue
  add column if not exists idempotency_key text,
  add column if not exists payload_size_bytes integer,
  add column if not exists split_batch_key text,
  add column if not exists original_business_batch_id uuid;

create unique index if not exists ediel_outbound_queue_company_idempotency_uidx
  on public.ediel_outbound_queue(company_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.ediel_test_run_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_role text not null,
  message_family text not null,
  environment_type public.ediel_environment_type not null,
  active_test_run_id uuid null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_test_run_locks_one_active_agt_uidx
  on public.ediel_test_run_locks(company_id, actor_role, message_family, environment_type)
  where released_at is null;

create table if not exists public.ediel_agt_readiness (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_role text not null,
  message_family text not null,
  test_resource_name text,
  test_resource_email text,
  test_resource_confirmed boolean not null default false,
  ediel_portal_login_confirmed boolean not null default false,
  application_system_selected boolean not null default false,
  edi_system_selected boolean not null default false,
  current_approval_version text,
  readiness_status text not null default 'not_ready',
  needs_retest boolean not null default false,
  retest_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, actor_role, message_family)
);

create table if not exists public.ediel_unlinked_test_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  environment_type public.ediel_environment_type not null default 'agt_test',
  message_family text,
  business_code text,
  sender_ediel_id text,
  receiver_ediel_id text,
  raw_payload_ref text,
  parsed_payload jsonb not null default '{}'::jsonb,
  candidate_test_run_ids uuid[] not null default array[]::uuid[],
  status text not null default 'unlinked',
  linked_test_run_id uuid null,
  linked_by uuid null,
  linked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.ediel_exchange_logs
  add column if not exists environment_type public.ediel_environment_type,
  add column if not exists payload_size_bytes integer,
  add column if not exists evidence_retention_until timestamptz;

alter table if exists public.ediel_dead_letter_items
  add column if not exists environment_type public.ediel_environment_type,
  add column if not exists replay_requires_approval boolean not null default false;

create index if not exists ediel_route_profiles_environment_type_idx
  on public.ediel_route_profiles(company_id, environment_type, message_family, business_code)
  where coalesce(is_active, true) = true and coalesce(is_enabled, true) = true;

create index if not exists ediel_test_runs_environment_type_idx
  on public.ediel_test_runs(company_id, environment_type, role_code, test_suite, test_case_code);

create index if not exists ediel_unlinked_test_messages_open_idx
  on public.ediel_unlinked_test_messages(environment_type, message_family, status)
  where status = 'unlinked';
