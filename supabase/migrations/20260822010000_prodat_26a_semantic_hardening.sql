-- PRODAT 26.A semantic hardening
--
-- Scope:
--   * make active PRODAT 26.A message profiles direction-exact
--   * persist canonical sender/receiver role and business meaning in profile JSON
--   * replace stale active PRODAT message semantics with versioned 26.A semantics
--   * prevent transport/application acknowledgement from becoming supplier-switch
--     business acceptance without an inbound Z04 market confirmation
--
-- Historical Ediel messages/payloads are intentionally not rewritten.

begin;

-- ---------------------------------------------------------------------------
-- 1. Active PRODAT 26.A message-profile direction and role contract
-- ---------------------------------------------------------------------------

create temporary table _prodat_26a_profile_contract (
  message_code text not null,
  transaction_subtype text not null,
  direction text not null,
  sender_role text not null,
  receiver_role text not null,
  business_process text not null,
  business_event text not null,
  reason_code text not null,
  primary key (message_code, transaction_subtype)
) on commit drop;

insert into _prodat_26a_profile_contract
  (message_code, transaction_subtype, direction, sender_role, receiver_role, business_process, business_event, reason_code)
values
  ('Z01','L', 'outbound','supplier','grid_owner','facility_contract_check','grid_contract_check_requested','Z22'),
  ('Z01','LK','outbound','supplier','grid_owner','facility_contract_check','grid_contract_check_requested','Z23'),
  ('Z02','L', 'inbound','grid_owner','supplier','facility_contract_response','grid_contract_check_received','Z22'),
  ('Z02','LK','inbound','grid_owner','supplier','facility_contract_response','grid_contract_check_received','Z23'),
  ('Z03','L', 'outbound','supplier','grid_owner','supplier_switch','supplier_switch_requested','Z22'),
  ('Z03','LK','outbound','supplier','grid_owner','move_in','customer_and_supplier_change_requested','Z23'),
  ('Z03','C', 'outbound','supplier','grid_owner','supplier_switch_cancellation','supplier_switch_cancellation_requested','Z24'),
  ('Z04','L', 'inbound','grid_owner','supplier','supplier_switch_response','supplier_switch_confirmed','Z22'),
  ('Z04','LK','inbound','grid_owner','supplier','supplier_switch_response','customer_and_supplier_change_confirmed','Z23'),
  ('Z04','C', 'inbound','grid_owner','supplier','supplier_switch_cancellation_response','supplier_switch_cancellation_confirmed','Z24'),
  ('Z04','A', 'inbound','grid_owner','supplier','assigned_supply','assigned_supply_notified','Z26'),
  ('Z04','D', 'inbound','grid_owner','supplier','mandatory_purchase','mandatory_purchase_notified','Z70'),
  ('Z05','L', 'inbound','grid_owner','supplier','supply_termination','supply_termination_notified','Z22'),
  ('Z05','LK','inbound','grid_owner','supplier','supply_termination','supply_termination_notified','Z23'),
  ('Z05','C', 'inbound','grid_owner','supplier','supply_continuation','supply_termination_reverted','Z24'),
  ('Z06','E', 'inbound','grid_owner','supplier','customer_masterdata_update','customer_masterdata_received','E34'),
  ('Z06','F', 'inbound','grid_owner','supplier','masterdata_with_reading','masterdata_with_reading_received','E64'),
  ('Z06','G', 'inbound','grid_owner','supplier','masterdata_without_reading','masterdata_without_reading_received','E32'),
  ('Z08','H', 'outbound','supplier','grid_owner','supplier_termination','supplier_termination_requested','Z25'),
  ('Z09','B', 'outbound','supplier','grid_owner','balance_responsible_change','balance_responsible_change_requested','Z27'),
  ('Z09','D', 'outbound','supplier','grid_owner','producer_agreement','producer_agreement_change_requested','Z70'),
  ('Z09','E', 'outbound','supplier','grid_owner','customer_masterdata_update','customer_masterdata_change_requested','E34'),
  ('Z09','F', 'outbound','supplier','grid_owner','quarter_metering_requested','quarter_metering_requested','E64'),
  ('Z09','G', 'outbound','supplier','grid_owner','quarter_metering_ended','quarter_metering_end_requested','E32'),
  ('Z10','M', 'inbound','grid_owner','supplier','meter_change','meter_change_received','E58'),
  ('Z13','V', 'outbound','esco','grid_owner','metering_permission_current','metering_reporting_permission_requested','S17'),
  ('Z13','VH','outbound','esco','grid_owner','metering_permission_historic','historical_metering_reporting_requested','S18'),
  ('Z14','V', 'inbound','grid_owner','esco','metering_permission_current','metering_reporting_permission_confirmed','S17'),
  ('Z14','VH','inbound','grid_owner','esco','metering_permission_historic','historical_metering_reporting_confirmed','S18'),
  ('Z14','N', 'inbound','grid_owner','esco','metering_permission_rejected','metering_reporting_permission_rejected','Z96'),
  ('Z15','V', 'inbound','grid_owner','esco','metering_permission_ended','metering_reporting_ended','S17'),
  ('Z15','VH','inbound','grid_owner','esco','historic_permission_ended','historical_metering_reporting_ended','S18'),
  ('Z15','C', 'inbound','grid_owner','esco','permission_termination_cancelled','metering_reporting_continues','Z24'),
  ('Z18','V', 'outbound','esco','grid_owner','metering_permission_termination','metering_reporting_end_requested','S17');

