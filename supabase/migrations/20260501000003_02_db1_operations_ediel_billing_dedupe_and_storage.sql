-- Gridex DB1 / 02 of 03
-- Kör efter 01. Skapar fullmakt/switch/outbound/billing/Ediel/audit/portal-kompletteringar, dedupe-index och storage buckets.
-- Ingen destruktiv dataoperation. Idempotent.

-- 5. Authorization, switch, outbound and billing operational tables
-- -----------------------------------------------------------------------------
create table if not exists public.powers_of_attorney (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  site_id uuid,
  metering_point_id uuid,
  scope text not null default 'supplier_switch',
  status text not null default 'draft',
  signed_at timestamptz,
  valid_from date,
  valid_to date,
  document_path text,
  document_hash text,
  reference text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_authorization_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  site_id uuid,
  metering_point_id uuid,
  power_of_attorney_id uuid,
  replaced_document_id uuid,
  document_type text not null default 'power_of_attorney',
  status text not null default 'uploaded',
  title text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text,
  file_path text,
  file_checksum text,
  upload_idempotency_key text,
  reference text,
  notes text,
  archived_reason text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);


create table if not exists public.power_of_attorney_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  power_of_attorney_id uuid references public.powers_of_attorney(id) on delete restrict,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  customer_contract_id uuid,
  scope_type text not null default 'supplier_switch',
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);



-- Compatibility columns for authorization tables that may already exist in live Supabase.
do $$
begin
  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney add column if not exists company_id uuid;
    alter table public.powers_of_attorney add column if not exists customer_id uuid;
    alter table public.powers_of_attorney add column if not exists site_id uuid;
    alter table public.powers_of_attorney add column if not exists metering_point_id uuid;
    alter table public.powers_of_attorney add column if not exists scope text default 'supplier_switch';
    alter table public.powers_of_attorney add column if not exists status text default 'draft';
    alter table public.powers_of_attorney add column if not exists signed_at timestamptz;
    alter table public.powers_of_attorney add column if not exists valid_from date;
    alter table public.powers_of_attorney add column if not exists valid_to date;
    alter table public.powers_of_attorney add column if not exists document_path text;
    alter table public.powers_of_attorney add column if not exists document_hash text;
    alter table public.powers_of_attorney add column if not exists reference text;
    alter table public.powers_of_attorney add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.powers_of_attorney add column if not exists created_at timestamptz default now();
    alter table public.powers_of_attorney add column if not exists updated_at timestamptz default now();
  end if;

  if to_regclass('public.power_of_attorney_scopes') is not null then
    alter table public.power_of_attorney_scopes add column if not exists company_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists power_of_attorney_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists customer_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists site_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists metering_point_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists customer_contract_id uuid;
    alter table public.power_of_attorney_scopes add column if not exists scope_type text default 'supplier_switch';
    alter table public.power_of_attorney_scopes add column if not exists status text default 'active';
    alter table public.power_of_attorney_scopes add column if not exists is_active boolean default true;
    alter table public.power_of_attorney_scopes add column if not exists valid_from date;
    alter table public.power_of_attorney_scopes add column if not exists valid_to date;
    alter table public.power_of_attorney_scopes add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.power_of_attorney_scopes add column if not exists created_at timestamptz default now();
    alter table public.power_of_attorney_scopes add column if not exists updated_at timestamptz default now();
  end if;
end $$;

create table if not exists public.supplier_switch_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid references public.customers(id),
  site_id uuid,
  metering_point_id uuid,
  power_of_attorney_id uuid,
  authorization_document_id uuid,
  request_type text not null default 'switch',
  status text not null default 'draft',
  requested_start_date date,
  current_supplier_name text,
  current_supplier_org_number text,
  incoming_supplier_name text,
  incoming_supplier_org_number text,
  grid_owner_id uuid,
  price_area_code text,
  validation_snapshot jsonb not null default '{}'::jsonb,
  external_reference text,
  submitted_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  paused_at timestamptz,
  paused_by uuid,
  pause_reason text,
  lifecycle_blocked boolean not null default false,
  lifecycle_block_source text,
  lifecycle_block_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  automation_origin text,
  automation_key text
);

