-- Gridex canonical Ediel completion and platform contract.
-- This migration is intentionally fail-closed. It establishes one global rule-pack
-- source, tenant-owned transport/routing configuration, immutable execution context,
-- transaction coverage, business correlation, and a deployment schema gate.

begin;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Global normative Ediel data. Tenants may read active rules but never mutate.
-- ---------------------------------------------------------------------------
create table if not exists public.ediel_rule_packs (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market = 'electricity'),
  family text not null check (family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR')),
  guide_version text not null,
  guide_revision text not null,
  unh_association_code text not null,
  valid_from date not null,
  valid_to date,
  status text not null check (status in ('draft','active','transition','future','retired')),
  source_document text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  field_matrix_version text,
  code_list_versions jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  unique (market,family,guide_version,guide_revision,valid_from)
);

create unique index if not exists ediel_rule_packs_one_active_window_uidx
  on public.ediel_rule_packs(family,valid_from,coalesce(valid_to,'infinity'::date),guide_version,guide_revision)
  where status in ('active','transition','future');

create table if not exists public.ediel_rule_pack_sources (
  id uuid primary key default gen_random_uuid(),
  rule_pack_id uuid not null references public.ediel_rule_packs(id) on delete cascade,
  source_type text not null check (source_type in ('law','market_handbook','technical_guide','general_guide','field_matrix','code_list','bilateral','example','tgt','agt')),
  priority integer not null check (priority between 1 and 9),
  title text not null,
  revision text,
  valid_from date,
  valid_to date,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  source_locator text,
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists ediel_rule_pack_sources_identity_uidx
  on public.ediel_rule_pack_sources(rule_pack_id,source_type,title,coalesce(revision,''));

create table if not exists public.ediel_message_profiles (
  id uuid primary key default gen_random_uuid(),
  rule_pack_id uuid not null references public.ediel_rule_packs(id) on delete cascade,
  message_code text not null,
  transaction_subtype text not null default '',
  direction text not null check(direction in ('inbound','outbound','both')),
  business_process text not null,
  phase text,
  profile_key text not null,
  profile jsonb not null,
  is_enabled boolean not null default true,
  unique(rule_pack_id,message_code,transaction_subtype,direction)
);

create table if not exists public.ediel_segment_rules (
  id uuid primary key default gen_random_uuid(),
  message_profile_id uuid not null references public.ediel_message_profiles(id) on delete cascade,
  segment_tag text not null,
  sequence_no integer not null check(sequence_no > 0),
  min_occurs integer not null default 0 check(min_occurs >= 0),
  max_occurs integer check(max_occurs is null or max_occurs >= min_occurs),
  condition jsonb not null default '{}'::jsonb,
  unique(message_profile_id,segment_tag,sequence_no)
);

create table if not exists public.ediel_field_rules (
  id uuid primary key default gen_random_uuid(),
  message_profile_id uuid not null references public.ediel_message_profiles(id) on delete cascade,
  segment_tag text not null,
  element_path text not null,
  classification text not null check(classification in ('R','D','O','X','N')),
  min_length integer,
  max_length integer,
  data_type text,
  code_list_key text,
  condition jsonb not null default '{}'::jsonb,
  unique(message_profile_id,segment_tag,element_path)
);

create table if not exists public.ediel_ack_rules (
  id uuid primary key default gen_random_uuid(),
  rule_pack_id uuid not null references public.ediel_rule_packs(id) on delete cascade,
  inbound_family text not null,
  message_code text not null default '*',
  transaction_subtype text not null default '*',
  syntax_response text not null check(syntax_response in ('none','CONTRL')),
  application_response text not null check(application_response in ('none','APERAK','APERAK_OR_UTILTS_ERR')),
  business_response text,
  deadline_minutes integer not null check(deadline_minutes between 1 and 1440),
  transaction_coverage_required boolean not null default false,
  policy jsonb not null default '{}'::jsonb,
  unique(rule_pack_id,inbound_family,message_code,transaction_subtype)
);

-- Compatibility upgrade: earlier Gridex migrations already created
-- public.ediel_ack_rules with the legacy rulebook shape. CREATE TABLE IF NOT
-- EXISTS does not add the canonical columns to that table, so upgrade it in
-- place while preserving all legacy columns and rows.
alter table public.ediel_ack_rules
  add column if not exists rule_pack_id uuid references public.ediel_rule_packs(id) on delete cascade,
  add column if not exists inbound_family text,
  add column if not exists transaction_subtype text default '*',
  add column if not exists syntax_response text,
  add column if not exists application_response text,
  add column if not exists business_response text,
  add column if not exists deadline_minutes integer,
  add column if not exists transaction_coverage_required boolean default false,
  add column if not exists policy jsonb default '{}'::jsonb;

-- Canonical rows do not use the legacy identity columns. They must therefore
-- be nullable when the table originated from the old rulebook migrations.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='message_family'
  ) then
    execute 'alter table public.ediel_ack_rules alter column message_family drop not null';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='rule_key'
  ) then
    execute 'alter table public.ediel_ack_rules alter column rule_key drop not null';
  end if;
end $$;

-- Map legacy rows to the canonical read shape without assigning a rule pack.
-- Legacy rows remain legacy (rule_pack_id is NULL); newly seeded canonical
-- rows always have a concrete rule_pack_id.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='message_family'
  ) then
    execute $sql$
      update public.ediel_ack_rules
      set inbound_family = coalesce(nullif(trim(inbound_family),''), nullif(trim(message_family),''))
      where inbound_family is null or trim(inbound_family)=''
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='requires_contrl'
  ) then
    execute $sql$
      update public.ediel_ack_rules
      set syntax_response = case when coalesce(requires_contrl,true) then 'CONTRL' else 'none' end
      where syntax_response is null
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='requires_utilts_err'
  ) then
    execute $sql$
      update public.ediel_ack_rules
      set application_response = case
        when coalesce(requires_utilts_err,false) then 'APERAK_OR_UTILTS_ERR'
        when coalesce(requires_aperak,false) then 'APERAK'
        else 'none'
      end
      where application_response is null
    $sql$;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='send_utilts_err_on_functional_error'
  ) then
    execute $sql$
      update public.ediel_ack_rules
      set application_response = case
        when coalesce(send_utilts_err_on_functional_error,false) then 'APERAK_OR_UTILTS_ERR'
        when coalesce(requires_aperak,false) then 'APERAK'
        else 'none'
      end
      where application_response is null
    $sql$;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='requires_aperak'
  ) then
    execute $sql$
      update public.ediel_ack_rules
      set application_response = case when coalesce(requires_aperak,false) then 'APERAK' else 'none' end
      where application_response is null
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ediel_ack_rules' and column_name='ack_deadline_minutes'
  ) then
    execute $sql$
      update public.ediel_ack_rules
      set deadline_minutes = coalesce(ack_deadline_minutes,30)
      where deadline_minutes is null
    $sql$;
  end if;
