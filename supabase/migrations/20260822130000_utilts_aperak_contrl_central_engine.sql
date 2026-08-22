-- Central Swedish UTILTS + APERAK + CONTRL production hardening.
-- Supplier operational outbound is E73 only, behind an explicit bilateral
-- capability. ACK transport/application state is kept separate from business
-- acceptance. Historical sent payloads are not rewritten.

begin;

-- Expired compatibility rules must not remain selectable as active runtime rules.
update public.ediel_message_rules
set is_active = false,
    updated_at = now()
where is_active = true
  and valid_to is not null
  and valid_to < current_date;

-- Current supplier-facing UTILTS direction and ACK semantics.
update public.ediel_message_rules
set direction = case upper(message_code)
      when 'E73' then 'outbound'
      when 'E66' then 'inbound'
      when 'S02' then 'inbound'
      else direction
    end,
    requires_contrl = true,
    requires_aperak = true,
    supports_negative_response = true,
    ack_deadline_minutes = 30,
    automatic_processing_enabled = case
      when upper(message_code) in ('E66','S02','E73') then true
      else automatic_processing_enabled
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'semantic_source', 'swedish_utilts_central_2026_08_22',
      'transport_ack_is_not_business_acceptance', true
    ),
    updated_at = now()
where upper(message_family) = 'UTILTS'
  and coalesce(version_code, version) = 'E5SE5A'
  and upper(message_code) in ('E66','S02','E73');

-- APERAK is acknowledged by CONTRL, never by APERAK. CONTRL itself is not
-- acknowledged. UTILTS-ERR requires both CONTRL and APERAK.
update public.ediel_message_rules
set requires_contrl = true,
    requires_aperak = false,
    supports_negative_response = false,
    ack_deadline_minutes = 30,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'semantic_source', 'swedish_ack_central_2026_08_22'
    ),
    updated_at = now()
where upper(message_family) = 'APERAK' and is_active = true;

update public.ediel_message_rules
set requires_contrl = false,
    requires_aperak = false,
    supports_negative_response = false,
    ack_deadline_minutes = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'semantic_source', 'swedish_ack_central_2026_08_22'
    ),
    updated_at = now()
where upper(message_family) = 'CONTRL' and is_active = true;

update public.ediel_message_rules
set requires_contrl = true,
    requires_aperak = true,
    supports_negative_response = true,
    ack_deadline_minutes = 30,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'semantic_source', 'swedish_ack_central_2026_08_22'
    ),
    updated_at = now()
where upper(message_family) = 'UTILTS_ERR' and is_active = true;

-- Version the canonical ACK matrix instead of mutating the old snapshot.
update public.ediel_ack_matrix_rules
set is_active = false, updated_at = now()
where is_active = true
  and upper(message_family) in ('UTILTS','UTILTS_ERR','APERAK','CONTRL');

with rules(message_family,message_code,technical_ack,application_ack,business_responses,negative_application_response,acknowledge_with) as (
  values
    ('CONTRL','*','none','none','{}'::text[],'none','{}'::text[]),
    ('APERAK','*','CONTRL','none','{}'::text[],'none',array['CONTRL']::text[]),
    ('UTILTS_ERR','*','CONTRL','APERAK','{}'::text[],'APERAK',array['CONTRL','APERAK']::text[]),
    ('UTILTS','*','CONTRL','transactional','{}'::text[],'APERAK_OR_UTILTS_ERR',array['CONTRL','APERAK','UTILTS_ERR']::text[])
), prepared as (
  select *,
    encode(digest(concat_ws('|',message_family,message_code,technical_ack,application_ack,array_to_string(business_responses,','),negative_application_response,array_to_string(acknowledge_with,','),'canonical-2026-08-22'),'sha256'),'hex') as checksum
  from rules
)
insert into public.ediel_ack_matrix_rules(
  company_id,message_family,message_code,environment,rule_version,technical_ack,
  application_ack,business_responses,negative_application_response,acknowledge_with,
  checksum,is_active,source_revision,created_at,updated_at
)
select null,message_family,message_code,'all','canonical-2026-08-22',technical_ack,
       application_ack,business_responses,negative_application_response,acknowledge_with,
       checksum,true,'Swedish UTILTS-APERAK/CONTRL central semantics 2026-08-22',now(),now()
from prepared;

