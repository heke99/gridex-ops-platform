-- customer_sites.normalized_facility_id is GENERATED ALWAYS AS
-- (gridex_normalize_facility_id(facility_id)) STORED. Two functions still
-- assigned it explicitly, which PostgreSQL rejects with 428C9
-- (generated_always) and which rolled back the whole statement:
--  * gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1,
--    reached from the BEFORE INSERT Z02 atomic-apply trigger on
--    customer_operation_jobs, so every positive Z02 apply failed at job_insert;
--  * public.gridex_complete_facility_response (facility lookup completion).
-- public.gridex_create_customer_site_with_address likewise inserted a literal
-- into the GENERATED ALWAYS customer_sites.is_active (428C9 on site creation);
-- that column is dropped from its INSERT list here.
-- Both are replaced verbatim from their current definitions with only that
-- assignment removed; the generated column follows facility_id by itself.
-- Owners, grants and comments are kept by CREATE OR REPLACE.
BEGIN;

CREATE OR REPLACE FUNCTION gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(p_company_id uuid, p_customer_id uuid, p_site_id uuid, p_request_id uuid, p_message_id uuid, p_operation_id uuid DEFAULT NULL::uuid, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
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
  v_source gridex_received_sources.sources%rowtype;
  v_dispatch gridex_ediel_transport.attempts%rowtype;
  v_original public.ediel_messages%rowtype;
  v_applied gridex_received_sources.z02_core_applications%rowtype;
  v_assessment gridex_received_sources.validation_assessments%rowtype;
  v_customer public.customers%rowtype;
  v_snapshot public.customer_operation_request_snapshots%rowtype;
  v_inbound_wire jsonb;v_original_wire jsonb;v_object jsonb;v_original_object jsonb;v_facet jsonb;
  v_match_count integer;v_result jsonb;v_expected_identity text;v_expected_qualifier text;
  v_current_address_hash text;
  v_price_area_count integer := 0;
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

  -- Lock/read the original tenant/environment source, never hydrate authority
  -- from mutable parsed_payload, validation_report, an incoming JSON signal or
  -- a cached job result. Already committed same-scope outcomes stay immutable.
  SELECT * INTO v_source FROM gridex_received_sources.sources
   WHERE source_message_id=p_message_id AND company_id=p_company_id AND environment=v_message.environment AND message_code='Z02';
  IF NOT FOUND OR v_source.raw_payload IS NULL OR v_source.payload_hash IS DISTINCT FROM v_message.immutable_payload_hash
   OR v_source.raw_payload IS DISTINCT FROM v_message.raw_payload OR v_source.source_received_at IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','z02_frozen_source_unavailable');END IF;
  SELECT * INTO v_applied FROM gridex_received_sources.z02_core_applications WHERE source_message_id=p_message_id AND request_id=p_request_id;
  IF FOUND THEN
   IF v_applied.company_id IS DISTINCT FROM p_company_id OR v_applied.customer_id IS DISTINCT FROM p_customer_id OR v_applied.site_id IS DISTINCT FROM p_site_id
    OR v_applied.source_payload_hash IS DISTINCT FROM v_source.payload_hash THEN RETURN jsonb_build_object('ok',false,'code','z02_applied_source_scope_mismatch');END IF;
   RETURN v_applied.result;
  END IF;
  SELECT count(*) INTO v_match_count FROM gridex_received_sources.validation_assessments a
   WHERE a.source_message_id=p_message_id AND a.company_id=p_company_id AND a.environment=v_source.environment AND a.source_payload_hash=v_source.payload_hash
   AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
  IF v_match_count<>1 THEN RETURN jsonb_build_object('ok',false,'code','z02_current_canonical_assessment_ambiguous'); END IF;
  SELECT a.* INTO v_assessment FROM gridex_received_sources.validation_assessments a
   WHERE a.source_message_id=p_message_id AND a.company_id=p_company_id AND a.environment=v_source.environment AND a.source_payload_hash=v_source.payload_hash
   AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
  IF NOT FOUND OR v_assessment.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted'
   OR v_assessment.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'accepted' OR v_assessment.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN
   RETURN jsonb_build_object('ok',false,'code','z02_canonical_source_not_accepted');END IF;
  SELECT * INTO v_original FROM public.ediel_messages
   WHERE id=v_request.ediel_message_id AND company_id=p_company_id AND environment=v_source.environment AND direction='outbound' AND message_standard='edifact' AND message_family='PRODAT' AND message_code='Z01'
    AND customer_id=p_customer_id AND site_id=p_site_id FOR SHARE;
  IF NOT FOUND OR v_original.raw_payload IS NULL OR v_original.immutable_rendered_at IS NULL
   OR v_original.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(v_original.raw_payload,'UTF8')),'hex')
   OR v_request.operation_id IS NULL OR p_operation_id IS NOT NULL AND p_operation_id IS DISTINCT FROM v_request.operation_id THEN
   RETURN jsonb_build_object('ok',false,'code','z02_originating_sent_source_unavailable');END IF;
  SELECT * INTO v_dispatch FROM gridex_ediel_transport.attempts a
   WHERE a.message_id=v_original.id AND a.company_id=p_company_id AND a.environment=v_source.environment
    AND a.binding->>'originalHash'=v_original.immutable_payload_hash AND a.classification='accepted'
    AND a.entered_at IS NOT NULL AND a.observed_at IS NOT NULL AND a.entered_at<=a.observed_at AND a.observed_at<=v_source.source_received_at
   ORDER BY a.observed_at,a.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','z02_originating_dispatch_proof_required'); END IF;
  v_inbound_wire:=gridex_received_sources.z02_core_wire_v1(v_source.raw_payload);v_original_wire:=gridex_received_sources.z02_core_wire_v1(v_original.raw_payload);
  IF v_inbound_wire IS NULL OR v_original_wire IS NULL OR v_inbound_wire->>'code'<>'Z02' OR v_original_wire->>'code'<>'Z01'
   OR v_inbound_wire->>'sender' IS DISTINCT FROM v_original_wire->>'receiver' OR v_inbound_wire->>'receiver' IS DISTINCT FROM v_original_wire->>'sender'
   OR v_inbound_wire->>'transportSender' IS DISTINCT FROM v_original_wire->>'transportReceiver' OR v_inbound_wire->>'transportReceiver' IS DISTINCT FROM v_original_wire->>'transportSender' THEN
   RETURN jsonb_build_object('ok',false,'code','z02_original_party_namespace_mismatch');END IF;
  SELECT count(*) INTO v_match_count FROM jsonb_array_elements(v_original_wire->'objects') x
   WHERE x->>'objectId'=coalesce(nullif(btrim(v_site.normalized_facility_id),''),nullif(btrim(v_site.facility_id),''));
  IF v_match_count<>1 THEN RETURN jsonb_build_object('ok',false,'code','z02_originating_object_ambiguous');END IF;
  SELECT x INTO v_original_object FROM jsonb_array_elements(v_original_wire->'objects') x
   WHERE x->>'objectId'=coalesce(nullif(btrim(v_site.normalized_facility_id),''),nullif(btrim(v_site.facility_id),''));
  SELECT count(*) INTO v_match_count FROM jsonb_array_elements(v_inbound_wire->'objects') x
   WHERE x->>'objectId'=v_original_object->>'objectId' AND x->>'identityAgency'=v_original_object->>'identityAgency'
    AND x->>'lineReference'=v_original_object->>'lineReference';
  IF v_match_count<>1 OR nullif(v_original_object->>'lineReference','') IS NULL THEN RETURN jsonb_build_object('ok',false,'code','z02_original_object_reference_mismatch');END IF;
  SELECT x INTO v_object FROM jsonb_array_elements(v_inbound_wire->'objects') x
   WHERE x->>'objectId'=v_original_object->>'objectId' AND x->>'identityAgency'=v_original_object->>'identityAgency' AND x->>'lineReference'=v_original_object->>'lineReference';
  SELECT count(*) INTO v_match_count FROM jsonb_array_elements(v_assessment.facts_text::jsonb#>'{registerValidation,objects}') x
   WHERE x->>'objectId'=v_object->>'objectId' AND x->>'identityAgency'=v_object->>'identityAgency' AND x->>'messageIndex'='0'
    AND x->>'messageReference'=v_inbound_wire->>'messageReference';
  IF v_match_count<>1 THEN RETURN jsonb_build_object('ok',false,'code','z02_own_canonical_object_ambiguous'); END IF;
  SELECT x INTO v_facet FROM jsonb_array_elements(v_assessment.facts_text::jsonb#>'{registerValidation,objects}') x
   WHERE x->>'objectId'=v_object->>'objectId' AND x->>'identityAgency'=v_object->>'identityAgency' AND x->>'messageIndex'='0'
    AND x->>'messageReference'=v_inbound_wire->>'messageReference';
  IF v_facet->>'disposition' IS DISTINCT FROM 'accepted' OR jsonb_array_length(v_facet->'registers') IS DISTINCT FROM 1
   OR v_facet#>>'{registers,0,lineIndex}' IS DISTINCT FROM v_object->>'lineIndex' OR v_facet#>>'{registers,0,segmentIndex}' IS DISTINCT FROM v_object->>'segmentIndex'
   OR v_facet#>>'{registers,0,lineNumber}' IS DISTINCT FROM v_object->>'lineNumber' THEN RETURN jsonb_build_object('ok',false,'code','z02_own_canonical_object_unavailable');END IF;
  IF (v_object->>'reason' IN ('Z22','Z23')) IS NOT TRUE OR v_object->>'reason' IS DISTINCT FROM v_original_object->>'reason'
   OR NOT EXISTS(SELECT FROM public.ediel_business_references br WHERE br.company_id=p_company_id AND br.source_message_id=v_original.id AND br.message_family='PRODAT' AND br.message_code='Z01' AND br.reference_type='RFF_LI' AND br.reference_value=v_object->>'lineReference') THEN
   RETURN jsonb_build_object('ok',false,'code','z02_source_reference_or_subtype_mismatch');END IF;
  SELECT * INTO v_customer FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id FOR SHARE;
  v_expected_identity:=coalesce(nullif(btrim(v_customer.org_number),''),nullif(btrim(v_customer.personal_number),''));
  v_expected_qualifier:=CASE WHEN nullif(btrim(v_customer.org_number),'') IS NOT NULL THEN 'SE1' WHEN nullif(btrim(v_customer.personal_number),'') IS NOT NULL THEN 'SE2' ELSE NULL END;
  IF v_expected_identity IS NULL OR v_object->>'customerId' IS DISTINCT FROM v_expected_identity OR v_object->>'customerQualifier' IS DISTINCT FROM v_expected_qualifier OR v_object->>'customerAgency' IS DISTINCT FROM '260'
   OR v_object->>'customerId' IS DISTINCT FROM v_original_object->>'customerId' OR v_object->>'customerQualifier' IS DISTINCT FROM v_original_object->>'customerQualifier'
   OR nullif(v_object->>'customerName','') IS NULL THEN RETURN jsonb_build_object('ok',false,'code','z02_verified_customer_identity_mismatch');END IF;
  SELECT * INTO v_snapshot FROM public.customer_operation_request_snapshots WHERE company_id=p_company_id AND operation_id=v_request.operation_id AND customer_id=p_customer_id AND customer_site_id=p_site_id
   AND request_kind='customer_data_request' AND request_reference=p_request_id::text AND superseded_at IS NULL FOR SHARE;
  v_current_address_hash:=coalesce(nullif(btrim(v_site.address_hash),''),lower(concat_ws('|',nullif(btrim(v_site.street),''),nullif(regexp_replace(coalesce(v_site.postal_code,''),'[^0-9]','','g'),''),nullif(btrim(v_site.city),''))));
  IF NOT FOUND OR v_snapshot.site_address_hash IS DISTINCT FROM v_current_address_hash OR v_snapshot.grid_owner_id IS DISTINCT FROM v_site.grid_owner_id
   OR nullif(v_original_object->>'installationAddress','') IS NOT NULL AND btrim(v_original_object->>'installationAddress') IS DISTINCT FROM btrim(v_site.street) THEN
   RETURN jsonb_build_object('ok',false,'code','z02_original_site_snapshot_changed');END IF;
  IF EXISTS(SELECT FROM gridex_received_sources.z02_core_applications WHERE source_message_id=p_message_id AND object_id=v_object->>'objectId' AND identity_agency=v_object->>'identityAgency') THEN
   RETURN jsonb_build_object('ok',false,'code','z02_object_already_applied_to_other_request');END IF;
  v_meter_external:=v_object->>'objectId';v_facility_id:=v_meter_external;v_grid_area:=v_object->>'gridArea';
  IF nullif(v_grid_area,'') IS NULL THEN RETURN jsonb_build_object('ok',false,'code','z02_source_grid_area_missing');END IF;

  select count(distinct upper(pga.price_area))::integer,
         min(upper(pga.price_area))
    into v_price_area_count, v_price_area
  from public.platform_grid_areas pga
  where pga.is_active = true
    and upper(pga.grid_area_code) = upper(v_grid_area)
    and upper(coalesce(pga.price_area, '')) in ('SE1','SE2','SE3','SE4')
    and (pga.valid_from is null or pga.valid_from <= (v_source.source_received_at AT TIME ZONE 'Etc/GMT-1')::date)
    and (pga.valid_to is null or pga.valid_to >= (v_source.source_received_at AT TIME ZONE 'Etc/GMT-1')::date);

  if v_meter_external is null then
    return jsonb_build_object('ok', false, 'code', 'z02_metering_point_missing');
  end if;
  if v_price_area_count <> 1 or v_price_area not in ('SE1','SE2','SE3','SE4') then
    return jsonb_build_object('ok', false, 'code', 'z02_grid_area_price_area_unresolved', 'gridAreaCode', v_grid_area);
  end if;
  if nullif(btrim(v_site.price_area_code), '') is not null and upper(v_site.price_area_code) <> v_price_area then
    return jsonb_build_object('ok', false, 'code', 'z02_existing_price_area_conflict', 'existingPriceArea', upper(v_site.price_area_code), 'canonicalPriceArea', v_price_area);
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

  -- Resolve the actual selected point before any writes. Core 209/260 facts
  -- cannot invent energy direction, reading frequency or settlement relevance
  -- for a new point; those belong to a separately sourced masterdata operation.
  SELECT * INTO v_meter FROM public.metering_points m
   WHERE m.company_id=p_company_id AND m.customer_id=p_customer_id
    AND coalesce(m.customer_site_id,m.site_id)=p_site_id
    AND (p_request_id IS NOT NULL AND m.id=v_request.metering_point_id
     OR v_request.metering_point_id IS NULL AND (m.metering_point_id=v_meter_external OR m.meter_point_id=v_meter_external OR m.ediel_reference=v_meter_external OR m.ediel_metering_point_id=v_meter_external))
   ORDER BY m.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','z02_source_qualified_point_creation_required'); END IF;
  SELECT count(*) INTO v_match_count FROM public.metering_points m
   WHERE m.company_id=p_company_id AND m.customer_id=p_customer_id AND coalesce(m.customer_site_id,m.site_id)=p_site_id
    AND (m.id=v_request.metering_point_id OR v_request.metering_point_id IS NULL AND (m.metering_point_id=v_meter_external OR m.meter_point_id=v_meter_external OR m.ediel_reference=v_meter_external OR m.ediel_metering_point_id=v_meter_external));
  IF v_match_count<>1 THEN RETURN jsonb_build_object('ok',false,'code','z02_selected_point_ambiguous'); END IF;

  update public.customer_sites
  set facility_id = coalesce(v_facility_id, facility_id),
      grid_area_code = coalesce(v_grid_area, grid_area_code),
      price_area_code = coalesce(v_price_area, price_area_code),
      bidding_zone_code = coalesce(v_price_area, bidding_zone_code),
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

  v_result := jsonb_build_object(
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
    'atomicCoreApply', true
  );
  INSERT INTO gridex_received_sources.z02_core_applications(source_message_id,company_id,environment,source_payload_hash,canonical_assessment_id,originating_z01_message_id,originating_transport_attempt_id,request_id,customer_id,site_id,object_id,identity_agency,metering_point_id,result)
  VALUES(p_message_id,p_company_id,v_source.environment,v_source.payload_hash,v_assessment.id,v_original.id,v_dispatch.id,p_request_id,p_customer_id,p_site_id,v_object->>'objectId',v_object->>'identityAgency',v_meter.id,v_result);
  RETURN v_result;
end;
$$;

CREATE OR REPLACE FUNCTION public.gridex_complete_facility_response(p_company_id uuid, p_request_id uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'system'::text, p_ediel_message_id uuid DEFAULT NULL::uuid, p_facility_id text DEFAULT NULL::text, p_metering_point_external_id text DEFAULT NULL::text, p_grid_area_code text DEFAULT NULL::text, p_price_area_code text DEFAULT NULL::text, p_source_party_grid_owner_id uuid DEFAULT NULL::uuid, p_raw_payload jsonb DEFAULT '{}'::jsonb, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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

CREATE OR REPLACE FUNCTION public.gridex_create_customer_site_with_address(p_company_id uuid, p_customer_id uuid, p_site_name text, p_facility_id text, p_street text, p_postal_code text, p_city text, p_country text, p_address_normalized text, p_address_hash text, p_source text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_site_id uuid;
  v_now timestamptz := now();
  v_country text := coalesce(nullif(btrim(p_country), ''), 'SE');
  v_site_name text := coalesce(nullif(btrim(p_site_name), ''), 'Anläggning');
  v_claimed_grid_area_code text := nullif(btrim(p_metadata ->> 'claimed_grid_area_code'), '');
  v_claimed_price_area_code text := upper(nullif(btrim(p_metadata ->> 'claimed_price_area_code'), ''));
  v_claimed_grid_owner_id uuid := null;
begin
  if p_company_id is null then
    raise exception 'company_id_required' using errcode = '22023';
  end if;
  if p_customer_id is null then
    raise exception 'customer_id_required' using errcode = '22023';
  end if;
  if p_address_hash is null or btrim(p_address_hash) = '' then
    raise exception 'address_hash_required' using errcode = '22023';
  end if;

  if (p_metadata ->> 'claimed_grid_owner_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_claimed_grid_owner_id := (p_metadata ->> 'claimed_grid_owner_id')::uuid;
  end if;

  select id
    into v_site_id
    from public.customer_sites
   where company_id = p_company_id
     and customer_id = p_customer_id
     and address_hash = p_address_hash
     and coalesce(is_active, true) = true
   order by created_at asc
   limit 1
   for update;

  if v_site_id is not null then
    update public.customer_sites
       set site_name = coalesce(nullif(btrim(site_name), ''), v_site_name),
           facility_id = coalesce(nullif(btrim(facility_id), ''), nullif(btrim(p_facility_id), '')),
           street = coalesce(nullif(btrim(street), ''), p_street),
           postal_code = coalesce(nullif(btrim(postal_code), ''), p_postal_code),
           city = coalesce(nullif(btrim(city), ''), p_city),
           country = coalesce(nullif(btrim(country), ''), v_country),
           address_normalized = coalesce(nullif(btrim(address_normalized), ''), p_address_normalized),
           address_hash = coalesce(nullif(btrim(address_hash), ''), p_address_hash),
           address_source = coalesce(nullif(btrim(address_source), ''), coalesce(nullif(btrim(p_source), ''), 'website')),
           address_received_at = coalesce(address_received_at, v_now),
           address_status = case when p_source = 'grid_owner_response' then 'verified' else coalesce(address_status, 'candidate') end,
           address_quality_status = coalesce(address_quality_status, 'complete'),
           facility_data_status = coalesce(facility_data_status, case when p_source = 'grid_owner_response' then 'verified' else 'unverified' end),
           resolution_status = coalesce(resolution_status, 'needs_review'),
           grid_owner_id = coalesce(grid_owner_id, v_claimed_grid_owner_id),
           selected_grid_owner_id = coalesce(selected_grid_owner_id, v_claimed_grid_owner_id),
           grid_area_code = coalesce(nullif(btrim(grid_area_code), ''), v_claimed_grid_area_code),
           price_area_code = coalesce(nullif(btrim(price_area_code), ''), v_claimed_price_area_code),
           bidding_zone_code = coalesce(nullif(btrim(bidding_zone_code), ''), v_claimed_price_area_code),
           metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
           updated_at = v_now
     where id = v_site_id
       and company_id = p_company_id
       and customer_id = p_customer_id;
    return v_site_id;
  end if;

  insert into public.customer_sites (
    company_id,
    customer_id,
    site_name,
    facility_id,
    site_type,
    status,
    street,
    postal_code,
    city,
    country,
    address_normalized,
    address_hash,
    address_source,
    address_received_at,
    address_status,
    address_quality_status,
    address_quality_warnings,
    facility_data_status,
    resolution_status,
    grid_owner_id,
    selected_grid_owner_id,
    grid_area_code,
    price_area_code,
    bidding_zone_code,
    metadata,
    created_at,
    updated_at
  ) values (
    p_company_id,
    p_customer_id,
    v_site_name,
    nullif(btrim(p_facility_id), ''),
    'consumption',
    'draft',
    p_street,
    p_postal_code,
    p_city,
    v_country,
    p_address_normalized,
    p_address_hash,
    coalesce(nullif(btrim(p_source), ''), 'website'),
    v_now,
    case when p_source = 'grid_owner_response' then 'verified' else 'candidate' end,
    'complete',
    '[]'::jsonb,
    case when p_source = 'grid_owner_response' then 'verified' else 'unverified' end,
    'needs_review',
    v_claimed_grid_owner_id,
    v_claimed_grid_owner_id,
    v_claimed_grid_area_code,
    v_claimed_price_area_code,
    v_claimed_price_area_code,
    coalesce(p_metadata, '{}'::jsonb),
    v_now,
    v_now
  ) returning id into v_site_id;

  insert into public.customer_addresses (
    company_id, customer_id, type, street_1, postal_code, city, country,
    is_active, metadata, created_at, updated_at
  ) values (
    p_company_id, p_customer_id, 'facility', p_street, p_postal_code, p_city,
    v_country, true,
    jsonb_build_object('customer_site_id', v_site_id, 'address_hash', p_address_hash, 'source', p_source),
    v_now, v_now
  );

  insert into public.customer_site_address_history (
    company_id, customer_id, customer_site_id, address_hash, source,
    source_reference, actor_user_id, snapshot
  ) values (
    p_company_id, p_customer_id, v_site_id, p_address_hash,
    coalesce(nullif(btrim(p_source), ''), 'website'), null, null,
    jsonb_build_object(
      'street', p_street,
      'postal_code', p_postal_code,
      'city', p_city,
      'country', v_country,
      'address_hash', p_address_hash,
      'source', p_source,
      'claimed_grid_owner_id', v_claimed_grid_owner_id,
      'claimed_grid_area_code', v_claimed_grid_area_code,
      'claimed_price_area_code', v_claimed_price_area_code
    )
  );

  return v_site_id;
end;
$_$;