end $$;

update public.ediel_ack_rules
set transaction_subtype = coalesce(nullif(trim(transaction_subtype),''),'*'),
    syntax_response = coalesce(syntax_response,'CONTRL'),
    application_response = coalesce(application_response,'none'),
    deadline_minutes = coalesce(deadline_minutes,30),
    transaction_coverage_required = coalesce(transaction_coverage_required,false),
    policy = coalesce(policy,'{}'::jsonb);

do $$
begin
  if exists (
    select 1 from public.ediel_ack_rules
    where inbound_family is null or trim(inbound_family)=''
       or syntax_response not in ('none','CONTRL')
       or application_response not in ('none','APERAK','APERAK_OR_UTILTS_ERR')
       or deadline_minutes not between 1 and 1440
  ) then
    raise exception 'ediel_ack_rules_legacy_upgrade_invalid';
  end if;
end $$;

alter table public.ediel_ack_rules
  alter column inbound_family set not null,
  alter column transaction_subtype set default '*',
  alter column transaction_subtype set not null,
  alter column syntax_response set not null,
  alter column application_response set not null,
  alter column deadline_minutes set not null,
  alter column transaction_coverage_required set default false,
  alter column transaction_coverage_required set not null,
  alter column policy set default '{}'::jsonb,
  alter column policy set not null;

create unique index if not exists ediel_ack_rules_canonical_uidx
  on public.ediel_ack_rules(rule_pack_id,inbound_family,message_code,transaction_subtype);

create table if not exists public.ediel_runtime_capabilities (
  id uuid primary key default gen_random_uuid(),
  rule_pack_id uuid not null references public.ediel_rule_packs(id) on delete cascade,
  message_code text not null,
  transaction_subtype text not null default '',
  direction text not null check(direction in ('inbound','outbound','both')),
  parser_ready boolean not null default false,
  builder_ready boolean not null default false,
  validator_ready boolean not null default false,
  ack_ready boolean not null default false,
  state_machine_ready boolean not null default false,
  route_required boolean not null default true,
  certificate_required boolean not null default true,
  verification jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(rule_pack_id,message_code,transaction_subtype,direction)
);

create table if not exists public.ediel_error_rules (
  id uuid primary key default gen_random_uuid(),
  rule_pack_id uuid not null references public.ediel_rule_packs(id) on delete cascade,
  layer text not null check(layer in ('syntax','guide','processability','business')),
  error_code text not null,
  response_family text not null check(response_family in ('CONTRL','APERAK','UTILTS_ERR','PRODAT','NONE')),
  severity text not null check(severity in ('warning','error','critical')),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  unique(rule_pack_id,layer,error_code)
);

create table if not exists public.ediel_code_lists (
  id uuid primary key default gen_random_uuid(),
  list_key text not null,
  version text not null,
  valid_from date not null,
  valid_to date,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  unique(list_key,version,valid_from)
);

create table if not exists public.ediel_code_list_values (
  id uuid primary key default gen_random_uuid(),
  code_list_id uuid not null references public.ediel_code_lists(id) on delete cascade,
  code text not null,
  description text not null,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  unique(code_list_id,code)
);

create table if not exists public.ediel_timeseries_products (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version text not null,
  family text not null default 'UTILTS' check(family='UTILTS'),
  message_codes text[] not null,
  phase text not null check(phase in ('planning','metering','settlement')),
  unit text not null,
  sign_rule text not null,
  resolution text not null,
  required_dimensions jsonb not null default '{}'::jsonb,
  allowed_sender_roles text[] not null,
  allowed_receiver_roles text[] not null,
  valid_from date not null,
  valid_to date,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  unique(code,version,valid_from)
);

create table if not exists public.ediel_product_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version text not null,
  family text not null,
  message_codes text[] not null,
  description text not null,
  valid_from date not null,
  valid_to date,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  unique(code,version,valid_from)
);

create table if not exists public.ediel_business_process_rules (
  id uuid primary key default gen_random_uuid(),
  rule_pack_id uuid not null references public.ediel_rule_packs(id) on delete cascade,
  business_process text not null,
  message_code text not null,
  transaction_subtype text not null default '',
  source_state text not null,
  target_state text not null,
  deadline_policy jsonb not null default '{}'::jsonb,
  action_policy jsonb not null default '{}'::jsonb,
  unique(rule_pack_id,business_process,message_code,transaction_subtype,source_state)
);

-- ---------------------------------------------------------------------------
-- 2. Tenant-owned Ediel configuration. No global sender/route/certificate rows.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_ediel_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  market text not null default 'electricity' check(market='electricity'),
  is_enabled boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique(company_id,environment,market,valid_from)
);

create table if not exists public.tenant_actor_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  actor_id uuid not null,
  identifier_type text not null,
  identifier_value text not null,
  qualifier text,
  subaddress text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz
);
create unique index if not exists tenant_actor_identifiers_identity_uidx
  on public.tenant_actor_identifiers(company_id,environment,identifier_type,identifier_value,coalesce(subaddress,''));

create table if not exists public.tenant_actor_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  actor_id uuid not null,
  role_code text not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique(company_id,environment,actor_id,role_code,valid_from)
);

create table if not exists public.tenant_message_capabilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  message_family text not null,
  message_code text not null,
  transaction_subtype text not null default '*',
  direction text not null check(direction in ('inbound','outbound','both')),
  business_process text,
  is_enabled boolean not null default false,
  bilateral boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check(valid_to is null or valid_to >= valid_from),
  unique(company_id,environment,message_family,message_code,transaction_subtype,direction,valid_from)
);
create unique index if not exists tenant_message_capabilities_active_uidx
  on public.tenant_message_capabilities(company_id,environment,message_family,message_code,transaction_subtype,direction)
  where is_enabled and valid_to is null;

