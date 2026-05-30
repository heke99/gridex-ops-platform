-- Batch 2 — Ediel Rulebook, Systemtest, testmotor, ESCO och regelversioner
-- Safe/idempotent migration. Adds rulebook/test-center tables without deleting or replacing existing Ediel runtime data.

create extension if not exists pgcrypto;

create table if not exists public.ediel_rulebooks (
  id uuid primary key default gen_random_uuid(),
  rulebook_key text not null unique,
  name text not null,
  market text not null default 'electricity',
  status text not null default 'active',
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rulebook_id uuid null references public.ediel_rulebooks(id) on delete cascade,
  rulebook_key text null,
  message_family text not null,
  message_code text not null,
  message_standard text not null default 'edifact',
  version_code text not null,
  previous_version_code text null,
  status text not null default 'draft',
  valid_from date null,
  valid_to date null,
  business_process text null,
  default_application_reference text null,
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  supports_negative_response boolean not null default true,
  supports_utilts_err boolean not null default false,
  source_title text null,
  source_version text null,
  notes jsonb not null default '{}'::jsonb,
  created_by uuid null,
  approved_by uuid null,
  activated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_rule_versions_unique_version_idx
  on public.ediel_rule_versions(message_family, message_code, message_standard, version_code, valid_from);

create index if not exists ediel_rule_versions_active_lookup_idx
  on public.ediel_rule_versions(message_family, message_code, message_standard, status, valid_from desc);

create table if not exists public.ediel_field_rules (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid null references public.ediel_rule_versions(id) on delete cascade,
  message_family text not null,
  message_code text not null,
  subtype text null,
  field_key text not null,
  field_label text not null,
  segment_path text not null,
  requirement text not null,
  condition text null,
  allowed_values jsonb not null default '[]'::jsonb,
  code_list text null,
  error_code_if_missing text null,
  error_code_if_invalid text null,
  valid_from date null,
  valid_to date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_field_rules_unique_idx
  on public.ediel_field_rules(message_family, message_code, coalesce(subtype, '*'), field_key, segment_path);

create table if not exists public.ediel_code_rules (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid null references public.ediel_rule_versions(id) on delete cascade,
  message_family text not null,
  message_code text not null,
  code_list text not null,
  code_value text not null,
  label text null,
  is_active boolean not null default true,
  valid_from date null,
  valid_to date null,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ediel_code_rules_unique_idx
  on public.ediel_code_rules(message_family, message_code, code_list, code_value);

create table if not exists public.ediel_ack_rules (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid null references public.ediel_rule_versions(id) on delete cascade,
  message_family text not null,
  message_code text not null,
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  send_negative_aperak_on_error boolean not null default true,
  send_utilts_err_on_functional_error boolean not null default false,
  ack_deadline_minutes integer null default 30,
  status text not null default 'active',
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_ack_rules_unique_idx
  on public.ediel_ack_rules(message_family, message_code, status);

create table if not exists public.ediel_message_build_rules (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid null references public.ediel_rule_versions(id) on delete cascade,
  message_family text not null,
  message_code text not null,
  subtype text null,
  business_process text not null,
  default_application_reference text null,
  builder_key text not null,
  status text not null default 'active',
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ediel_message_build_rules_unique_idx
  on public.ediel_message_build_rules(message_family, message_code, coalesce(subtype, '*'), business_process, builder_key);

create table if not exists public.ediel_test_suites (
  id uuid primary key default gen_random_uuid(),
  suite_key text not null unique,
  name text not null,
  category text not null,
  actor_role text null,
  market text not null default 'electricity',
  status text not null default 'active',
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_test_cases (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid null references public.ediel_test_suites(id) on delete cascade,
  suite_key text not null,
  test_case_code text not null,
  name text not null,
  actor_role text not null,
  market text not null default 'electricity',
  message_family text not null,
  message_code text not null,
  subtype text null,
  direction text not null,
  expected_contrl text not null default 'positive',
  expected_aperak text not null default 'depends',
  expected_utilts_err text not null default 'not_expected',
  expected_status text not null default 'passed',
  rule_version text null,
  is_active boolean not null default true,
  is_mandatory boolean not null default true,
  test_data_source text null,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_test_cases_unique_idx
  on public.ediel_test_cases(suite_key, test_case_code);

create table if not exists public.ediel_test_steps (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid not null references public.ediel_test_cases(id) on delete cascade,
  step_no integer not null,
  name text not null,
  expected_family text null,
  expected_code text null,
  expected_direction text null,
  expected_ack text null,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ediel_test_steps_unique_idx
  on public.ediel_test_steps(test_case_id, step_no);

create table if not exists public.ediel_test_data_sets (
  id uuid primary key default gen_random_uuid(),
  dataset_key text not null unique,
  name text not null,
  source_file_name text null,
  source_type text null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_test_artifacts (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid null references public.ediel_test_runs(id) on delete cascade,
  test_case_id uuid null references public.ediel_test_cases(id) on delete set null,
  artifact_type text not null,
  title text not null,
  raw_payload text null,
  parsed_payload jsonb not null default '{}'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_rule_change_logs (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid null references public.ediel_rule_versions(id) on delete set null,
  changed_by uuid null,
  change_type text not null,
  old_value jsonb null,
  new_value jsonb null,
  approved_by uuid null,
  activated_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_permission_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  customer_id uuid null,
  site_id uuid null,
  metering_point_id uuid null,
  grid_owner_id uuid null,
  permission_reference text null,
  status text not null default 'draft',
  started_at timestamptz null,
  ended_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ediel_permission_cases_company_status_idx
  on public.ediel_permission_cases(company_id, status, created_at desc);

create table if not exists public.ediel_permission_events (
  id uuid primary key default gen_random_uuid(),
  permission_case_id uuid not null references public.ediel_permission_cases(id) on delete cascade,
  event_type text not null,
  message_family text null,
  message_code text null,
  ediel_message_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_ai_list_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  run_type text not null default 'AI',
  file_name text null,
  file_version text null default 'Ver20140401',
  file_extension text null,
  status text not null default 'draft',
  parsed_rows integer not null default 0,
  discrepancy_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_ai_list_discrepancies (
  id uuid primary key default gen_random_uuid(),
  ai_list_run_id uuid not null references public.ediel_ai_list_runs(id) on delete cascade,
  discrepancy_type text not null,
  severity text not null default 'warning',
  facility_id text null,
  metering_point_id text null,
  expected_value text null,
  actual_value text null,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Optional compatibility columns for existing test run table.
alter table if exists public.ediel_test_runs add column if not exists actor_profile_id uuid null;
alter table if exists public.ediel_test_runs add column if not exists environment text null default 'test';
alter table if exists public.ediel_test_runs add column if not exists rule_version_id uuid null;
alter table if exists public.ediel_test_runs add column if not exists timeline jsonb not null default '[]'::jsonb;

insert into public.ediel_rulebooks(rulebook_key, name, market, status, description)
values
  ('ediel-electricity-2026A', 'Ediel elmarknad 2026A', 'electricity', 'active', 'PRODAT/APERAK/CONTRL/UTILTS/AI-list rulebook for Gridex SaaS runtime.')
on conflict (rulebook_key) do update set
  name = excluded.name,
  status = excluded.status,
  description = excluded.description,
  updated_at = now();

with rb as (
  select id from public.ediel_rulebooks where rulebook_key = 'ediel-electricity-2026A'
), rules(message_family, message_code, version_code, previous_version_code, status, valid_from, business_process, appref, requires_contrl, requires_aperak, negative_response, utilts_err, source_title) as (
  values
    ('PRODAT','Z01','26A','16B','active','2026-04-01'::date,'customer_masterdata','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z02','26A','16B','active','2026-04-01'::date,'customer_masterdata','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z03','26A','16B','active','2026-04-01'::date,'supplier_switch','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z04','26A','16B','active','2026-04-01'::date,'supplier_switch','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z05','26A','16B','active','2026-04-01'::date,'supplier_switch','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z06','26A','16B','active','2026-04-01'::date,'supplier_switch','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z08','26A','16B','active','2026-04-01'::date,'supplier_switch','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z09','26A','16B','active','2026-04-01'::date,'supplier_switch','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z10','26A','16B','active','2026-04-01'::date,'supplier_switch','23-DDQ-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z13','26A','16B','active','2026-04-01'::date,'metering_access','23-DGI-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z14','26A','16B','active','2026-04-01'::date,'metering_access','23-DGI-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z15','26A','16B','active','2026-04-01'::date,'metering_access','23-DGI-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('PRODAT','Z18','26A','16B','active','2026-04-01'::date,'metering_access','23-DGI-PRODAT',true,true,true,false,'PRODAT 26-A / APERAK 16-B'),
    ('UTILTS','E66','E5SE5A',null,'active','2025-06-01'::date,'meter_values','23-DDQ-UTILTS',true,true,true,true,'UTILTS E5SE5A'),
    ('UTILTS','E31','E5SE5A',null,'active','2025-06-01'::date,'meter_values','23-DDQ-E31-S',true,true,true,true,'UTILTS E5SE5A'),
    ('UTILTS','S02','E5SE5A',null,'review','2025-06-01'::date,'meter_values','23-DDQ-UTILTS',true,true,true,true,'UTILTS E5SE5A'),
    ('UTILTS','S03','E5SE5A',null,'review','2025-06-01'::date,'meter_values','23-DDQ-UTILTS',true,true,true,true,'UTILTS E5SE5A'),
    ('APERAK','APERAK','E2SE6A',null,'active',null,'ediel_ack',null,false,false,false,false,'APERAK'),
    ('CONTRL','CONTRL','D96A',null,'active',null,'ediel_ack',null,false,false,false,false,'Generella tekniska regler'),
    ('UTILTS_ERR','UTILTS_ERR','E5SE5A',null,'active','2025-06-01'::date,'ediel_ack',null,false,false,false,false,'UTILTS E5SE5A')
)
insert into public.ediel_rule_versions(
  rulebook_id, rulebook_key, message_family, message_code, message_standard, version_code,
  previous_version_code, status, valid_from, business_process, default_application_reference,
  requires_contrl, requires_aperak, supports_negative_response, supports_utilts_err,
  source_title, source_version, notes
)
select rb.id, 'ediel-electricity-2026A', r.message_family, r.message_code, 'edifact', r.version_code,
       r.previous_version_code, r.status, r.valid_from, r.business_process, r.appref,
       r.requires_contrl, r.requires_aperak, r.negative_response, r.utilts_err,
       r.source_title, r.version_code, jsonb_build_object('batch', 'batch_2_rulebook')
from rb cross join rules r
on conflict (message_family, message_code, message_standard, version_code, valid_from) do update set
  status = excluded.status,
  business_process = excluded.business_process,
  default_application_reference = excluded.default_application_reference,
  requires_contrl = excluded.requires_contrl,
  requires_aperak = excluded.requires_aperak,
  supports_negative_response = excluded.supports_negative_response,
  supports_utilts_err = excluded.supports_utilts_err,
  updated_at = now();

with suites(suite_key, name, category, actor_role, description) as (
  values
    ('AGT_PRODAT_SUPPLIER','AGT PRODAT leverantör','agt','supplier','Leverantörens AGT PRODAT L1-L7.'),
    ('AGT_UTILTS_SUPPLIER','AGT UTILTS leverantör','agt','supplier','Leverantörens AGT UTILTS UL1-UL6.'),
    ('AGT_PRODAT_ESCO','AGT PRODAT energitjänsteföretag','agt','energy_service_company','ESCO/berättigad part E3-E8.'),
    ('AGT_UTILTS_ESCO','AGT UTILTS energitjänsteföretag','agt','energy_service_company','ESCO UTILTS UE1-UE2.'),
    ('TGT_PRODAT_ESCO','TGT PRODAT energitjänsteföretag','tgt','energy_service_company','TGT 8.x/9.x ESCO.'),
    ('TGT_UTILTS_ESCO','TGT UTILTS energitjänsteföretag','tgt','energy_service_company','TGT U3.x ESCO.'),
    ('INTERNAL_REGRESSION','Intern regression','regression','platform','Regression innan regelaktivering.'),
    ('AI_LIST','AI-/BI-lista','ai_list','platform','AI/BI-fil och avvikelsekontroll.')
)
insert into public.ediel_test_suites(suite_key, name, category, actor_role, description)
select suite_key, name, category, actor_role, description from suites
on conflict (suite_key) do update set
  name = excluded.name,
  category = excluded.category,
  actor_role = excluded.actor_role,
  description = excluded.description,
  updated_at = now();

with cases(suite_key, test_case_code, name, actor_role, family, code, subtype, direction, contrl, aperak, utilts_err, expected_status) as (
  values
    ('AGT_PRODAT_SUPPLIER','L1','L1 PRODAT Z03','supplier','PRODAT','Z03','L','actor_to_portal','positive','positive','not_expected','passed'),
    ('AGT_PRODAT_SUPPLIER','L2','L2 PRODAT Z04','supplier','PRODAT','Z04',null,'portal_to_actor','positive','negative','not_expected','manual_review'),
    ('AGT_PRODAT_SUPPLIER','L3','L3 PRODAT Z05','supplier','PRODAT','Z05',null,'portal_to_actor','positive','negative','not_expected','manual_review'),
    ('AGT_PRODAT_SUPPLIER','L4','L4 PRODAT Z06','supplier','PRODAT','Z06',null,'portal_to_actor','positive','negative','not_expected','manual_review'),
    ('AGT_PRODAT_SUPPLIER','L5','L5 PRODAT Z10','supplier','PRODAT','Z10',null,'portal_to_actor','positive','negative','not_expected','manual_review'),
    ('AGT_PRODAT_SUPPLIER','L7','L7 PRODAT Z09','supplier','PRODAT','Z09','F','actor_to_portal','positive','positive','not_expected','passed'),
    ('AGT_UTILTS_SUPPLIER','UL1','UL1 UTILTS S03','supplier','UTILTS','S03',null,'actor_to_portal','positive','depends','depends','passed'),
    ('AGT_UTILTS_SUPPLIER','UL2','UL2 UTILTS E66-KVART','supplier','UTILTS','E66',null,'actor_to_portal','positive','depends','depends','passed'),
    ('AGT_UTILTS_SUPPLIER','UL3','UL3 UTILTS E66-SCH','supplier','UTILTS','E66',null,'actor_to_portal','positive','depends','depends','passed'),
    ('AGT_UTILTS_SUPPLIER','UL4','UL4 UTILTS S02','supplier','UTILTS','S02',null,'actor_to_portal','positive','depends','depends','passed'),
    ('AGT_UTILTS_SUPPLIER','UL6','UL6 UTILTS E31-SCH','supplier','UTILTS','E31',null,'actor_to_portal','positive','depends','depends','passed'),
    ('AGT_PRODAT_ESCO','E3','E3 PRODAT Z13V','energy_service_company','PRODAT','Z13','V','actor_to_portal','positive','positive','not_expected','passed'),
    ('AGT_PRODAT_ESCO','E4','E4 PRODAT Z13VH','energy_service_company','PRODAT','Z13','VH','actor_to_portal','positive','positive','not_expected','passed'),
    ('AGT_PRODAT_ESCO','E5','E5 PRODAT Z14V','energy_service_company','PRODAT','Z14','V','portal_to_actor','positive','positive','not_expected','passed'),
    ('AGT_PRODAT_ESCO','E6','E6 PRODAT Z14N','energy_service_company','PRODAT','Z14','N','portal_to_actor','positive','negative','not_expected','manual_review'),
    ('AGT_PRODAT_ESCO','E7','E7 PRODAT Z15V','energy_service_company','PRODAT','Z15','V','portal_to_actor','positive','positive','not_expected','passed'),
    ('AGT_PRODAT_ESCO','E8','E8 PRODAT Z18V','energy_service_company','PRODAT','Z18','V','actor_to_portal','positive','positive','not_expected','passed'),
    ('TGT_PRODAT_ESCO','8.1.1','Korrekt Z13V -> Z14V','energy_service_company','PRODAT','Z13','V','inbound','positive','positive','not_expected','passed'),
    ('TGT_PRODAT_ESCO','8.1.2','Korrekt Z13V -> Z14N','energy_service_company','PRODAT','Z13','V','inbound','positive','positive','not_expected','passed'),
    ('TGT_PRODAT_ESCO','8.1.3','Korrekt Z13VH -> Z14VH','energy_service_company','PRODAT','Z13','VH','inbound','positive','positive','not_expected','passed'),
    ('TGT_PRODAT_ESCO','8.2.1','Avvisad Z14V','energy_service_company','PRODAT','Z14','V','inbound','positive','negative','not_expected','manual_review'),
    ('TGT_PRODAT_ESCO','9.1.1','Z15V','energy_service_company','PRODAT','Z15','V','inbound','positive','positive','not_expected','passed'),
    ('TGT_PRODAT_ESCO','9.1.2','Z18V -> Z15V','energy_service_company','PRODAT','Z18','V','inbound','positive','positive','not_expected','passed'),
    ('TGT_PRODAT_ESCO','9.2.1','Avvisad Z15V','energy_service_company','PRODAT','Z15','V','inbound','positive','negative','not_expected','manual_review'),
    ('TGT_UTILTS_ESCO','U3.1.1','Korrekt UTILTS E66-SCH','energy_service_company','UTILTS','E66',null,'inbound','positive','positive','not_expected','passed'),
    ('TGT_UTILTS_ESCO','U3.1.2','Korrekt UTILTS E66-KVART','energy_service_company','UTILTS','E66',null,'inbound','positive','positive','not_expected','passed'),
    ('TGT_UTILTS_ESCO','U3.2.1','Felaktig UTILTS E66 anvisningsfel kvart','energy_service_company','UTILTS','E66',null,'inbound','positive','negative','not_expected','manual_review'),
    ('TGT_UTILTS_ESCO','U3.2.2','Felaktig UTILTS E66 funktionsfel kvart','energy_service_company','UTILTS','E66',null,'inbound','positive','not_expected','expected','manual_review')
)
insert into public.ediel_test_cases(
  suite_id, suite_key, test_case_code, name, actor_role, message_family, message_code,
  subtype, direction, expected_contrl, expected_aperak, expected_utilts_err, expected_status,
  rule_version, test_data_source, notes
)
select s.id, c.suite_key, c.test_case_code, c.name, c.actor_role, c.family, c.code,
       c.subtype, c.direction, c.contrl, c.aperak, c.utilts_err, c.expected_status,
       'rulebook-2026A', 'rulebook-seed', jsonb_build_object('batch','batch_2_rulebook')
from cases c
join public.ediel_test_suites s on s.suite_key = c.suite_key
on conflict (suite_key, test_case_code) do update set
  name = excluded.name,
  actor_role = excluded.actor_role,
  message_family = excluded.message_family,
  message_code = excluded.message_code,
  subtype = excluded.subtype,
  direction = excluded.direction,
  expected_contrl = excluded.expected_contrl,
  expected_aperak = excluded.expected_aperak,
  expected_utilts_err = excluded.expected_utilts_err,
  expected_status = excluded.expected_status,
  updated_at = now();

-- Keep RLS enabled where the project enables it globally, but do not create broad permissive policies here.
alter table public.ediel_rulebooks enable row level security;
alter table public.ediel_rule_versions enable row level security;
alter table public.ediel_field_rules enable row level security;
alter table public.ediel_code_rules enable row level security;
alter table public.ediel_ack_rules enable row level security;
alter table public.ediel_message_build_rules enable row level security;
alter table public.ediel_test_suites enable row level security;
alter table public.ediel_test_cases enable row level security;
alter table public.ediel_test_steps enable row level security;
alter table public.ediel_test_data_sets enable row level security;
alter table public.ediel_test_artifacts enable row level security;
alter table public.ediel_rule_change_logs enable row level security;
alter table public.ediel_permission_cases enable row level security;
alter table public.ediel_permission_events enable row level security;
alter table public.ediel_ai_list_runs enable row level security;
alter table public.ediel_ai_list_discrepancies enable row level security;