-- If an exact-direction duplicate already exists, keep it and remove the stale
-- 'both' row before the update below. This makes the migration replay-safe across
-- environments that may already contain a partial correction.
delete from public.ediel_message_profiles stale
using public.ediel_rule_packs rp, _prodat_26a_profile_contract contract
where stale.rule_pack_id = rp.id
  and rp.family = 'PRODAT'
  and rp.guide_version = '26.A'
  and rp.status = 'active'
  and stale.message_code = contract.message_code
  and stale.transaction_subtype = contract.transaction_subtype
  and stale.direction = 'both'
  and exists (
    select 1
    from public.ediel_message_profiles exact
    where exact.rule_pack_id = stale.rule_pack_id
      and exact.message_code = stale.message_code
      and exact.transaction_subtype = stale.transaction_subtype
      and exact.direction = contract.direction
      and exact.id <> stale.id
  );

update public.ediel_message_profiles profile
set
  direction = contract.direction,
  business_process = contract.business_process,
  profile = coalesce(profile.profile, '{}'::jsonb) || jsonb_build_object(
    'source', 'canonical-db-rule-pack',
    'semanticSource', 'Swedish PRODAT 26.A',
    'semanticHardeningVersion', '2026-08-22.prodat-26a.v1',
    'canonicalDirection', contract.direction,
    'senderRole', contract.sender_role,
    'receiverRole', contract.receiver_role,
    'businessProcess', contract.business_process,
    'businessEvent', contract.business_event,
    'reasonForTransaction', contract.reason_code
  )
from public.ediel_rule_packs rp, _prodat_26a_profile_contract contract
where profile.rule_pack_id = rp.id
  and rp.family = 'PRODAT'
  and rp.guide_version = '26.A'
  and rp.status = 'active'
  and profile.message_code = contract.message_code
  and profile.transaction_subtype = contract.transaction_subtype;

-- Fail the migration instead of silently leaving an incomplete active pack.
do $$
declare
  missing_count integer;
  wrong_direction_count integer;
begin
  select count(*) into missing_count
  from _prodat_26a_profile_contract contract
  where not exists (
    select 1
    from public.ediel_message_profiles profile
    join public.ediel_rule_packs rp on rp.id = profile.rule_pack_id
    where rp.family = 'PRODAT'
      and rp.guide_version = '26.A'
      and rp.status = 'active'
      and profile.message_code = contract.message_code
      and profile.transaction_subtype = contract.transaction_subtype
      and profile.direction = contract.direction
      and profile.is_enabled = true
  );

  if missing_count <> 0 then
    raise exception 'PRODAT 26.A profile hardening incomplete: % canonical profiles missing', missing_count;
  end if;

  select count(*) into wrong_direction_count
  from public.ediel_message_profiles profile
  join public.ediel_rule_packs rp on rp.id = profile.rule_pack_id
  join _prodat_26a_profile_contract contract
    on contract.message_code = profile.message_code
   and contract.transaction_subtype = profile.transaction_subtype
  where rp.family = 'PRODAT'
    and rp.guide_version = '26.A'
    and rp.status = 'active'
    and profile.is_enabled = true
    and profile.direction <> contract.direction;

  if wrong_direction_count <> 0 then
    raise exception 'PRODAT 26.A profile hardening incomplete: % profiles still have a non-canonical direction', wrong_direction_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Versioned business semantics. Historical rows remain for audit but are