create table if not exists public.supplier_switch_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  switch_request_id uuid references public.supplier_switch_requests(id) on delete restrict,
  event_type text not null,
  event_status text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.customer_operation_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  task_type text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  title text not null,
  description text,
  assigned_to uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.communication_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  route_name text not null,
  is_active boolean not null default true,
  route_scope text not null default 'supplier_switch',
  route_type text not null default 'ediel_partner',
  grid_owner_id uuid,
  target_system text,
  endpoint text,
  target_email text,
  auth_config jsonb not null default '{}'::jsonb,
  supported_payload_version text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.grid_owner_data_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  authorization_document_id uuid,
  request_scope text not null default 'customer_masterdata',
  status text not null default 'pending',
  requested_period_start date,
  requested_period_end date,
  external_reference text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  notes text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  readiness_status text default 'not_checked',
  readiness_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  automation_origin text,
  automation_key text
);

create table if not exists public.outbound_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  communication_route_id uuid,
  authorization_document_id uuid,
  request_type text not null,
  source_type text,
  source_id uuid,
  status text not null default 'queued',
  channel_type text not null default 'unresolved',
  payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  period_start date,
  period_end date,
  external_reference text,
  dispatch_batch_key text,
  attempts_count integer not null default 0,
  queued_at timestamptz not null default now(),
  prepared_at timestamptz,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  automation_origin text,
  automation_key text
);

create table if not exists public.outbound_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  outbound_request_id uuid references public.outbound_requests(id) on delete restrict,
  event_type text not null,
  event_status text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.metering_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  source_request_id uuid,
  grid_owner_id uuid,
  reading_type text not null default 'consumption',
  value_kwh numeric,
  quality_code text,
  read_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  source_system text not null default 'manual',
  raw_payload jsonb not null default '{}'::jsonb,
  source_ediel_message_id uuid,
  canonical_dedupe_key text,
  is_current boolean not null default true,
  previous_value_id uuid,
  replaced_by_value_id uuid,
  revision_number integer not null default 1,
  correction_reason text,
  value_status text default 'current',
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.billing_underlays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  source_request_id uuid,
  grid_owner_id uuid,
  underlay_month integer,
  underlay_year integer,
  status text not null default 'pending',
  total_kwh numeric,
  total_sek_ex_vat numeric,
  currency text not null default 'SEK',
  source_system text not null default 'manual',
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz,
  validated_at timestamptz,
  exported_at timestamptz,
  failure_reason text,
  readiness_status text default 'not_checked',
  readiness_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.billing_export_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  period_month text,
  target_system text,
  export_format text,
  status text not null default 'draft',
  rows_total integer not null default 0,
  rows_ready integer not null default 0,
  rows_blocked integer not null default 0,
  rows_exported integer not null default 0,
  blocker_summary jsonb not null default '[]'::jsonb,
  partner_response_log jsonb not null default '[]'::jsonb,
  last_partner_response_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.billing_export_run_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  export_run_id uuid references public.billing_export_runs(id) on delete restrict,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  billing_underlay_id uuid,
  source_type text,
  source_id uuid,
  period_start date,
  period_end date,
  status text not null default 'pending',
  blocker_reasons jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  billing_underlay_id uuid,
  export_kind text not null default 'billing_underlay',
  target_system text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  external_reference text,
  export_batch_key text,
  idempotency_key text,
  retry_count integer not null default 0,
  adapter_key text,
  payload_version text,
  partner_response_log jsonb not null default '[]'::jsonb,
  last_partner_response_at timestamptz,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- -----------------------------------------------------------------------------
