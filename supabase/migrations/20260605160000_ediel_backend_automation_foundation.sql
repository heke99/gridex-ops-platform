-- Gridex Ediel backend automation foundation.
-- Idempotent, additive migration: no destructive changes.

begin;

create table if not exists public.ediel_processing_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  source_message_id uuid null references public.ediel_messages(id) on delete set null,
  status text not null default 'running',
  context text not null default 'unknown',
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.ediel_decision_traces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  source_message_id uuid null references public.ediel_messages(id) on delete set null,
  processing_run_id uuid null references public.ediel_processing_runs(id) on delete set null,
  decision text not null,
  ack_family text null,
  outcome text null,
  confidence text null,
  can_auto_send boolean not null default false,
  rule_profile text null,
  rule_profile_version text null,
  backend_rule_keys text[] not null default '{}'::text[],
  reasons jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  application_errors jsonb not null default '[]'::jsonb,
  ack_payload_intent jsonb not null default '{}'::jsonb,
  business_match jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  source_message_id uuid null references public.ediel_messages(id) on delete set null,
  status text not null default 'prepared',
  priority integer not null default 100,
  lock_key text not null,
  message_family text null,
  message_code text null,
  ack_outcome text null,
  environment text not null default 'test',
  route_profile_id uuid null,
  attempts integer not null default 0,
  last_error text null,
  payload jsonb not null default '{}'::jsonb,
  queued_at timestamptz null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint ediel_outbox_status_check check (status in ('draft','prepared','queued','sending','sent','failed','superseded','blocked'))
);

create unique index if not exists ediel_outbox_lock_key_uidx on public.ediel_outbox(lock_key);

create table if not exists public.ediel_ack_lifecycle (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  source_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  ack_message_id uuid null references public.ediel_messages(id) on delete set null,
  ack_family text not null,
  desired_outcome text null,
  lifecycle_status text not null,
  reason text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_process_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  business_object_type text not null,
  business_object_id uuid null,
  confidence text not null default 'low',
  score integer not null default 0,
  reason text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_match_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  entity_type text not null,
  entity_id uuid null,
  confidence text not null default 'low',
  score integer not null default 0,
  reason text null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'candidate',
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_portal_validation_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  ediel_message_id uuid null references public.ediel_messages(id) on delete set null,
  test_run_id uuid null,
  test_case_code text null,
  step text null,
  expected_ack_type text null,
  expected_outcome text null,
  expected_erc text null,
  expected_ftx text null,
  actual_ack_type text null,
  actual_outcome text null,
  actual_erc text null,
  actual_ftx text null,
  diff text null,
  status text not null default 'unknown',
  raw_report text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_sla_timers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  timer_type text not null,
  status text not null default 'open',
  due_at timestamptz not null,
  warning_at timestamptz null,
  critical_at timestamptz null,
  triggered_at timestamptz null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create unique index if not exists ediel_sla_timers_message_type_uidx on public.ediel_sla_timers(ediel_message_id, timer_type);

create table if not exists public.ediel_rule_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  profile_key text not null unique,
  message_family text not null,
  message_code text null,
  profile_name text not null,
  description text null,
  active_version text null,
  is_active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.ediel_rule_profile_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  rule_profile_id uuid null references public.ediel_rule_profiles(id) on delete cascade,
  profile_key text not null,
  version text not null,
  status text not null default 'draft',
  rules jsonb not null default '{}'::jsonb,
  activated_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  unique(profile_key, version)
);

create table if not exists public.ediel_field_matrix_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  rule_profile_version_id uuid null references public.ediel_rule_profile_versions(id) on delete cascade,
  profile_key text not null,
  message_family text not null,
  message_code text null,
  segment text not null,
  qualifier text null,
  rule_type text not null,
  rule_payload jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid null
);

-- The operational project may already have Ediel-named tables from earlier batches.
-- Do not CREATE OR REPLACE VIEW over an existing table; that fails with
-- ERROR 42809: "<relation>" is not a view. Keep this additive and non-destructive.
do $$
declare
  relation_kind text;
  has_energy_permissions boolean;
  has_energy_permission_events boolean;
  has_unresolved_items boolean;
