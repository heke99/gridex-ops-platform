-- GridCore active Swedish electricity Ediel scope + AI/BI import engine
-- Idempotent, additive and tenant-safe. Does not remove existing rule systems.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- AI-list / BI-list CSV import and deviation review engine.
-- These are not EDIFACT messages and must never create CONTRL/APERAK/UTILTS_ERR.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_list_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  list_type text not null check (list_type in ('AI', 'BI')),
  filename text,
  grid_owner_id uuid,
  status text not null default 'parsed',
  row_count integer not null default 0,
  discrepancy_count integer not null default 0,
  raw_payload text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_list_import_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  import_id uuid not null references public.ai_list_imports(id) on delete cascade,
  row_number integer not null,
  raw_columns jsonb not null default '{}'::jsonb,
  metering_point_external_id text,
  matched_metering_point_id uuid references public.metering_points(id) on delete set null,
  matched_customer_id uuid references public.customers(id) on delete set null,
  matched_customer_site_id uuid references public.customer_sites(id) on delete set null,
  match_status text not null default 'unmatched',
  discrepancy_reasons text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create table if not exists public.ai_list_discrepancies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  import_id uuid not null references public.ai_list_imports(id) on delete cascade,
  import_row_id uuid not null references public.ai_list_import_rows(id) on delete cascade,
  discrepancy_type text not null,
  severity text not null default 'warning',
  current_values jsonb not null default '{}'::jsonb,
  imported_values jsonb not null default '{}'::jsonb,
  proposed_values jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  applied_by uuid,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_list_imports_company_status
  on public.ai_list_imports(company_id, status, created_at desc);
create index if not exists idx_ai_list_import_rows_import
  on public.ai_list_import_rows(company_id, import_id, row_number);
create index if not exists idx_ai_list_import_rows_metering_point
  on public.ai_list_import_rows(company_id, metering_point_external_id);
create index if not exists idx_ai_list_discrepancies_company_status
  on public.ai_list_discrepancies(company_id, status, discrepancy_type, created_at desc);

