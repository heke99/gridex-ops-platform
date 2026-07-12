-- Gridex OPS Ediel canonical consolidation, batches 1-11.
-- Additive/idempotent. Preserves the intent/outbox model, atomic claims,
-- delivery_uncertain, production locks, S/MIME, route snapshots and billing RPC.

begin;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1-2. Canonical rule-pack snapshots and profile versioning
-- ---------------------------------------------------------------------------
alter table if exists public.ediel_rule_profiles
  add column if not exists message_subtype text,
  add column if not exists effective_from date,
  add column if not exists effective_to date;

alter table if exists public.ediel_rule_profile_versions
  add column if not exists checksum text,
  add column if not exists source_revision text,
  add column if not exists activated_by uuid;

alter table if exists public.ediel_messages
  add column if not exists message_subtype text,
  add column if not exists business_process text,
  add column if not exists business_state text,
  add column if not exists rule_profile_key text,
  add column if not exists rule_profile_version_id uuid,
  add column if not exists rule_profile_version text,
  add column if not exists rule_pack_checksum text,
  add column if not exists rule_pack_snapshot jsonb not null default '{}'::jsonb;

alter table if exists public.ediel_outbox
  add column if not exists rule_profile_key text,
  add column if not exists rule_profile_version_id uuid,
  add column if not exists rule_profile_version text,
  add column if not exists rule_pack_checksum text,
  add column if not exists rule_pack_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists send_attempt_count integer not null default 0,
  add column if not exists current_send_attempt_id uuid;

create table if not exists public.ediel_rule_pack_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ediel_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  profile_key text not null,
  rule_profile_version_id uuid not null references public.ediel_rule_profile_versions(id),
  profile_version text not null,
  checksum text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(ediel_message_id)
);

create index if not exists ediel_rule_pack_snapshots_company_idx
  on public.ediel_rule_pack_snapshots(company_id, profile_key, profile_version, created_at desc);