begin
  select c.relkind::text into relation_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'ediel_permissions';

  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'energy_service_permissions'
  ) into has_energy_permissions;

  if relation_kind is null and has_energy_permissions then
    execute $view$
      create view public.ediel_permissions as
      select
        id,
        company_id,
        permission_reference,
        agreement_reference as external_permission_id,
        metering_point_id,
        customer_id,
        null::uuid as site_id,
        status,
        active_from as valid_from,
        active_to as valid_to,
        metadata,
        created_at,
        updated_at
      from public.energy_service_permissions
    $view$;
  elsif relation_kind = 'v' and has_energy_permissions then
    execute $view$
      create or replace view public.ediel_permissions as
      select
        id,
        company_id,
        permission_reference,
        agreement_reference as external_permission_id,
        metering_point_id,
        customer_id,
        null::uuid as site_id,
        status,
        active_from as valid_from,
        active_to as valid_to,
        metadata,
        created_at,
        updated_at
      from public.energy_service_permissions
    $view$;
  elsif relation_kind is null then
    create table public.ediel_permissions (
      id uuid primary key default gen_random_uuid(),
      company_id uuid null references public.companies(id),
      permission_reference text null,
      external_permission_id text null,
      metering_point_id uuid null,
      customer_id uuid null,
      site_id uuid null,
      status text null,
      valid_from timestamptz null,
      valid_to timestamptz null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  end if;

  relation_kind := null;
  select c.relkind::text into relation_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'ediel_permission_events';

  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'energy_service_permission_events'
  ) into has_energy_permission_events;

  if relation_kind is null and has_energy_permission_events then
    execute $view$
      create view public.ediel_permission_events as
      select
        id,
        company_id,
        permission_id,
        event_type,
        event_status,
        message,
        payload,
        created_by,
        created_at
      from public.energy_service_permission_events
    $view$;
  elsif relation_kind = 'v' and has_energy_permission_events then
    execute $view$
      create or replace view public.ediel_permission_events as
      select
        id,
        company_id,
        permission_id,
        event_type,
        event_status,
        message,
        payload,
        created_by,
        created_at
      from public.energy_service_permission_events
    $view$;
  elsif relation_kind is null then
    create table public.ediel_permission_events (
      id uuid primary key default gen_random_uuid(),
      company_id uuid null references public.companies(id),
      permission_id uuid null,
      event_type text null,
      event_status text null,
      message text null,
      payload jsonb not null default '{}'::jsonb,
      created_by uuid null,
      created_at timestamptz not null default now()
    );
  end if;

  relation_kind := null;
  select c.relkind::text into relation_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'ediel_unresolved_messages';

  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ediel_unresolved_items'
  ) into has_unresolved_items;

  if relation_kind is null and has_unresolved_items then
    execute 'create view public.ediel_unresolved_messages as select * from public.ediel_unresolved_items';
  elsif relation_kind = 'v' and has_unresolved_items then
    execute 'create or replace view public.ediel_unresolved_messages as select * from public.ediel_unresolved_items';
  elsif relation_kind is null then
    create table public.ediel_unresolved_messages (
      id uuid primary key default gen_random_uuid(),
      company_id uuid null references public.companies(id),
      ediel_message_id uuid null references public.ediel_messages(id) on delete set null,
      reason text not null default 'unknown',
      status text not null default 'open',
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      created_by uuid null,
      updated_by uuid null
    );
  end if;
end $$;

create index if not exists ediel_processing_runs_company_status_idx on public.ediel_processing_runs(company_id, status, created_at desc);
create index if not exists ediel_decision_traces_source_idx on public.ediel_decision_traces(source_message_id, created_at desc);
create index if not exists ediel_ack_lifecycle_source_idx on public.ediel_ack_lifecycle(source_message_id, created_at desc);
create index if not exists ediel_process_links_message_idx on public.ediel_process_links(ediel_message_id, confidence, created_at desc);
create index if not exists ediel_match_candidates_message_idx on public.ediel_match_candidates(ediel_message_id, confidence, score desc);
create index if not exists ediel_portal_validation_feedback_case_idx on public.ediel_portal_validation_feedback(test_case_code, status, created_at desc);
create index if not exists ediel_sla_timers_status_due_idx on public.ediel_sla_timers(status, due_at);
create index if not exists ediel_rule_profiles_family_code_idx on public.ediel_rule_profiles(message_family, message_code, is_active);
create index if not exists ediel_field_matrix_rules_profile_idx on public.ediel_field_matrix_rules(profile_key, message_family, message_code, status);