create table if not exists public.tenant_communication_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  profile_name text not null,
  transport_type text not null,
  mime_type text not null,
  charset text not null default 'UNOC',
  is_enabled boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique(company_id,environment,profile_name,valid_from)
);

create table if not exists public.tenant_application_reference_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  message_family text not null,
  business_process text not null,
  sender_role text not null,
  receiver_role text not null,
  application_reference text not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique(company_id,environment,message_family,business_process,sender_role,receiver_role,valid_from)
);

create table if not exists public.tenant_mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  mailbox_address text not null,
  provider text not null,
  secret_reference text not null,
  is_enabled boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique(company_id,environment,mailbox_address,valid_from)
);

create table if not exists public.tenant_certificate_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  certificate_id text not null,
  fingerprint text not null,
  serial_number text,
  subject text,
  issuer text,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  chain jsonb not null default '[]'::jsonb,
  revocation_status text not null default 'unknown',
  secret_reference text not null,
  is_enabled boolean not null default false,
  check(valid_to > valid_from),
  unique(company_id,environment,certificate_id),
  unique(company_id,environment,fingerprint)
);

create table if not exists public.tenant_counterparty_relations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  counterparty_actor_id uuid not null,
  relation_type text not null,
  is_enabled boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique(company_id,environment,counterparty_actor_id,relation_type,valid_from)
);

create table if not exists public.tenant_counterparty_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  counterparty_relation_id uuid not null references public.tenant_counterparty_relations(id) on delete cascade,
  communication_route_id uuid not null references public.communication_routes(id) on delete restrict,
  route_profile_id uuid not null,
  certificate_profile_id uuid references public.tenant_certificate_profiles(id) on delete restrict,
  message_family text not null,
  message_code text not null default '*',
  transaction_subtype text not null default '*',
  business_process text not null,
  sender_role text not null,
  receiver_role text not null,
  grid_area_code text,
  is_enabled boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique(company_id,environment,counterparty_relation_id,message_family,message_code,transaction_subtype,business_process,valid_from)
);

create table if not exists public.tenant_bilateral_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  counterparty_actor_id uuid not null,
  capability_code text not null,
  terms jsonb not null,
  is_enabled boolean not null default false,
  valid_from timestamptz not null,
  valid_to timestamptz,
  source_reference text not null,
  unique(company_id,environment,counterparty_actor_id,capability_code,valid_from)
);

-- ---------------------------------------------------------------------------
-- 3. Operational coverage, correlation and immutable context.
-- ---------------------------------------------------------------------------
create table if not exists public.ediel_inbound_quarantine (
  id uuid primary key default gen_random_uuid(),
  environment text check (environment in ('test','production')),
  mailbox_id uuid,
  inbound_email_message_id uuid,
  internet_message_id text not null default '',
  raw_payload text not null,
  payload_hash text not null,
  sender_ediel_id text,
  sender_subaddress text,
  receiver_ediel_id text,
  receiver_subaddress text,
  application_reference text,
  interchange_reference text not null default '',
  message_family text,
  message_code text,
  tenant_resolution_status text not null check (tenant_resolution_status in ('tenant_unresolved','tenant_ambiguous')),
  candidate_company_ids uuid[] not null default '{}'::uuid[],
  resolution_evidence jsonb not null default '{}'::jsonb,
  status text not null default 'manual_review' check(status in ('manual_review','assigned','released','rejected','expired')),
  assigned_company_id uuid references public.companies(id) on delete restrict,
  assigned_by uuid,
  assigned_at timestamptz,
  delete_after timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(environment,payload_hash,internet_message_id,interchange_reference)
);
create index if not exists ediel_inbound_quarantine_review_idx
  on public.ediel_inbound_quarantine(status,created_at)
  where status in ('manual_review','assigned');

alter table if exists public.ediel_unresolved_items
  add column if not exists inbound_quarantine_id uuid references public.ediel_inbound_quarantine(id) on delete cascade;
create index if not exists ediel_unresolved_items_quarantine_idx
  on public.ediel_unresolved_items(inbound_quarantine_id)
  where inbound_quarantine_id is not null;

create table if not exists public.ediel_ack_transaction_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  source_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  source_transaction_id text not null,
  syntax_result text not null check(syntax_result in ('pending','positive','negative')),
  guide_validation_result text not null check(guide_validation_result in ('pending','positive','negative')),
  processability_result text not null check(processability_result in ('pending','positive','negative','not_applicable')),
  final_response_type text check(final_response_type in ('positive_aperak','negative_aperak','utilts_err')),
  response_message_id uuid references public.ediel_messages(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,environment,source_message_id,source_transaction_id),
  check((final_response_type is null and finalized_at is null and response_message_id is null)
     or (final_response_type is not null and finalized_at is not null and response_message_id is not null))
);

create table if not exists public.ediel_business_correlations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  family text not null,
  message_code text not null,
  transaction_subtype text,
  sender_ediel_id text not null,
  receiver_ediel_id text not null,
  interchange_reference text not null default '',
  message_reference text,
  business_document_reference text,
  transaction_reference text,
  case_reference text,
  application_reference text,
  original_message_reference text,
  original_transaction_reference text,
  business_operation_id text not null,
  related_ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  correlation_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique(company_id,environment,correlation_fingerprint)
);

create table if not exists public.ediel_business_expectations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  source_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  source_operation_id text not null,
  expected_family text not null,
  expected_code text not null,
  expected_subtype text,
  expected_case_reference text,
  due_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','fulfilled','rejected','timeout','manual_review','cancelled')),
  fulfilled_by_message_id uuid references public.ediel_messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ediel_business_expectations_identity_uidx
  on public.ediel_business_expectations(company_id,environment,source_message_id,expected_family,expected_code,coalesce(expected_subtype,''));

alter table public.ediel_messages
  add column if not exists canonical_rule_pack_id uuid references public.ediel_rule_packs(id) on delete restrict,
  add column if not exists route_profile_id uuid,
  add column if not exists certificate_profile_id uuid,
  add column if not exists business_date date,
  add column if not exists source_operation_id text,
  add column if not exists immutable_payload_hash text,
  add column if not exists immutable_rendered_at timestamptz;