--    deactivated; the new version is the only active PRODAT semantic set.
-- ---------------------------------------------------------------------------

update public.ediel_message_semantics
set is_active = false, updated_at = now()
where upper(message_family) = 'PRODAT'
  and is_active = true
  and rule_version <> '26.A-r3-semantic-hardening-20260822';

insert into public.ediel_message_semantics (
  message_family,
  message_code,
  subtype,
  direction,
  sender_role,
  receiver_role,
  business_process,
  request_type,
  expected_response,
  allowed_next_status,
  required_fields,
  forbidden_if_missing,
  ack_policy,
  timeout_policy,
  rule_version,
  environment,
  is_active,
  metadata
)
select
  'PRODAT',
  contract.message_code,
  contract.transaction_subtype,
  contract.direction,
  contract.sender_role,
  contract.receiver_role,
  contract.business_process,
  case
    when contract.message_code = 'Z01' then 'facility_lookup'
    when contract.message_code = 'Z02' then 'facility_lookup_response'
    when contract.message_code = 'Z03' then case when contract.transaction_subtype = 'C' then 'supplier_switch_cancellation' else 'supplier_switch' end
    when contract.message_code = 'Z04' then 'supplier_switch_response'
    when contract.message_code = 'Z05' then case when contract.transaction_subtype = 'C' then 'supply_continuation_notice' else 'supply_termination_notice' end
    when contract.message_code in ('Z06','Z09') then 'masterdata_update'
    when contract.message_code = 'Z08' then 'supply_termination'
    when contract.message_code = 'Z10' then 'meter_change'
    when contract.message_code = 'Z13' then 'metering_access_request'
    when contract.message_code = 'Z14' then 'metering_access_response'
    when contract.message_code = 'Z15' then case when contract.transaction_subtype = 'C' then 'metering_access_continues_notice' else 'metering_access_end_notice' end
    when contract.message_code = 'Z18' then 'metering_access_end_request'
    else null
  end,
  case
    when contract.message_code in ('Z01','Z03','Z13') then array['CONTRL','APERAK',case when contract.message_code='Z01' then 'PRODAT:Z02' when contract.message_code='Z03' then 'PRODAT:Z04' else 'PRODAT:Z14' end]::text[]
    when contract.message_code in ('Z02','Z04','Z05','Z06','Z08','Z09','Z10','Z14','Z15','Z18') then array['CONTRL','APERAK']::text[]
    else array[]::text[]
  end,
  case contract.business_event
    when 'grid_contract_check_requested' then array['waiting_grid_owner_response']::text[]
    when 'grid_contract_check_received' then array['facility_data_received','facility_data_invalid']::text[]
    when 'supplier_switch_requested' then array['switch_requested','awaiting_grid_owner_response']::text[]
    when 'customer_and_supplier_change_requested' then array['switch_requested','awaiting_grid_owner_response']::text[]
    when 'supplier_switch_cancellation_requested' then array['cancellation_requested']::text[]
    when 'supplier_switch_confirmed' then array['switch_confirmed']::text[]
    when 'customer_and_supplier_change_confirmed' then array['switch_confirmed']::text[]
    when 'supplier_switch_cancellation_confirmed' then array['cancelled_before_start']::text[]
    when 'assigned_supply_notified' then array['assigned_supply_confirmed']::text[]
    when 'mandatory_purchase_notified' then array['mandatory_purchase_confirmed']::text[]
    when 'supply_termination_notified' then array['supply_ending','supply_ended']::text[]
    when 'supply_termination_reverted' then array['supply_active']::text[]
    when 'customer_masterdata_received' then array['masterdata_reviewed']::text[]
    when 'masterdata_with_reading_received' then array['masterdata_reviewed']::text[]
    when 'masterdata_without_reading_received' then array['masterdata_reviewed']::text[]
    when 'meter_change_received' then array['meter_change_reviewed']::text[]
    when 'metering_reporting_permission_requested' then array['metering_access_requested']::text[]
    when 'historical_metering_reporting_requested' then array['historical_metering_access_requested']::text[]
    when 'metering_reporting_permission_confirmed' then array['metering_access_confirmed']::text[]
    when 'historical_metering_reporting_confirmed' then array['historical_metering_access_confirmed']::text[]
    when 'metering_reporting_permission_rejected' then array['metering_access_rejected']::text[]
    when 'metering_reporting_ended' then array['metering_access_ended']::text[]
    when 'historical_metering_reporting_ended' then array['historical_metering_access_ended']::text[]
    when 'metering_reporting_continues' then array['metering_access_active']::text[]
    when 'metering_reporting_end_requested' then array['metering_access_end_requested']::text[]
    else array['submitted']::text[]
  end,
  case
    when contract.message_code in ('Z01','Z03') then array['customer_id','customer_site_id','facility_id']::text[]
    when contract.message_code in ('Z13','Z18') then array['customer_id','customer_site_id','metering_point_id','power_of_attorney']::text[]
    else array[]::text[]
  end,
  array[]::text[],
  'technical_and_application_ack',
  'standard_market_sla',
  '26.A-r3-semantic-hardening-20260822',
  'both',
  true,
  jsonb_build_object(
    'semanticSource', 'Swedish PRODAT 26.A',
    'guideVersion', '26.A',
    'guideRevision', '3',
    'businessEvent', contract.business_event,
    'reasonForTransaction', contract.reason_code,
    'canonicalDirection', contract.direction,
    'historicalRowsPreserved', true
  )