-- 6. Ediel core tables and views
-- -----------------------------------------------------------------------------
create table if not exists public.ediel_actor_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  actor_name text not null,
  actor_ediel_id text not null,
  actor_role text not null default 'supplier',
  environment text not null default 'test',
  is_active boolean not null default true,
  sender_name text,
  sender_sub_address text,
  default_application_reference text,
  default_timezone integer not null default 1,
  default_charset text not null default 'UNOC:3',
  default_test_flag integer not null default 1,
  smtp_from_email text,
  smtp_reply_to_email text,
  mailbox text,
  brp_name text,
  brp_ediel_id text,
  brp_status text,
  esett_status text,
  valid_from date,
  valid_to date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_route_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  communication_route_id uuid,
  is_enabled boolean not null default true,
  sender_ediel_id text,
  sender_sub_address text,
  sender_name text,
  receiver_ediel_id text,
  receiver_sub_address text,
  receiver_name text,
  application_reference text,
  smtp_host text,
  smtp_port integer,
  imap_host text,
  imap_port integer,
  mailbox text,
  encryption_mode text default 'none',
  payload_format text not null default 'edifact',
  default_message_version text,
  default_test_flag integer not null default 1,
  default_timezone integer not null default 1,
  environment text not null default 'test',
  message_standard text not null default 'edifact',
  ack_mode text not null default 'default',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_message_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  message_family text not null,
  message_code text not null,
  message_standard text not null default 'edifact',
  version_code text not null,
  direction text not null default 'both',
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  supports_negative_response boolean not null default true,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  direction text not null,
  message_standard text not null default 'edifact',
  message_family text not null,
  message_code text,
  message_version text,
  process_type text,
  environment text not null default 'test',
  test_flag integer not null default 1,
  status text not null default 'draft',
  transport_type text not null default 'email',
  mailbox text,
  mailbox_message_id text,
  sender_ediel_id text,
  sender_name text,
  sender_sub_address text,
  receiver_ediel_id text,
  receiver_name text,
  receiver_sub_address text,
  sender_email text,
  receiver_email text,
  subject text,
  file_name text,
  mime_type text,
  interchange_reference text,
  external_reference text,
  correlation_reference text,
  transaction_reference text,
  application_reference text,
  original_message_id text,
  original_transaction_id text,
  original_message_code text,
  related_message_id uuid,
  communication_route_id uuid,
  outbound_request_id uuid,
  switch_request_id uuid,
  grid_owner_data_request_id uuid,
  partner_export_id uuid,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  raw_payload text,
  parsed_payload jsonb not null default '{}'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  contrl_status text,
  aperak_status text,
  utilts_err_status text,
  ack_outcome text,
  syntax_check_status text,
  functional_check_status text,
  failure_reason text,
  message_created_at timestamptz,
  message_received_at timestamptz,
  message_sent_at timestamptz,
  parsed_at timestamptz,
  validated_at timestamptz,
  acknowledged_at timestamptz,
  failed_at timestamptz,
  ack_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_message_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  ediel_message_id uuid references public.ediel_messages(id) on delete restrict,
  event_type text not null,
  event_status text not null default 'info',
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.ediel_message_validation_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  ediel_message_id uuid references public.ediel_messages(id) on delete restrict,
  issue_code text,
  severity text not null default 'warning',
  title text,
  description text,
  segment_ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_aperak_error_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  message_family text,
  message_code text,
  error_key text not null,
  erc_code text,
  ftx_code text,
  ftx_text text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_aperak_error_details (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  error_rule_id uuid references public.ediel_aperak_error_rules(id) on delete restrict,
  detail_key text,
  detail_value text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_inbound_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  ediel_message_id uuid references public.ediel_messages(id) on delete restrict,
  case_type text not null default 'unresolved',
  status text not null default 'open',
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  switch_request_id uuid,
  assigned_to uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_tgt_test_data (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  test_suite text not null,
  role_code text,
  test_case_code text not null,
  data_key text not null,
  data_value text,
  payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, test_suite, test_case_code, data_key)
);