-- ACK rule versions are independent of the source message association/version.
-- If the caller explicitly requests a canonical-* ACK rule version we honor it;
-- otherwise select the latest active canonical rule for family/code/tenant/env.
create or replace function public.resolve_ediel_ack_matrix_rule(
  p_message_family text,
  p_message_code text default '*',
  p_company_id uuid default null,
  p_environment text default null,
  p_requested_version text default null
)
returns table(
  rule_id uuid,
  rule_version text,
  rule_checksum text,
  message_family text,
  message_code text,
  technical_ack text,
  application_ack text,
  business_responses text[],
  negative_application_response text,
  acknowledge_with text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,r.rule_version,r.checksum,r.message_family,r.message_code,r.technical_ack,r.application_ack,
         r.business_responses,r.negative_application_response,r.acknowledge_with
  from public.ediel_ack_matrix_rules r
  where r.is_active=true
    and upper(r.message_family)=upper(p_message_family)
    and (upper(r.message_code)=upper(coalesce(nullif(p_message_code,''),'*')) or r.message_code='*')
    and (r.company_id is null or r.company_id=p_company_id)
    and (r.environment='all' or r.environment=coalesce(nullif(p_environment,''),'all'))
    and (
      p_requested_version is null
      or p_requested_version !~* '^canonical-'
      or r.rule_version=p_requested_version
    )
  order by case when r.company_id=p_company_id then 0 else 1 end,
           case when upper(r.message_code)=upper(coalesce(nullif(p_message_code,''),'*')) then 0 else 1 end,
           r.updated_at desc,
           r.created_at desc
  limit 1;
$$;

-- Database defense in depth for operational supplier UTILTS. Actor-test
-- fixtures without a grid-owner data request remain possible, but the real CIS
-- data-request path cannot originate E66 or an unqualified E73.
create or replace function public.gridex_enforce_supplier_utilts_outbound_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code text;
  v_requested text;
  v_resolution text;
  v_expected_appref text;
  v_capability_count integer;
  v_operational boolean;
begin
  if new.direction <> 'outbound' or upper(coalesce(new.message_family,'')) <> 'UTILTS' then
    return new;
  end if;

  -- Never reinterpret/mutate already-sent historical market payloads.
  if tg_op = 'UPDATE' and old.status in ('sent','acknowledged','received','validated') then
    return new;
  end if;

  v_code := upper(coalesce(new.message_code,''));
  v_operational := new.grid_owner_data_request_id is not null
    or lower(coalesce(new.process_type,'')) = 'meter_values_request';

  if not v_operational then
    return new;
  end if;

  if v_code = 'E66' then
    raise exception 'utilts_e66_supplier_outbound_not_allowed';
  end if;

  if v_code <> 'E73' then
    raise exception 'utilts_supplier_operational_outbound_not_allowed:%', v_code;
  end if;

  v_requested := upper(coalesce(
    new.parsed_payload->>'requestedMessageCode',
    new.parsed_payload->>'requested_message_code',
    ''
  ));
  if v_requested not in ('S02','E66') then
    raise exception 'utilts_e73_requested_message_required';
  end if;

  if coalesce((new.parsed_payload->>'bilateralCapabilityVerified')::boolean,false) is not true then
    raise exception 'utilts_e73_bilateral_capability_required';
  end if;
  if new.company_id is null then
    raise exception 'utilts_e73_company_required';
  end if;

  select count(*) into v_capability_count
  from public.tenant_message_capabilities c
  where c.company_id = new.company_id
    and c.environment = new.environment
    and upper(c.message_family) = 'UTILTS'
    and upper(c.message_code) = 'E73'
    and lower(c.direction) = 'outbound'
    and c.is_enabled = true
    and c.bilateral = true
    and (c.valid_from is null or c.valid_from <= now())
    and (c.valid_to is null or c.valid_to > now());

  if v_capability_count <> 1 then
    raise exception 'utilts_e73_bilateral_capability_invalid:%', v_capability_count;
  end if;

  v_resolution := upper(coalesce(
    new.parsed_payload->>'resolution',
    new.parsed_payload->>'readingFrequency',
    ''
  ));
  if v_requested = 'S02' then
    v_expected_appref := '23-DDQ-S02-S';
  elsif v_resolution in ('15','PT15M','QUARTER_HOUR','QUARTER-HOURLY','QUARTER_HOURLY','KVART') then
    v_expected_appref := '23-DDQ-E66-T';
  else
    v_expected_appref := '23-DDQ-E66-S';
  end if;

  if upper(coalesce(new.application_reference,'')) = '23-DDQ-UTILTS' then
    raise exception 'utilts_generic_application_reference_forbidden';
  end if;
  if upper(coalesce(new.application_reference,'')) <> v_expected_appref then
    raise exception 'utilts_e73_application_reference_mismatch:expected=% actual=%', v_expected_appref, coalesce(new.application_reference,'');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_gridex_enforce_supplier_utilts_outbound_v1 on public.ediel_messages;
create trigger trg_gridex_enforce_supplier_utilts_outbound_v1
before insert or update on public.ediel_messages
for each row execute function public.gridex_enforce_supplier_utilts_outbound_v1();

-- Verification: one active canonical ACK row per family and no stale current
-- E66/E73 supplier directions.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from (
    select upper(message_family) family,count(*) n
    from public.ediel_ack_matrix_rules
    where is_active=true and upper(message_family) in ('UTILTS','UTILTS_ERR','APERAK','CONTRL')
    group by upper(message_family)
    having count(*) <> 1
  ) q;
  if v_bad <> 0 then
    raise exception 'canonical ack matrix verification failed';
  end if;

  if exists (
    select 1 from public.ediel_message_rules
    where is_active=true
      and coalesce(version_code,version)='E5SE5A'
      and ((upper(message_code)='E66' and direction <> 'inbound')
        or (upper(message_code)='E73' and direction <> 'outbound')
        or (upper(message_code)='S02' and direction <> 'inbound'))
  ) then
    raise exception 'current UTILTS supplier direction verification failed';
  end if;
end $$;

commit;
