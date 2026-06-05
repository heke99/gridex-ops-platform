-- Batch 4: Canonical Ediel EDIFACT Rulebook + Field Matrix + Certification.
-- Additive/idempotent. Scope: PRODAT, UTILTS, APERAK, CONTRL, UTILTS_ERR.
-- Explicitly excludes NBS/XML/eSett, gas/naturgas, BRP/trader XML, ECP/EDX and full bilateral test manager.

begin;

create table if not exists public.ediel_field_matrix_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  batch_key text not null unique,
  version text not null,
  source text not null default 'admin_field_matrix_import',
  status text not null default 'review',
  row_count integer not null default 0,
  warning_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  raw_preview text null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_rule_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source_name text not null,
  source_version text null,
  valid_from date null,
  valid_to date null,
  market text not null default 'electricity',
  scope text not null default 'edifact',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_rule_compile_results (
  id uuid primary key default gen_random_uuid(),
  rule_profile_version_id uuid null references public.ediel_rule_profile_versions(id) on delete cascade,
  profile_key text not null,
  version text not null,
  status text not null default 'review',
  canonical_conflicts jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  compiled_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_rule_activation_log (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null,
  version text not null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_canonical_error_mappings (
  id uuid primary key default gen_random_uuid(),
  error_key text not null unique,
  ack_family text not null default 'APERAK',
  erc_code text not null,
  field_code text null,
  canonical_text text not null,
  source text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ediel_certification_test_runs (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null,
  role text not null,
  test_case_code text not null,
  portal_test_id text null,
  message_family text not null,
  message_code text not null,
  variant text null,
  direction text not null,
  status text not null default 'pending',
  expected_contrl text not null default 'positive',
  expected_business_response_family text not null,
  expected_business_outcome text not null,
  source text not null,
  notes text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_key, test_case_code)
);

create table if not exists public.ediel_certification_golden_results (
  id uuid primary key default gen_random_uuid(),
  test_case_code text not null unique,
  portal_test_id text null,
  status text not null,
  message_family text not null,
  message_code text not null,
  expected_ack_family text not null,
  expected_ack_outcome text not null,
  decision_rule_keys jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_ai_list_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  source text not null default 'ai_list_import',
  status text not null default 'review',
  row_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  raw_preview text null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create table if not exists public.ediel_masterdata_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id),
  item_type text not null,
  status text not null default 'open',
  confidence text not null default 'low',
  customer_id uuid null,
  site_id uuid null,
  metering_point_id uuid null,
  ediel_message_id uuid null references public.ediel_messages(id) on delete set null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

alter table if exists public.ediel_rule_profile_versions
  add column if not exists activated_at timestamptz null;

create index if not exists ediel_field_matrix_imports_status_idx on public.ediel_field_matrix_imports(status, created_at desc);
create index if not exists ediel_rule_profile_versions_status_idx on public.ediel_rule_profile_versions(profile_key, status, created_at desc);
create index if not exists ediel_field_matrix_rules_version_rule_idx on public.ediel_field_matrix_rules(rule_profile_version_id, rule_type, status);
create index if not exists ediel_rule_compile_results_profile_idx on public.ediel_rule_compile_results(profile_key, version, created_at desc);
create index if not exists ediel_rule_activation_log_profile_idx on public.ediel_rule_activation_log(profile_key, version, created_at desc);
create index if not exists ediel_certification_test_runs_status_idx on public.ediel_certification_test_runs(profile_key, status, test_case_code);
create index if not exists ediel_masterdata_reconciliation_items_status_idx on public.ediel_masterdata_reconciliation_items(company_id, status, created_at desc);

insert into public.ediel_rule_sources(source_key, source_name, source_version, valid_from, market, scope, payload)
values
  ('general_technical_24a6', 'Ediel generella tekniska regler', '24.A.6', '2026-02-20', 'electricity', 'edifact', '{"canonical":true}'::jsonb),
  ('prodat_26a_aperak_16b', 'PRODAT och APERAK', '26.A/16.B', '2026-04-01', 'electricity', 'edifact', '{"canonical":true}'::jsonb),
  ('agt_prodat_5_0_2', 'AGT PRODAT testanvisning', '5.0.2', '2025-05-22', 'electricity', 'edifact', '{"certification":true}'::jsonb),
  ('agt_utilts_5_0_0', 'AGT UTILTS testanvisning', '5.0.0', '2025-04-25', 'electricity', 'edifact', '{"certification":true}'::jsonb)
on conflict (source_key) do update set
  source_name = excluded.source_name,
  source_version = excluded.source_version,
  valid_from = excluded.valid_from,
  payload = public.ediel_rule_sources.payload || excluded.payload;

insert into public.ediel_canonical_error_mappings(error_key, ack_family, erc_code, field_code, canonical_text, source)
values
  ('OK', 'APERAK', '100', null, 'OK', 'Ediel APERAK positiv kvittens'),
  ('OBJECT_NOT_IDENTIFIED', 'APERAK', '40', '105', 'The object could not be identified', 'PRODAT/APERAK 16.B'),
  ('ACTOR_NOT_CONNECTED', 'APERAK', '40', '107', 'The actor is not connected to the object', 'PRODAT/APERAK 16.B'),
  ('INCORRECT_PERMISSION_STATUS', 'APERAK', '41', '322', 'INCORRECT DATA - permission status', 'PRODAT permission lifecycle'),
  ('INCORRECT_PERMISSION_END_REASON', 'APERAK', '41', '324', 'INCORRECT DATA - permission end reason', 'PRODAT permission lifecycle'),
  ('UTILTS_E31_INCORRECT_DATA', 'APERAK', '41', '511a', 'INCORRECT DATA', 'UTILTS E31 application validation'),
  ('MANDATORY_FIELD_MISSING', 'APERAK', '41', '512', 'MANDATORY FIELD MISSING', 'UTILTS/PRODAT application validation'),
  ('INCORRECT_METERING_POINT_ID', 'APERAK', '42', '209', 'INCORRECT DATA - metering point id', 'PRODAT object validation'),
  ('INCORRECT_GRID_AREA_ID', 'APERAK', '42', '260', 'INCORRECT DATA - grid area id', 'PRODAT object validation')
on conflict (error_key) do update set
  ack_family = excluded.ack_family,
  erc_code = excluded.erc_code,
  field_code = excluded.field_code,
  canonical_text = excluded.canonical_text,
  source = excluded.source,
  is_active = true;

insert into public.ediel_rule_profiles(profile_key, message_family, message_code, profile_name, description, active_version, payload)
values
  ('prodat_z01_customer_identity_request', 'PRODAT', 'Z01', 'PRODAT Z01 customer identity request', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z01_customer_identity_request'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z02_customer_identity_response', 'PRODAT', 'Z02', 'PRODAT Z02 customer identity response', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z02_customer_identity_response'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z03_supplier_switch', 'PRODAT', 'Z03', 'PRODAT Z03 supplier switch', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z03_supplier_switch'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z04_supplier_switch_confirmation', 'PRODAT', 'Z04', 'PRODAT Z04 supplier switch confirmation', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z04_supplier_switch_confirmation'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z05_old_supplier_confirmation', 'PRODAT', 'Z05', 'PRODAT Z05 old supplier confirmation', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z05_old_supplier_confirmation'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z06_masterdata_grid_to_supplier', 'PRODAT', 'Z06', 'PRODAT Z06 masterdata grid to supplier', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z06_masterdata_grid_to_supplier'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z08_contract_end', 'PRODAT', 'Z08', 'PRODAT Z08 contract end', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z08_contract_end'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z09_masterdata_supplier_to_grid', 'PRODAT', 'Z09', 'PRODAT Z09 masterdata supplier to grid', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z09_masterdata_supplier_to_grid'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z10_meter_change', 'PRODAT', 'Z10', 'PRODAT Z10 meter change', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z10_meter_change'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z13_permission_request', 'PRODAT', 'Z13', 'PRODAT Z13 permission request', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z13_permission_request'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z14_permission_response', 'PRODAT', 'Z14', 'PRODAT Z14 permission response', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z14_permission_response'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z15_permission_ended', 'PRODAT', 'Z15', 'PRODAT Z15 permission ended', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z15_permission_ended'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('prodat_z18_permission_end_request', 'PRODAT', 'Z18', 'PRODAT Z18 permission end request', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'prodat_z18_permission_end_request'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('utilts_e66', 'UTILTS', 'E66', 'UTILTS E66', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'utilts_e66'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('utilts_e31', 'UTILTS', 'E31', 'UTILTS E31', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'utilts_e31'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('utilts_s01', 'UTILTS', 'S01', 'UTILTS S01', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'utilts_s01'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('utilts_s02', 'UTILTS', 'S02', 'UTILTS S02', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'utilts_s02'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('utilts_s03', 'UTILTS', 'S03', 'UTILTS S03', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'utilts_s03'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb),
  ('utilts_s04', 'UTILTS', 'S04', 'UTILTS S04', 'Field Matrix + canonical rulebook profile.', coalesce((select active_version from public.ediel_rule_profiles where profile_key = 'utilts_s04'), 'foundation-v1'), '{"canonicalRulesLocked":true}'::jsonb)
on conflict (profile_key) do update set
  message_family = excluded.message_family,
  message_code = excluded.message_code,
  profile_name = excluded.profile_name,
  description = excluded.description,
  payload = public.ediel_rule_profiles.payload || excluded.payload,
  updated_at = now();

insert into public.ediel_rule_profile_versions(profile_key, version, status, rules)
select profile_key, 'foundation-v1', 'active', jsonb_build_object(
  'canonicalRulesLocked', true,
  'source', 'batch4_canonical_edifact_rulebook',
  'scope', 'PRODAT_UTILTS_APERAK_CONTRL_UTILTS_ERR',
  'excluded', jsonb_build_array('NBS_XML_ESETT','GAS','ECP_EDX','FULL_BILATERAL_MANAGER')
)
from public.ediel_rule_profiles
where profile_key in (
  'prodat_z01_customer_identity_request','prodat_z02_customer_identity_response','prodat_z03_supplier_switch','prodat_z04_supplier_switch_confirmation','prodat_z05_old_supplier_confirmation','prodat_z06_masterdata_grid_to_supplier','prodat_z08_contract_end','prodat_z09_masterdata_supplier_to_grid','prodat_z10_meter_change','prodat_z13_permission_request','prodat_z14_permission_response','prodat_z15_permission_ended','prodat_z18_permission_end_request','utilts_e66','utilts_e31','utilts_s01','utilts_s02','utilts_s03','utilts_s04','contrl','aperak','utilts_err'
)
on conflict (profile_key, version) do nothing;

update public.ediel_rule_profile_versions v
set rule_profile_id = p.id
from public.ediel_rule_profiles p
where v.profile_key = p.profile_key and v.rule_profile_id is null;

insert into public.ediel_certification_test_runs(profile_key, role, test_case_code, portal_test_id, message_family, message_code, variant, direction, status, expected_contrl, expected_business_response_family, expected_business_outcome, source, notes, payload)
values
  ('supplier_prodat_agt','supplier','L1','388756','PRODAT','Z03',null,'actor_to_portal','approved','positive','INCOMING_APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_prodat_agt','supplier','L2','388764','PRODAT','Z04',null,'portal_to_actor','approved','positive','APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_prodat_agt','supplier','L3','388765','PRODAT','Z05',null,'portal_to_actor','approved','positive','APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_prodat_agt','supplier','L4','388766','PRODAT','Z06',null,'portal_to_actor','approved','positive','APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_prodat_agt','supplier','L5','388767','PRODAT','Z10',null,'portal_to_actor','approved','positive','APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_prodat_agt','supplier','L7','388809','PRODAT','Z09',null,'actor_to_portal','approved','positive','INCOMING_APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_utilts_agt','supplier','UL1','388810','UTILTS','S03',null,'portal_to_actor','approved','positive','UTILTS_ERR','negative','AGT UTILTS 5.0.0','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_utilts_agt','supplier','UL2','388811','UTILTS','E66','KVART','portal_to_actor','approved','positive','UTILTS_ERR','negative','AGT UTILTS 5.0.0','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_utilts_agt','supplier','UL3','388812','UTILTS','E66','SCH','portal_to_actor','approved','positive','UTILTS_ERR','negative','AGT UTILTS 5.0.0','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_utilts_agt','supplier','UL4','388813','UTILTS','S02',null,'portal_to_actor','approved','positive','UTILTS_ERR','negative','AGT UTILTS 5.0.0','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('supplier_utilts_agt','supplier','UL6','388814','UTILTS','E31','SCH','portal_to_actor','approved','positive','UTILTS_ERR','negative','AGT UTILTS 5.0.0','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('energy_service_prodat_agt','energy_service_company','E3','389178','PRODAT','Z13','V','actor_to_portal','approved','positive','INCOMING_APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('energy_service_prodat_agt','energy_service_company','E4',null,'PRODAT','Z13','VH','actor_to_portal','pending','positive','INCOMING_APERAK','negative','AGT PRODAT 5.0.2','Pending readiness.','{"golden":false}'::jsonb),
  ('energy_service_prodat_agt','energy_service_company','E5','389280','PRODAT','Z14','V','portal_to_actor','approved','positive','APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Skyddad regression.','{"golden":true}'::jsonb),
  ('energy_service_prodat_agt','energy_service_company','E6','389301','PRODAT','Z14','N','portal_to_actor','approved','positive','APERAK','negative','AGT PRODAT 5.0.2','Godkänt. Backend negative APERAK är facit.','{"golden":true}'::jsonb),
  ('energy_service_prodat_agt','energy_service_company','E7','389303','PRODAT','Z15','V','portal_to_actor','failed','positive','APERAK','negative','AGT PRODAT 5.0.2','Aktivt fixmål.','{"golden":false}'::jsonb),
  ('energy_service_prodat_agt','energy_service_company','E8',null,'PRODAT','Z18','V','actor_to_portal','pending','positive','INCOMING_APERAK','negative','AGT PRODAT 5.0.2','Pending readiness.','{"golden":false}'::jsonb),
  ('energy_service_utilts_agt','energy_service_company','UE1',null,'UTILTS','E66','KVART','portal_to_actor','pending','positive','UTILTS_ERR','negative','AGT UTILTS 5.0.0','Pending readiness.','{"golden":false}'::jsonb),
  ('energy_service_utilts_agt','energy_service_company','UE2',null,'UTILTS','E66','SCH','portal_to_actor','pending','positive','UTILTS_ERR','negative','AGT UTILTS 5.0.0','Pending readiness.','{"golden":false}'::jsonb)
on conflict(profile_key, test_case_code) do update set
  portal_test_id = excluded.portal_test_id,
  message_family = excluded.message_family,
  message_code = excluded.message_code,
  variant = excluded.variant,
  direction = excluded.direction,
  status = excluded.status,
  expected_contrl = excluded.expected_contrl,
  expected_business_response_family = excluded.expected_business_response_family,
  expected_business_outcome = excluded.expected_business_outcome,
  notes = excluded.notes,
  payload = public.ediel_certification_test_runs.payload || excluded.payload,
  updated_at = now();

insert into public.ediel_certification_golden_results(test_case_code, portal_test_id, status, message_family, message_code, expected_ack_family, expected_ack_outcome, decision_rule_keys, payload)
select test_case_code, portal_test_id, 'approved', message_family, message_code, expected_business_response_family, expected_business_outcome,
  jsonb_build_array(profile_key, message_family || '_' || message_code, 'backend_decision_engine'), payload
from public.ediel_certification_test_runs
where status = 'approved'
on conflict(test_case_code) do update set
  portal_test_id = excluded.portal_test_id,
  status = excluded.status,
  message_family = excluded.message_family,
  message_code = excluded.message_code,
  expected_ack_family = excluded.expected_ack_family,
  expected_ack_outcome = excluded.expected_ack_outcome,
  decision_rule_keys = excluded.decision_rule_keys,
  payload = excluded.payload,
  updated_at = now();

commit;