alter table if exists public.ediel_messages
  add column if not exists backend_automation_status text null,
  add column if not exists backend_automation_reason text null;

-- Seed canonical profile shells. Real field matrix import can later activate full versions.
insert into public.ediel_rule_profiles(profile_key, message_family, message_code, profile_name, description, active_version, payload)
values
  ('prodat_z13_permission_request','PRODAT','Z13','PRODAT Z13 permission request','Begäran om tillgång till mätvärden.','foundation-v1','{}'::jsonb),
  ('prodat_z14_permission_response','PRODAT','Z14','PRODAT Z14 permission response','Tillgång godkänd/nekad/historisk.','foundation-v1','{}'::jsonb),
  ('prodat_z15_permission_ended','PRODAT','Z15','PRODAT Z15 permission ended','Aktivt tillstånd upphör.','foundation-v1','{}'::jsonb),
  ('prodat_z18_permission_end_request','PRODAT','Z18','PRODAT Z18 permission end request','Begäran om avslut av rapportering.','foundation-v1','{}'::jsonb),
  ('utilts_e66','UTILTS','E66','UTILTS E66','Mätvärden.','foundation-v1','{}'::jsonb),
  ('utilts_e31','UTILTS','E31','UTILTS E31','Andelstal/struktur.','foundation-v1','{}'::jsonb),
  ('contrl','CONTRL','CONTRL','CONTRL','Syntaxkvittens.','foundation-v1','{}'::jsonb),
  ('aperak','APERAK','APERAK','APERAK','Applikationskvittens.','foundation-v1','{}'::jsonb),
  ('utilts_err','UTILTS_ERR','ERR','UTILTS_ERR','Funktions-/processfel för UTILTS.','foundation-v1','{}'::jsonb)
on conflict (profile_key) do update set
  message_family = excluded.message_family,
  message_code = excluded.message_code,
  profile_name = excluded.profile_name,
  description = excluded.description,
  active_version = coalesce(public.ediel_rule_profiles.active_version, excluded.active_version),
  updated_at = now();

insert into public.ediel_rule_profile_versions(profile_key, version, status, rules)
select profile_key, 'foundation-v1', 'active', jsonb_build_object(
  'autoSendPolicy', 'backend_decision_high_confidence_only',
  'manualReviewTriggers', jsonb_build_array('unknown_tenant','ambiguous_process_match','customer_match_low_confidence','metering_point_match_low_confidence','wrong_final_ack_exists'),
  'source', '20260605160000_ediel_backend_automation_foundation'
)
from public.ediel_rule_profiles
where profile_key in ('prodat_z13_permission_request','prodat_z14_permission_response','prodat_z15_permission_ended','prodat_z18_permission_end_request','utilts_e66','utilts_e31','contrl','aperak','utilts_err')
on conflict (profile_key, version) do nothing;

update public.ediel_rule_profile_versions v
set rule_profile_id = p.id
from public.ediel_rule_profiles p
where v.profile_key = p.profile_key and v.rule_profile_id is null;

do $$
declare
  t text;
  select_policy text;
  insert_policy text;
  update_policy text;
begin
  foreach t in array array[
    'ediel_processing_runs',
    'ediel_decision_traces',
    'ediel_outbox',
    'ediel_ack_lifecycle',
    'ediel_process_links',
    'ediel_match_candidates',
    'ediel_portal_validation_feedback',
    'ediel_sla_timers',
    'ediel_rule_profiles',
    'ediel_rule_profile_versions',
    'ediel_field_matrix_rules'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    select_policy := t || '_tenant_select';
    insert_policy := t || '_tenant_insert';
    update_policy := t || '_tenant_update';

    if to_regprocedure('public.gridex_user_is_platform_admin()') is not null
       and to_regprocedure('public.gridex_can_read_company(uuid)') is not null
       and to_regprocedure('public.gridex_can_write_company(uuid)') is not null then
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = select_policy) then
        execute format(
          'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)))',
          select_policy,
          t
        );
      end if;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = insert_policy) then
        execute format(
          'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))',
          insert_policy,
          t
        );
      end if;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = update_policy) then
        execute format(
          'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id))) with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))',
          update_policy,
          t
        );
      end if;
    end if;
  end loop;
end $$;

commit;