alter table public.ai_list_imports enable row level security;
alter table public.ai_list_import_rows enable row level security;
alter table public.ai_list_discrepancies enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_list_imports' and policyname = 'gridcore_ai_list_imports_tenant_read') then
    create policy gridcore_ai_list_imports_tenant_read on public.ai_list_imports
      for select using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_list_imports' and policyname = 'gridcore_ai_list_imports_tenant_write') then
    create policy gridcore_ai_list_imports_tenant_write on public.ai_list_imports
      for all using (public.gridex_can_write_company(company_id))
      with check (public.gridex_can_write_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_list_import_rows' and policyname = 'gridcore_ai_list_import_rows_tenant_read') then
    create policy gridcore_ai_list_import_rows_tenant_read on public.ai_list_import_rows
      for select using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_list_import_rows' and policyname = 'gridcore_ai_list_import_rows_tenant_write') then
    create policy gridcore_ai_list_import_rows_tenant_write on public.ai_list_import_rows
      for all using (public.gridex_can_write_company(company_id))
      with check (public.gridex_can_write_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_list_discrepancies' and policyname = 'gridcore_ai_list_discrepancies_tenant_read') then
    create policy gridcore_ai_list_discrepancies_tenant_read on public.ai_list_discrepancies
      for select using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_list_discrepancies' and policyname = 'gridcore_ai_list_discrepancies_tenant_write') then
    create policy gridcore_ai_list_discrepancies_tenant_write on public.ai_list_discrepancies
      for all using (public.gridex_can_write_company(company_id))
      with check (public.gridex_can_write_company(company_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Additive rule table compatibility columns for the active production scope.
-- ---------------------------------------------------------------------------

alter table if exists public.ediel_message_rules
  add column if not exists role_code text,
  add column if not exists direction text,
  add column if not exists enabled boolean,
  add column if not exists current_version text,
  add column if not exists allowed_versions text[] default '{}'::text[],
  add column if not exists default_ack_policy text,
  add column if not exists transaction_scope_policy text,
  add column if not exists valid_from date,
  add column if not exists valid_to date;

update public.ediel_message_rules
set enabled = coalesce(enabled, is_active),
    current_version = coalesce(current_version, version, version_code),
    allowed_versions = case when cardinality(coalesce(allowed_versions, '{}'::text[])) = 0 and coalesce(version, version_code) is not null then array[coalesce(version, version_code)] else allowed_versions end
where to_regclass('public.ediel_message_rules') is not null;

alter table if exists public.ediel_field_rules
  add column if not exists field_code text,
  add column if not exists field_name_en text,
  add column if not exists field_name_sv text,
  add column if not exists field_label text,
  add column if not exists dependency_note text,
  add column if not exists role_code text,
  add column if not exists source_document text;

alter table if exists public.ediel_error_rules
  add column if not exists role_code text,
  add column if not exists field_code text,
  add column if not exists error_class text,
  add column if not exists response_family text,
  add column if not exists sts_code text,
  add column if not exists severity text,
  add column if not exists valid_from date,
  add column if not exists valid_to date;

alter table if exists public.ediel_code_lists
  add column if not exists list_name text,
  add column if not exists description_sv text,
  add column if not exists description_en text,
  add column if not exists role_code text,
  add column if not exists message_family text,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists enabled boolean not null default true;

update public.ediel_code_lists
set list_name = coalesce(list_name, code_list_name),
    enabled = coalesce(enabled, true)
where to_regclass('public.ediel_code_lists') is not null;

alter table if exists public.ediel_version_rules
  add column if not exists role_code text,
  add column if not exists current_version text,
  add column if not exists accepted_versions text[] default '{}'::text[],
  add column if not exists transition_policy text;

-- Active message and version rules. Inactive/future roles/families are present only as disabled registry data.
with rules(message_family, message_code, role_code, application_reference, direction, current_version, default_ack_policy, transaction_scope_policy, enabled) as (
  values
    ('PRODAT','Z01','DDQ','23-DDQ-PRODAT','outbound','26A','CONTRL_OPTIONAL_APERAK_ON_ERROR','message',true),
    ('PRODAT','Z02','DDQ','23-DDQ-PRODAT','inbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z03','DDQ','23-DDQ-PRODAT','outbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z04','DDQ','23-DDQ-PRODAT','inbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z05','DDQ','23-DDQ-PRODAT','inbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z06','DDQ','23-DDQ-PRODAT','inbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z08','DDQ','23-DDQ-PRODAT','outbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z09','DDQ','23-DDQ-PRODAT','outbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z10','DDQ','23-DDQ-PRODAT','inbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z13','DGI','23-DGI-PRODAT','outbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z14','DGI','23-DGI-PRODAT','inbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z15','DGI','23-DGI-PRODAT','inbound','26A','CONTRL_AND_APERAK','message',true),
    ('PRODAT','Z18','DGI','23-DGI-PRODAT','outbound','26A','CONTRL_AND_APERAK','message',true),
    ('UTILTS','E66','DDQ','23-DDQ-E66-T','inbound','E5SE5A','CONTRL_AND_APERAK_OR_UTILTS_ERR','transaction',true),
    ('UTILTS','E66','DGI','23-DGI-E66-T','inbound','E5SE5A','CONTRL_AND_APERAK_OR_UTILTS_ERR','transaction',true),
    ('UTILTS','S02','DDQ','23-DDQ-S02-T','inbound','E5SE5A','CONTRL_AND_APERAK_OR_UTILTS_ERR','transaction',true),
    ('UTILTS','E73','DDQ','23-DDQ-E73-T','outbound','E5SE5A','CONTRL_AND_APERAK','message',true),
    ('CONTRL','CONTRL',null,null,'inbound','EDIEL2','NO_RESPONSE','message',true),
    ('APERAK','APERAK',null,null,'inbound','E5SE5A','CONTRL_ONLY','message',true),
    ('UTILTS_ERR','UTILTS_ERR','DDQ',null,'outbound','E5SE5A','CONTRL_EXPECTED','transaction',true),
    ('UTILTS_ERR','UTILTS_ERR','DGI',null,'outbound','E5SE5A','CONTRL_EXPECTED','transaction',true),
    ('UTILTS','E31','DDK','23-DDK-E31-S','inbound','E5SE5A','FUTURE_INACTIVE','message',false),
    ('MSCONS','MSCONS',null,null,'inbound',null,'FUTURE_INACTIVE','message',false),
    ('NBS_XML','NBS_XML',null,null,'inbound',null,'FUTURE_INACTIVE','message',false)
)
insert into public.ediel_message_rules(message_family, message_code, role_code, application_reference, direction, version, current_version, allowed_versions, default_ack_policy, transaction_scope_policy, is_active, enabled, valid_from, rule_payload)
select message_family, message_code, role_code, application_reference, direction, current_version, current_version, case when current_version is null then '{}'::text[] else array[current_version] end, default_ack_policy, transaction_scope_policy, enabled, enabled, date '2026-04-01', jsonb_build_object('source', 'gridcore_active_scope_2026_05_30')
from rules
on conflict do nothing;

insert into public.ediel_version_rules(message_family, message_code, role_code, version, current_version, accepted_versions, association_code, valid_from, is_current, transition_policy, metadata)
select message_family, message_code, role_code, current_version, current_version, array[current_version], current_version, date '2026-04-01', true, 'current_only', jsonb_build_object('source', 'gridcore_active_scope_2026_05_30')
from (
  values
    ('PRODAT','Z01','DDQ','26A'),('PRODAT','Z02','DDQ','26A'),('PRODAT','Z03','DDQ','26A'),('PRODAT','Z04','DDQ','26A'),
    ('PRODAT','Z05','DDQ','26A'),('PRODAT','Z06','DDQ','26A'),('PRODAT','Z08','DDQ','26A'),('PRODAT','Z09','DDQ','26A'),
    ('PRODAT','Z10','DDQ','26A'),('PRODAT','Z13','DGI','26A'),('PRODAT','Z14','DGI','26A'),('PRODAT','Z15','DGI','26A'),
    ('PRODAT','Z18','DGI','26A'),('UTILTS','E66','DDQ','E5SE5A'),('UTILTS','E66','DGI','E5SE5A'),('UTILTS','S02','DDQ','E5SE5A'),
    ('UTILTS','E73','DDQ','E5SE5A'),('CONTRL','CONTRL',null,'EDIEL2'),('APERAK','APERAK',null,'E5SE5A'),('UTILTS_ERR','UTILTS_ERR','DDQ','E5SE5A'),('UTILTS_ERR','UTILTS_ERR','DGI','E5SE5A')
) as v(message_family, message_code, role_code, current_version)
on conflict do nothing;

insert into public.ediel_code_lists(code_list_name, list_name, code, label, description_sv, description_en, role_code, message_family, enabled, metadata)
values
  ('ACTIVE_ROLE','ACTIVE_ROLE','DDQ','Elhandelsföretag','Elhandelsföretag / leverantör','Electricity supplier',null,null,true,'{}'),
  ('ACTIVE_ROLE','ACTIVE_ROLE','DGI','Berättigad part','Energiserviceföretag / berättigad part','Energy service company / entitled party',null,null,true,'{}'),
  ('FUTURE_ROLE','FUTURE_ROLE','DDK','Balansansvarig','Framtida/inaktiv roll','Future inactive balance responsible party',null,null,false,'{}'),
  ('FUTURE_ROLE','FUTURE_ROLE','DDX','Obalansansvarig','Framtida/inaktiv roll','Future inactive imbalance settlement responsible',null,null,false,'{}'),
  ('FUTURE_ROLE','FUTURE_ROLE','PQ','Cesar','Framtida/inaktiv roll, endast kod-NAD kan valideras','Future inactive certificate context',null,null,false,'{}'),
  ('FUTURE_ROLE','FUTURE_ROLE','EZ','Systemoperatör','Framtida/inaktiv roll','Future inactive system operator',null,null,false,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z22','Supplier switch','Leverantörsbyte','Supplier switch','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z23','Supplier and customer change','Leverantörs- och kundbyte','Supplier and customer change','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z24','Cancellation','Avbokning','Cancellation',null,'PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z25','Termination','Avslut','Termination',null,'PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z26','Assigned supplier','Anvisat avtal','Assigned supplier','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z27','BRP change','Balansansvarsbyte, inaktivt','BRP change inactive','DDK','PRODAT',false,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z70','Mandatory purchase obligation','Mottagningsplikt','Mandatory purchase obligation','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','E34','Customer update','Kunduppdatering','Customer information update','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','E32','Installation update','Anläggningsuppdatering','Installation update','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','E64','Installation update with reading','Anläggningsuppdatering med mätarställning','Installation update with meter reading','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','E58','Meter/master-data update','Mätar-/grunddatauppdatering','Meter/master-data update','DDQ','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','Z96','Rejected access','Avvisad åtkomst','Rejected access','DGI','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','S17','Permission/reporting','Tillstånd/rapportering','Permission/reporting','DGI','PRODAT',true,'{}'),
  ('PRODAT_SUBTYPE','PRODAT_SUBTYPE','S18','Historical meter values','Historiska mätvärden','Historical meter values','DGI','PRODAT',true,'{}'),
  ('UTILTS_CODE','UTILTS_CODE','E66','Validated meter values','Validerade mätvärden','Validated meter values',null,'UTILTS',true,'{}'),
  ('UTILTS_CODE','UTILTS_CODE','S02','Forecast','Förbrukningsprognos','Consumption forecast',null,'UTILTS',true,'{}'),
  ('UTILTS_CODE','UTILTS_CODE','E73','Missing values request','Begäran om saknade mätvärden','Missing validated meter values request',null,'UTILTS',true,'{}'),
  ('UTILTS_CODE','UTILTS_CODE','ERR','UTILTS_ERR','Negativ UTILTS för funktionsfel','Negative UTILTS for functional error',null,'UTILTS_ERR',true,'{}')
on conflict do nothing;

-- Runtime PRODAT field matrix. One row per message code and field code.
with message_codes(code, idx) as (
  values ('Z01',1),('Z02',2),('Z03',3),('Z04',4),('Z05',5),('Z06',6),('Z08',7),('Z09',8),('Z10',9),('Z13',10),('Z14',11),('Z15',12),('Z18',13)
),
field_matrix(field_code, field_name_en, field_name_sv, reqs, note) as (
  values
    ('311','Application Reference','Application Reference',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'UNB Application Reference. Electricity market: 23-DDQ-PRODAT or 23-DGI-PRODAT.'),
    ('312','Association assigned code','Version',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'National Ediel message version.'),
    ('202','Message name','Meddelandenamn',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'PRODAT function.'),
    ('203','Message Id.','Meddelandeidentifikation',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'Unique message identity.'),
    ('204','Message function','Meddelandefunktion',array['O','O','O','O','O','O','O','O','O','O','O','O','O'],'Code 9 original, code 5 replacement.'),
    ('313','Request for acknowledgement','Kvittensbegäran',array['O','R','R','R','R','R','R','R','R','R','R','R','R'],'APERAK request.'),
    ('205','Message date','Meddelandedatum',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'Application creation date.'),
    ('206','Time zone','Tidszon',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'UTC offset. Sweden uses 1 according to handbook rule.'),
    ('301','Free text header','Fritext huvud',array['O','O','O','O','O','O','O','O','O','O','O','O','O'],'Not recommended.'),
    ('207','Sender','Avsändare Ediel-ID',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'Valid Ediel ID.'),
    ('315','Sender organisation no','Avsändarens org.nr',array['-','-','O','-','-','-','-','-','-','-','-','-','-'],'Sender organisation number.'),
    ('208','Recipient','Mottagare Ediel-ID',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'Valid Ediel ID.'),
    ('314','Sequence number','Sekvensnummer',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'Sequence number.'),
    ('209','Object Id','Anläggnings-id',array['R','R','R','R','R','R','R','R','R','-','D','R','R'],'Sent in Z14 except Z14N.'),
    ('258','Sub-line number','Sekvensnummer register',array['-','-','-','D','-','D','-','-','D','-','-','-','-'],'Mandatory for multiple registers.'),
    ('210','Contract start date','Avtal startdatum',array['R','-','R','R','-','D','-','D','D','-','-','-','-'],'Supply start date.'),
    ('211','Contract stop date','Avtal slutdatum',array['-','-','-','-','R','O','R','D','-','-','-','-','-'],'Supply end date.'),
    ('302','Report start date','Rapportstartdatum',array['-','-','-','O','-','-','-','-','-','R','D','-','-'],'Z13 required. Z14 sent except Z14N.'),
    ('321','Report end date','Rapportslutdatum',array['-','-','-','-','-','-','-','-','-','D','D','-','-'],'Used in Z13/Z14 unless until further notice.'),
    ('216','Validity start date','Giltighetsdatum from',array['-','-','-','-','-','R','-','D','R','-','-','-','-'],'Date from which change applies.'),
    ('212','First meter reading date','Datum första mätaravläsning',array['-','-','-','O','-','-','-','-','-','-','-','-','-'],'Date when reading starts.'),
    ('249','Date of birth','Födelsedatum',array['O','O','O','O','O','O','O','-','-','-','-','-','-'],'Used when known and customer id is not birthdate/personal number.'),
    ('508','Observation length','Tidslängd',array['-','-','-','R','-','D','-','-','R','-','D','-','-'],'Quarter/hour/month/year values.'),
    ('326','Permission creation timestamp','Tillståndets tidstämpel',array['-','-','-','-','-','-','-','-','-','-','D','O','O'],'Sent in Z14 except Z14N.'),
    ('327','Processing end date/time','Rapportering/tjänst upphör',array['-','-','-','-','-','-','-','-','-','-','-','R','R'],'Timestamp when reporting/service ends.'),
    ('303','Free text item level','Fritext per anläggning',array['O','O','O','O','O','O','O','-','O','-','-','-','-'],'Not recommended.'),
    ('213','Estimated annual volume','Uppskattad årsenergi',array['-','-','O','R','-','O','-','-','O','-','-','-','-'],'kWh electricity.'),
    ('214','Constant','Konstant för mätare',array['-','-','-','D','-','D','-','-','D','-','-','-','-'],'Required if meter stands are sent.'),
    ('215','Old Constant','Konstant gammal mätare',array['-','-','-','-','-','-','-','-','O','-','-','-','-'],'Used at meter change.'),
    ('217','Measure method','Mätmetod',array['-','R','R','R','-','D','-','D','R','R','D','-','-'],'Quarter/hour/month/year measuring method.'),
    ('218','Number of digits','Antal siffror mätare',array['-','-','-','D','-','D','-','-','D','-','-','-','-'],'Required when meter stands are sent.'),
    ('219','Old Number of digits','Antal siffror gammal mätare',array['-','-','-','-','-','-','-','-','O','-','-','-','-'],'Used at meter change.'),
    ('306','Installation status','Installationsstatus',array['-','-','-','R','-','D','-','-','-','-','-','-','-'],'Active/disconnected.'),
    ('307','Tariff code','Tariffkod',array['-','-','-','O','-','O','-','-','-','-','-','-','-'],'Network tariff.'),
    ('220','Priority','Prioritet',array['-','-','-','O','-','O','-','-','-','-','-','-','-'],'Priority/disconnectable installation.'),
    ('222','Meter reading frequency','Rapporteringsfrekvens',array['-','-','-','R','-','R','-','-','R','R','D','-','-'],'Reporting frequency.'),
    ('223','Reason for transaction','Transaktionstyp undertyp',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'Valid subtype according to code list.'),
    ('259','Meter time frame','Räkneverkskod',array['-','-','-','D','-','D','-','-','D','-','-','-','-'],'Required for multiple registers and meter stands.'),
    ('254','Method for balance settlement','Avräkningsmetod',array['-','-','-','R','-','D','-','-','D','-','-','-','-'],'Field validation only; BRP inactive.'),
    ('242','Product code','Produktkod',array['-','-','-','R','-','D','-','-','D','-','-','-','-'],'Electricity timeseries product.'),
    ('506','Product identification / Energy product','Energiprodukt',array['-','-','-','-','-','-','-','-','-','R','D','-','-'],'Used in Z13 and Z14 except Z14N.'),
    ('310','Party connected to grid status','Kundstatus',array['-','-','-','-','D','D','-','D','-','-','-','-','-'],'Used only with death.'),
    ('513','Type of metering point / Flow direction','Riktning typ av anläggning',array['-','-','-','-','-','-','-','-','-','R','D','-','-'],'Flow direction at metering point.'),
    ('322','Permission status','Tillståndets status',array['-','-','-','-','-','-','-','-','-','-','R','R','-'],'Used in Z14 and Z15.'),
    ('323','Purpose','Tillståndets syfte',array['-','-','-','-','-','-','-','-','-','D','D','-','-'],'Required for private customers in Z13/Z14 except Z14N.'),
    ('324','Permission end reason','Orsak till tillståndets upphörande',array['-','-','-','-','-','-','-','-','-','-','-','R','R'],'Used in Z15 and Z18.'),
    ('224','Meter no.','Mätarnummer',array['-','-','-','R','O','O','O','-','R','-','-','-','-'],'Meter number.'),
    ('225','Old Meter no.','Gammalt mätarnummer',array['-','-','-','-','-','-','-','-','R','-','-','-','-'],'Used at meter change.'),
    ('308','Supplier contract no','Leverantörens avtalsnr',array['-','-','O','-','O','O','O','-','-','-','-','-','-'],'Contract number with end user.'),
    ('260','Net Area','Nätområdesid',array['R','R','R','R','R','R','R','R','R','-','D','R','R'],'3-character grid area code.'),
    ('319','Reference to metering point','Referens till anläggning',array['-','-','-','D','-','-','-','-','-','-','-','-','-'],'Required in Z04D for microproduction link.'),
    ('261','Reference to authorisation','Referens till avtal/fullmakt',array['R','-','R','-','-','-','-','-','-','R','-','-','-'],'Agreement/authorisation/power of attorney.'),
    ('226','Reference to line item','Ärendereferens',array['R','R','R','R','R','R','R','R','R','R','R','R','R'],'Unique case reference.'),
    ('325','Permission ID','Tillståndets id',array['-','-','-','-','-','-','-','-','-','-','D','R','R'],'Permission identifier. Not sent in Z14N.'),
    ('End user group','End user','Elanvändare',array['R','R','R','R','R','D','R','D','-','R','D','R','R'],'End-user group.'),
    ('227','End user ID','Kund-id',array['R','R','R','R','R','D','R','D','-','R','D','R','R'],'Customer ID.'),
    ('228','End user Name','Namn elanvändare',array['R','R','R','R','R','D','R','D','-','R','D','R','R'],'1-2 rows.'),
    ('229','End user Address','Adress elanvändare',array['D','D','D','D','D','D','D','D','-','-','-','-','-'],'1-3 rows.'),
    ('231','End user Postcode','Postnr elanvändare',array['R','R','R','R','R','D','R','D','-','-','-','-','-'],'End user postcode.'),
    ('232','End user City name','Postort elanvändare',array['R','R','R','R','R','D','R','D','-','-','-','-','-'],'End user city.'),
    ('316','End user Country','Land elanvändare',array['R','R','R','R','R','D','R','D','-','R','R','R','R'],'End user country.'),
    ('Installation group','Installation','Anläggning',array['O','R','O','R','R','R','O','-','-','-','D','-','-'],'Installation address group.'),
    ('233','Installation ID','Anläggnings-id',array['D','R','D','R','R','R','D','-','-','-','R','-','-'],'Same value as field 209.'),
    ('234','Installation Address','Adress anläggning',array['D','R','D','R','R','R','D','-','-','-','R','-','-'],'Required when installation is sent.'),
    ('235','Installation Postcode','Postnr anläggning',array['O','O','O','O','O','O','O','-','-','-','O','-','-'],'Installation postcode.'),
    ('236','Installation City name','Postort anläggning',array['O','O','O','O','O','O','O','-','-','-','O','-','-'],'Installation city.'),
    ('237','Installation Country','Land anläggning',array['O','O','O','O','O','O','O','-','-','-','O','-','-'],'Installation country.'),
    ('Invoicee group','Invoicee','Fakturamottagare',array['-','-','D','D','D','D','D','D','-','-','-','-','-'],'Sent if invoicee differs from end user.'),
    ('250','Invoicee ID','Fakturamottagare ID',array['-','-','D','D','D','D','D','D','-','-','-','-','-'],'Required when invoicee is sent.'),
    ('251','Invoicee Name','Namn fakturamottagare',array['-','-','D','D','D','D','D','D','-','-','-','-','-'],'1-2 rows.'),
    ('252','Invoicee Address','Adress fakturamottagare',array['-','-','D','D','D','D','D','D','-','-','-','-','-'],'1-3 rows.'),
    ('253','Invoicee Postcode','Postnr fakturamottagare',array['-','-','D','D','D','D','D','D','-','-','-','-','-'],'Required when invoicee is sent.'),
    ('317','Invoicee City name','Postort fakturamottagare',array['-','-','D','D','D','D','D','D','-','-','-','-','-'],'Required when invoicee is sent.'),
    ('318','Invoicee Country','Land fakturamottagare',array['-','-','D','D','D','D','D','D','-','-','-','-','-'],'Required when invoicee is sent.'),
    ('262','Balance responsible','Balansansvarig',array['-','-','R','R','R','R','R','R','R','-','-','-','-'],'Store and validate as field data only; do not activate DDK role.')
)
insert into public.ediel_field_rules(
  message_family, message_code, role_code, field_code, field_number, field_key,
  field_name_en, field_name_sv, field_name, field_label, segment_path, requirement,
  dependency_note, valid_from, is_active, source_document, rule_payload
)
select
  'PRODAT',
  message_codes.code,
  case when message_codes.code in ('Z13','Z14','Z15','Z18') then 'DGI' else 'DDQ' end,
  field_matrix.field_code,
  field_matrix.field_code,
  lower(regexp_replace(field_matrix.field_name_en, '[^A-Za-z0-9]+', '_', 'g')),
  field_matrix.field_name_en,
  field_matrix.field_name_sv,
  field_matrix.field_name_en,
  field_matrix.field_name_sv,
  null,
  field_matrix.reqs[message_codes.idx],
  field_matrix.note,
  date '2026-04-01',
  true,
  'gridcore_active_scope_2026_05_30',
  jsonb_build_object('matrixRequirement', field_matrix.reqs[message_codes.idx], 'note', field_matrix.note)
from field_matrix
cross join message_codes
on conflict do nothing;

-- Error routing rules for required production response decisions.
insert into public.ediel_error_rules(message_family, message_code, role_code, field_code, error_key, error_class, response_family, ack_family, erc_code, ftx_code, sts_code, default_text, severity, valid_from, metadata)
values
  ('PRODAT',null,null,null,'message_type_not_implemented','application','APERAK','APERAK','40','100',null,'Message type/function not implemented','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,null,'prodat_header_unreadable','application','APERAK','APERAK','40','102',null,'PRODAT header cannot be read','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,null,'duplicate_message','application','APERAK','APERAK','40','103',null,'Duplicate message','warning',date '2026-04-01','{}'),
  ('PRODAT',null,null,'209','object_not_identified','application','APERAK','APERAK','40','105',null,'The object could not be identified','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,'209','incorrect_metering_point','guide','APERAK','APERAK','42','209',null,'Incorrect metering point / installation id','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,'210','missing_start_date','guide','APERAK','APERAK','41','210',null,'MANDATORY FIELD MISSING','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,'223','invalid_transaction_type','guide','APERAK','APERAK','42','223',null,'INCORRECT DATA','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,'261','missing_authorisation_reference','guide','APERAK','APERAK','41','261',null,'MANDATORY FIELD MISSING','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,'262','incorrect_balance_responsible','guide','APERAK','APERAK','42','262',null,'INCORRECT DATA','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,'322','invalid_permission_status','guide','APERAK','APERAK','42','322',null,'INCORRECT DATA','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,'325','unknown_permission_id','application','APERAK','APERAK','40','325',null,'Unknown permission id','error',date '2026-04-01','{}'),
  ('PRODAT',null,null,null,'unknown_sender','application','APERAK','APERAK','40','110',null,'Unknown/invalid sender','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,'512','missing_registration_time','guide','APERAK','APERAK','41','512',null,'MANDATORY FIELD MISSING','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,'508','wrong_resolution','guide','APERAK','APERAK','42','508',null,'INCORRECT DATA','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,null,'observation_count_mismatch','functional','UTILTS_ERR','UTILTS_ERR',null,null,'E87','Observation count does not match period/resolution','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,null,'invalid_period','functional','UTILTS_ERR','UTILTS_ERR',null,null,'E50','Invalid period','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,null,'meter_stand_volume_mismatch','functional','UTILTS_ERR','UTILTS_ERR',null,null,'E19','Meter stand does not match energy volume','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,null,'wrong_consumption_sign','functional','UTILTS_ERR','UTILTS_ERR',null,null,'E98','Consumption has wrong sign','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,null,'missing_status_with_quantity','functional','UTILTS_ERR','UTILTS_ERR',null,null,'E90','Status indicates missing value but QTY contains value','error',date '2026-04-01','{}'),
  ('UTILTS','E66',null,null,'metering_point_not_identified','functional','UTILTS_ERR','UTILTS_ERR',null,null,'E10','Metering point cannot be identified/processed','error',date '2026-04-01','{}')
on conflict do nothing;

commit;