-- Ediel runtime/reporting views expected by the app.
create or replace view public.ediel_active_actor_settings_v as
select *
from public.ediel_actor_settings
where coalesce(is_active, true) = true
  and (valid_from is null or valid_from <= current_date)
  and (valid_to is null or valid_to >= current_date);

create or replace view public.ediel_route_runtime_v as
select
  rp.*,
  cr.route_name,
  cr.route_scope,
  cr.route_type,
  cr.grid_owner_id as route_grid_owner_id,
  cr.target_system,
  cr.endpoint,
  cr.target_email,
  cr.auth_config,
  cr.supported_payload_version
from public.ediel_route_profiles rp
left join public.communication_routes cr on cr.id = rp.communication_route_id
where coalesce(rp.is_enabled, true) = true;

create or replace view public.ediel_message_ack_state_v as
select
  m.id,
  m.company_id,
  m.direction,
  m.message_family,
  coalesce(m.message_code, '') as message_code,
  m.message_version,
  m.status,
  m.environment,
  coalesce(m.requires_contrl, false) as requires_contrl,
  coalesce(m.requires_aperak, false) as requires_aperak,
  m.contrl_status,
  m.aperak_status,
  m.utilts_err_status,
  m.ack_due_at,
  m.message_sent_at,
  m.message_received_at,
  m.acknowledged_at,
  m.failed_at,
  case
    when m.status = 'failed' then 'failed'
    when coalesce(m.requires_contrl,false) and coalesce(m.contrl_status,'pending') = 'pending' then 'awaiting_contrl'
    when coalesce(m.contrl_status,'') = 'failed' then 'contrl_failed'
    when coalesce(m.requires_aperak,false) and coalesce(m.aperak_status,'pending') = 'pending' then 'awaiting_aperak'
    when m.aperak_status = 'received' and m.ack_outcome = 'negative' then 'aperak_received_negative'
    when m.aperak_status = 'received' and m.ack_outcome = 'positive' then 'aperak_received_positive'
    when coalesce(m.utilts_err_status,'') = 'received' then 'utilts_err_received'
    when m.ack_due_at is not null and m.ack_due_at < now() and m.acknowledged_at is null then 'ack_overdue'
    when not coalesce(m.requires_contrl,false) and not coalesce(m.requires_aperak,false) then 'no_ack_required'
    else 'in_progress'
  end as canonical_ack_state
from public.ediel_messages m;

create or replace view public.ediel_overdue_message_acks_v as
select *
from public.ediel_message_ack_state_v
where canonical_ack_state = 'ack_overdue';

create or replace view public.ediel_duplicate_ack_candidates_v as
select
  company_id,
  related_message_id,
  message_family as ack_family,
  transaction_reference,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as message_ids
from public.ediel_messages
where related_message_id is not null
  and message_family in ('APERAK','CONTRL','UTILTS_ERR')
group by company_id, related_message_id, message_family, transaction_reference
having count(*) > 1;

create or replace view public.ediel_rule_ambiguities_v as
select
  company_id,
  message_family,
  message_code,
  message_standard,
  version_code,
  direction,
  count(*) as rule_count
from public.ediel_message_rules
where coalesce(is_active,true) = true
group by company_id, message_family, message_code, message_standard, version_code, direction
having count(*) > 1;

-- -----------------------------------------------------------------------------
-- 7. Audit and customer portal companion tables
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  actor_user_id uuid,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid,
  customer_id uuid,
  status text not null default 'active',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_portal_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  user_id uuid,
  claim_type text not null default 'customer_access',
  status text not null default 'pending',
  token_hash text,
  claimed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_portal_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_id uuid,
  user_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);


