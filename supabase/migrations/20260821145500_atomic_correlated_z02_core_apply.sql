-- Atomically apply an exactly correlated PRODAT Z02 core response before the
-- durable worker is allowed to continue. The preceding correlation trigger
-- must have set z02_correlation_status=exact. Site, metering point, request and
-- message linkage then commit or roll back together.

create or replace function public.gridex_edifact_first_lin_item_id(p_raw text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_match text[];
begin
  if coalesce(p_raw, '') = '' then return null; end if;
  v_match := regexp_match(p_raw, 'LIN\+[^'']*\+\+([^:+''\r\n]+)');
  return nullif(btrim(v_match[1]), '');
exception when others then
  return null;
end;
$$;

create or replace function public.gridex_apply_exact_z02_core(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_id uuid,
  p_request_id uuid,
  p_message_id uuid,
  p_operation_id uuid default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.customer_info_requests%rowtype;
  v_message public.ediel_messages%rowtype;
  v_site public.customer_sites%rowtype;
  v_meter public.metering_points%rowtype;
  v_conflict public.metering_points%rowtype;
  v_meter_external text;
  v_facility_id text;
  v_grid_area text;
  v_price_area text;
  v_annual numeric;
  v_now timestamptz := now();
begin
  select * into v_request
  from public.customer_info_requests
  where id = p_request_id
    and company_id = p_company_id
    and customer_id = p_customer_id
    and site_id = p_site_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'z02_request_site_customer_mismatch');
  end if;

  select * into v_message
  from public.ediel_messages
  where id = p_message_id
    and company_id = p_company_id
    and direction = 'inbound'
    and message_family = 'PRODAT'
    and upper(coalesce(message_code, '')) = 'Z02'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'z02_inbound_message_not_found');
  end if;

  select * into v_site
  from public.customer_sites
  where id = p_site_id
    and company_id = p_company_id
    and customer_id = p_customer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'z02_site_not_found');
  end if;

  if v_message.customer_id is not null and v_message.customer_id <> p_customer_id then
    return jsonb_build_object('ok', false, 'code', 'z02_customer_mismatch');
  end if;
  if v_message.site_id is not null and v_message.site_id <> p_site_id then
    return jsonb_build_object('ok', false, 'code', 'response_site_mismatch');
  end if;
  if v_request.grid_owner_id is not null
     and v_message.grid_owner_id is not null
     and v_request.grid_owner_id <> v_message.grid_owner_id then
    return jsonb_build_object('ok', false, 'code', 'grid_owner_conflict');
  end if;

  v_meter_external := coalesce(
    nullif(btrim(v_message.parsed_payload ->> 'meteringPointId'), ''),
    nullif(btrim(v_message.parsed_payload ->> 'meterPointId'), ''),
    public.gridex_edifact_first_lin_item_id(v_message.raw_payload)
  );
  v_facility_id := coalesce(nullif(btrim(v_site.facility_id), ''), v_meter_external);
  v_grid_area := coalesce(
    nullif(btrim(v_message.parsed_payload ->> 'gridAreaId'), ''),
    nullif(btrim(v_message.parsed_payload ->> 'grid_area_code'), ''),
    public.gridex_edifact_rff_value(v_message.raw_payload, 'Z05')
  );
  v_price_area := upper(coalesce(
    nullif(btrim(v_message.parsed_payload ->> 'priceAreaCode'), ''),
    nullif(btrim(v_message.parsed_payload ->> 'price_area_code'), ''),
    nullif(btrim(v_site.price_area_code), '')
  ));

  begin
    v_annual := nullif(coalesce(
      v_message.parsed_payload ->> 'annualConsumptionKwh',
      v_message.parsed_payload ->> 'annual_consumption_kwh'
    ), '')::numeric;
  exception when others then
    v_annual := null;
  end;

  if v_meter_external is null then
    return jsonb_build_object('ok', false, 'code', 'z02_metering_point_missing');
  end if;
  if v_price_area is not null and v_price_area not in ('SE1','SE2','SE3','SE4') then
    return jsonb_build_object('ok', false, 'code', 'invalid_price_area');
  end if;

  if v_site.facility_id is not null and btrim(v_site.facility_id) <> v_facility_id then
    return jsonb_build_object('ok', false, 'code', 'facility_identifier_conflict');
  end if;

  if v_facility_id is not null and exists (
    select 1
    from public.customer_sites s
    where s.company_id = p_company_id
      and s.id <> p_site_id
      and s.is_active = true
      and (
        s.normalized_facility_id = v_facility_id
        or s.facility_id = v_facility_id
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'cross_site_identifier_conflict');
  end if;

  select * into v_conflict
  from public.metering_points m
  where m.company_id = p_company_id
    and coalesce(m.customer_site_id, m.site_id) <> p_site_id
    and m.status in ('draft','pending_validation','active')
    and (
      m.metering_point_id = v_meter_external
      or m.meter_point_id = v_meter_external
      or m.ediel_reference = v_meter_external
      or m.ediel_metering_point_id = v_meter_external
    )
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'code', 'duplicate_metering_point',
      'conflictingSiteId', coalesce(v_conflict.customer_site_id, v_conflict.site_id),
      'conflictingMeteringPointId', v_conflict.id
    );
  end if;

  update public.customer_sites
  set facility_id = coalesce(v_facility_id, facility_id),
      normalized_facility_id = coalesce(v_facility_id, normalized_facility_id),
      grid_area_code = coalesce(v_grid_area, grid_area_code),
      price_area_code = coalesce(v_price_area, price_area_code),
      bidding_zone_code = coalesce(v_price_area, bidding_zone_code),
      annual_consumption_kwh = coalesce(v_annual, annual_consumption_kwh),
      facility_data_status = 'verified',
      facility_data_verified_at = v_now,
      resolution_status = 'facility_verified',
      data_quality_status = 'verified',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'facility_provenance', jsonb_build_object(
          'sourceType', 'ediel_inbound',
          'sourceMessageId', p_message_id,
          'sourcePartyId', coalesce(v_message.grid_owner_id, v_request.grid_owner_id),
          'receivedAt', v_now,
          'verificationLevel', 'market_verified',
          'verifiedAt', v_now,
          'customerInfoRequestId', p_request_id,
          'operationId', p_operation_id
        )
      ),
      updated_at = v_now,
      updated_by = p_actor_user_id
  where id = p_site_id
    and company_id = p_company_id
    and customer_id = p_customer_id;

  if v_request.metering_point_id is not null then
    select * into v_meter
    from public.metering_points m
    where m.id = v_request.metering_point_id
      and m.company_id = p_company_id
      and m.customer_id = p_customer_id
      and coalesce(m.customer_site_id, m.site_id) = p_site_id
    for update;
  end if;

  if not found then
    select * into v_meter
    from public.metering_points m
    where m.company_id = p_company_id
      and m.customer_id = p_customer_id
      and coalesce(m.customer_site_id, m.site_id) = p_site_id
      and (
        m.metering_point_id = v_meter_external
        or m.meter_point_id = v_meter_external
        or m.ediel_reference = v_meter_external
        or m.ediel_metering_point_id = v_meter_external
      )
    order by m.updated_at desc nulls last, m.created_at desc
    limit 1
    for update;
  end if;

  if found then
    update public.metering_points
    set site_id = p_site_id,
        customer_site_id = p_site_id,
        customer_id = p_customer_id,
        metering_point_id = v_meter_external,
        meter_point_id = v_meter_external,
        ediel_metering_point_id = coalesce(ediel_metering_point_id, v_meter_external),
        ediel_reference = coalesce(ediel_reference, v_meter_external),
        site_facility_id = coalesce(v_facility_id, site_facility_id),
        grid_owner_id = coalesce(v_request.grid_owner_id, v_message.grid_owner_id, grid_owner_id),
        grid_area_code = coalesce(v_grid_area, grid_area_code),
        price_area_code = coalesce(v_price_area, price_area_code),
        bidding_zone_code = coalesce(v_price_area, bidding_zone_code),
        estimated_annual_consumption_kwh = coalesce(v_annual, estimated_annual_consumption_kwh),
        status = 'active',
        data_quality_status = 'verified',
        verification_status = 'verified',
        facility_data_status = 'verified',
        facility_data_verified_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'z02_market_verified', true,
          'z02_message_id', p_message_id,
          'customer_info_request_id', p_request_id,
          'operation_id', p_operation_id,
          'verified_at', v_now
        ),
        updated_at = v_now,
        updated_by = p_actor_user_id
    where id = v_meter.id
    returning * into v_meter;
  else
    insert into public.metering_points (
      company_id,
      customer_id,
      site_id,
      customer_site_id,
      metering_point_id,
      meter_point_id,
      ediel_metering_point_id,
      ediel_reference,
      site_facility_id,
      grid_owner_id,
      grid_area_code,
      price_area_code,
      bidding_zone_code,
      status,
      measurement_type,
      reading_frequency,
      is_settlement_relevant,
      data_quality_status,
      verification_status,
      facility_data_status,
      facility_data_verified_at,
      estimated_annual_consumption_kwh,
      metadata,
      created_by,
      updated_by
    ) values (
      p_company_id,
      p_customer_id,
      p_site_id,
      p_site_id,
      v_meter_external,
      v_meter_external,
      v_meter_external,
      v_meter_external,
      v_facility_id,
      coalesce(v_request.grid_owner_id, v_message.grid_owner_id),
      v_grid_area,
      v_price_area,
      v_price_area,
      'active',
      'consumption',
      'hourly',
      true,
      'verified',
      'verified',
      'verified',
      v_now,
      v_annual,
      jsonb_build_object(
        'z02_market_verified', true,
        'z02_message_id', p_message_id,
        'customer_info_request_id', p_request_id,
        'operation_id', p_operation_id,
        'verified_at', v_now
      ),
      p_actor_user_id,
      p_actor_user_id
    )
    returning * into v_meter;
  end if;

  update public.customer_info_requests
  set status = 'ready_for_switch',
      metering_point_id = v_meter.id,
      response_ediel_message_id = p_message_id,
      received_at = coalesce(received_at, v_now),
      blocker_code = null,
      blocker_reason = null,
      blocker_details = '{}'::jsonb,
      route_resolution_status = 'z02_market_verified',
      next_required_action = 'Kör canonical supplier-switch readiness och nästa steg.',
      verified_payload = coalesce(verified_payload, '{}'::jsonb) || jsonb_build_object(
        'z02', jsonb_build_object(
          'message_id', p_message_id,
          'metering_point_id', v_meter_external,
          'facility_id', v_facility_id,
          'grid_area_code', v_grid_area,
          'price_area_code', v_price_area,
          'annual_consumption_kwh', v_annual,
          'verification_level', 'market_verified',
          'verified_at', v_now,
          'atomic_core_apply', true
        )
      ),
      updated_at = v_now,
      updated_by = p_actor_user_id
  where id = p_request_id
    and company_id = p_company_id
    and customer_id = p_customer_id
    and site_id = p_site_id;

  if v_request.grid_owner_data_request_id is not null then
    update public.grid_owner_data_requests
    set status = 'received',
        response_payload = coalesce(response_payload, '{}'::jsonb) || jsonb_build_object(
          'z02_message_id', p_message_id,
          'metering_point_id', v_meter_external,
          'facility_id', v_facility_id,
          'grid_area_code', v_grid_area,
          'price_area_code', v_price_area,
          'atomic_core_apply', true,
          'received_at', v_now
        ),
        updated_at = v_now,
        updated_by = p_actor_user_id
    where id = v_request.grid_owner_data_request_id
      and company_id = p_company_id;
  end if;

  update public.ediel_messages
  set customer_id = p_customer_id,
      site_id = p_site_id,
      metering_point_id = v_meter.id,
      grid_owner_id = coalesce(grid_owner_id, v_request.grid_owner_id),
      operation_id = coalesce(operation_id, p_operation_id),
      parsed_payload = coalesce(parsed_payload, '{}'::jsonb) || jsonb_build_object(
        'canonicalCorrelation', jsonb_build_object(
          'status', 'exact',
          'customer_info_request_id', p_request_id,
          'customer_id', p_customer_id,
          'site_id', p_site_id,
          'metering_point_record_id', v_meter.id,
          'operation_id', p_operation_id,
          'atomic_core_apply', true,
          'applied_at', v_now
        )
      ),
      updated_at = v_now
  where id = p_message_id
    and company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'requestId', p_request_id,
    'messageId', p_message_id,
    'customerId', p_customer_id,
    'customerSiteId', p_site_id,
    'meteringPointRecordId', v_meter.id,
    'meteringPointExternalId', v_meter_external,
    'facilityId', v_facility_id,
    'gridAreaCode', v_grid_area,
    'priceAreaCode', v_price_area,
    'annualConsumptionKwh', v_annual,
    'atomicCoreApply', true
  );
