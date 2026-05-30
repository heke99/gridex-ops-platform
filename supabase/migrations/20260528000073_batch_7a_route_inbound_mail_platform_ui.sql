-- Batch 7A — Smart Communication Route Engine + Ediel Separation + Inbound Mail + Platform UI
-- Idempotent schema foundation. No destructive operations.

-- -----------------------------------------------------------------------------
-- 1. Route/process fields and outbound/runtime coupling
-- -----------------------------------------------------------------------------
alter table if exists public.outbound_requests
  add column if not exists agreement_id uuid,
  add column if not exists grid_owner_access_agreement_id uuid,
  add column if not exists route_decision_payload jsonb not null default '{}'::jsonb,
  add column if not exists business_process text,
  add column if not exists message_intent text,
  add column if not exists message_family text,
  add column if not exists message_code text,
  add column if not exists message_version text,
  add column if not exists ediel_route_profile_id uuid,
  add column if not exists application_reference text,
  add column if not exists sender_ediel_id text,
  add column if not exists sender_sub_address text,
  add column if not exists receiver_ediel_id text,
  add column if not exists receiver_sub_address text,
  add column if not exists ack_policy jsonb not null default '{}'::jsonb,
  add column if not exists blocking_reasons jsonb not null default '[]'::jsonb,
  add column if not exists required_admin_actions jsonb not null default '[]'::jsonb;

alter table if exists public.ediel_messages
  add column if not exists message_intent text,
  add column if not exists route_scope text,
  add column if not exists route_decision_payload jsonb not null default '{}'::jsonb,
  add column if not exists inbound_email_message_id uuid,
  add column if not exists inbound_processing_job_id uuid;

alter table if exists public.communication_routes
  add column if not exists route_scope text not null default 'supplier_switch',
  add column if not exists route_group text,
  add column if not exists supported_message_families jsonb not null default '[]'::jsonb,
  add column if not exists supported_message_codes jsonb not null default '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- 2. Grid owner agreement module
-- -----------------------------------------------------------------------------
create table if not exists public.grid_owner_access_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  grid_owner_id uuid,
  agreement_type text not null default 'metering_access',
  agreement_scope text not null default 'metering_access',
  status text not null default 'draft',
  agreement_reference text,
  external_agreement_number text,
  valid_from date,
  valid_to date,
  signed_at timestamptz,
  document_id uuid,
  document_path text,
  requires_customer_authorization boolean not null default true,
  requires_metering_point_id boolean not null default true,
  requires_facility_id boolean not null default false,
  requires_customer_personal_number boolean not null default false,
  requires_report_period boolean not null default false,
  preferred_application_reference text,
  preferred_message_version text,
  preferred_receiver_ediel_id text,
  preferred_receiver_sub_address text,
  preferred_route_id uuid,
  reference_requirements jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_grid_owner_access_agreements_company_scope
  on public.grid_owner_access_agreements(company_id, grid_owner_id, agreement_scope, status);

create index if not exists idx_grid_owner_access_agreements_active_metering
  on public.grid_owner_access_agreements(company_id, grid_owner_id, agreement_type, status, valid_from, valid_to);

-- -----------------------------------------------------------------------------
-- 3. Route decision log and inbound mail tables
-- -----------------------------------------------------------------------------
create table if not exists public.route_decision_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  business_process text,
  requested_action text,
  message_family text,
  message_code text,
  environment text not null default 'test',
  decision_status text not null default 'manual_review',
  route_scope text,
  communication_route_id uuid,
  ediel_route_profile_id uuid,
  grid_owner_access_agreement_id uuid,
  application_reference text,
  message_version text,
  sender_ediel_id text,
  sender_sub_address text,
  receiver_ediel_id text,
  receiver_sub_address text,
  ack_policy jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  required_admin_actions jsonb not null default '[]'::jsonb,
  decision_trace jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_route_decision_logs_company_created
  on public.route_decision_logs(company_id, created_at desc);

create index if not exists idx_route_decision_logs_route_scope
  on public.route_decision_logs(company_id, route_scope, decision_status, created_at desc);

create table if not exists public.ediel_mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  mailbox_name text not null,
  email_address text,
  imap_host text,
  imap_port integer default 993,
  smtp_host text,
  smtp_port integer default 587,
  username text,
  secret_reference text,
  environment text not null default 'test',
  is_active boolean not null default true,
  poll_interval_minutes integer not null default 10,
  last_polled_at timestamptz,
  last_successful_poll_at timestamptz,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create index if not exists idx_ediel_mailboxes_company_active
  on public.ediel_mailboxes(company_id, is_active, environment);

create table if not exists public.inbound_email_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  mailbox_id uuid references public.ediel_mailboxes(id) on delete set null,
  internet_message_id text,
  from_address text,
  to_address text,
  subject text,
  received_at timestamptz,
  raw_email_path text,
  raw_email text,
  raw_edifact_payload text,
  body_text text,
  body_html text,
  has_attachments boolean not null default false,
  processing_status text not null default 'received',
  dedupe_key text,
  match_status text not null default 'not_checked',
  match_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_inbound_email_messages_mailbox_message
  on public.inbound_email_messages(mailbox_id, internet_message_id)
  where mailbox_id is not null and internet_message_id is not null;