create table if not exists public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid,
  customer_id uuid,
  document_type text default 'customer_document',
  title text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_bucket text,
  file_path text,
  public_url text,
  source_system text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  user_id uuid,
  customer_id uuid,
  agreement_id uuid,
  billing_underlay_id uuid,
  partner_export_id uuid,
  partner_invoice_reference text,
  invoice_number text,
  period_start date,
  period_end date,
  total_kwh numeric,
  amount_ex_vat numeric,
  vat_amount numeric,
  amount_inc_vat numeric,
  currency text not null default 'SEK',
  due_date date,
  issued_at timestamptz,
  paid_at timestamptz,
  status text not null default 'draft',
  pdf_path text,
  pdf_url text,
  source_system text not null default 'manual',
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customer_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  invoice_id uuid,
  customer_id uuid,
  description text,
  quantity numeric,
  unit_price numeric,
  amount_ex_vat numeric,
  vat_amount numeric,
  amount_inc_vat numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  invoice_id uuid,
  customer_id uuid,
  storage_bucket text,
  file_path text,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 8. Compatibility column hardening for existing tables
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','customer_addresses','customer_contacts','customer_internal_notes','customer_sites','metering_points',
    'powers_of_attorney','customer_authorization_documents','supplier_switch_requests','supplier_switch_events',
    'customer_operation_tasks','communication_routes','grid_owner_data_requests','outbound_requests','outbound_dispatch_events',
    'metering_values','billing_underlays','billing_export_runs','billing_export_run_items','partner_exports',
    'ediel_actor_settings','ediel_route_profiles','ediel_message_rules','ediel_messages','ediel_message_events',
    'ediel_message_validation_issues','ediel_aperak_error_rules','ediel_aperak_error_details','ediel_inbound_cases','ediel_tgt_test_data',
    'audit_logs','customer_portal_accounts','customer_portal_claims','customer_portal_events','customer_invoice_lines','customer_invoice_documents'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid', t);
      execute format('alter table public.%I add column if not exists metadata jsonb default ''{}''::jsonb', t);
      execute format('alter table public.%I add column if not exists created_at timestamptz default now()', t);
      execute format('alter table public.%I add column if not exists updated_at timestamptz default now()', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Safe dedupe/index foundation
-- -----------------------------------------------------------------------------
select public.gridex_db1_try_exec('dedupe_index','companies_slug',
  'create unique index if not exists ux_companies_slug on public.companies (lower(coalesce(slug, company_slug))) where coalesce(slug, company_slug) is not null');
select public.gridex_db1_try_exec('dedupe_index','companies_org_number',
  'create unique index if not exists ux_companies_normalized_org on public.companies (normalized_org_number) where normalized_org_number is not null');
select public.gridex_db1_try_exec('dedupe_index','company_memberships_company_user',
  'create unique index if not exists ux_company_memberships_company_user on public.company_memberships (company_id, user_id)');
select public.gridex_db1_try_exec('dedupe_index','customers_customer_number',
  'create unique index if not exists ux_customers_company_customer_number on public.customers (company_id, customer_number) where customer_number is not null');
select public.gridex_db1_try_exec('dedupe_index','customers_personal_number',
  'create unique index if not exists ux_customers_company_personal_number on public.customers (company_id, normalized_personal_number) where normalized_personal_number is not null');
select public.gridex_db1_try_exec('dedupe_index','customers_email',
  'create unique index if not exists ux_customers_company_email on public.customers (company_id, normalized_email) where normalized_email is not null');
select public.gridex_db1_try_exec('dedupe_index','customer_sites_facility',
  'create unique index if not exists ux_customer_sites_company_facility on public.customer_sites (company_id, normalized_facility_id) where normalized_facility_id is not null');
select public.gridex_db1_try_exec('dedupe_index','metering_points_meter_id',
  'create unique index if not exists ux_metering_points_company_meter_id on public.metering_points (company_id, normalized_metering_point_id) where normalized_metering_point_id is not null');
select public.gridex_db1_try_exec('dedupe_index','powers_of_attorney_doc_hash',
  'create unique index if not exists ux_poa_company_customer_document_hash on public.powers_of_attorney (company_id, customer_id, document_hash) where document_hash is not null');
select public.gridex_db1_try_exec('dedupe_index','supplier_switch_requests_dedupe',
  'create unique index if not exists ux_switch_company_meter_start_contract on public.supplier_switch_requests (company_id, metering_point_id, requested_start_date, coalesce((metadata->>''customer_contract_id'')::text, '''')) where metering_point_id is not null and requested_start_date is not null');
select public.gridex_db1_try_exec('dedupe_index','ediel_messages_inbound_interchange',
  'create unique index if not exists ux_ediel_inbound_interchange on public.ediel_messages (company_id, direction, sender_ediel_id, receiver_ediel_id, interchange_reference) where direction = ''inbound'' and interchange_reference is not null');
select public.gridex_db1_try_exec('dedupe_index','ediel_messages_outbound_source',
  'create unique index if not exists ux_ediel_outbound_source on public.ediel_messages (company_id, direction, outbound_request_id, message_family, coalesce(message_code,''''), receiver_ediel_id, coalesce(message_version,'''')) where direction = ''outbound'' and outbound_request_id is not null');
select public.gridex_db1_try_exec('dedupe_index','ediel_ack_dedupe',
  'create unique index if not exists ux_ediel_ack_related on public.ediel_messages (company_id, related_message_id, message_family, coalesce(transaction_reference,'''')) where related_message_id is not null and message_family in (''APERAK'',''CONTRL'',''UTILTS_ERR'')');
select public.gridex_db1_try_exec('dedupe_index','billing_export_items_dedupe',
  'create unique index if not exists ux_billing_export_items_source_period on public.billing_export_run_items (company_id, export_run_id, source_type, source_id, period_start, period_end) where source_type is not null and source_id is not null');
select public.gridex_db1_try_exec('dedupe_index','outbound_request_active_dedupe',
  'create unique index if not exists ux_outbound_active_source_request on public.outbound_requests (company_id, source_type, source_id, request_type, coalesce(period_start, ''1900-01-01''::date), coalesce(period_end, ''1900-01-01''::date)) where status in (''queued'',''prepared'',''sent'',''acknowledged'') and source_type is not null and source_id is not null');

-- Supporting non-unique indexes
create index if not exists idx_customers_company on public.customers(company_id);
create index if not exists idx_customer_sites_company_customer on public.customer_sites(company_id, customer_id);
create index if not exists idx_metering_points_company_site on public.metering_points(company_id, site_id);
create index if not exists idx_ediel_messages_company_status on public.ediel_messages(company_id, status, created_at desc);
create index if not exists idx_ediel_messages_related on public.ediel_messages(related_message_id);
create index if not exists idx_outbound_requests_company_status on public.outbound_requests(company_id, status, created_at desc);
create index if not exists idx_supplier_switch_company_status on public.supplier_switch_requests(company_id, status, created_at desc);
create index if not exists idx_audit_logs_company_entity on public.audit_logs(company_id, entity_type, entity_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 10. Storage bucket foundation. Policies stay in DB2 after app paths are verified.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('customer-documents', 'customer-documents', false, 52428800, array['application/pdf','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('contract-pdfs', 'contract-pdfs', false, 52428800, array['application/pdf']::text[]),
  ('customer-intake', 'customer-intake', false, 52428800, array['application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('billing-imports', 'billing-imports', false, 52428800, array['text/csv','application/json','application/xml','text/xml','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('billing-exports', 'billing-exports', false, 52428800, array['text/csv','application/json','application/xml','text/xml','application/pdf']::text[]),
  ('ediel-files', 'ediel-files', false, 52428800, array['application/EDIFACT','text/plain','application/octet-stream','message/rfc822']::text[]),
  ('actor-test-evidence', 'actor-test-evidence', false, 52428800, array['application/pdf','image/png','image/jpeg','text/plain','application/json']::text[])
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
