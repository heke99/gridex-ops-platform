-- Site-scoped customer process P0 hardening.
-- The operational identity is tenant + customer + site. No child row may point
-- at another customer's site inside the same tenant.

alter table public.customer_sites
  add constraint customer_sites_company_customer_id_uidx
  unique (company_id, customer_id, id);

alter table public.metering_points
  add constraint metering_points_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.metering_points validate constraint metering_points_company_customer_site_rel_fkey;

alter table public.customer_contracts
  add constraint customer_contracts_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.customer_contracts validate constraint customer_contracts_company_customer_site_rel_fkey;

alter table public.customer_contracts
  add constraint customer_contracts_company_customer_customer_site_rel_fkey
  foreign key (company_id, customer_id, customer_site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.customer_contracts validate constraint customer_contracts_company_customer_customer_site_rel_fkey;

alter table public.powers_of_attorney
  add constraint powers_of_attorney_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.powers_of_attorney validate constraint powers_of_attorney_company_customer_site_rel_fkey;

alter table public.powers_of_attorney
  add constraint powers_of_attorney_company_customer_customer_site_rel_fkey
  foreign key (company_id, customer_id, customer_site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.powers_of_attorney validate constraint powers_of_attorney_company_customer_customer_site_rel_fkey;

alter table public.supplier_switch_requests
  add constraint supplier_switch_requests_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.supplier_switch_requests validate constraint supplier_switch_requests_company_customer_site_rel_fkey;

alter table public.supplier_switch_requests
  add constraint supplier_switch_requests_company_customer_customer_site_rel_fkey
  foreign key (company_id, customer_id, customer_site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.supplier_switch_requests validate constraint supplier_switch_requests_company_customer_customer_site_rel_fkey;

alter table public.grid_owner_information_requests
  add constraint grid_owner_information_requests_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, customer_site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.grid_owner_information_requests validate constraint grid_owner_information_requests_company_customer_site_rel_fkey;

alter table public.grid_owner_data_requests
  add constraint grid_owner_data_requests_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.grid_owner_data_requests validate constraint grid_owner_data_requests_company_customer_site_rel_fkey;

alter table public.customer_info_requests
  add constraint customer_info_requests_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.customer_info_requests validate constraint customer_info_requests_company_customer_site_rel_fkey;

alter table public.outbound_requests
  add constraint outbound_requests_company_customer_site_rel_fkey
  foreign key (company_id, customer_id, site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.outbound_requests validate constraint outbound_requests_company_customer_site_rel_fkey;

alter table public.outbound_requests
  add constraint outbound_requests_company_customer_customer_site_rel_fkey
  foreign key (company_id, customer_id, customer_site_id)
  references public.customer_sites(company_id, customer_id, id) not valid;
alter table public.outbound_requests validate constraint outbound_requests_company_customer_customer_site_rel_fkey;

alter table public.grid_owner_information_requests
  add column if not exists customer_contract_id uuid,
  add column if not exists process_type text,
  add column if not exists idempotency_key text,
  add column if not exists expected_response text,
  add column if not exists source text,
  add column if not exists template_key text,
  add column if not exists template_version text,
  add column if not exists rendered_subject text,
  add column if not exists rendered_body_hash text;

alter table public.grid_owner_information_requests
  add constraint grid_owner_information_requests_company_contract_fkey
  foreign key (company_id, customer_contract_id)
  references public.customer_contracts(company_id, id) not valid;
alter table public.grid_owner_information_requests validate constraint grid_owner_information_requests_company_contract_fkey;

update public.grid_owner_information_requests
set idempotency_key = concat_ws(':', company_id::text, customer_id::text, customer_site_id::text, request_type, coalesce(grid_owner_id::text, 'unresolved'))
where customer_site_id is not null and idempotency_key is null;

create unique index if not exists grid_owner_information_requests_open_idempotency_uidx
on public.grid_owner_information_requests(idempotency_key)
where idempotency_key is not null
  and status in (
    'draft','ready_to_send','ready_to_send_manual_email','manual_email_queued',
    'manual_email_sent','waiting_manual_response','manual_response_received','needs_review',
    'blocked_missing_poa','blocked_missing_grid_owner_contact','blocked_missing_manual_mailbox',
    'sent','waiting_response'
  );

drop index if exists public.grid_owner_information_requests_manual_open_uidx;
create index if not exists grid_owner_information_requests_manual_open_lookup_idx
on public.grid_owner_information_requests(company_id, customer_id, customer_site_id, request_type, grid_owner_id, updated_at desc)
where channel = 'manual_email'
  and status in (
    'draft','ready_to_send','ready_to_send_manual_email','manual_email_queued',
    'manual_email_sent','waiting_manual_response','manual_response_received','needs_review',
    'blocked_missing_poa','blocked_missing_grid_owner_contact','blocked_missing_manual_mailbox'
  );

-- Materialize missing canonical OPS owners from platform masterdata, but keep
-- them fail-closed until a route or verified manual contact exists.
insert into public.grid_owners (
  name, owner_code, ediel_id, org_number, organization_number,
  is_active, country, environment, lifecycle_status, source,
  platform_grid_owner_id, verified_for_customer_flow, technical_owner_only,
  actor_registry_status, verification_status, verification_reasons,
  route_status, prodat_ready_for_customer_flow, utilts_ready_for_metering_flow,
  supplier_switch_ready, electricity_scope_status, manual_review_required,
  manual_review_reason
)
select
  p.name,
  'PLATFORM-' || replace(p.id::text, '-', ''),
  nullif(trim(p.ediel_id), ''),
  nullif(trim(p.org_number), ''),
  nullif(trim(p.org_number), ''),
  true,
  'SE',
  'production',
  'active',
  'platform_grid_owner_materialization',
  p.id,
  false,
  true,
  'under_review',
  case when nullif(trim(p.ediel_id), '') is null then 'needs_ediel_id' else 'under_review' end,
  array['platform_mapping_materialized','route_not_verified'],
  'needs_route',
  false,
  false,
  false,
  'electricity_scope_pending',
  true,
  'Canonical OPS mapping created from platform masterdata; market route/contact still requires verification.'
from public.platform_grid_owners p
where p.ops_grid_owner_id is null
  and exists (select 1 from public.platform_grid_areas a where a.grid_owner_id = p.id and a.is_active)
  and not exists (select 1 from public.grid_owners g where g.platform_grid_owner_id = p.id);

update public.platform_grid_owners p
set ops_grid_owner_id = g.id,
    updated_at = now()
from public.grid_owners g
where p.ops_grid_owner_id is null
  and g.platform_grid_owner_id = p.id;

create unique index if not exists grid_owners_platform_grid_owner_uidx
on public.grid_owners(platform_grid_owner_id)
where platform_grid_owner_id is not null;

create or replace function public.gridex_complete_facility_response(
  p_company_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid default null,
  p_source text default 'system',
  p_ediel_message_id uuid default null,
  p_facility_id text default null,
  p_metering_point_external_id text default null,
  p_grid_area_code text default null,
  p_price_area_code text default null,
  p_source_party_grid_owner_id uuid default null,
  p_raw_payload jsonb default '{}'::jsonb,
  p_note text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_request public.grid_owner_information_requests%rowtype;
  v_site public.customer_sites%rowtype;
  v_meter public.metering_points%rowtype;
  v_conflict public.metering_points%rowtype;
  v_facility_id text;
  v_meter_external text;
  v_grid_area text;
  v_price_area text;
  v_now timestamptz := now();
  v_received jsonb;
begin
  select * into v_request
  from public.grid_owner_information_requests
  where id = p_request_id and company_id = p_company_id
  for update;

  if not found then raise exception using errcode = 'P0002', message = 'facility_request_not_found'; end if;
  if v_request.customer_id is null or v_request.customer_site_id is null then raise exception using errcode = '23514', message = 'request_site_customer_missing'; end if;

  select * into v_site
  from public.customer_sites
  where id = v_request.customer_site_id and company_id = p_company_id and customer_id = v_request.customer_id
  for update;
  if not found then raise exception using errcode = '23514', message = 'request_site_customer_mismatch'; end if;

  if p_source_party_grid_owner_id is not null and v_request.grid_owner_id is distinct from p_source_party_grid_owner_id then
    insert into public.facility_data_quality_issues(company_id,customer_id,customer_site_id,grid_owner_id,issue_type,severity,source,recommended_action,retry_allowed,metadata)
    values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.grid_owner_id,'grid_owner_conflict','critical',p_source,'Verify the sender/grid owner before applying the response.',false,jsonb_build_object('request_id',p_request_id,'expected_grid_owner_id',v_request.grid_owner_id,'incoming_grid_owner_id',p_source_party_grid_owner_id));
    return jsonb_build_object('ok',false,'code','grid_owner_conflict','requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id);
  end if;

  if v_request.status = 'completed' then
    select * into v_meter from public.metering_points where company_id=p_company_id and customer_id=v_request.customer_id and site_id=v_request.customer_site_id order by updated_at desc nulls last,created_at desc limit 1;
    return jsonb_build_object('ok',true,'alreadyCompleted',true,'requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id,'meteringPointRecordId',v_meter.id,'operationId',v_request.operation_id);
  end if;

  if v_request.status not in ('draft','ready_to_send','sent','waiting_response','received','needs_review','manual_email_sent','waiting_manual_response','manual_response_received','manual_response_parsed') then
    raise exception using errcode = '23514', message = 'facility_request_not_open';
  end if;

  v_facility_id := nullif(trim(coalesce(p_facility_id,v_request.facility_id,'')),'');
  v_meter_external := nullif(trim(coalesce(p_metering_point_external_id,v_request.metering_point_id,'')),'');
  v_grid_area := nullif(trim(coalesce(p_grid_area_code,v_request.grid_area_code,'')),'');
  v_price_area := upper(nullif(trim(coalesce(p_price_area_code,v_request.price_area,'')) ,''));
  if v_facility_id is null and v_meter_external is null then raise exception using errcode = '23514', message = 'facility_or_metering_point_missing'; end if;
  if v_price_area is not null and v_price_area not in ('SE1','SE2','SE3','SE4') then raise exception using errcode = '23514', message = 'invalid_price_area'; end if;

  if v_facility_id is not null and v_site.facility_id is not null and trim(v_site.facility_id) <> v_facility_id then
    insert into public.facility_data_quality_issues(company_id,customer_id,customer_site_id,grid_owner_id,issue_type,severity,facility_id,source,recommended_action,retry_allowed,metadata)
    values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.grid_owner_id,'facility_identifier_conflict','critical',v_facility_id,p_source,'Review conflicting facility identifiers before continuing.',false,jsonb_build_object('request_id',p_request_id,'existing_facility_id',v_site.facility_id,'incoming_facility_id',v_facility_id));
    return jsonb_build_object('ok',false,'code','facility_identifier_conflict','requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id);
  end if;

  if v_facility_id is not null and exists (select 1 from public.customer_sites s where s.company_id=p_company_id and s.id<>v_request.customer_site_id and s.is_active=true and s.normalized_facility_id=v_facility_id) then
    insert into public.facility_data_quality_issues(company_id,customer_id,customer_site_id,grid_owner_id,issue_type,severity,facility_id,source,recommended_action,retry_allowed,metadata)
    values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.grid_owner_id,'cross_site_identifier_conflict','critical',v_facility_id,p_source,'Resolve the duplicate facility identifier across sites.',false,jsonb_build_object('request_id',p_request_id));
    return jsonb_build_object('ok',false,'code','cross_site_identifier_conflict','requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id);
  end if;

  if v_meter_external is not null then
    select * into v_conflict from public.metering_points m where m.company_id=p_company_id and m.site_id<>v_request.customer_site_id and m.status in ('draft','pending_validation','active') and (m.metering_point_id=v_meter_external or m.meter_point_id=v_meter_external or m.ediel_reference=v_meter_external) limit 1;
    if found then
      insert into public.facility_data_quality_issues(company_id,customer_id,customer_site_id,metering_point_id,grid_owner_id,issue_type,severity,ediel_metering_point_id,source,recommended_action,retry_allowed,metadata)
      values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_conflict.id,v_request.grid_owner_id,'duplicate_metering_point','critical',v_meter_external,p_source,'Resolve the metering-point identity conflict across sites.',false,jsonb_build_object('request_id',p_request_id,'conflicting_site_id',v_conflict.site_id));
      return jsonb_build_object('ok',false,'code','duplicate_metering_point','requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id);
    end if;
  end if;

  update public.customer_sites
  set facility_id=coalesce(v_facility_id,facility_id),normalized_facility_id=coalesce(v_facility_id,normalized_facility_id),grid_area_code=coalesce(v_grid_area,grid_area_code),price_area_code=coalesce(v_price_area,price_area_code),bidding_zone_code=coalesce(v_price_area,bidding_zone_code),facility_data_status='verified',facility_data_verified_at=v_now,resolution_status='facility_verified',data_quality_status='verified',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('facility_provenance',jsonb_build_object('sourceType',p_source,'sourceMessageId',p_ediel_message_id,'receivedAt',v_now,'verificationLevel',case when p_source='ediel_inbound' then 'market_verified' else 'externally_verified' end,'verifiedAt',v_now)),updated_at=v_now,updated_by=p_actor_user_id
  where id=v_request.customer_site_id and company_id=p_company_id and customer_id=v_request.customer_id;

  if v_meter_external is not null then
    select * into v_meter from public.metering_points m where m.company_id=p_company_id and m.customer_id=v_request.customer_id and m.site_id=v_request.customer_site_id and (m.metering_point_id=v_meter_external or m.meter_point_id=v_meter_external or m.ediel_reference=v_meter_external) for update;
    if found then
      update public.metering_points set customer_site_id=v_request.customer_site_id,site_facility_id=coalesce(v_facility_id,site_facility_id),grid_owner_id=coalesce(v_request.grid_owner_id,grid_owner_id),grid_area_code=coalesce(v_grid_area,grid_area_code),price_area_code=coalesce(v_price_area,price_area_code),bidding_zone_code=coalesce(v_price_area,bidding_zone_code),status='active',data_quality_status='verified',verification_status='verified',facility_data_status='verified',facility_data_verified_at=v_now,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('facility_response_source',p_source,'facility_response_request_id',p_request_id,'source_message_id',p_ediel_message_id),updated_at=v_now,updated_by=p_actor_user_id where id=v_meter.id returning * into v_meter;
    else
      insert into public.metering_points(company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_reference,site_facility_id,grid_owner_id,grid_area_code,price_area_code,bidding_zone_code,status,measurement_type,reading_frequency,data_quality_status,verification_status,facility_data_status,facility_data_verified_at,metadata,created_by,updated_by)
      values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.customer_site_id,v_meter_external,v_meter_external,v_meter_external,v_facility_id,v_request.grid_owner_id,v_grid_area,v_price_area,v_price_area,'active','consumption','hourly','verified','verified','verified',v_now,jsonb_build_object('facility_response_source',p_source,'facility_response_request_id',p_request_id,'source_message_id',p_ediel_message_id,'raw_payload',coalesce(p_raw_payload,'{}'::jsonb)),p_actor_user_id,p_actor_user_id) returning * into v_meter;
    end if;
  end if;

  update public.customer_info_requests
  set blocker_code=null,blocker_reason=null,blocker_details='{}'::jsonb,route_resolution_status='facility_identifier_received',next_required_action='Starta leverantörsbyte när readiness är grön.',metering_point_id=coalesce(v_meter.id,metering_point_id),status='ready_for_switch',updated_at=v_now,updated_by=p_actor_user_id
  where company_id=p_company_id and customer_id=v_request.customer_id and site_id=v_request.customer_site_id and blocker_code='facility_or_metering_point_missing';

  v_received := coalesce(v_request.received_payload,'{}'::jsonb)||jsonb_build_object('source',p_source,'ediel_message_id',p_ediel_message_id,'facility_id',v_facility_id,'metering_point_id',v_meter_external,'grid_area_code',v_grid_area,'price_area',v_price_area,'note',p_note,'raw_payload',coalesce(p_raw_payload,'{}'::jsonb),'completed_at',v_now);
  update public.grid_owner_information_requests
  set status='completed',dispatch_status='completed',received_at=v_now,completed_at=v_now,facility_id=v_facility_id,metering_point_id=v_meter_external,grid_area_code=coalesce(v_grid_area,grid_area_code),price_area=coalesce(v_price_area,price_area),received_payload=v_received,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('completed_by',p_source,'completed_at',v_now,'matched_ediel_message_id',p_ediel_message_id,'atomic_completion',true),updated_at=v_now,updated_by=p_actor_user_id
  where id=p_request_id and company_id=p_company_id;

  return jsonb_build_object('ok',true,'alreadyCompleted',false,'requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id,'meteringPointRecordId',v_meter.id,'operationId',v_request.operation_id,'facilityId',v_facility_id,'meteringPointExternalId',v_meter_external,'gridAreaCode',v_grid_area,'priceAreaCode',v_price_area);
end;
$$;

revoke all on function public.gridex_complete_facility_response(uuid,uuid,uuid,text,uuid,text,text,text,text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.gridex_complete_facility_response(uuid,uuid,uuid,text,uuid,text,text,text,text,uuid,jsonb,text) to service_role;
