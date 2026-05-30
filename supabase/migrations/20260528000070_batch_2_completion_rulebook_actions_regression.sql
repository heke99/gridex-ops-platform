-- Batch 2 completion — rulebook actions, regression steps, parser artifacts and seed data.
-- Idempotent and non-destructive. Does not alter approved Ediel runtime messages.

create extension if not exists pgcrypto;

alter table if exists public.ediel_test_runs add column if not exists actor_profile_id uuid null;
alter table if exists public.ediel_test_runs add column if not exists environment text null default 'test';
alter table if exists public.ediel_test_runs add column if not exists rule_version_id uuid null;
alter table if exists public.ediel_test_runs add column if not exists timeline jsonb not null default '[]'::jsonb;

create table if not exists public.ediel_test_run_steps (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid not null references public.ediel_test_runs(id) on delete cascade,
  step_no integer not null,
  name text not null,
  status text not null default 'pending',
  expected_family text null,
  expected_code text null,
  expected_direction text null,
  expected_ack text null,
  actual_family text null,
  actual_code text null,
  ediel_message_id uuid null,
  validation_report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_test_run_steps_unique_step_idx
  on public.ediel_test_run_steps(test_run_id, step_no);

create index if not exists ediel_test_run_steps_status_idx
  on public.ediel_test_run_steps(test_run_id, status, step_no);

alter table if exists public.ediel_test_artifacts add column if not exists source_file_name text null;
alter table if exists public.ediel_test_artifacts add column if not exists diff_report jsonb not null default '{}'::jsonb;

create index if not exists ediel_test_artifacts_run_type_idx
  on public.ediel_test_artifacts(test_run_id, artifact_type, created_at desc);

-- Seed the rule matrices that the UI/actions expect. More detailed imported matrices can be added later.
insert into public.ediel_field_rules(message_family, message_code, subtype, field_key, field_label, segment_path, requirement, condition, allowed_values, error_code_if_missing, error_code_if_invalid)
values
  ('PRODAT','Z01',null,'application_reference','Application Reference','UNB/0026','required',null,'["23-DDQ-PRODAT"]'::jsonb,null,null),
  ('PRODAT','Z03',null,'application_reference','Application Reference','UNB/0026','required',null,'["23-DDQ-PRODAT"]'::jsonb,null,null),
  ('PRODAT','Z13',null,'application_reference','Application Reference','UNB/0026','required',null,'["23-DGI-PRODAT"]'::jsonb,null,null),
  ('PRODAT','Z18',null,'application_reference','Application Reference','UNB/0026','required',null,'["23-DGI-PRODAT"]'::jsonb,null,null),
  ('PRODAT','*',null,'message_code','PRODAT-funktion','BGM/1001','required','BGM ska vara Z01/Z02/Z03 osv. Undertyp får aldrig bakas in i BGM.','[]'::jsonb,null,null),
  ('PRODAT','*',null,'case_reference','Ärendereferens','SG8/RFF+LI','required',null,'[]'::jsonb,null,null),
  ('PRODAT','Z03',null,'transaction_type','Transaktionstyp','SG14/CCI-CAV','required','Z03L/Z03LK/Z03C anges som transaktionstyp, inte som BGM.','["Z22","Z23","Z24"]'::jsonb,null,null),
  ('PRODAT','Z13',null,'transaction_type','Transaktionstyp','SG14/CCI-CAV','required','Z13V/Z13VH anges som S17/S18.','["S17","S18"]'::jsonb,null,null),
  ('PRODAT','Z13',null,'agreement_reference','Avtals-/fullmaktsreferens','SG8/RFF+ANJ','required','Z13 kräver avtal/fullmakt med elanvändaren.','[]'::jsonb,null,null),
  ('UTILTS','E66',null,'registration_timestamp','Registreringstidpunkt','DTM+597','required','E66 kvart/tim kräver riktigt datumvärde. Saknas datum ska negativ APERAK 41/512 skapas.','[]'::jsonb,'512','512'),
  ('UTILTS','E31',null,'negative_final_share','Negativt slutligt andelstal','QTY+136','dependent','Negativt slutligt andelstal i E31 SCH är anvisningsfel och ska ge negativ APERAK 41/511a.','[]'::jsonb,'511a','511a'),
  ('AI_LIST','AI',null,'file_extension','Filändelse','file.extension','required','Från 2025-10-01 ska AI-listan stödja .csv.','["csv"]'::jsonb,null,null),
  ('AI_LIST','AI',null,'version_marker','Versionsmarkering','file.version','required','Version ska fortsatt vara Ver20140401.','["Ver20140401"]'::jsonb,null,null)
on conflict do nothing;

insert into public.ediel_ack_rules(message_family, message_code, requires_contrl, requires_aperak, send_negative_aperak_on_error, send_utilts_err_on_functional_error, ack_deadline_minutes, status, notes)
values
  ('PRODAT','Z01',true,true,true,false,30,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('PRODAT','Z03',true,true,true,false,30,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('PRODAT','Z13',true,true,true,false,30,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('PRODAT','Z18',true,true,true,false,30,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('UTILTS','E66',true,true,true,true,30,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('UTILTS','E31',true,true,true,true,30,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('APERAK','APERAK',true,false,false,false,30,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('CONTRL','CONTRL',false,false,false,false,null,'active','{"seed":"batch_2_completion"}'::jsonb),
  ('UTILTS_ERR','UTILTS_ERR',false,false,false,false,null,'active','{"seed":"batch_2_completion"}'::jsonb)
on conflict (message_family, message_code, status) do update set
  requires_contrl = excluded.requires_contrl,
  requires_aperak = excluded.requires_aperak,
  send_negative_aperak_on_error = excluded.send_negative_aperak_on_error,
  send_utilts_err_on_functional_error = excluded.send_utilts_err_on_functional_error,
  ack_deadline_minutes = excluded.ack_deadline_minutes,
  updated_at = now();

insert into public.ediel_message_build_rules(message_family, message_code, subtype, business_process, default_application_reference, builder_key, status, notes)
values
  ('PRODAT','Z01',null,'customer_masterdata','23-DDQ-PRODAT','rulebook_prodat_builder','active','{"bgm":"Z01"}'::jsonb),
  ('PRODAT','Z03',null,'supplier_switch','23-DDQ-PRODAT','rulebook_prodat_builder','active','{"bgm":"Z03","subtype":"CCI/CAV"}'::jsonb),
  ('PRODAT','Z13',null,'metering_access','23-DGI-PRODAT','rulebook_prodat_builder','active','{"bgm":"Z13","subtype":"CCI/CAV"}'::jsonb),
  ('PRODAT','Z18',null,'metering_access','23-DGI-PRODAT','rulebook_prodat_builder','active','{"bgm":"Z18","subtype":"CCI/CAV"}'::jsonb),
  ('UTILTS','E66',null,'meter_values','23-DDQ-UTILTS','rulebook_utilts_builder','active','{"status":"partial_until_full_utilts_matrix_import"}'::jsonb)
on conflict do nothing;

alter table public.ediel_test_run_steps enable row level security;
