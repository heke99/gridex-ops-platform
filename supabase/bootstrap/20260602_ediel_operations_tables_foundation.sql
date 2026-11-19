-- Local047: exact three-table/index subset of immutable source 20260602143000.
-- Enum prerequisite: 20260602_ediel_environment_type_foundation.sql.
-- Later canonical 20260602152000 supplies hardening; forward repair completes ACLs.
-- No route changes, business rows, readiness or approval evidence are seeded.

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

create index if not exists ediel_unlinked_test_messages_open_idx
  on public.ediel_unlinked_test_messages(environment_type, message_family, status)
  where status = 'unlinked';
