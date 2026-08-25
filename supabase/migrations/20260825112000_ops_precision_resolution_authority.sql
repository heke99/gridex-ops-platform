-- OPS-only precision hardening.
-- Papilite postcode centroids may establish canonical geography only when the
-- centroid is safely inside one unique SVK grid area. GeoTorget/Lantmateriet
-- remains an exact-address fallback. customer_site_resolution stays the
-- canonical write authority for geographical site projections.

create or replace function public.gridex_point_to_grid_area(p_x numeric, p_y numeric)
returns table (
  grid_area_code text,
  grid_area_name text,
  grid_owner_id uuid,
  grid_owner_name text,
  price_area text,
  confidence numeric,
  source text
)
language sql
stable
as $$
  with point_input as (
    select extensions.ST_SetSRID(
      extensions.ST_MakePoint(p_x::double precision, p_y::double precision),
      3006
    ) as geom
  ),
  matching_codes as (
    select distinct g.grid_area_code
    from public.platform_grid_area_geometries g
    cross join point_input p
    where g.is_active = true
      and g.geometry is not null
      and extensions.ST_Covers(g.geometry, p.geom)
  ),
  unique_code as (
    select min(grid_area_code) as grid_area_code, count(*)::integer as match_count
    from matching_codes
  ),
  area_geometry as (
    select
      u.grid_area_code,
      u.match_count,
      extensions.ST_UnaryUnion(extensions.ST_Collect(g.geometry)) as geometry
    from unique_code u
    join public.platform_grid_area_geometries g
      on g.grid_area_code = u.grid_area_code
     and g.is_active = true
     and g.geometry is not null
    where u.match_count = 1
    group by u.grid_area_code, u.match_count
  ),
  scored as (
    select
      a.grid_area_code,
      extensions.ST_Distance(p.geom, extensions.ST_Boundary(a.geometry)) as boundary_distance_m
    from area_geometry a
    cross join point_input p
  )
  select
    ga.grid_area_code,
    ga.grid_area_name,
    ga.grid_owner_id,
    coalesce(go.name, ga.grid_owner_name) as grid_owner_name,
    ga.price_area,
    case
      when s.boundary_distance_m >= 5000 then 0.99::numeric
      when s.boundary_distance_m >= 2500 then 0.97::numeric
      when s.boundary_distance_m >= 1500 then 0.95::numeric
      when s.boundary_distance_m >= 750 then 0.88::numeric
      else 0.75::numeric
    end as confidence,
    'svk_arcgis_polygon'::text as source
  from scored s
  join public.platform_grid_areas ga
    on ga.grid_area_code = s.grid_area_code
   and ga.is_active = true
  left join public.platform_grid_owners go on go.id = ga.grid_owner_id;
$$;

revoke all on function public.gridex_point_to_grid_area(numeric, numeric) from public;
revoke all on function public.gridex_point_to_grid_area(numeric, numeric) from anon;
revoke all on function public.gridex_point_to_grid_area(numeric, numeric) from authenticated;
grant execute on function public.gridex_point_to_grid_area(numeric, numeric) to service_role;

comment on function public.gridex_point_to_grid_area(numeric, numeric) is
  'Matches one point to exactly one active SVK grid area. Confidence is boundary-distance based: >=1.5 km is the default high-confidence Papilite threshold; exact-address callers may still use lower-confidence matches for review.';

create or replace function private.gridex_guard_site_resolution_materialization_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution public.customer_site_resolution%rowtype;
  v_price_safe boolean := false;
  v_coordinates jsonb;
  v_canonical_status boolean := false;