alter table public.ediel_outbox
  add column if not exists immutable_payload_hash text,
  add column if not exists generation integer not null default 1 check(generation > 0);

-- Idempotent historical rule-pack backfill. Business messages bind by family
-- and business date; ACKs inherit the exact pack from their source message.
update public.ediel_messages m
set business_date=coalesce(m.business_date,(coalesce(m.message_created_at,m.created_at) at time zone 'Europe/Stockholm')::date),
    canonical_rule_pack_id=rp.id
from public.ediel_rule_packs rp
where m.canonical_rule_pack_id is null
  and m.message_family in ('PRODAT','UTILTS')
  and rp.family=m.message_family
  and coalesce(m.business_date,(coalesce(m.message_created_at,m.created_at) at time zone 'Europe/Stockholm')::date) >= rp.valid_from
  and (rp.valid_to is null or coalesce(m.business_date,(coalesce(m.message_created_at,m.created_at) at time zone 'Europe/Stockholm')::date) <= rp.valid_to)
  and rp.status in ('active','transition','future');

update public.ediel_messages ack
set canonical_rule_pack_id=source.canonical_rule_pack_id,
    business_date=coalesce(ack.business_date,source.business_date)
from public.ediel_messages source
where ack.canonical_rule_pack_id is null
  and ack.related_message_id=source.id
  and ack.message_family in ('CONTRL','APERAK','UTILTS_ERR')
  and source.canonical_rule_pack_id is not null;

create table if not exists public.ediel_rule_pack_backfill_issues (
  id uuid primary key default gen_random_uuid(),
  ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  issue_code text not null,
  snapshot jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(ediel_message_id,issue_code)
);
insert into public.ediel_rule_pack_backfill_issues(ediel_message_id,company_id,issue_code,snapshot)
select m.id,m.company_id,'canonical_rule_pack_unresolved',jsonb_build_object(
  'family',m.message_family,'code',m.message_code,'subtype',m.message_subtype,'direction',m.direction,
  'businessDate',m.business_date,'relatedMessageId',m.related_message_id)
from public.ediel_messages m
where m.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR') and m.canonical_rule_pack_id is null
on conflict(ediel_message_id,issue_code) do update set snapshot=excluded.snapshot,resolved_at=null;

create or replace function public.gridex_validate_ediel_message_contract()
returns trigger language plpgsql set search_path=public as $$
declare v_canonical boolean;
begin
  v_canonical := upper(coalesce(new.message_family,'')) in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR');
  if v_canonical then
    if new.company_id is null then raise exception 'canonical_ediel_company_required' using errcode='23502'; end if;
    if nullif(btrim(coalesce(new.environment,'')),'') is null then raise exception 'canonical_ediel_environment_required' using errcode='23502'; end if;
    if new.direction='outbound' then
      if new.canonical_rule_pack_id is null then raise exception 'canonical_ediel_rule_pack_required' using errcode='23502'; end if;
      if new.communication_route_id is null then raise exception 'canonical_ediel_route_required' using errcode='23502'; end if;
      if new.route_profile_id is null and nullif(new.execution_context_snapshot->>'routeProfileId','') is null then raise exception 'canonical_ediel_route_profile_required' using errcode='23502'; end if;
      if nullif(btrim(coalesce(new.application_reference,'')),'') is null then raise exception 'canonical_ediel_application_reference_required' using errcode='23502'; end if;
      if nullif(btrim(coalesce(new.source_operation_id,new.execution_context_snapshot->>'sourceOperationId','')),'') is null then raise exception 'canonical_ediel_source_operation_required' using errcode='23502'; end if;
      if new.raw_payload is not null and nullif(btrim(new.raw_payload),'') is not null then
        new.immutable_payload_hash := encode(digest(convert_to(new.raw_payload,'UTF8'),'sha256'),'hex');
        new.immutable_rendered_at := coalesce(new.immutable_rendered_at,now());
      end if;
    end if;
  end if;
  if tg_op='UPDATE' and old.immutable_payload_hash is not null then
    if new.raw_payload is distinct from old.raw_payload or new.immutable_payload_hash is distinct from old.immutable_payload_hash then
      raise exception 'immutable_ediel_payload_cannot_change' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ediel_messages_canonical_contract_biu on public.ediel_messages;
create trigger ediel_messages_canonical_contract_biu
before insert or update on public.ediel_messages
for each row execute function public.gridex_validate_ediel_message_contract();

create or replace function public.gridex_validate_ediel_outbox_contract()
returns trigger language plpgsql set search_path=public as $$
declare v_message public.ediel_messages%rowtype;
begin
  select * into v_message from public.ediel_messages where id=new.ediel_message_id for share;
  if not found then raise exception 'ediel_outbox_message_missing' using errcode='23503'; end if;
  if v_message.company_id is null or new.company_id is null or v_message.company_id<>new.company_id then
    raise exception 'ediel_outbox_tenant_mismatch' using errcode='23514';
  end if;
  if v_message.immutable_payload_hash is null then raise exception 'ediel_outbox_immutable_payload_hash_required' using errcode='23502'; end if;
  new.immutable_payload_hash := v_message.immutable_payload_hash;
  return new;
end $$;

drop trigger if exists ediel_outbox_canonical_contract_biu on public.ediel_outbox;
create trigger ediel_outbox_canonical_contract_biu
before insert or update of ediel_message_id,company_id on public.ediel_outbox
for each row execute function public.gridex_validate_ediel_outbox_contract();

