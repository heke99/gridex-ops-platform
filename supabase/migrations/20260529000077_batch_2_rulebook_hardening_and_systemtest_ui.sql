-- Batch 2 hardening: rulebook, systemtest UI actions, structured testdata, activation guards.
-- Idempotent and SaaS-safe. Does not delete existing data.

create extension if not exists pgcrypto;

create table if not exists public.ediel_rulebooks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rulebook_id uuid references public.ediel_rulebooks(id) on delete set null,
  rule_key text not null unique,
  version_code text not null,
  previous_version_code text,
  message_family text not null,
  message_code text not null,
  process_group text,
  application_reference text,
  status text not null default 'draft',
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  latest_change_at timestamptz not null default now(),
  last_regression_run_id uuid,
  last_regression_status text,
  last_regression_at timestamptz,
  approved_by uuid,
  activated_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ediel_rule_versions add column if not exists latest_change_at timestamptz not null default now();
alter table public.ediel_rule_versions add column if not exists last_regression_run_id uuid;
alter table public.ediel_rule_versions add column if not exists last_regression_status text;
alter table public.ediel_rule_versions add column if not exists last_regression_at timestamptz;
alter table public.ediel_rule_versions add column if not exists previous_version_code text;

create table if not exists public.ediel_field_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  message_family text not null,
  message_code text not null,
  field_key text not null,
  field_name text,
  segment_path text,
  requirement text not null default 'optional',
  condition text,
  allowed_values text[] not null default '{}'::text[],
  error_code_if_missing text,
  error_code_if_invalid text,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_code_rules (
  id uuid primary key default gen_random_uuid(),
  code_list text not null unique,
  allowed_values text[] not null default '{}'::text[],
  description text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_ack_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  message_family text not null,
  message_code text not null,
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  requires_utilts_err boolean not null default false,
  negative_aperak_on_error boolean not null default true,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_message_build_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  message_family text not null,
  message_code text not null,
  process_group text,
  application_reference text,
  segment_rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_test_cases (
  id uuid primary key default gen_random_uuid(),
  test_case_code text not null unique,
  suite_code text not null,
  title text not null,
  role_code text,
  message_family text,
  message_code text,
  subtype text,
  process_group text,
  expected_contrl text,
  expected_aperak text,
  expected_utilts_err text,
  mandatory boolean not null default true,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_test_run_steps (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid references public.ediel_test_runs(id) on delete cascade,
  ediel_message_id uuid references public.ediel_messages(id) on delete set null,
  step_no integer,
  title text,
  status text not null default 'pending',
  expected_direction text,
  expected_family text,
  expected_code text,
  expected_ack jsonb not null default '{}'::jsonb,
  actual_direction text,
  actual_family text,
  actual_code text,
  validation_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_test_artifacts (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid references public.ediel_test_runs(id) on delete cascade,
  ediel_message_id uuid references public.ediel_messages(id) on delete set null,
  artifact_type text not null,
  title text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.ediel_test_artifacts add column if not exists ediel_message_id uuid references public.ediel_messages(id) on delete set null;
alter table public.ediel_test_artifacts add column if not exists payload jsonb not null default '{}'::jsonb;

create table if not exists public.ediel_rule_change_logs (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid references public.ediel_rule_versions(id) on delete set null,
  change_type text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_test_data_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  file_name text,
  source_type text,
  row_count integer not null default 0,
  headers text[] not null default '{}'::text[],
  raw_text_preview text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_test_customers (
  id uuid primary key default gen_random_uuid(),
  data_set_id uuid references public.ediel_test_data_sets(id) on delete cascade,
  test_case_code text,
  customer_identifier text,
  customer_name text,
  raw text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_test_facilities (
  id uuid primary key default gen_random_uuid(),
  data_set_id uuid references public.ediel_test_data_sets(id) on delete cascade,
  test_case_code text,
  facility_id text,
  grid_area_id text,
  raw text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_test_metering_points (
  id uuid primary key default gen_random_uuid(),
  data_set_id uuid references public.ediel_test_data_sets(id) on delete cascade,
  test_case_code text,
  metering_point_id text,
  metering_method text,
  reporting_frequency text,
  raw text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_test_expected_values (
  id uuid primary key default gen_random_uuid(),
  data_set_id uuid references public.ediel_test_data_sets(id) on delete cascade,
  test_case_code text,
  message_family text,
  message_code text,
  expected_status text,
  raw text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_test_expected_acks (
  id uuid primary key default gen_random_uuid(),
  data_set_id uuid references public.ediel_test_data_sets(id) on delete cascade,
  test_case_code text,
  expected_contrl text,
  expected_aperak text,
  expected_utilts_err text,
  raw text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_test_field_values (
  id uuid primary key default gen_random_uuid(),
  data_set_id uuid references public.ediel_test_data_sets(id) on delete cascade,
  test_case_code text,
  field_key text,
  field_value text,
  raw text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_permission_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  status text not null default 'draft',
  permission_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_permission_events (
  id uuid primary key default gen_random_uuid(),
  permission_case_id uuid references public.ediel_permission_cases(id) on delete cascade,
  event_type text not null,
  event_status text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_ai_list_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  status text not null default 'draft',
  file_name text,
  format_version text,
  row_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_ai_list_discrepancies (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ediel_ai_list_runs(id) on delete cascade,
  discrepancy_type text not null,
  severity text not null default 'warning',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists ediel_rule_versions_runtime_idx on public.ediel_rule_versions(message_family, message_code, status, valid_from desc);
create index if not exists ediel_test_cases_suite_idx on public.ediel_test_cases(suite_code, is_active);
create index if not exists ediel_test_run_steps_run_idx on public.ediel_test_run_steps(test_run_id, step_no);
create index if not exists ediel_test_artifacts_run_idx on public.ediel_test_artifacts(test_run_id, artifact_type);
create index if not exists ediel_test_field_values_dataset_idx on public.ediel_test_field_values(data_set_id, test_case_code);

-- RLS: rulebook/systemtest data is platform-owned. Runtime access is through server actions/service role.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'ediel_rulebooks','ediel_rule_versions','ediel_field_rules','ediel_code_rules','ediel_ack_rules','ediel_message_build_rules',
    'ediel_test_cases','ediel_test_run_steps','ediel_test_artifacts','ediel_rule_change_logs','ediel_test_data_sets',
    'ediel_test_customers','ediel_test_facilities','ediel_test_metering_points','ediel_test_expected_values','ediel_test_expected_acks','ediel_test_field_values',
    'ediel_permission_cases','ediel_permission_events','ediel_ai_list_runs','ediel_ai_list_discrepancies'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
  end loop;
end $$;

-- Fix older wrong seed values if they exist.
update public.ediel_rule_versions
   set previous_version_code = null,
       updated_at = now()
 where message_family = 'PRODAT'
   and previous_version_code = '16B';

update public.ediel_ack_rules
   set requires_aperak = false,
       negative_aperak_on_error = true,
       updated_at = now()
 where message_family = 'PRODAT'
   and message_code = 'Z01';