from _prodat_26a_profile_contract contract
on conflict do nothing;

-- If this migration is replayed after the new rows already exist, reactivate
-- exactly this version and keep all older versions inactive.
update public.ediel_message_semantics
set is_active = true, updated_at = now()
where upper(message_family) = 'PRODAT'
  and rule_version = '26.A-r3-semantic-hardening-20260822';

-- ---------------------------------------------------------------------------
-- 3. Supplier-switch business confirmation invariant.
--    CONTRL/APERAK/outbound status may advance transport state, but cannot set
--    accepted/completed without an inbound PRODAT Z04 linked on the switch.
-- ---------------------------------------------------------------------------

create or replace function public.gridex_enforce_supplier_switch_z04_confirmation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('accepted','completed') and new.inbound_z04_message_id is null then
    raise exception using
      errcode = '23514',
      message = 'supplier_switch_business_confirmation_requires_inbound_z04',
      detail = 'CONTRL/APERAK/outbound acknowledged status is not a business confirmation. Link the correlated inbound PRODAT Z04 first.';
  end if;

  if new.inbound_z04_message_id is not null then
    if not exists (
      select 1
      from public.ediel_messages m
      where m.id = new.inbound_z04_message_id
        and m.company_id = new.company_id
        and m.direction = 'inbound'
        and upper(m.message_family) = 'PRODAT'
        and upper(coalesce(m.message_code,'')) = 'Z04'
    ) then
      raise exception using
        errcode = '23514',
        message = 'supplier_switch_inbound_z04_reference_invalid',
        detail = 'inbound_z04_message_id must reference an inbound PRODAT Z04 in the same tenant.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_supplier_switch_requires_z04_confirmation on public.supplier_switch_requests;
create trigger trg_supplier_switch_requires_z04_confirmation
before insert or update of status, inbound_z04_message_id, company_id
on public.supplier_switch_requests
for each row
execute function public.gridex_enforce_supplier_switch_z04_confirmation_v1();

-- ---------------------------------------------------------------------------
-- 4. Hard verification of the semantic set written by this migration.
-- ---------------------------------------------------------------------------

do $$
declare
  active_semantics integer;
  stale_active_semantics integer;
  both_profiles integer;
begin
  select count(*) into active_semantics
  from public.ediel_message_semantics
  where upper(message_family) = 'PRODAT'
    and rule_version = '26.A-r3-semantic-hardening-20260822'
    and is_active = true;

  if active_semantics <> 34 then
    raise exception 'Expected 34 active PRODAT 26.A semantic rows, found %', active_semantics;
  end if;

  select count(*) into stale_active_semantics
  from public.ediel_message_semantics
  where upper(message_family) = 'PRODAT'
    and rule_version <> '26.A-r3-semantic-hardening-20260822'
    and is_active = true;

  if stale_active_semantics <> 0 then
    raise exception 'Stale active PRODAT semantics remain: %', stale_active_semantics;
  end if;

  select count(*) into both_profiles
  from public.ediel_message_profiles p
  join public.ediel_rule_packs rp on rp.id = p.rule_pack_id
  where rp.family = 'PRODAT'
    and rp.guide_version = '26.A'
    and rp.status = 'active'
    and p.is_enabled = true
    and p.direction = 'both';

  if both_profiles <> 0 then
    raise exception 'Active PRODAT 26.A profiles still use direction=both: %', both_profiles;
  end if;
end $$;

commit;