-- Canonical code-level profiles. Exact PRODAT subtype rules are carried in the
-- version rules JSON and message_subtype snapshot, never inferred from defaults.
with profiles(profile_key,family,code,name,description,version,source_revision,rules) as (
  values
    ('prodat_26a_z01','PRODAT','Z01','PRODAT 26.A Z01','Customer/facility information request','26A-r3','PRODAT-26A-rev3','{"subtypes":["*"],"business_response":["Z02"],"no_fabricated_business_data":true}'::jsonb),
    ('prodat_26a_z02','PRODAT','Z02','PRODAT 26.A Z02','Customer/facility information response','26A-r3','PRODAT-26A-rev3','{"subtypes":["*"],"no_fabricated_business_data":true}'::jsonb),
    ('prodat_26a_z03','PRODAT','Z03','PRODAT 26.A Z03','Supplier switch request','26A-r3','PRODAT-26A-rev3','{"subtypes":["L","LK"],"business_response":["Z04L","Z04LK"],"requires_start_date":true}'::jsonb),
    ('prodat_26a_z04','PRODAT','Z04','PRODAT 26.A Z04','Supplier switch result by subtype','26A-r3','PRODAT-26A-rev3','{"subtypes":["L","LK","C","A","D"],"state_machine":"prodat_switch_v1","z04c_creates_supply_period":false}'::jsonb),
    ('prodat_26a_z05','PRODAT','Z05','PRODAT 26.A Z05','Delivery ended','26A-r3','PRODAT-26A-rev3','{"subtypes":["L","LK"],"state_machine":"prodat_termination_v1"}'::jsonb),
    ('prodat_26a_z06','PRODAT','Z06','PRODAT 26.A Z06','Supplier/customer relation change','26A-r3','PRODAT-26A-rev3','{"subtypes":["F","G"],"no_fabricated_business_data":true}'::jsonb),
    ('prodat_26a_z08','PRODAT','Z08','PRODAT 26.A Z08H','Termination request','26A-r3','PRODAT-26A-rev3','{"subtypes":["H"],"business_response":["Z05L"],"requires_end_date":true,"requires_closure_reason":true}'::jsonb),
    ('prodat_26a_z09','PRODAT','Z09','PRODAT 26.A Z09','Metering point relation','26A-r3','PRODAT-26A-rev3','{"subtypes":["F","G","D"],"requires_start_date":true}'::jsonb),
    ('prodat_26a_z10','PRODAT','Z10','PRODAT 26.A Z10','Metering point data','26A-r3','PRODAT-26A-rev3','{"subtypes":["*"],"no_fabricated_business_data":true}'::jsonb),
    ('prodat_26a_z13','PRODAT','Z13','PRODAT 26.A Z13','Permission request','26A-r3','PRODAT-26A-rev3','{"subtypes":["V","VH"],"state_machine":"prodat_permission_v1"}'::jsonb),
    ('prodat_26a_z14','PRODAT','Z14','PRODAT 26.A Z14','Permission response','26A-r3','PRODAT-26A-rev3','{"subtypes":["V","N","VH"],"state_machine":"prodat_permission_v1"}'::jsonb),
    ('prodat_26a_z15','PRODAT','Z15','PRODAT 26.A Z15','Permission ended','26A-r3','PRODAT-26A-rev3','{"subtypes":["V"],"requires_end_date":true,"state_machine":"prodat_permission_v1"}'::jsonb),
    ('prodat_26a_z18','PRODAT','Z18','PRODAT 26.A Z18','Permission end request','26A-r3','PRODAT-26A-rev3','{"subtypes":["V"],"requires_end_date":true,"no_derived_end_date":true,"state_machine":"prodat_permission_v1"}'::jsonb),
    ('utilts_e30','UTILTS','E30','UTILTS E30','Metering point time series','E5SE5A-r3','UTILTS-current','{"scope":"metering_point","transactional":true,"dst":true,"corrections":true}'::jsonb),
    ('utilts_e31','UTILTS','E31','UTILTS E31','Grid area time series','E5SE5A-r3','UTILTS-current','{"scope":"grid_area","transactional":true,"dst":true,"corrections":true}'::jsonb),
    ('utilts_e66','UTILTS','E66','UTILTS E66','Metering values','E5SE5A-r3','UTILTS-current','{"scope":"metering_point","transactional":true,"dst":true,"corrections":true}'::jsonb),
    ('utilts_e72','UTILTS','E72','UTILTS E72','Register values','E5SE5A-r3','UTILTS-current','{"scope":"register","transactional":true,"corrections":true}'::jsonb),
    ('utilts_e73','UTILTS','E73','UTILTS E73','Metering data request','E5SE5A-r3','UTILTS-current','{"scope":"request","transactional":true}'::jsonb),
    ('utilts_e74','UTILTS','E74','UTILTS E74','Time series product','E5SE5A-r3','UTILTS-current','{"scope":"product","transactional":true,"dst":true,"corrections":true}'::jsonb),
    ('utilts_s01','UTILTS','S01','UTILTS S01','Metering point register data','E5SE5A-r3','UTILTS-current','{"scope":"metering_point","transactional":true,"corrections":true}'::jsonb),
    ('utilts_s02','UTILTS','S02','UTILTS S02','Metering values by metering point','E5SE5A-r3','UTILTS-current','{"scope":"metering_point","transactional":true,"corrections":true}'::jsonb),
    ('utilts_s03','UTILTS','S03','UTILTS S03','Grid area aggregate','E5SE5A-r3','UTILTS-current','{"scope":"grid_area","transactional":true,"dst":true,"corrections":true}'::jsonb),
    ('utilts_s04','UTILTS','S04','UTILTS S04','Metering point product values','E5SE5A-r3','UTILTS-current','{"scope":"metering_point","transactional":true,"dst":true,"corrections":true}'::jsonb),
    ('utilts_s05','UTILTS','S05','UTILTS S05','Register data','E5SE5A-r3','UTILTS-current','{"scope":"register","transactional":true,"corrections":true}'::jsonb),
    ('utilts_s06','UTILTS','S06','UTILTS S06','Meter replacement data','E5SE5A-r3','UTILTS-current','{"scope":"meter_change","transactional":true,"corrections":true}'::jsonb),
    ('utilts_s07','UTILTS','S07','UTILTS S07','Product time series','E5SE5A-r3','UTILTS-current','{"scope":"product","transactional":true,"dst":true,"corrections":true}'::jsonb),
    ('utilts_err','UTILTS_ERR','ERR','UTILTS-ERR','Transactional functional error','E5SE5A-r3','UTILTS-current','{"scope":"error","requires_contrl":true,"requires_positive_aperak":true}'::jsonb),
    ('contrl','CONTRL','CONTRL','CONTRL','Syntax acknowledgement','26A-r3','PRODAT-26A-rev3','{"reply_to_contrl":false}'::jsonb),
    ('aperak','APERAK','APERAK','APERAK','Application acknowledgement','26A-r3','PRODAT-26A-rev3','{"requires_contrl":true}'::jsonb)
), upsert_profiles as (
  insert into public.ediel_rule_profiles(
    profile_key,message_family,message_code,profile_name,description,active_version,is_active,payload,effective_from
  )
  select profile_key,family,code,name,description,version,true,
         jsonb_build_object('source_revision',source_revision,'rules',rules,'canonical',true),
         date '2026-04-01'
  from profiles
  on conflict(profile_key) do update set
    message_family=excluded.message_family,
    message_code=excluded.message_code,
    profile_name=excluded.profile_name,
    description=excluded.description,
    active_version=excluded.active_version,
    is_active=true,
    payload=excluded.payload,
    effective_from=excluded.effective_from,
    updated_at=now()
  returning profile_key,id
)
insert into public.ediel_rule_profile_versions(
  rule_profile_id,profile_key,version,status,rules,checksum,source_revision,activated_at
)
select p.id,x.profile_key,x.version,'active',x.rules,
       encode(digest(convert_to(x.rules::text,'UTF8'),'sha256'),'hex'),
       x.source_revision,now()