create or replace function public.gridex_assert_utilts_transaction_coverage(p_source_message_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_company uuid; v_environment text; v_expected integer; v_final integer;
begin
  select company_id,environment into v_company,v_environment
    from public.ediel_messages where id=p_source_message_id and message_family='UTILTS';
  if not found then raise exception 'utilts_source_message_missing'; end if;
  select count(*) into v_expected from public.ediel_ack_transaction_results
    where company_id=v_company and environment=v_environment and source_message_id=p_source_message_id;
  if v_expected=0 then raise exception 'utilts_transaction_coverage_missing'; end if;
  select count(*) into v_final from public.ediel_ack_transaction_results
    where company_id=v_company and environment=v_environment and source_message_id=p_source_message_id
      and final_response_type is not null and response_message_id is not null and finalized_at is not null;
  if v_final<>v_expected then raise exception 'utilts_transaction_coverage_incomplete:%/%',v_final,v_expected; end if;
end $$;
revoke all on function public.gridex_assert_utilts_transaction_coverage(uuid) from public,anon,authenticated;
grant execute on function public.gridex_assert_utilts_transaction_coverage(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Strict tenant consistency for canonical tenant tables.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_assert_tenant_reference()
returns trigger language plpgsql set search_path=public as $$
declare v_related_company uuid; v_relation_id uuid;
begin
  if tg_table_name='tenant_counterparty_routes' then
    select company_id into v_related_company from public.tenant_counterparty_relations where id=new.counterparty_relation_id;
    if v_related_company is distinct from new.company_id then raise exception 'tenant_counterparty_relation_mismatch'; end if;
    select company_id into v_related_company from public.communication_routes where id=new.communication_route_id;
    if v_related_company is distinct from new.company_id then raise exception 'tenant_communication_route_mismatch'; end if;
    if new.certificate_profile_id is not null then
      select company_id into v_related_company from public.tenant_certificate_profiles where id=new.certificate_profile_id;
      if v_related_company is distinct from new.company_id then raise exception 'tenant_certificate_profile_mismatch'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tenant_counterparty_routes_tenant_guard on public.tenant_counterparty_routes;
create trigger tenant_counterparty_routes_tenant_guard before insert or update on public.tenant_counterparty_routes
for each row execute function public.gridex_assert_tenant_reference();

-- ---------------------------------------------------------------------------
-- 5. Seed version windows and mandatory ACK matrix. Source hashes bind the rows.
-- ---------------------------------------------------------------------------
insert into public.ediel_rule_packs(market,family,guide_version,guide_revision,unh_association_code,valid_from,valid_to,status,source_document,source_hash,field_matrix_version,code_list_versions,metadata)
values
('electricity','PRODAT','26.A','3','E2SE6A','2026-04-01',null,'active','PRODAT 26.A revision 3',encode(digest(convert_to('PRODAT|26.A|revision3|2026-04-01','UTF8'),'sha256'),'hex'),'26A-r3','{"market":"Sweden"}'::jsonb,'{"activation":"2026-04-01"}'::jsonb),
('electricity','UTILTS','E5SE5A','current-r3','E5SE5A','2026-04-01','2026-09-30','active','UTILTS current rule pack through 2026-09-30',encode(digest(convert_to('UTILTS|E5SE5A|current-r3|2026-04-01|2026-09-30','UTF8'),'sha256'),'hex'),'current-r3','{"market":"Sweden"}'::jsonb,'{"activation":"2026-04-01","retirement":"2026-09-30"}'::jsonb),
('electricity','UTILTS','E5SE5A','4','E5SE5A','2026-10-01',null,'future','UTILTS revision 4 effective 2026-10-01',encode(digest(convert_to('UTILTS|E5SE5A|revision4|2026-10-01','UTF8'),'sha256'),'hex'),'revision4','{"market":"Sweden"}'::jsonb,'{"activation":"2026-10-01"}'::jsonb)
on conflict(market,family,guide_version,guide_revision,valid_from) do update
set valid_to=excluded.valid_to,status=excluded.status,source_document=excluded.source_document,source_hash=excluded.source_hash,field_matrix_version=excluded.field_matrix_version,code_list_versions=excluded.code_list_versions,metadata=excluded.metadata,updated_at=now();

insert into public.ediel_rule_pack_sources(rule_pack_id,source_type,priority,title,revision,valid_from,valid_to,source_hash,metadata)
select rp.id,'technical_guide',3,rp.source_document,rp.guide_revision,rp.valid_from,rp.valid_to,rp.source_hash,
       jsonb_build_object('family',rp.family,'guideVersion',rp.guide_version,'binding','source-hash-required')
from public.ediel_rule_packs rp
where rp.family in ('PRODAT','UTILTS')
on conflict(rule_pack_id,source_type,title,coalesce(revision,'')) do update set
 valid_from=excluded.valid_from,valid_to=excluded.valid_to,source_hash=excluded.source_hash,metadata=excluded.metadata;

with packs as (
  select id,family from public.ediel_rule_packs where status in ('active','future')
)
insert into public.ediel_ack_rules(rule_pack_id,inbound_family,message_code,transaction_subtype,syntax_response,application_response,business_response,deadline_minutes,transaction_coverage_required,policy)
select id,family,'*','*','CONTRL',
  case when family='CONTRL' then 'none' when family='APERAK' then 'none' when family='UTILTS_ERR' then 'APERAK' when family='UTILTS' then 'APERAK_OR_UTILTS_ERR' else 'APERAK' end,
  case when family='PRODAT' then 'PRODAT' else null end,
  30,
  family='UTILTS',
  jsonb_build_object('no_ack_loop',true,'source','canonical-rule-pack')
from packs
on conflict(rule_pack_id,inbound_family,message_code,transaction_subtype) do update
set syntax_response=excluded.syntax_response,application_response=excluded.application_response,business_response=excluded.business_response,deadline_minutes=excluded.deadline_minutes,transaction_coverage_required=excluded.transaction_coverage_required,policy=excluded.policy;

-- Canonical message profiles are the only runtime profile selector. Detailed
-- segment/field rules may be compiled into the older validation tables, but they
-- cannot choose version, code or subtype independently of these rows.
with prodat_pack as (
  select id from public.ediel_rule_packs where family='PRODAT' and guide_version='26.A' and guide_revision='3' limit 1
), profiles(code,subtype,direction,business_process) as (
  values
    ('Z01','L','both','facility_verification_switch'),('Z01','LK','both','facility_verification_move_in'),
    ('Z02','L','both','facility_verification_switch'),('Z02','LK','both','facility_verification_move_in'),
    ('Z03','L','both','supplier_switch'),('Z03','LK','both','move_in'),('Z03','C','both','supplier_switch_cancellation'),
    ('Z04','L','both','supplier_switch'),('Z04','LK','both','move_in'),('Z04','C','both','supplier_switch_cancellation'),
    ('Z04','A','inbound','assigned_supply'),('Z04','D','inbound','mandatory_purchase'),
    ('Z05','L','both','supply_termination'),('Z05','LK','both','move_out'),('Z05','C','inbound','cancellation_previous_supplier'),
    ('Z06','E','inbound','customer_death'),('Z06','F','inbound','masterdata_with_reading'),('Z06','G','inbound','masterdata_without_reading'),
    ('Z08','H','outbound','supplier_termination'),
    ('Z09','B','both','balance_responsible_change'),('Z09','D','both','producer_agreement'),('Z09','E','both','customer_death'),
    ('Z09','F','both','quarter_metering_requested'),('Z09','G','both','quarter_metering_ended'),('Z10','M','both','meter_change'),
    ('Z13','V','both','metering_permission_current'),('Z13','VH','both','metering_permission_historic'),
    ('Z14','V','both','metering_permission_current'),('Z14','VH','both','metering_permission_historic'),('Z14','N','both','metering_permission_rejected'),
    ('Z15','V','both','metering_permission_ended'),('Z15','VH','both','historic_permission_ended'),('Z15','C','both','permission_termination_cancelled'),
    ('Z18','V','both','metering_permission_termination')
)
insert into public.ediel_message_profiles(rule_pack_id,message_code,transaction_subtype,direction,business_process,profile_key,profile)
select p.id,x.code,x.subtype,x.direction,x.business_process,
       concat('PRODAT:',x.code,':',x.subtype,':26.A:r3'),
       jsonb_build_object('family','PRODAT','messageCode',x.code,'transactionSubtype',x.subtype,'guideVersion','26.A','guideRevision','3','source','canonical-db-rule-pack')
from prodat_pack p cross join profiles x
on conflict(rule_pack_id,message_code,transaction_subtype,direction) do update set
 business_process=excluded.business_process,profile_key=excluded.profile_key,profile=excluded.profile,is_enabled=true;

with utilts_packs as (
  select id,guide_revision,valid_from,valid_to from public.ediel_rule_packs where family='UTILTS'
), profiles(code,direction,phase,business_process) as (
  values
    ('S01','inbound','settlement','aggregated_settlement'),('S02','inbound','planning','object_consumption_forecast'),
    ('S03','inbound','planning','preliminary_shares'),('S04','inbound','planning','summed_plan_values'),
    ('S05','inbound','settlement','aggregated_settlement'),('S06','both','settlement','bilateral_aggregate_request'),
    ('S07','inbound','metering','object_time_series'),('E30','inbound','metering','collected_metering'),
    ('E31','inbound','settlement','final_aggregated_metering'),('E66','both','metering','validated_metering'),
    ('E72','both','metering','missing_e30_request'),('E73','both','metering','missing_s02_e66_request'),
    ('E74','both','settlement','missing_s03_e31_request'),('ERR','both','metering','functional_rejection')
)
insert into public.ediel_message_profiles(rule_pack_id,message_code,transaction_subtype,direction,business_process,phase,profile_key,profile)
select p.id,x.code,'',x.direction,x.business_process,x.phase,
       concat('UTILTS:',x.code,':E5SE5A:',p.guide_revision),
       jsonb_build_object('family','UTILTS','messageCode',x.code,'phase',x.phase,'guideVersion','E5SE5A','guideRevision',p.guide_revision,'validFrom',p.valid_from,'validTo',p.valid_to,'source','canonical-db-rule-pack')
from utilts_packs p cross join profiles x
on conflict(rule_pack_id,message_code,transaction_subtype,direction) do update set
 business_process=excluded.business_process,phase=excluded.phase,profile_key=excluded.profile_key,profile=excluded.profile,is_enabled=true;

create or replace function public.resolve_canonical_ediel_rule_pack(
  p_market text,
  p_family text,
  p_message_code text,
  p_transaction_subtype text,
  p_direction text,
  p_business_date date
)
returns table(
  rule_pack_id uuid,
  message_profile_id uuid,
  market text,
  family text,
  guide_version text,
  guide_revision text,
  unh_association_code text,
  valid_from date,
  valid_to date,
  source_document text,
  source_hash text,
  field_matrix_version text,
  profile_key text,
  business_process text,
  phase text,
  profile jsonb,
  parser_ready boolean,
  builder_ready boolean,
  validator_ready boolean,
  ack_ready boolean,
  state_machine_ready boolean
)
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer;
begin
  if p_market <> 'electricity' or p_direction not in ('inbound','outbound') or p_business_date is null then
    raise exception 'canonical_rule_pack_invalid_request';
  end if;
  select count(*) into v_count
  from public.ediel_rule_packs rp
  join public.ediel_message_profiles mp on mp.rule_pack_id=rp.id and mp.is_enabled
  where rp.market=p_market and rp.family=upper(p_family) and mp.message_code=upper(p_message_code)
    and mp.transaction_subtype=coalesce(upper(nullif(btrim(p_transaction_subtype),'')),'')
    and mp.direction in (p_direction,'both')
    and rp.status in ('active','transition','future')
    and p_business_date >= rp.valid_from and (rp.valid_to is null or p_business_date <= rp.valid_to);
  if v_count <> 1 then
    raise exception 'canonical_rule_pack_resolution_count:%:%:%:%',v_count,p_family,p_message_code,coalesce(p_transaction_subtype,'');
  end if;
  return query
  select rp.id,mp.id,rp.market,rp.family,rp.guide_version,rp.guide_revision,rp.unh_association_code,
         rp.valid_from,rp.valid_to,rp.source_document,rp.source_hash,rp.field_matrix_version,
         mp.profile_key,mp.business_process,mp.phase,mp.profile,
         coalesce(rc.parser_ready,false),coalesce(rc.builder_ready,false),coalesce(rc.validator_ready,false),
         coalesce(rc.ack_ready,false),coalesce(rc.state_machine_ready,false)
  from public.ediel_rule_packs rp
  join public.ediel_message_profiles mp on mp.rule_pack_id=rp.id and mp.is_enabled
  left join public.ediel_runtime_capabilities rc on rc.rule_pack_id=rp.id and rc.message_code=mp.message_code
    and rc.transaction_subtype=mp.transaction_subtype and rc.direction in (p_direction,'both')
  where rp.market=p_market and rp.family=upper(p_family) and mp.message_code=upper(p_message_code)
    and mp.transaction_subtype=coalesce(upper(nullif(btrim(p_transaction_subtype),'')),'')
    and mp.direction in (p_direction,'both')
    and rp.status in ('active','transition','future')
    and p_business_date >= rp.valid_from and (rp.valid_to is null or p_business_date <= rp.valid_to);
end $$;
revoke all on function public.resolve_canonical_ediel_rule_pack(text,text,text,text,text,date) from public,anon,authenticated;
grant execute on function public.resolve_canonical_ediel_rule_pack(text,text,text,text,text,date) to service_role;

with prodat_pack as (
  select id from public.ediel_rule_packs where family='PRODAT' and guide_version='26.A' and guide_revision='3' limit 1
), profiles(code,subtype,direction) as (
  values
    ('Z01','L','both'),('Z01','LK','both'),('Z02','L','both'),('Z02','LK','both'),
    ('Z03','L','both'),('Z03','LK','both'),('Z03','C','both'),
    ('Z04','L','both'),('Z04','LK','both'),('Z04','C','both'),('Z04','A','inbound'),('Z04','D','inbound'),
    ('Z05','L','both'),('Z05','LK','both'),('Z05','C','inbound'),
    ('Z06','E','inbound'),('Z06','F','inbound'),('Z06','G','inbound'),
    ('Z08','H','outbound'),
    ('Z09','B','both'),('Z09','D','both'),('Z09','E','both'),('Z09','F','both'),('Z09','G','both'),
    ('Z10','M','both'),
    ('Z13','V','both'),('Z13','VH','both'),('Z14','V','both'),('Z14','VH','both'),('Z14','N','both'),
    ('Z15','V','both'),('Z15','VH','both'),('Z15','C','both'),('Z18','V','both')
)
insert into public.ediel_runtime_capabilities(rule_pack_id,message_code,transaction_subtype,direction,parser_ready,builder_ready,validator_ready,ack_ready,state_machine_ready,verification)
select p.id,x.code,x.subtype,x.direction,true,
       x.direction in ('outbound','both'),true,true,true,
       jsonb_build_object('source','canonical-prodat-profile-registry','engine_schema_version','20260713100000')
from prodat_pack p cross join profiles x
on conflict(rule_pack_id,message_code,transaction_subtype,direction) do update set
 parser_ready=excluded.parser_ready,builder_ready=excluded.builder_ready,validator_ready=excluded.validator_ready,
 ack_ready=excluded.ack_ready,state_machine_ready=excluded.state_machine_ready,verification=excluded.verification,updated_at=now();

with utilts_packs as (
  select id from public.ediel_rule_packs where family='UTILTS'
), profiles(code,direction,builder_ready,state_ready) as (
  values
    ('S01','inbound',false,true),('S02','inbound',false,true),('S03','inbound',false,true),
    ('S04','inbound',false,true),('S05','inbound',false,true),('S06','both',true,true),('S07','inbound',false,true),
    ('E30','inbound',false,true),('E31','inbound',false,true),('E66','both',true,true),
    ('E72','both',true,true),('E73','both',true,true),('E74','both',true,true),('ERR','both',true,true)
)
insert into public.ediel_runtime_capabilities(rule_pack_id,message_code,transaction_subtype,direction,parser_ready,builder_ready,validator_ready,ack_ready,state_machine_ready,verification)
select p.id,x.code,'',x.direction,true,x.builder_ready,true,true,x.state_ready,
       jsonb_build_object('source','canonical-utilts-profile-registry','engine_schema_version','20260713100000')
from utilts_packs p cross join profiles x
on conflict(rule_pack_id,message_code,transaction_subtype,direction) do update set
 parser_ready=excluded.parser_ready,builder_ready=excluded.builder_ready,validator_ready=excluded.validator_ready,
 ack_ready=excluded.ack_ready,state_machine_ready=excluded.state_machine_ready,verification=excluded.verification,updated_at=now();

-- Ensure future UTILTS does not activate early and no active windows overlap.
do $$
begin
  if exists (
    select 1 from public.ediel_rule_packs a join public.ediel_rule_packs b
      on a.id<>b.id and a.family=b.family and a.status in ('active','transition') and b.status in ('active','transition')
     and daterange(a.valid_from,coalesce(a.valid_to,'infinity'::date),'[]') && daterange(b.valid_from,coalesce(b.valid_to,'infinity'::date),'[]')
  ) then raise exception 'overlapping_active_ediel_rule_pack_windows'; end if;
  if exists (select 1 from public.ediel_rule_packs where family='UTILTS' and guide_revision='4' and valid_from<'2026-10-01') then
    raise exception 'utilts_revision_4_activated_too_early';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 6. External certification/pilot evidence. Production readiness must remain
-- blocked until evidence has been recorded after the canonical engine version.
-- ---------------------------------------------------------------------------
create table if not exists public.ediel_certification_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check(environment in ('test','production')),
  evidence_type text not null check(evidence_type in ('TGT','AGT','SHADOW_PRODUCTION','LIMITED_PILOT','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY')),
  status text not null check(status in ('pending','passed','failed','expired','revoked')),
  engine_schema_version text not null,
  external_reference text,
  evidence_document_reference text,
  tested_at timestamptz,
  valid_until timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,environment,evidence_type,engine_schema_version)
);
create index if not exists ediel_certification_evidence_readiness_idx
  on public.ediel_certification_evidence(company_id,environment,evidence_type,status,approved_at desc);

