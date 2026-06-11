-- Batch: Actor Registry + Ediel Message Semantics + Tenant-Safe Automation
-- Production-safe foundation for points 1-54: actor imports, message semantics,
-- facility-data errors, manual review, retry/SLA, and no-crash customer application handling.

create extension if not exists pgcrypto with schema extensions;

-- 1) Platform actor registry imported from Ediel companies.xml / CSV / manual verification.
create table if not exists public.platform_market_actors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(coalesce(name, ''), '\\s+', ' ', 'g'))) stored,
  country_code text not null default 'SE',
  org_number text,
  legal_name text,
  status text not null default 'active' check (status in ('active','inactive','deprecated','blocked','needs_review')),
  match_status text not null default 'needs_review' check (match_status in ('verified','strong_suggestion','needs_review')),
  source text not null default 'manual',
  source_reference text,
  visible_to_tenants boolean not null default false,
  verified_at timestamptz,
  verified_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_market_actors_normalized_name_uidx on public.platform_market_actors (normalized_name);
create index if not exists platform_market_actors_status_idx on public.platform_market_actors (status, match_status, visible_to_tenants);
create index if not exists platform_market_actors_org_idx on public.platform_market_actors (org_number) where org_number is not null;

create table if not exists public.platform_actor_identifiers (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.platform_market_actors(id) on delete cascade,
  identifier_type text not null,
  identifier_value text not null,
  id_code_qualifier text,
  id_code_responsible text,
  source text not null default 'companies_xml',
  is_verified boolean not null default false,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_actor_identifiers_uidx on public.platform_actor_identifiers (identifier_type, identifier_value);
create index if not exists platform_actor_identifiers_actor_idx on public.platform_actor_identifiers (actor_id);

create table if not exists public.platform_actor_roles (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.platform_market_actors(id) on delete cascade,
  actor_role text not null,
  role_source text not null default 'companies_xml',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_actor_roles_uidx on public.platform_actor_roles (actor_id, actor_role);
create index if not exists platform_actor_roles_role_idx on public.platform_actor_roles (actor_role, is_active);

create table if not exists public.platform_actor_aliases (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.platform_market_actors(id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (lower(regexp_replace(coalesce(alias, ''), '\\s+', ' ', 'g'))) stored,
  alias_source text not null default 'system',
  confidence numeric(5,4) not null default 1,
  is_verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_actor_aliases_uidx on public.platform_actor_aliases (actor_id, normalized_alias);
create index if not exists platform_actor_aliases_lookup_idx on public.platform_actor_aliases (normalized_alias);

create table if not exists public.platform_actor_routes (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.platform_market_actors(id) on delete cascade,
  message_family text not null,
  application_reference text,
  environment text not null default 'production' check (environment in ('test','production')),
  subaddress text,
  communication_type text,
  communication_address text,
  edi_charset text,
  edi_syntax text,
  party_id text,
  party_id_qualifier text,
  party_id_responsible text,
  interchange_party_id text,
  interchange_id_qualifier text,
  requires_poa boolean not null default true,
  is_verified boolean not null default false,
  auto_send_allowed boolean not null default false,
  status text not null default 'needs_review' check (status in ('active','inactive','needs_review','blocked')),
  valid_from date,
  valid_to date,
  source text not null default 'companies_xml',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_actor_routes_uidx on public.platform_actor_routes (
  actor_id,
  upper(message_family),
  environment,
  coalesce(subaddress, ''),
  coalesce(communication_address, '')
);
create index if not exists platform_actor_routes_lookup_idx on public.platform_actor_routes (upper(message_family), environment, status, is_verified);

create table if not exists public.platform_actor_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  import_type text not null default 'companies_xml',
  status text not null default 'running' check (status in ('running','completed','completed_with_warnings','failed','cancelled')),
  records_seen integer not null default 0,
  records_upserted integer not null default 0,
  records_failed integer not null default 0,
  safe boolean not null default true,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  error_log jsonb not null default '[]'::jsonb
);

create table if not exists public.platform_actor_import_issues (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid references public.platform_actor_import_runs(id) on delete cascade,
  actor_id uuid references public.platform_market_actors(id) on delete set null,
  issue_type text not null,
  severity text not null default 'warning' check (severity in ('info','warning','blocking')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists platform_actor_import_issues_lookup_idx on public.platform_actor_import_issues (issue_type, status, severity);

-- 2) Message semantics engine. This is the safe catalog used by route/request resolution.
create table if not exists public.ediel_message_semantics (
  id uuid primary key default gen_random_uuid(),
  message_family text not null,
  message_code text not null,
  subtype text,
  direction text not null check (direction in ('inbound','outbound','both')),
  sender_role text,
  receiver_role text,
  business_process text not null,
  request_type text,
  expected_response text[] not null default '{}'::text[],
  allowed_next_status text[] not null default '{}'::text[],
  required_fields text[] not null default '{}'::text[],
  forbidden_if_missing text[] not null default '{}'::text[],
  ack_policy text not null default 'technical_and_application',
  timeout_policy text not null default 'standard_market_sla',
  rule_version text not null default '2026-06-11.actor-registry-automation',
  environment text not null default 'both' check (environment in ('test','production','both')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_message_semantics_uidx on public.ediel_message_semantics (
  upper(message_family), upper(message_code), coalesce(subtype, ''), direction, environment, rule_version
);
create index if not exists ediel_message_semantics_lookup_idx on public.ediel_message_semantics (upper(message_family), upper(message_code), business_process, is_active);

create table if not exists public.ediel_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  message_family text,
  message_code text,
  message_standard text not null default 'edifact',
  version_code text not null default '2026-06-11.actor-registry-automation',
  status text not null default 'active',
  schema_version text,
  source text not null default 'gridex_runtime',
  environment text not null default 'both' check (environment in ('test','production','both')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibility guard: older Gridex migrations may already have created
-- ediel_rule_versions without rule_key/schema_version/source/environment/metadata.
-- Add the new columns without dropping existing rulebook columns or constraints.
alter table public.ediel_rule_versions add column if not exists rule_key text;
alter table public.ediel_rule_versions add column if not exists message_standard text not null default 'edifact';
alter table public.ediel_rule_versions add column if not exists version_code text not null default '2026-06-11.actor-registry-automation';
alter table public.ediel_rule_versions add column if not exists status text not null default 'active';
alter table public.ediel_rule_versions add column if not exists schema_version text;
alter table public.ediel_rule_versions add column if not exists source text not null default 'gridex_runtime';
alter table public.ediel_rule_versions add column if not exists environment text not null default 'both';
alter table public.ediel_rule_versions add column if not exists is_active boolean not null default true;
alter table public.ediel_rule_versions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.ediel_rule_versions add column if not exists notes jsonb not null default '{}'::jsonb;

update public.ediel_rule_versions
set rule_key = concat_ws('.', 'legacy', coalesce(message_family, 'unknown'), coalesce(message_code, 'unknown'), coalesce(version_code, 'unknown'), id::text)
where rule_key is null;

create unique index if not exists ediel_rule_versions_rule_key_uidx
  on public.ediel_rule_versions (rule_key)
  where rule_key is not null;

create unique index if not exists ediel_rule_versions_uidx on public.ediel_rule_versions (
  coalesce(rule_key, ''),
  coalesce(message_family, ''),
  coalesce(message_code, ''),
  environment,
  valid_from
);

-- 3) Controlled business errors for facility/metering/APERAK/Z02. These replace crashes/internal_error.
create table if not exists public.ediel_error_code_mappings (
  id uuid primary key default gen_random_uuid(),
  message_family text,
  ack_type text not null,
  error_code text,
  error_text text,
  business_error text not null,
  recommended_action text not null,
  retry_allowed boolean not null default false,
  requires_customer_contact boolean not null default false,
  requires_grid_owner_contact boolean not null default false,
  requires_superadmin_review boolean not null default false,
  severity text not null default 'blocking' check (severity in ('info','warning','blocking')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ediel_error_code_mappings_uidx on public.ediel_error_code_mappings (
  coalesce(message_family, ''), ack_type, coalesce(error_code, ''), business_error
);

create table if not exists public.facility_data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  metering_point_id uuid references public.metering_points(id) on delete set null,
  customer_application_id uuid,
  grid_owner_id uuid,
  issue_type text not null,
  status text not null default 'open' check (status in ('open','waiting_customer','waiting_grid_owner','waiting_superadmin','resolved','ignored')),
  severity text not null default 'blocking' check (severity in ('info','warning','blocking')),
  facility_id text,
  ediel_metering_point_id text,
  grid_area_code text,
  price_area text,
  source text not null default 'system',
  source_actor_id uuid,
  source_error_code text,
  source_error_text text,
  recommended_action text not null,
  retry_allowed boolean not null default false,
  next_readiness_required boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists facility_data_quality_issues_company_idx on public.facility_data_quality_issues (company_id, status, issue_type, created_at desc);
create index if not exists facility_data_quality_issues_facility_idx on public.facility_data_quality_issues (company_id, facility_id) where facility_id is not null;

create table if not exists public.ediel_business_errors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  metering_point_id uuid references public.metering_points(id) on delete set null,
  customer_application_id uuid,
  ediel_message_id uuid,
  related_message_id uuid,
  message_family text,
  ack_type text,
  error_code text,
  error_text text,
  business_error text not null,
  recommended_action text not null,
  status text not null default 'open' check (status in ('open','waiting_customer','waiting_grid_owner','waiting_superadmin','resolved','ignored')),
  retry_allowed boolean not null default false,
  source text not null default 'ediel_runtime',
  rule_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists ediel_business_errors_company_idx on public.ediel_business_errors (company_id, status, business_error, created_at desc);

create table if not exists public.customer_correction_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  customer_application_id uuid,
  issue_type text not null,
  status text not null default 'draft' check (status in ('draft','sent','waiting_customer','received','verified','cancelled')),
  requested_fields text[] not null default '{}'::text[],
  public_token_hash text,
  expires_at timestamptz,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists customer_correction_requests_company_idx on public.customer_correction_requests (company_id, status, created_at desc);

-- Extend existing operational status constraints without dropping data.
alter table public.customer_site_resolution drop constraint if exists customer_site_resolution_resolution_status_check;
alter table public.customer_site_resolution
  add constraint customer_site_resolution_resolution_status_check check (resolution_status in (
    'postal_suggested','address_resolved','grid_area_resolved','grid_area_master_validated',
    'facility_data_requested','facility_data_received','facility_verified','needs_review','failed',
    'facility_data_invalid','customer_information_mismatch','grid_owner_rejected_request',
    'negative_aperak_received','z02_rejected','needs_customer_correction','needs_grid_owner_followup',
    'protected_identity'
  ));

alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_status_check;
alter table public.grid_owner_information_requests
  add constraint grid_owner_information_requests_status_check check (status in (
    'draft','ready_to_send','sent','waiting_response','received','completed','failed','needs_review',
    'facility_data_invalid','customer_information_mismatch','grid_owner_rejected_request','negative_aperak_received',
    'z02_rejected','needs_customer_correction','needs_grid_owner_followup','timeout','retry_blocked'
  ));

alter table public.website_customer_applications drop constraint if exists website_customer_applications_status_check;
alter table public.website_customer_applications
  add constraint website_customer_applications_status_check check (
    status in (
      'received','customer_created','customer_matched','contract_created','confirmation_pending','confirmation_sent',
      'cooling_off_sent','webhook_pending','completed','application_received','linked_existing_customer',
      'needs_address_resolution','address_resolved','grid_area_resolved','needs_facility_data',
      'information_request_ready','information_request_sent','waiting_grid_owner_response','facility_data_received',
      'needs_information','pending_validation','ready_for_switch','switch_requested','switch_confirmed','switch_rejected',
      'active','pending_review','manual_review','rejected','failed','cancelled',
      'facility_data_invalid','customer_information_mismatch','grid_owner_rejected_request','negative_aperak_received',
      'z02_rejected','needs_customer_correction','needs_grid_owner_followup','protected_identity',
      'duplicate_facility_id','cross_tenant_facility_conflict'
    )
  );

alter table public.grid_owner_information_requests add column if not exists actor_route_id uuid references public.platform_actor_routes(id) on delete set null;
create index if not exists grid_owner_information_requests_actor_route_idx on public.grid_owner_information_requests (actor_route_id) where actor_route_id is not null;

alter table public.customer_sites add column if not exists facility_data_status text not null default 'unverified';
alter table public.customer_sites add column if not exists facility_data_last_error text;
alter table public.customer_sites add column if not exists facility_data_last_error_code text;
alter table public.customer_sites add column if not exists protected_identity boolean not null default false;
alter table public.metering_points add column if not exists facility_data_status text not null default 'unverified';
alter table public.metering_points add column if not exists facility_data_last_error text;
alter table public.metering_points add column if not exists facility_data_last_error_code text;

create index if not exists customer_sites_facility_lookup_idx on public.customer_sites (company_id, facility_id) where facility_id is not null;
create index if not exists metering_points_metering_lookup_idx on public.metering_points (company_id, metering_point_id) where metering_point_id is not null;

-- 4) Seed semantics and mappings. Idempotent upsert keeps future rule versions clean.
insert into public.ediel_message_semantics (
  message_family, message_code, subtype, direction, sender_role, receiver_role,
  business_process, request_type, expected_response, allowed_next_status, required_fields,
  forbidden_if_missing, ack_policy, timeout_policy, rule_version, environment, metadata
) values
  ('PRODAT','Z01','L','outbound','power_supplier','netowner','facility_contract_check','facility_lookup',array['CONTRL','APERAK','PRODAT Z02'],array['waiting_grid_owner_response','facility_data_received','facility_data_invalid'],array['company_id','customer_id','customer_site_id','grid_owner_id','grid_area_code','power_of_attorney'],array['tenant_unresolved','route_missing','poa_missing'],'technical_and_application','z02_sla','2026-06-11.actor-registry-automation','both','{"description":"Kontroll av elnätsavtal/anläggningsrelaterad struktur inför leverantörsbyte/inflytt."}'::jsonb),
  ('PRODAT','Z02','L','inbound','netowner','power_supplier','facility_contract_check_response','facility_lookup_response',array['CONTRL','APERAK'],array['facility_data_received','facility_data_invalid','needs_customer_correction'],array['company_id','related_message_id','customer_site_id'],array['tenant_unresolved'],'technical_and_application','application_response_sla','2026-06-11.actor-registry-automation','both','{"description":"Svar på Z01. Ska tolkas affärsmässigt, inte bara parsed."}'::jsonb),
  ('PRODAT','Z03','L','outbound','power_supplier','netowner','supplier_switch','supplier_switch',array['CONTRL','APERAK','PRODAT Z04'],array['switch_requested','switch_confirmed','switch_rejected'],array['company_id','customer_id','customer_site_id','metering_point_id','facility_id','grid_owner_id','power_of_attorney','contract_id'],array['tenant_unresolved','route_missing','facility_missing','poa_missing'],'technical_and_application','z04_sla','2026-06-11.actor-registry-automation','both','{"description":"Anmälan om leverantörsbyte/påbörjande av elleverans."}'::jsonb),
  ('PRODAT','Z04','L','inbound','netowner','power_supplier','supplier_switch_response','supplier_switch_response',array['CONTRL','APERAK'],array['switch_confirmed','switch_rejected','needs_customer_correction'],array['company_id','related_message_id','customer_site_id'],array['tenant_unresolved'],'technical_and_application','application_response_sla','2026-06-11.actor-registry-automation','both','{"description":"Svar på Z03/leverantörsbyte."}'::jsonb),
  ('PRODAT','Z13',null,'outbound','esco','netowner','metering_access','metering_access_request',array['CONTRL','APERAK','PRODAT Z14'],array['waiting_grid_owner_response','metering_access_confirmed','metering_access_rejected'],array['company_id','customer_id','metering_point_id','facility_id','power_of_attorney'],array['tenant_unresolved','route_missing','poa_missing'],'technical_and_application','permission_sla','2026-06-11.actor-registry-automation','both','{"description":"Begäran om tillgång till mätvärden/berättigad part."}'::jsonb),
  ('PRODAT','Z14',null,'inbound','netowner','esco','metering_access_response','metering_access_response',array['CONTRL','APERAK'],array['metering_access_confirmed','metering_access_rejected'],array['company_id','related_message_id'],array['tenant_unresolved'],'technical_and_application','permission_sla','2026-06-11.actor-registry-automation','both','{"description":"Svar på Z13."}'::jsonb),
  ('PRODAT','Z15',null,'outbound','esco','netowner','metering_access_end','metering_access_end',array['CONTRL','APERAK'],array['metering_access_end_requested','metering_access_ended'],array['company_id','metering_point_id','facility_id'],array['tenant_unresolved','route_missing'],'technical_and_application','permission_sla','2026-06-11.actor-registry-automation','both','{"description":"Avslut/statusändring av tillståndsflöde."}'::jsonb),
  ('PRODAT','Z18',null,'outbound','esco','netowner','metering_access_change','metering_access_change',array['CONTRL','APERAK'],array['metering_access_change_requested','metering_access_changed'],array['company_id','metering_point_id','facility_id'],array['tenant_unresolved','route_missing'],'technical_and_application','permission_sla','2026-06-11.actor-registry-automation','both','{"description":"Ändring/underhåll i tillståndsflöde."}'::jsonb),
  ('UTILTS','E66',null,'both','netowner','power_supplier','metering_values','metering_values',array['CONTRL','APERAK','UTILTS_ERR'],array['metering_values_received','metering_values_rejected'],array['company_id','metering_point_id','period'],array['tenant_unresolved'],'technical_and_application','utilts_sla','2026-06-11.actor-registry-automation','both','{"description":"Mätvärden."}'::jsonb),
  ('UTILTS','E31',null,'both','netowner','power_supplier','settlement_shares','settlement_shares',array['CONTRL','APERAK','UTILTS_ERR'],array['settlement_values_received','settlement_values_rejected'],array['company_id','metering_point_id','period'],array['tenant_unresolved'],'technical_and_application','utilts_sla','2026-06-11.actor-registry-automation','both','{"description":"Andelstal/slutliga värden."}'::jsonb),
  ('CONTRL','CONTRL',null,'both','any','any','technical_ack','technical_ack',array[]::text[],array['technical_ack_received'],array['related_message_id'],array['tenant_unresolved'],'technical_only','technical_ack_sla','2026-06-11.actor-registry-automation','both','{"description":"Teknisk kvittens; innebär inte affärsgodkännande."}'::jsonb),
  ('APERAK','APERAK',null,'both','any','any','application_ack','application_ack',array[]::text[],array['application_ack_received','negative_aperak_received'],array['related_message_id'],array['tenant_unresolved'],'application_only','application_ack_sla','2026-06-11.actor-registry-automation','both','{"description":"Applikationskvittens; negativ ska skapa affärsfel och åtgärd."}'::jsonb),
  ('UTILTS_ERR','ERR',null,'outbound','power_supplier','netowner','utilts_functional_error','utilts_functional_error',array['CONTRL','APERAK'],array['utilts_error_sent'],array['related_message_id','reason_code'],array['tenant_unresolved'],'technical_and_application','utilts_err_sla','2026-06-11.actor-registry-automation','both','{"description":"Funktionsfel för UTILTS, inte APERAK."}'::jsonb)
on conflict do nothing;

insert into public.ediel_rule_versions (
  rule_key, message_family, message_code, message_standard, version_code, status,
  schema_version, source, environment, valid_from, metadata, notes
)
values
  ('actor_registry_route_guard','PRODAT','ROUTE_GUARD','edifact','2026-06-11.actor-registry-automation','active','2026-06-11','gridex_runtime','both',current_date,'{"purpose":"Actor registry + tenant-safe route guard."}'::jsonb,'{"purpose":"Actor registry + tenant-safe route guard."}'::jsonb),
  ('message_semantics_engine','SYSTEM','SEMANTICS','edifact','2026-06-11.actor-registry-automation','active','2026-06-11','gridex_runtime','both',current_date,'{"purpose":"Business meaning per message code."}'::jsonb,'{"purpose":"Business meaning per message code."}'::jsonb),
  ('facility_error_mapping','SYSTEM','FACILITY_ERRORS','edifact','2026-06-11.actor-registry-automation','active','2026-06-11','gridex_runtime','both',current_date,'{"purpose":"No-crash mapping for facility/metering/APERAK/Z02 errors."}'::jsonb,'{"purpose":"No-crash mapping for facility/metering/APERAK/Z02 errors."}'::jsonb)
on conflict do nothing;

insert into public.ediel_error_code_mappings (
  message_family, ack_type, error_code, error_text, business_error, recommended_action,
  retry_allowed, requires_customer_contact, requires_grid_owner_contact, requires_superadmin_review, severity, metadata
) values
  ('APERAK','negative','105','The object could not be identified','facility_data_invalid','Kontrollera anläggnings-ID/mätpunkt och kundidentitet. Begär rätt uppgifter från kund eller nätägare.',false,true,true,false,'blocking','{"maps_to_status":"needs_customer_correction"}'::jsonb),
  ('APERAK','negative','209','Felaktigt anläggningsid','facility_data_invalid','Rätta anläggnings-ID och kör ny readiness-check innan nytt meddelande skickas.',false,true,true,false,'blocking','{"maps_to_status":"facility_data_invalid"}'::jsonb),
  ('APERAK','negative','322','Felaktigt tillståndets status','unexpected_response','Granska tillståndsflödet och tidigare Z13/Z14/Z15-kedja innan retry.',false,false,false,true,'blocking','{"maps_to_status":"manual_review"}'::jsonb),
  ('PRODAT','Z02_REJECTED',null,'Z02 avvisade uppgifterna','z02_rejected','Visa nätägarens svar, stoppa switch och begär rätt anläggnings-/kunduppgifter.',false,true,true,false,'blocking','{"maps_to_status":"z02_rejected"}'::jsonb),
  ('PRODAT','Z04_REJECTED',null,'Z04 avvisade leverantörsbyte','switch_rejected','Visa orsak, stoppa aktivering och skapa uppföljningsärende.',false,true,true,false,'blocking','{"maps_to_status":"switch_rejected"}'::jsonb),
  (null,'business','customer_mismatch','Kundidentitet matchar inte','customer_information_mismatch','Kontrollera personnummer/orgnummer och anläggning mot kund.',false,true,true,false,'blocking','{"maps_to_status":"customer_information_mismatch"}'::jsonb),
  (null,'business','wrong_grid_owner','Fel nätägare för anläggningen','grid_owner_rejected_request','Kör om Energy Resolver, kontrollera nätområde och välj verifierad nätägare.',false,false,true,false,'blocking','{"maps_to_status":"needs_grid_owner_followup"}'::jsonb),
  (null,'business','protected_identity','Skyddad identitet','protected_identity','Stoppa autosändning, begränsa UI och hantera manuellt med behörig roll.',false,false,false,true,'blocking','{"maps_to_status":"protected_identity"}'::jsonb),
  (null,'transport','timeout','Svar saknas inom SLA','timeout','Skapa uppföljning/påminnelse enligt SLA. Retry endast enligt feltyp.',true,false,true,false,'warning','{"maps_to_status":"waiting_grid_owner_response"}'::jsonb)
on conflict do nothing;

-- 5) RLS. Platform actor registry is readable to signed-in tenants; writes are platform/service only.
alter table public.platform_market_actors enable row level security;
alter table public.platform_actor_identifiers enable row level security;
alter table public.platform_actor_roles enable row level security;
alter table public.platform_actor_aliases enable row level security;
alter table public.platform_actor_routes enable row level security;
alter table public.platform_actor_import_runs enable row level security;
alter table public.platform_actor_import_issues enable row level security;
alter table public.ediel_message_semantics enable row level security;
alter table public.ediel_rule_versions enable row level security;
alter table public.ediel_error_code_mappings enable row level security;
alter table public.facility_data_quality_issues enable row level security;
alter table public.ediel_business_errors enable row level security;
alter table public.customer_correction_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_market_actors' and policyname='platform_market_actors_read') then
    create policy platform_market_actors_read on public.platform_market_actors for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_market_actors' and policyname='platform_market_actors_platform_write') then
    create policy platform_market_actors_platform_write on public.platform_market_actors for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_identifiers' and policyname='platform_actor_identifiers_read') then
    create policy platform_actor_identifiers_read on public.platform_actor_identifiers for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_identifiers' and policyname='platform_actor_identifiers_platform_write') then
    create policy platform_actor_identifiers_platform_write on public.platform_actor_identifiers for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_roles' and policyname='platform_actor_roles_read') then
    create policy platform_actor_roles_read on public.platform_actor_roles for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_roles' and policyname='platform_actor_roles_platform_write') then
    create policy platform_actor_roles_platform_write on public.platform_actor_roles for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_aliases' and policyname='platform_actor_aliases_read') then
    create policy platform_actor_aliases_read on public.platform_actor_aliases for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_aliases' and policyname='platform_actor_aliases_platform_write') then
    create policy platform_actor_aliases_platform_write on public.platform_actor_aliases for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_routes' and policyname='platform_actor_routes_read') then
    create policy platform_actor_routes_read on public.platform_actor_routes for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_routes' and policyname='platform_actor_routes_platform_write') then
    create policy platform_actor_routes_platform_write on public.platform_actor_routes for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_import_runs' and policyname='platform_actor_import_runs_platform') then
    create policy platform_actor_import_runs_platform on public.platform_actor_import_runs for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_import_issues' and policyname='platform_actor_import_issues_platform') then
    create policy platform_actor_import_issues_platform on public.platform_actor_import_issues for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_message_semantics' and policyname='ediel_message_semantics_read') then
    create policy ediel_message_semantics_read on public.ediel_message_semantics for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_message_semantics' and policyname='ediel_message_semantics_platform_write') then
    create policy ediel_message_semantics_platform_write on public.ediel_message_semantics for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_rule_versions' and policyname='ediel_rule_versions_read') then
    create policy ediel_rule_versions_read on public.ediel_rule_versions for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_rule_versions' and policyname='ediel_rule_versions_platform_write') then
    create policy ediel_rule_versions_platform_write on public.ediel_rule_versions for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_error_code_mappings' and policyname='ediel_error_code_mappings_read') then
    create policy ediel_error_code_mappings_read on public.ediel_error_code_mappings for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_error_code_mappings' and policyname='ediel_error_code_mappings_platform_write') then
    create policy ediel_error_code_mappings_platform_write on public.ediel_error_code_mappings for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facility_data_quality_issues' and policyname='facility_data_quality_issues_tenant_read') then
    create policy facility_data_quality_issues_tenant_read on public.facility_data_quality_issues for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='facility_data_quality_issues' and policyname='facility_data_quality_issues_tenant_write') then
    create policy facility_data_quality_issues_tenant_write on public.facility_data_quality_issues for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id)) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_business_errors' and policyname='ediel_business_errors_tenant_read') then
    create policy ediel_business_errors_tenant_read on public.ediel_business_errors for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_business_errors' and policyname='ediel_business_errors_tenant_write') then
    create policy ediel_business_errors_tenant_write on public.ediel_business_errors for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id)) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_correction_requests' and policyname='customer_correction_requests_tenant_read') then
    create policy customer_correction_requests_tenant_read on public.customer_correction_requests for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_correction_requests' and policyname='customer_correction_requests_tenant_write') then
    create policy customer_correction_requests_tenant_write on public.customer_correction_requests for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id)) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id));
  end if;
end $$;