from profiles x
join public.ediel_rule_profiles p on p.profile_key=x.profile_key
on conflict(profile_key,version) do update set
  rule_profile_id=excluded.rule_profile_id,
  status='active',
  rules=excluded.rules,
  checksum=excluded.checksum,
  source_revision=excluded.source_revision,
  activated_at=coalesce(public.ediel_rule_profile_versions.activated_at,excluded.activated_at);

update public.ediel_rule_profile_versions
set checksum=encode(digest(convert_to(coalesce(rules,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex')
where checksum is null or checksum='';

-- Import the legacy field matrix once into the active canonical profile. JSON
-- extraction keeps the backfill compatible with both historical table shapes.
insert into public.ediel_field_matrix_rules(
  company_id,rule_profile_version_id,profile_key,message_family,message_code,
  segment,qualifier,rule_type,rule_payload,source,status,created_at
)
select
  null,
  v.id,
  p.profile_key,
  upper(coalesce(j->>'message_family','')),
  upper(coalesce(j->>'message_code','')),
  coalesce(nullif(j->>'segment_path',''),nullif(j->>'field_key',''),'UNKNOWN'),
  nullif(j->>'subtype',''),
  coalesce(nullif(j->>'requirement',''),'optional'),
  jsonb_build_object(
    'field_key',coalesce(nullif(j->>'field_key',''),nullif(j->>'field_code','')),
    'field_code',nullif(j->>'field_code',''),
    'field_name',coalesce(nullif(j->>'field_name',''),nullif(j->>'field_label','')),
    'field_label',coalesce(nullif(j->>'field_label',''),nullif(j->>'field_name','')),
    'segment_path',nullif(j->>'segment_path',''),
    'requirement',coalesce(nullif(j->>'requirement',''),'optional'),
    'condition',nullif(j->>'condition',''),
    'allowed_values',coalesce(j->'allowed_values','[]'::jsonb),
    'error_code_if_missing',nullif(j->>'error_code_if_missing',''),
    'error_code_if_invalid',nullif(j->>'error_code_if_invalid',''),
    'severity',coalesce(nullif(j->>'severity',''),'error'),
    'subtype',nullif(j->>'subtype',''),
    'legacy_rule_id',nullif(j->>'id','')
  ),
  'legacy_field_rules_backfill','active',now()
from public.ediel_field_rules f
cross join lateral (select to_jsonb(f) j) q
join public.ediel_rule_profiles p
  on p.is_active=true
 and upper(p.message_family)=upper(coalesce(j->>'message_family',''))
 and upper(coalesce(p.message_code,''))=upper(coalesce(j->>'message_code',''))
join public.ediel_rule_profile_versions v
  on v.profile_key=p.profile_key and v.version=p.active_version and v.status='active'
where not exists (
  select 1 from public.ediel_field_matrix_rules m
  where m.rule_profile_version_id=v.id
    and coalesce(m.rule_payload->>'legacy_rule_id','')=coalesce(j->>'id','')
);

create or replace function public.resolve_ediel_rule_pack_fields(
  p_message_family text,
  p_message_code text,
  p_role_code text default null,
  p_direction text default null,
  p_environment text default null,
  p_requested_version text default null,
  p_company_id uuid default null
)
returns table(
  profile_key text,
  rule_profile_version_id uuid,
  profile_version text,
  rule_pack_checksum text,
  message_family text,
  message_code text,
  field_key text,
  field_code text,
  field_name text,
  field_label text,
  segment_path text,
  requirement text,
  condition text,
  allowed_values text[],
  error_code_if_missing text,
  error_code_if_invalid text,
  error_code text,
  severity text,
  role_code text,
  direction text,
  environment text,
  version text,
  version_code text,
  is_active boolean,
  enabled boolean,
  dependency_note text,
  rule_payload jsonb
)
language sql
stable
security definer
set search_path=public
as $$
  with selected as (
    select p.*,v.id version_id,v.version selected_version,v.checksum,v.rules
    from public.ediel_rule_profiles p
    join public.ediel_rule_profile_versions v
      on v.profile_key=p.profile_key
     and v.version=p.active_version
     and v.status='active'
    where p.is_active=true
      and upper(p.message_family)=upper(p_message_family)
      and upper(coalesce(p.message_code,''))=upper(coalesce(p_message_code,''))
      and (p.company_id is null or p.company_id=p_company_id)
    order by case when p.company_id=p_company_id then 0 else 1 end,p.updated_at desc
    limit 1
  ), rows as (
    select
      s.profile_key,s.version_id,s.selected_version,s.checksum,
      s.message_family,s.message_code,
      coalesce(m.rule_payload->>'field_key','') as field_key,
      m.rule_payload->>'field_code' as field_code,
      m.rule_payload->>'field_name' as field_name,
      m.rule_payload->>'field_label' as field_label,
      coalesce(m.rule_payload->>'segment_path',m.segment) as segment_path,
      coalesce(m.rule_payload->>'requirement',m.rule_type,'optional') as requirement,
      m.rule_payload->>'condition' as condition,
      case when jsonb_typeof(m.rule_payload->'allowed_values')='array'
        then array(select jsonb_array_elements_text(m.rule_payload->'allowed_values')) else '{}'::text[] end as allowed_values,
      m.rule_payload->>'error_code_if_missing' as error_code_if_missing,
      m.rule_payload->>'error_code_if_invalid' as error_code_if_invalid,
      m.rule_payload->>'error_code' as error_code,
      coalesce(m.rule_payload->>'severity','error') as severity,
      m.rule_payload->>'role_code' as role_code,
      coalesce(m.rule_payload->>'direction','all') as direction,
      coalesce(m.rule_payload->>'environment','all') as environment,
      s.selected_version as version,
      s.selected_version as version_code,
      true as is_active,true as enabled,
      m.rule_payload->>'dependency_note' as dependency_note,
      m.rule_payload
    from selected s
    join public.ediel_field_matrix_rules m
      on m.rule_profile_version_id=s.version_id and m.status='active'
  )
  select * from rows
  union all
  select s.profile_key,s.version_id,s.selected_version,s.checksum,
         s.message_family,s.message_code,'__PROFILE__',null,null,null,null,'optional',null,
         '{}'::text[],null,null,null,'error',p_role_code,
         coalesce(p_direction,'all'),coalesce(p_environment,'all'),
         s.selected_version,s.selected_version,true,true,null,
         jsonb_build_object('profile_rules',s.rules,'snapshot_only',true)
  from selected s
  where not exists(select 1 from rows);
$$;
revoke all on function public.resolve_ediel_rule_pack_fields(text,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_ediel_rule_pack_fields(text,text,text,text,text,text,uuid) to service_role;

create or replace function public.gridex_capture_ediel_rule_pack_snapshot()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.direction='outbound' and new.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR') then
    if new.company_id is null then raise exception 'outbound_ediel_company_id_required' using errcode='23502'; end if;
    if nullif(new.rule_profile_key,'') is null or new.rule_profile_version_id is null
       or nullif(new.rule_profile_version,'') is null or nullif(new.rule_pack_checksum,'') is null
       or coalesce(new.rule_pack_snapshot,'{}'::jsonb)='{}'::jsonb then
      raise exception 'outbound_ediel_rule_pack_snapshot_required' using errcode='23514';
    end if;
    insert into public.ediel_rule_pack_snapshots(
      company_id,ediel_message_id,profile_key,rule_profile_version_id,profile_version,checksum,snapshot
    ) values (
      new.company_id,new.id,new.rule_profile_key,new.rule_profile_version_id,new.rule_profile_version,new.rule_pack_checksum,new.rule_pack_snapshot
    ) on conflict(ediel_message_id) do update set
      company_id=excluded.company_id,profile_key=excluded.profile_key,
      rule_profile_version_id=excluded.rule_profile_version_id,profile_version=excluded.profile_version,
      checksum=excluded.checksum,snapshot=excluded.snapshot;
  end if;
  return new;
end; $$;

drop trigger if exists ediel_messages_rule_pack_snapshot_trg on public.ediel_messages;
create trigger ediel_messages_rule_pack_snapshot_trg
after insert or update of rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot
on public.ediel_messages for each row execute function public.gridex_capture_ediel_rule_pack_snapshot();

-- ---------------------------------------------------------------------------
-- 3. One database-backed ACK matrix
-- ---------------------------------------------------------------------------
create table if not exists public.ediel_ack_matrix_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  message_family text not null,
  message_code text not null default '*',
  environment text not null default 'all',
  rule_version text not null,
  technical_ack text not null check(technical_ack in ('CONTRL','none')),
  application_ack text not null check(application_ack in ('APERAK','transactional','none')),
  business_responses text[] not null default '{}'::text[],
  negative_application_response text not null check(negative_application_response in ('APERAK','UTILTS_ERR','APERAK_OR_UTILTS_ERR','none')),
  acknowledge_with text[] not null default '{}'::text[],
  checksum text not null,
  is_active boolean not null default true,
  source_revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ediel_ack_matrix_active_uidx
  on public.ediel_ack_matrix_rules(
    coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid),message_family,message_code,environment,rule_version
  );

with rules(family,code,technical,application,business,negative,ackwith) as (
  values
    ('CONTRL','*','none','none','{}'::text[],'none','{}'::text[]),
    ('APERAK','*','CONTRL','none','{}'::text[],'none',array['CONTRL']),
    ('UTILTS_ERR','*','CONTRL','APERAK','{}'::text[],'APERAK',array['CONTRL','APERAK']),
    ('PRODAT','Z01','CONTRL','none',array['Z02'],'APERAK',array['CONTRL']),
    ('PRODAT','*','CONTRL','APERAK','{}'::text[],'APERAK',array['CONTRL','APERAK']),
    ('UTILTS','*','CONTRL','transactional','{}'::text[],'APERAK_OR_UTILTS_ERR',array['CONTRL','APERAK','UTILTS_ERR'])
)
insert into public.ediel_ack_matrix_rules(
  company_id,message_family,message_code,environment,rule_version,technical_ack,application_ack,
  business_responses,negative_application_response,acknowledge_with,checksum,is_active,source_revision
)
select null,family,code,'all','canonical-2026-04-01',technical,application,business,negative,ackwith,
       encode(digest(convert_to(concat_ws('|',family,code,technical,application,array_to_string(business,','),negative,array_to_string(ackwith,',')),'UTF8'),'sha256'),'hex'),
       true,'PRODAT-26A-rev3/UTILTS-current'
from rules
on conflict do nothing;

with rules(family,code,technical,application,business,negative,ackwith) as (
  values
    ('CONTRL','*','none','none','{}'::text[],'none','{}'::text[]),
    ('APERAK','*','CONTRL','none','{}'::text[],'none',array['CONTRL']),
    ('UTILTS_ERR','*','CONTRL','APERAK','{}'::text[],'APERAK',array['CONTRL','APERAK']),
    ('PRODAT','Z01','CONTRL','none',array['Z02'],'APERAK',array['CONTRL']),
    ('PRODAT','*','CONTRL','APERAK','{}'::text[],'APERAK',array['CONTRL','APERAK']),
    ('UTILTS','*','CONTRL','transactional','{}'::text[],'APERAK_OR_UTILTS_ERR',array['CONTRL','APERAK','UTILTS_ERR'])
)
update public.ediel_ack_matrix_rules r
set technical_ack=x.technical,application_ack=x.application,business_responses=x.business,
    negative_application_response=x.negative,acknowledge_with=x.ackwith,
    checksum=encode(digest(convert_to(concat_ws('|',x.family,x.code,x.technical,x.application,array_to_string(x.business,','),x.negative,array_to_string(x.ackwith,',')),'UTF8'),'sha256'),'hex'),
    is_active=true,updated_at=now()
from rules x
where r.company_id is null and r.message_family=x.family and r.message_code=x.code
  and r.environment='all' and r.rule_version='canonical-2026-04-01';

create or replace function public.resolve_ediel_ack_matrix_rule(
  p_message_family text,
  p_message_code text default '*',
  p_company_id uuid default null,
  p_environment text default null,
  p_requested_version text default null
)
returns table(
  rule_id uuid,rule_version text,rule_checksum text,message_family text,message_code text,
  technical_ack text,application_ack text,business_responses text[],negative_application_response text,acknowledge_with text[]
)
language sql stable security definer set search_path=public as $$
  select r.id,r.rule_version,r.checksum,r.message_family,r.message_code,r.technical_ack,r.application_ack,
         r.business_responses,r.negative_application_response,r.acknowledge_with
  from public.ediel_ack_matrix_rules r
  where r.is_active=true
    and upper(r.message_family)=upper(p_message_family)
    and (upper(r.message_code)=upper(coalesce(nullif(p_message_code,''),'*')) or r.message_code='*')
    and (r.company_id is null or r.company_id=p_company_id)
    and (r.environment='all' or r.environment=coalesce(nullif(p_environment,''),'all'))
    and (p_requested_version is null or r.rule_version=p_requested_version or r.rule_version='canonical-2026-04-01')
  order by case when r.company_id=p_company_id then 0 else 1 end,
           case when upper(r.message_code)=upper(coalesce(nullif(p_message_code,''),'*')) then 0 else 1 end,
           r.updated_at desc
  limit 1;
$$;
revoke all on function public.resolve_ediel_ack_matrix_rule(text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.resolve_ediel_ack_matrix_rule(text,text,uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 7-8. Tenant-only production routes and atomic single-item outbox claim
-- ---------------------------------------------------------------------------
create or replace function public.gridex_require_tenant_owned_ediel_route()
returns trigger language plpgsql as $$
begin
  if new.is_active=true and coalesce(new.route_type,'')='ediel_partner'
     and coalesce(new.environment_type::text,'production')='production'
     and new.company_id is null then
    raise exception 'production_ediel_route_company_id_required' using errcode='23502';
  end if;
  return new;
end; $$;

drop trigger if exists communication_routes_tenant_owned_ediel_trg on public.communication_routes;
create trigger communication_routes_tenant_owned_ediel_trg
before insert or update of company_id,is_active,route_type,environment_type
on public.communication_routes for each row execute function public.gridex_require_tenant_owned_ediel_route();

create or replace function public.claim_ediel_outbox_item(
  p_outbox_item_id uuid,
  p_worker_id text,
  p_actor_user_id uuid
)
returns setof public.ediel_outbox
language plpgsql security definer set search_path=public as $$
begin
  if p_outbox_item_id is null or nullif(trim(p_worker_id),'') is null or p_actor_user_id is null then
    raise exception 'ediel_outbox_claim_arguments_required' using errcode='22023';
  end if;
  return query
  with claimed as (
    update public.ediel_outbox o
       set status='sending',locked_at=now(),locked_by=p_worker_id,
           attempts=coalesce(o.attempts,0)+1,
           send_attempt_count=coalesce(o.send_attempt_count,0)+1,
           current_send_attempt_id=gen_random_uuid(),updated_by=p_actor_user_id,updated_at=now()
     where o.id=p_outbox_item_id
       and o.company_id is not null
       and o.status in ('prepared','queued')
       and exists(
         select 1 from public.ediel_messages m
         where m.id=o.ediel_message_id and m.company_id=o.company_id and m.direction='outbound'
           and m.rule_profile_version_id is not null and nullif(m.rule_pack_checksum,'') is not null
       )
     returning o.*
  ) select * from claimed;
end; $$;
revoke all on function public.claim_ediel_outbox_item(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_ediel_outbox_item(uuid,text,uuid) to service_role;

create or replace function public.gridex_validate_ediel_outbox_tenant_and_snapshot()
returns trigger language plpgsql as $$
declare m public.ediel_messages%rowtype;
begin
  select * into m from public.ediel_messages where id=new.ediel_message_id;
  if not found then raise exception 'ediel_outbox_message_missing' using errcode='23503'; end if;
  if new.company_id is null or m.company_id is null or new.company_id<>m.company_id then
    raise exception 'ediel_outbox_message_tenant_mismatch' using errcode='23514';
  end if;
  if m.direction<>'outbound' then raise exception 'ediel_outbox_requires_outbound_message' using errcode='23514'; end if;
  if m.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR')
     and (m.rule_profile_version_id is null or nullif(m.rule_pack_checksum,'') is null) then
    raise exception 'ediel_outbox_rule_pack_snapshot_missing' using errcode='23514';
  end if;
  new.rule_profile_key:=m.rule_profile_key;
  new.rule_profile_version_id:=m.rule_profile_version_id;
  new.rule_profile_version:=m.rule_profile_version;
  new.rule_pack_checksum:=m.rule_pack_checksum;
  new.rule_pack_snapshot:=m.rule_pack_snapshot;
  return new;
end; $$;

drop trigger if exists ediel_outbox_tenant_snapshot_trg on public.ediel_outbox;
create trigger ediel_outbox_tenant_snapshot_trg
before insert or update of company_id,ediel_message_id,status
on public.ediel_outbox for each row execute function public.gridex_validate_ediel_outbox_tenant_and_snapshot();

-- ---------------------------------------------------------------------------
-- 9. Full metering-to-billing lineage and an enforceable billing gate
-- ---------------------------------------------------------------------------
alter table if exists public.normalized_metering_values
  add column if not exists billing_gate_status text not null default 'pending_match',
  add column if not exists billing_gate_reasons jsonb not null default '[]'::jsonb,
  add column if not exists billing_gate_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists billing_gate_evaluated_at timestamptz;

alter table if exists public.metering_values
  add column if not exists billing_gate_status text not null default 'pending_match',
  add column if not exists billing_gate_reasons jsonb not null default '[]'::jsonb,
  add column if not exists billing_gate_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists billing_gate_evaluated_at timestamptz,
  add column if not exists supply_period_id uuid;

alter table if exists public.normalized_metering_values drop constraint if exists normalized_metering_values_billing_gate_status_check;
alter table if exists public.normalized_metering_values add constraint normalized_metering_values_billing_gate_status_check
  check(billing_gate_status in ('pending_match','eligible','blocked','conflict'));
alter table if exists public.metering_values drop constraint if exists metering_values_billing_gate_status_check;
alter table if exists public.metering_values add constraint metering_values_billing_gate_status_check
  check(billing_gate_status in ('pending_match','eligible','blocked','conflict'));

create index if not exists normalized_metering_values_billing_gate_idx
  on public.normalized_metering_values(company_id,billing_gate_status,billing_status,revision_status,period_start,metering_point_id);

create or replace function public.gridex_billing_underlay_item_gate_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare n public.normalized_metering_values%rowtype; u public.billing_underlays%rowtype;
begin
  if new.source_normalized_metering_value_id is null then
    raise exception 'billing_underlay_source_normalized_value_required' using errcode='23514';
  end if;
  select * into n from public.normalized_metering_values where id=new.source_normalized_metering_value_id;
  select * into u from public.billing_underlays where id=new.billing_underlay_id;
  if not found or u.id is null then raise exception 'billing_underlay_missing' using errcode='23503'; end if;
  if n.id is null then raise exception 'billing_underlay_normalized_value_missing' using errcode='23503'; end if;
  if n.company_id<>new.company_id or u.company_id<>new.company_id then
    raise exception 'billing_underlay_lineage_tenant_mismatch' using errcode='23514';
  end if;
  if n.revision_status<>'current' or n.billing_status<>'billable' or n.billing_gate_status<>'eligible' then
    raise exception 'billing_underlay_value_not_gate_eligible' using errcode='23514';
  end if;
  if n.source_message_id is null or n.source_metering_value_id is null or n.supply_period_id is null then
    raise exception 'billing_underlay_lineage_incomplete' using errcode='23514';
  end if;
  if u.supply_period_id is null or u.supply_period_id<>n.supply_period_id then
    raise exception 'billing_underlay_supply_period_mismatch' using errcode='23514';
  end if;
  if n.period_start < u.billing_period_start or n.period_end > u.billing_period_end then
    raise exception 'billing_underlay_period_outside_segment' using errcode='23514';
  end if;
  return new;
end; $$;

drop trigger if exists billing_underlay_items_gate_guard_trg on public.billing_underlay_items;
create trigger billing_underlay_items_gate_guard_trg
before insert or update of source_normalized_metering_value_id,billing_underlay_id,company_id
on public.billing_underlay_items for each row execute function public.gridex_billing_underlay_item_gate_guard();

-- ---------------------------------------------------------------------------
-- 10. Idempotent repair/diagnostic suite. It never guesses masterdata or dates.
-- ---------------------------------------------------------------------------
create table if not exists public.ediel_repair_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  mode text not null check(mode in ('scan','safe_repair')),
  status text not null default 'running',
  counters jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid
);
create table if not exists public.ediel_repair_issues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ediel_repair_runs(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  issue_fingerprint text not null,
  issue_type text not null,
  entity_type text not null,
  entity_id uuid,
  severity text not null check(severity in ('warning','error','critical')),
  status text not null default 'open' check(status in ('open','repaired','ignored')),
  details jsonb not null default '{}'::jsonb,
  repaired_at timestamptz,
  created_at timestamptz not null default now(),
  unique(run_id,issue_fingerprint)
);
create index if not exists ediel_repair_issues_company_status_idx
  on public.ediel_repair_issues(company_id,status,severity,created_at desc);

create or replace function public.gridex_scan_ediel_canonical_repairs(
  p_company_id uuid default null,
  p_apply_safe_repairs boolean default false,
  p_actor_user_id uuid default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_run uuid; v_repaired integer:=0; v_issues integer:=0;
begin
  insert into public.ediel_repair_runs(company_id,mode,created_by)
  values(p_company_id,case when p_apply_safe_repairs then 'safe_repair' else 'scan' end,p_actor_user_id)
  returning id into v_run;

  insert into public.ediel_repair_issues(run_id,company_id,issue_fingerprint,issue_type,entity_type,entity_id,severity,details)
  select v_run,m.company_id,encode(digest(convert_to('message_without_tenant|'||m.id::text,'UTF8'),'sha256'),'hex'),
         'message_without_tenant','ediel_message',m.id,'critical',jsonb_build_object('family',m.message_family,'code',m.message_code,'direction',m.direction)
  from public.ediel_messages m where m.company_id is null and (p_company_id is null)
  on conflict do nothing;

  insert into public.ediel_repair_issues(run_id,company_id,issue_fingerprint,issue_type,entity_type,entity_id,severity,details)
  select v_run,m.company_id,encode(digest(convert_to('outbound_rule_snapshot_missing|'||m.id::text,'UTF8'),'sha256'),'hex'),
         'outbound_rule_snapshot_missing','ediel_message',m.id,'critical',jsonb_build_object('family',m.message_family,'code',m.message_code)
  from public.ediel_messages m
  where m.direction='outbound' and m.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR')
    and (m.rule_profile_version_id is null or nullif(m.rule_pack_checksum,'') is null)
    and (p_company_id is null or m.company_id=p_company_id)
  on conflict do nothing;

  insert into public.ediel_repair_issues(run_id,company_id,issue_fingerprint,issue_type,entity_type,entity_id,severity,details)
  select v_run,o.company_id,encode(digest(convert_to('outbox_tenant_mismatch|'||o.id::text,'UTF8'),'sha256'),'hex'),
         'outbox_tenant_mismatch','ediel_outbox',o.id,'critical',jsonb_build_object('message_id',o.ediel_message_id,'message_company_id',m.company_id)
  from public.ediel_outbox o join public.ediel_messages m on m.id=o.ediel_message_id
  where (o.company_id is null or m.company_id is null or o.company_id<>m.company_id)
    and (p_company_id is null or o.company_id=p_company_id or m.company_id=p_company_id)
  on conflict do nothing;

  insert into public.ediel_repair_issues(run_id,company_id,issue_fingerprint,issue_type,entity_type,entity_id,severity,details)
  select v_run,m.company_id,encode(digest(convert_to('z04_subtype_missing|'||m.id::text,'UTF8'),'sha256'),'hex'),
         'z04_subtype_missing','ediel_message',m.id,'critical',jsonb_build_object('parsed_payload',m.parsed_payload)
  from public.ediel_messages m
  where m.message_family='PRODAT' and m.message_code='Z04'
    and coalesce(nullif(m.message_subtype,''),nullif(m.parsed_payload->>'subtype','')) is null
    and (p_company_id is null or m.company_id=p_company_id)
  on conflict do nothing;

  insert into public.ediel_repair_issues(run_id,company_id,issue_fingerprint,issue_type,entity_type,entity_id,severity,details)
  select v_run,n.company_id,encode(digest(convert_to('metering_lineage_incomplete|'||n.id::text,'UTF8'),'sha256'),'hex'),
         'metering_lineage_incomplete','normalized_metering_value',n.id,'error',
         jsonb_build_object('source_message_id',n.source_message_id,'source_metering_value_id',n.source_metering_value_id,'supply_period_id',n.supply_period_id,'billing_status',n.billing_status)
  from public.normalized_metering_values n
  where n.revision_status='current' and (n.source_message_id is null or n.source_metering_value_id is null or n.supply_period_id is null)
    and (p_company_id is null or n.company_id=p_company_id)
  on conflict do nothing;

  insert into public.ediel_repair_issues(run_id,company_id,issue_fingerprint,issue_type,entity_type,entity_id,severity,details)
  select v_run,r.company_id,encode(digest(convert_to('global_production_route|'||r.id::text,'UTF8'),'sha256'),'hex'),
         'global_production_route','communication_route',r.id,'critical',jsonb_build_object('route_name',r.route_name,'route_type',r.route_type)
  from public.communication_routes r
  where r.company_id is null and r.is_active=true and coalesce(r.route_type,'')='ediel_partner'
    and coalesce(r.environment_type::text,'production')='production' and p_company_id is null
  on conflict do nothing;

  if p_apply_safe_repairs then
    update public.normalized_metering_values n
       set source_message_id=m.source_message_id,
           billing_gate_status='pending_match',
           billing_gate_reasons='["safe_repair_lineage_backfill_requires_gate_recheck"]'::jsonb,
           billing_gate_evaluated_at=null,
           updated_at=now()
      from public.metering_values m
     where n.source_metering_value_id=m.id and n.company_id=m.company_id
       and n.source_message_id is null and m.source_message_id is not null
       and (p_company_id is null or n.company_id=p_company_id);
    get diagnostics v_repaired=row_count;
  end if;

  select count(*) into v_issues from public.ediel_repair_issues where run_id=v_run;
  update public.ediel_repair_runs
     set status='completed',completed_at=now(),counters=jsonb_build_object('issues',v_issues,'safe_repairs',v_repaired)
   where id=v_run;
  return v_run;
exception when others then
  update public.ediel_repair_runs set status='failed',completed_at=now(),counters=jsonb_build_object('error',sqlerrm) where id=v_run;
  raise;
end; $$;
revoke all on function public.gridex_scan_ediel_canonical_repairs(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.gridex_scan_ediel_canonical_repairs(uuid,boolean,uuid) to service_role;

-- RLS/service role: operational writes happen through service-role kernel/RPCs.
alter table public.ediel_rule_pack_snapshots enable row level security;
alter table public.ediel_ack_matrix_rules enable row level security;
alter table public.ediel_repair_runs enable row level security;
alter table public.ediel_repair_issues enable row level security;
revoke all on public.ediel_rule_pack_snapshots,public.ediel_ack_matrix_rules,public.ediel_repair_runs,public.ediel_repair_issues from anon,authenticated;
grant select,insert,update,delete on public.ediel_rule_pack_snapshots,public.ediel_ack_matrix_rules,public.ediel_repair_runs,public.ediel_repair_issues to service_role;

commit;