create index if not exists idx_inbound_email_messages_company_status
  on public.inbound_email_messages(company_id, processing_status, created_at desc);

create table if not exists public.inbound_email_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  filename text,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  raw_text text,
  is_edifact_candidate boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_email_attachments_message
  on public.inbound_email_attachments(inbound_email_message_id);

create table if not exists public.inbound_ediel_parse_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  message_family text,
  message_code text,
  interchange_reference text,
  transaction_reference text,
  sender_ediel_id text,
  sender_sub_address text,
  receiver_ediel_id text,
  receiver_sub_address text,
  application_reference text,
  parse_status text not null default 'parsed',
  parsed_payload jsonb not null default '{}'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  raw_payload text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_ediel_parse_results_company_refs
  on public.inbound_ediel_parse_results(company_id, sender_ediel_id, receiver_ediel_id, interchange_reference, transaction_reference);

create table if not exists public.inbound_ediel_match_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  parse_result_id uuid references public.inbound_ediel_parse_results(id) on delete cascade,
  match_type text not null,
  match_status text not null default 'not_checked',
  matched_entity_type text,
  matched_entity_id uuid,
  confidence numeric,
  reasons jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_ediel_match_attempts_message
  on public.inbound_ediel_match_attempts(inbound_email_message_id, match_type, match_status);

create table if not exists public.inbound_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  mailbox_id uuid references public.ediel_mailboxes(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  status text not null default 'queued',
  step text,
  attempts_count integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inbound_processing_jobs_status
  on public.inbound_processing_jobs(status, created_at);

-- -----------------------------------------------------------------------------
-- 4. Safe dedupe/idempotency indexes from Batch 7A
-- -----------------------------------------------------------------------------
create unique index if not exists ux_outbound_batch7a_source_message_period
  on public.outbound_requests (
    company_id,
    coalesce(source_type, 'manual'),
    source_id,
    request_type,
    coalesce(message_code, ''),
    coalesce(period_start, '1900-01-01'::date),
    coalesce(period_end, '1900-01-01'::date)
  )
  where source_id is not null and status in ('queued','prepared','sent','acknowledged');

create unique index if not exists ux_ediel_batch7a_outbound_message
  on public.ediel_messages (
    company_id,
    outbound_request_id,
    message_family,
    coalesce(message_code, ''),
    receiver_ediel_id,
    coalesce(message_version, '')
  )
  where direction = 'outbound' and outbound_request_id is not null;

create unique index if not exists ux_ediel_batch7a_inbound_interchange
  on public.ediel_messages (
    company_id,
    sender_ediel_id,
    receiver_ediel_id,
    interchange_reference
  )
  where direction = 'inbound' and interchange_reference is not null;

create unique index if not exists ux_ediel_batch7a_inbound_transaction
  on public.ediel_messages (
    company_id,
    sender_ediel_id,
    transaction_reference,
    coalesce(message_code, '')
  )
  where direction = 'inbound' and transaction_reference is not null;

-- -----------------------------------------------------------------------------
-- 5. RLS policies. Platform technical tables stay platform-only; agreement data is tenant-readable but write-guarded.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'grid_owner_access_agreements',
    'route_decision_logs',
    'ediel_mailboxes',
    'inbound_email_messages',
    'inbound_email_attachments',
    'inbound_ediel_parse_results',
    'inbound_ediel_match_attempts',
    'inbound_processing_jobs'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);

      execute format('drop policy if exists %I on public.%I', t || '_service_role_all', t);
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        t || '_service_role_all', t
      );

      execute format('drop policy if exists %I on public.%I', t || '_platform_select', t);
      execute format(
        'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin())',
        t || '_platform_select', t
      );

      execute format('drop policy if exists %I on public.%I', t || '_platform_write', t);
      execute format(
        'create policy %I on public.%I for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
        t || '_platform_write', t
      );
    end if;
  end loop;
end $$;

-- Company admins may read high-level grid owner agreements for their tenant, but not technical mailbox/parser tables.
do $$
begin
  if to_regclass('public.grid_owner_access_agreements') is not null then
    drop policy if exists grid_owner_access_agreements_tenant_select on public.grid_owner_access_agreements;
    create policy grid_owner_access_agreements_tenant_select
      on public.grid_owner_access_agreements
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Keep readiness views aware of new Batch 7A tables when existing DB1 view exists.
-- -----------------------------------------------------------------------------
create or replace view public.gridex_batch7a_foundation_readiness_v as
with expected(table_name) as (
  values
    ('grid_owner_access_agreements'),
    ('route_decision_logs'),
    ('ediel_mailboxes'),
    ('inbound_email_messages'),
    ('inbound_email_attachments'),
    ('inbound_ediel_parse_results'),
    ('inbound_ediel_match_attempts'),
    ('inbound_processing_jobs')
), actual as (
  select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
)
select
  e.table_name,
  (a.table_name is not null) as exists_in_database
from expected e
left join actual a on a.table_name = e.table_name
order by e.table_name;