-- ---------------------------------------------------------------------------
-- 6. Resumable, tenant-fair monthly billing jobs.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  billing_month text not null check (billing_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target_system text not null,
  export_format text not null,
  send_to_partner boolean not null default false,
  status text not null default 'queued' check(status in ('queued','running','completed','completed_with_blockers','failed','cancelled')),
  attempts integer not null default 0 check(attempts >= 0),
  max_attempts integer not null default 5 check(max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(company_id,billing_month,target_system,export_format)
);
create index if not exists billing_automation_jobs_claim_idx
  on public.billing_automation_jobs(status,available_at,created_at,company_id)
  where status in ('queued','failed');

create or replace function public.gridex_claim_billing_automation_jobs(
  p_worker_id text,
  p_limit integer default 8
) returns setof public.billing_automation_jobs
language plpgsql security definer set search_path=public as $$
begin
  if nullif(btrim(p_worker_id),'') is null then raise exception 'worker_id_required'; end if;
  if p_limit < 1 or p_limit > 50 then raise exception 'invalid_claim_limit'; end if;
  return query
  with candidates as (
    select j.id
    from public.billing_automation_jobs j
    where j.status in ('queued','failed')
      and j.available_at <= now()
      and j.attempts < j.max_attempts
      and (j.locked_at is null or j.locked_at < now() - interval '30 minutes')
    order by j.available_at,j.created_at,j.company_id
    for update skip locked
    limit p_limit
  )
  update public.billing_automation_jobs j
     set status='running', locked_at=now(), locked_by=p_worker_id,
         attempts=j.attempts+1, updated_at=now(), last_error=null
    from candidates c
   where j.id=c.id
  returning j.*;
end $$;
revoke all on function public.gridex_claim_billing_automation_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.gridex_claim_billing_automation_jobs(text,integer) to service_role;

alter table public.billing_automation_jobs enable row level security;
alter table public.billing_automation_jobs force row level security;
revoke all on public.billing_automation_jobs from anon,authenticated;
grant select,insert,update,delete on public.billing_automation_jobs to service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS/grants. Global rules are read-only; tenant configuration is service-only
-- until tenant-aware policies are explicitly provisioned and tested.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ediel_rule_packs','ediel_rule_pack_sources','ediel_message_profiles','ediel_segment_rules','ediel_field_rules','ediel_runtime_capabilities','ediel_ack_rules','ediel_error_rules','ediel_code_lists','ediel_code_list_values','ediel_timeseries_products','ediel_product_codes','ediel_business_process_rules'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
    execute format('drop policy if exists %I on public.%I',t||'_authenticated_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',t||'_authenticated_read',t);
  end loop;
  foreach t in array array[
    'tenant_ediel_profiles','tenant_actor_identifiers','tenant_actor_roles','tenant_message_capabilities','tenant_communication_profiles','tenant_application_reference_profiles','tenant_mailboxes','tenant_certificate_profiles','tenant_counterparty_relations','tenant_counterparty_routes','tenant_bilateral_agreements','ediel_certification_evidence','ediel_inbound_quarantine','ediel_ack_transaction_results','ediel_business_correlations','ediel_business_expectations'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 7. Canonical economic precision, VAT and late-correction workflow.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['contract_offers','customer_contracts','pricing_preview_lines','billing_underlays'] loop
    if to_regclass('public.'||t) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema='public' and table_name=t and column_name='vat_rate'
       ) then
      execute format('update public.%I set vat_rate=vat_rate/100 where vat_rate>1 and vat_rate<=100',t);
      execute format('alter table public.%I drop constraint if exists %I',t,t||'_vat_rate_fraction_contract');
      execute format('alter table public.%I add constraint %I check(vat_rate is null or (vat_rate>=0 and vat_rate<=1))',t,t||'_vat_rate_fraction_contract');
    end if;
  end loop;
end $$;

create table if not exists public.billing_adjustment_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'production' check(environment in ('test','production')),
  original_billing_underlay_id uuid not null references public.billing_underlays(id) on delete restrict,
  corrected_billing_underlay_id uuid references public.billing_underlays(id) on delete restrict,
  source_normalized_metering_value_id uuid,
  original_invoice_id uuid,
  credit_invoice_id uuid,
  replacement_invoice_id uuid,
  reason text not null,
  status text not null default 'detected' check(status in ('detected','blocked','approved','credit_queued','credited','rebill_queued','completed','rejected')),
  difference_minor_units bigint,
  currency char(3) not null,
  approval_required boolean not null default true,
  approved_by uuid,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,original_billing_underlay_id,source_normalized_metering_value_id)
);
alter table public.billing_adjustment_cases enable row level security;
alter table public.billing_adjustment_cases force row level security;
revoke all on public.billing_adjustment_cases from anon,authenticated;
grant select,insert,update,delete on public.billing_adjustment_cases to service_role;