begin
  if new.resolution_id is not distinct from old.resolution_id then
    v_canonical_status := lower(coalesce(new.resolution_status, '')) in (
      'grid_area_master_validated',
      'facility_data_requested',
      'facility_data_received',
      'facility_verified'
    );

    if v_canonical_status and (
      new.grid_owner_id is distinct from old.grid_owner_id
      or new.grid_area_code is distinct from old.grid_area_code
      or new.price_area_code is distinct from old.price_area_code
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.sweref99_x is distinct from old.sweref99_x
      or new.sweref99_y is distinct from old.sweref99_y
    ) then
      raise exception using
        errcode = '23514',
        message = 'canonical_site_geography_requires_resolution_binding';
    end if;
    return new;
  end if;

  if new.resolution_id is null then
    new.grid_owner_id := null;
    new.grid_area_code := null;
    new.price_area_code := null;
    new.latitude := null;
    new.longitude := null;
    new.sweref99_x := null;
    new.sweref99_y := null;
    return new;
  end if;

  select *
    into v_resolution
    from public.customer_site_resolution
   where id = new.resolution_id
     and company_id = new.company_id
     and customer_site_id = new.id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'customer_site_resolution binding must match company and site';
  end if;

  v_price_safe :=
    v_resolution.price_area in ('SE1', 'SE2', 'SE3', 'SE4')
    and v_resolution.price_area_unique_count = 1
    and (
      v_resolution.price_area_assurance_status = 'verified'
      or (
        v_resolution.price_area_assurance_status = 'estimated'
        and v_resolution.price_area_assurance_confidence >= 0.8
      )
    );

  new.price_area_code := case when v_price_safe then v_resolution.price_area else null end;

  if lower(coalesce(v_resolution.resolution_status, '')) = 'postal_suggested' then
    new.grid_owner_id := null;
    new.grid_area_code := null;
  else
    new.grid_owner_id := v_resolution.grid_owner_id;
    new.grid_area_code := v_resolution.grid_area_code;
  end if;

  v_coordinates := coalesce(v_resolution.result_snapshot->'coordinates', '{}'::jsonb);
  new.latitude := nullif(v_coordinates->>'latitude', '')::numeric;
  new.longitude := nullif(v_coordinates->>'longitude', '')::numeric;
  new.sweref99_x := nullif(v_coordinates->>'sweref99X', '')::numeric;
  new.sweref99_y := nullif(v_coordinates->>'sweref99Y', '')::numeric;

  return new;
end;
$$;

revoke all on function private.gridex_guard_site_resolution_materialization_v1() from public, anon, authenticated;
grant execute on function private.gridex_guard_site_resolution_materialization_v1() to service_role;