end;
$$;

create or replace function public.gridex_gate_exact_z02_atomic_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_message_id uuid;
  v_result jsonb;
  v_code text;
begin
  if new.job_type <> 'apply_inbound_grid_owner_response'
     or new.status not in ('queued', 'running')
     or coalesce(new.result ->> 'z02_correlation_status', '') <> 'exact'
     or coalesce((new.result ->> 'z02_atomic_core_applied')::boolean, false) then
    return new;
  end if;

  begin
    v_request_id := nullif(new.payload ->> 'customer_info_request_id', '')::uuid;
    v_message_id := nullif(new.payload ->> 'ediel_message_id', '')::uuid;
  exception when others then
    new.status := 'needs_review';
    new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object(
      'reason', 'z02_atomic_apply_invalid_identifiers',
      'reason_code', 'z02_atomic_apply_invalid_identifiers'
    );
    return new;
  end;

  v_result := public.gridex_apply_exact_z02_core(
    new.company_id,
    new.customer_id,
    new.customer_site_id,
    v_request_id,
    v_message_id,
    new.operation_id,
    new.created_by
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object(
      'z02_atomic_core_applied', true,
      'z02_atomic_core', v_result
    );
    return new;
  end if;

  v_code := coalesce(v_result ->> 'code', 'z02_atomic_core_apply_failed');
  new.status := 'needs_review';
  new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object(
    'reason', v_code,
    'reason_code', v_code,
    'z02_atomic_core_applied', false,
    'z02_atomic_core', v_result
  );

  update public.customer_info_requests
  set status = 'manual_review_required',
      blocker_code = v_code,
      blocker_reason = 'Atomisk Z02-apply blockerades av datainvariant.',
      blocker_details = coalesce(blocker_details, '{}'::jsonb) || jsonb_build_object(
        'atomic_core_apply', v_result,
        'inbound_message_id', v_message_id,
        'operation_id', new.operation_id
      ),
      next_required_action = 'Granska Z02-data och lös konflikt innan automation återupptas.',
      updated_at = now(),
      updated_by = new.created_by
  where id = v_request_id
    and company_id = new.company_id;

  insert into public.facility_data_quality_issues (
    company_id,
    customer_id,
    customer_site_id,
    grid_owner_id,
    issue_type,
    severity,
    source,
    source_error_code,
    source_error_text,
    recommended_action,
    retry_allowed,
    next_readiness_required,
    metadata
  )
  select
    new.company_id,
    new.customer_id,
    new.customer_site_id,
    cir.grid_owner_id,
    case
      when v_code = 'duplicate_metering_point' then 'duplicate_metering_point'
      when v_code = 'cross_site_identifier_conflict' then 'cross_site_identifier_conflict'
      when v_code = 'facility_identifier_conflict' then 'facility_identifier_conflict'
      when v_code = 'grid_owner_conflict' then 'grid_owner_conflict'
      when v_code = 'response_site_mismatch' then 'response_site_mismatch'
      else 'request_site_customer_mismatch'
    end,
    'critical',
    'ediel_z02_atomic_core_apply',
    v_code,
    'Atomisk Z02-apply blockerades av datainvariant.',
    'Granska inbound Z02 och site/metering-identitet innan automation återupptas.',
    false,
    true,
    jsonb_build_object(
      'customer_info_request_id', v_request_id,
      'inbound_message_id', v_message_id,
      'operation_id', new.operation_id,
      'result', v_result
    )
  from public.customer_info_requests cir
  where cir.id = v_request_id
    and cir.company_id = new.company_id
    and not exists (
      select 1
      from public.facility_data_quality_issues q
      where q.company_id = new.company_id
        and q.customer_site_id is not distinct from new.customer_site_id
        and q.status = 'open'
        and q.source = 'ediel_z02_atomic_core_apply'
        and q.source_error_code = v_code
        and q.metadata ->> 'inbound_message_id' = v_message_id::text
    );

  return new;
end;
$$;

drop trigger if exists trg_customer_operation_job_z02_zz_atomic_apply
  on public.customer_operation_jobs;

create trigger trg_customer_operation_job_z02_zz_atomic_apply
before insert or update of status, payload, job_type
on public.customer_operation_jobs
for each row
execute function public.gridex_gate_exact_z02_atomic_apply();

comment on function public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid) is
  'Atomic market-verified Z02 core apply: exact site, metering point, request, grid-owner-data request and inbound message linkage commit together.';
comment on function public.gridex_gate_exact_z02_atomic_apply() is
  'Runs after the exact Z02 correlation trigger (trigger name sorts later); conflicts force needs_review before a worker can claim the job.';