create or replace function public.gridex_register_late_metering_correction(
  p_company_id uuid,
  p_original_underlay_id uuid,
  p_corrected_underlay_id uuid,
  p_source_value_id uuid,
  p_reason text,
  p_currency text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_status text;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'adjustment_reason_required'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  select status into v_status from public.billing_underlays where id=p_original_underlay_id and company_id=p_company_id;
  if not found then raise exception 'original_underlay_not_found_for_tenant'; end if;
  if v_status not in ('exported','invoiced','locked','completed') then raise exception 'underlay_not_locked_or_invoiced'; end if;
  insert into public.billing_adjustment_cases(company_id,original_billing_underlay_id,corrected_billing_underlay_id,source_normalized_metering_value_id,reason,status,currency)
  values(p_company_id,p_original_underlay_id,p_corrected_underlay_id,p_source_value_id,p_reason,'detected',p_currency)
  on conflict(company_id,original_billing_underlay_id,source_normalized_metering_value_id)
  do update set corrected_billing_underlay_id=excluded.corrected_billing_underlay_id,reason=excluded.reason,updated_at=now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.gridex_register_late_metering_correction(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.gridex_register_late_metering_correction(uuid,uuid,uuid,uuid,text,text) to service_role;


update public.market_process_policies
set policy = jsonb_set(policy,'{day_mode}',to_jsonb('calendar_days'::text),true), updated_at=now()
where process_code='supplier_switch' and not (policy ? 'day_mode');

-- ---------------------------------------------------------------------------
-- 9. Final deployment gate. Must remain the final statement before COMMIT.
-- ---------------------------------------------------------------------------
alter table public.ediel_rule_pack_backfill_issues enable row level security;
alter table public.ediel_rule_pack_backfill_issues force row level security;
revoke all on public.ediel_rule_pack_backfill_issues from anon,authenticated;
grant select,insert,update,delete on public.ediel_rule_pack_backfill_issues to service_role;

insert into public.platform_schema_state(id,current_version,is_ready,blocking_issues,verified_at,updated_at)
values(true,'20260713100000-ediel-completion-and-platform-contract',true,'[]'::jsonb,now(),now())
on conflict(id) do update set current_version=excluded.current_version,is_ready=true,blocking_issues='[]'::jsonb,verified_at=now(),updated_at=now();

commit;