comment on function private.gridex_guard_site_resolution_materialization_v1() is
  'Fail-closed canonical site projection guard. Canonical geographical fields can change only by binding a tenant/site-matching customer_site_resolution; postal suggestions never materialize a grid owner.';

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
  v_previous_resolution public.customer_site_resolution%rowtype;
  v_facility_id text;
  v_meter_external text;
  v_grid_area text;
  v_grid_area_name text;
  v_grid_owner_name text;
  v_master_ops_grid_owner_id uuid;
  v_master_price_area text;
  v_price_area text;
  v_resolution_id uuid;
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

  if v_request.grid_owner_id is null or v_site.grid_owner_id is null or v_request.grid_owner_id is distinct from v_site.grid_owner_id then
    raise exception using errcode = '23514', message = 'facility_request_requires_bound_canonical_site_owner';
  end if;

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
  v_grid_area := upper(nullif(trim(coalesce(p_grid_area_code,v_request.grid_area_code,v_site.grid_area_code,'')),''));
  v_price_area := upper(nullif(trim(coalesce(p_price_area_code,v_request.price_area,v_site.price_area_code,'')),''));

  if v_facility_id is null and v_meter_external is null then raise exception using errcode = '23514', message = 'facility_or_metering_point_missing'; end if;
  if v_grid_area is null then raise exception using errcode = '23514', message = 'facility_response_grid_area_missing'; end if;
  if v_price_area is not null and v_price_area not in ('SE1','SE2','SE3','SE4') then raise exception using errcode = '23514', message = 'invalid_price_area'; end if;

  select ga.grid_area_name, coalesce(pgo.name,ga.grid_owner_name), pgo.ops_grid_owner_id, ga.price_area
    into v_grid_area_name, v_grid_owner_name, v_master_ops_grid_owner_id, v_master_price_area
  from public.platform_grid_areas ga
  left join public.platform_grid_owners pgo on pgo.id = ga.grid_owner_id
  where ga.grid_area_code = v_grid_area and ga.is_active = true;

  if v_master_ops_grid_owner_id is null or v_master_ops_grid_owner_id is distinct from v_request.grid_owner_id then
    insert into public.facility_data_quality_issues(company_id,customer_id,customer_site_id,grid_owner_id,issue_type,severity,source,recommended_action,retry_allowed,metadata)
    values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.grid_owner_id,'grid_owner_conflict','critical',p_source,'Facility response grid area does not map to the canonical request owner.',false,jsonb_build_object('request_id',p_request_id,'grid_area_code',v_grid_area,'master_ops_grid_owner_id',v_master_ops_grid_owner_id));
    return jsonb_build_object('ok',false,'code','grid_owner_conflict','requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id);
  end if;

  if v_price_area is not null and v_master_price_area is not null and v_price_area <> v_master_price_area then
    insert into public.facility_data_quality_issues(company_id,customer_id,customer_site_id,grid_owner_id,issue_type,severity,source,recommended_action,retry_allowed,metadata)
    values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.grid_owner_id,'price_area_conflict','critical',p_source,'Facility response price area conflicts with canonical grid-area masterdata.',false,jsonb_build_object('request_id',p_request_id,'incoming_price_area',v_price_area,'master_price_area',v_master_price_area,'grid_area_code',v_grid_area));
    return jsonb_build_object('ok',false,'code','price_area_conflict','requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id);
  end if;
  v_price_area := coalesce(v_master_price_area,v_price_area);

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

  if v_site.resolution_id is not null then
    select * into v_previous_resolution from public.customer_site_resolution
    where id=v_site.resolution_id and company_id=p_company_id and customer_site_id=v_request.customer_site_id;
  end if;

  insert into public.customer_site_resolution(
    company_id,customer_id,customer_site_id,customer_application_id,
    grid_owner_id,grid_area_code,grid_area_name,grid_owner_name,price_area,
    resolution_status,confidence,source_chain,input_snapshot,result_snapshot,
    automation_allowed,next_required_action,facility_data_verified_at,verified_by,
    resolved_at,resolver_version,geodata_version,source_claims,conflict_code,
    price_area_assurance_status,price_area_assurance_source,price_area_assurance_confidence,
    price_area_assurance_source_version,price_area_candidate_count,price_area_unique_count,
    price_area_evidence,updated_at
  ) values (
    p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.customer_application_id,
    v_request.grid_owner_id,v_grid_area,v_grid_area_name,v_grid_owner_name,v_price_area,
    'facility_verified',1,
    jsonb_build_array('facility_response',p_source,'grid_owner_information_request','platform_grid_areas'),
    jsonb_build_object('request_id',p_request_id,'source',p_source,'ediel_message_id',p_ediel_message_id),
    jsonb_build_object(
      'gridAreaCode',v_grid_area,'gridAreaName',v_grid_area_name,
      'gridOwnerId',v_request.grid_owner_id,'gridOwnerName',v_grid_owner_name,
      'priceArea',v_price_area,
      'coordinates',jsonb_build_object('latitude',v_site.latitude,'longitude',v_site.longitude,'sweref99X',v_site.sweref99_x,'sweref99Y',v_site.sweref99_y),
      'facility',jsonb_build_object('facilityId',v_facility_id,'meteringPointId',v_meter_external,'verifiedAt',v_now,'source',p_source)
    ),
    false,'Facility data verified. Evaluate supplier-switch and Ediel/PRODAT readiness separately.',v_now,p_actor_user_id,
    v_now,'facility-response-v2',v_previous_resolution.geodata_version,'{}'::jsonb,null,
    'verified','facility_data',1,v_now::text,1,1,
    jsonb_build_object('request_id',p_request_id,'grid_area_code',v_grid_area,'grid_owner_id',v_request.grid_owner_id,'price_area',v_price_area,'source',p_source),v_now
  ) returning id into v_resolution_id;

  update public.customer_sites
  set facility_id=coalesce(v_facility_id,facility_id),
      normalized_facility_id=coalesce(v_facility_id,normalized_facility_id),
      resolution_id=v_resolution_id,
      resolution_status='facility_verified',
      resolution_confidence=1,
      bidding_zone_code=coalesce(v_price_area,bidding_zone_code),
      facility_data_status='verified',facility_data_verified_at=v_now,data_quality_status='verified',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('facility_provenance',jsonb_build_object('sourceType',p_source,'sourceMessageId',p_ediel_message_id,'receivedAt',v_now,'verificationLevel',case when p_source='ediel_inbound' then 'market_verified' else 'externally_verified' end,'verifiedAt',v_now),'facility_resolution_id',v_resolution_id),
      updated_at=v_now,updated_by=p_actor_user_id
  where id=v_request.customer_site_id and company_id=p_company_id and customer_id=v_request.customer_id;

  if v_meter_external is not null then
    select * into v_meter from public.metering_points m where m.company_id=p_company_id and m.customer_id=v_request.customer_id and m.site_id=v_request.customer_site_id and (m.metering_point_id=v_meter_external or m.meter_point_id=v_meter_external or m.ediel_reference=v_meter_external) for update;
    if found then
      update public.metering_points set customer_site_id=v_request.customer_site_id,site_facility_id=coalesce(v_facility_id,site_facility_id),grid_owner_id=coalesce(v_request.grid_owner_id,grid_owner_id),grid_area_code=coalesce(v_grid_area,grid_area_code),price_area_code=coalesce(v_price_area,price_area_code),bidding_zone_code=coalesce(v_price_area,bidding_zone_code),status='active',data_quality_status='verified',verification_status='verified',facility_data_status='verified',facility_data_verified_at=v_now,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('facility_response_source',p_source,'facility_response_request_id',p_request_id,'source_message_id',p_ediel_message_id,'resolution_id',v_resolution_id),updated_at=v_now,updated_by=p_actor_user_id where id=v_meter.id returning * into v_meter;
    else
      insert into public.metering_points(company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_reference,site_facility_id,grid_owner_id,grid_area_code,price_area_code,bidding_zone_code,status,measurement_type,reading_frequency,data_quality_status,verification_status,facility_data_status,facility_data_verified_at,metadata,created_by,updated_by)
      values (p_company_id,v_request.customer_id,v_request.customer_site_id,v_request.customer_site_id,v_meter_external,v_meter_external,v_meter_external,v_facility_id,v_request.grid_owner_id,v_grid_area,v_price_area,v_price_area,'active','consumption','hourly','verified','verified','verified',v_now,jsonb_build_object('facility_response_source',p_source,'facility_response_request_id',p_request_id,'source_message_id',p_ediel_message_id,'raw_payload',coalesce(p_raw_payload,'{}'::jsonb),'resolution_id',v_resolution_id),p_actor_user_id,p_actor_user_id) returning * into v_meter;
    end if;
  end if;

  update public.customer_info_requests
  set blocker_code=null,blocker_reason=null,blocker_details='{}'::jsonb,route_resolution_status='facility_identifier_received',next_required_action='Starta leverantörsbyte när readiness är grön.',metering_point_id=coalesce(v_meter.id,metering_point_id),status='ready_for_switch',updated_at=v_now,updated_by=p_actor_user_id
  where company_id=p_company_id and customer_id=v_request.customer_id and site_id=v_request.customer_site_id and blocker_code='facility_or_metering_point_missing';

  v_received := coalesce(v_request.received_payload,'{}'::jsonb)||jsonb_build_object('source',p_source,'ediel_message_id',p_ediel_message_id,'facility_id',v_facility_id,'metering_point_id',v_meter_external,'grid_area_code',v_grid_area,'price_area',v_price_area,'resolution_id',v_resolution_id,'note',p_note,'raw_payload',coalesce(p_raw_payload,'{}'::jsonb),'completed_at',v_now);

  update public.grid_owner_information_requests
  set status='completed',dispatch_status='completed',received_at=v_now,completed_at=v_now,facility_id=v_facility_id,metering_point_id=v_meter_external,grid_area_code=v_grid_area,price_area=v_price_area,resolution_id=v_resolution_id,received_payload=v_received,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('completed_by',p_source,'completed_at',v_now,'matched_ediel_message_id',p_ediel_message_id,'atomic_completion',true,'resolution_id',v_resolution_id),updated_at=v_now,updated_by=p_actor_user_id
  where id=p_request_id and company_id=p_company_id;

  return jsonb_build_object('ok',true,'alreadyCompleted',false,'requestId',p_request_id,'customerId',v_request.customer_id,'customerSiteId',v_request.customer_site_id,'meteringPointRecordId',v_meter.id,'operationId',v_request.operation_id,'facilityId',v_facility_id,'meteringPointExternalId',v_meter_external,'gridAreaCode',v_grid_area,'priceAreaCode',v_price_area,'resolutionId',v_resolution_id);
end;
$$;
