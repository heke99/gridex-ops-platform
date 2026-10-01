-- Forward source-owned Z02 core mutation. Generated with Supabase CLI.
-- P26.A fields209/260 are projected only from their own immutable LIN scope.
-- Field213 and all parsed/caller JSON extras cannot affect business writes.
BEGIN;
CREATE TABLE gridex_received_sources.z02_core_applications (
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^[a-f0-9]{64}$'),
 canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
 originating_z01_message_id uuid NOT NULL, request_id uuid NOT NULL, customer_id uuid NOT NULL,site_id uuid NOT NULL,
 object_id text NOT NULL,identity_agency text NOT NULL, metering_point_id uuid NOT NULL,result jsonb NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(source_message_id,request_id),UNIQUE(source_message_id,object_id,identity_agency)
);
ALTER TABLE gridex_received_sources.z02_core_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.z02_core_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY z02_core_application_service_read ON gridex_received_sources.z02_core_applications FOR SELECT TO service_role USING(true);
REVOKE ALL ON gridex_received_sources.z02_core_applications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON gridex_received_sources.z02_core_applications TO service_role;
CREATE TRIGGER z02_core_applications_no_mutation BEFORE UPDATE OR DELETE ON gridex_received_sources.z02_core_applications
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER z02_core_applications_no_truncate BEFORE TRUNCATE ON gridex_received_sources.z02_core_applications
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

-- Bounded physical projection, never a validator/party approval. The shared
-- lexer decodes UNA/release exactly once; national acceptance remains canonical.
CREATE FUNCTION gridex_received_sources.z02_core_wire_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(p_raw);t jsonb;e jsonb;
 result jsonb:='{}';objects jsonb:='[]';obj jsonb;key text;value text;characteristic text;line_index integer:=-1;
BEGIN
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='BGM')<>1 THEN RETURN NULL; END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x ORDER BY (x->>'index')::integer LOOP
  e:=t->'elements';key:=NULL;value:=NULL;
  IF t->>'tag'='UNB' THEN
   IF result ? 'transportSender' OR jsonb_array_length(e->2)<>2 OR jsonb_array_length(e->3)<>2
    OR (e#>>'{2,1}' IN ('14','ZZ')) IS NOT TRUE OR (e#>>'{3,1}' IN ('14','ZZ')) IS NOT TRUE THEN RETURN NULL; END IF;
   result:=result||jsonb_build_object('transportSender',e#>>'{2,0}','transportReceiver',e#>>'{3,0}');
  ELSIF t->>'tag'='UNH' THEN result:=result||jsonb_build_object('messageReference',e#>>'{1,0}');
  ELSIF t->>'tag'='BGM' THEN result:=result||jsonb_build_object('code',e#>>'{1,0}');
  ELSIF t->>'tag'='NAD' AND obj IS NULL AND e#>>'{1,0}' IN ('FR','DO') THEN
   key:=CASE e#>>'{1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;
   IF result ? key OR e#>>'{2,1}' IS DISTINCT FROM '160' OR e#>>'{2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL; END IF;
   result:=result||jsonb_build_object(key,e#>>'{2,0}');
  END IF;
  IF t->>'tag'='LIN' THEN
   IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj); END IF;
   line_index:=line_index+1;characteristic:=NULL;
   obj:=jsonb_build_object('objectId',e#>>'{3,0}','identityAgency',e#>>'{3,3}','lineIndex',line_index,'lineNumber',e#>>'{1,0}','segmentIndex',(t->>'index')::integer);
  ELSIF obj IS NOT NULL AND t->>'tag' NOT IN ('UNT','UNZ') THEN
   key:=NULL;value:=NULL;
   IF t->>'tag'='RFF' AND e#>>'{1,0}' IN ('LI','Z05') THEN key:=CASE e#>>'{1,0}' WHEN 'LI' THEN 'lineReference' ELSE 'gridArea' END;value:=e#>>'{1,1}';
   ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' AND characteristic='Z13' THEN key:='reason';value:=e#>>'{1,0}';characteristic:=NULL;
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN
    IF obj ? 'customerId' THEN RETURN NULL; END IF;
    obj:=obj||jsonb_build_object('customerId',e#>>'{2,0}','customerQualifier',e#>>'{2,1}','customerAgency',e#>>'{2,2}','customerName',e#>>'{4,0}');
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='IT' THEN
    IF obj ? 'installationAddress' THEN RETURN NULL; END IF;
    obj:=obj||jsonb_build_object('installationAddress',e#>>'{5,0}','installationPostcode',e#>>'{8,0}','installationCity',e#>>'{6,0}');
   END IF;
   IF key IS NOT NULL THEN IF obj ? key THEN RETURN NULL; END IF;obj:=obj||jsonb_build_object(key,nullif(value,''));END IF;
  END IF;
 END LOOP;
 IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj); END IF;
 IF (result->>'code' IN ('Z01','Z02')) IS NOT TRUE OR nullif(result->>'sender','') IS NULL OR nullif(result->>'receiver','') IS NULL
 OR jsonb_array_length(objects)=0 THEN RETURN NULL; END IF;
 RETURN result||jsonb_build_object('objects',objects);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.z02_core_wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;
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
set search_path = pg_catalog, public
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
  v_source gridex_received_sources.sources%rowtype;
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
   OR v_original.message_sent_at IS NULL OR v_original.message_sent_at>v_source.source_received_at
   OR v_request.operation_id IS NULL OR p_operation_id IS NOT NULL AND p_operation_id IS DISTINCT FROM v_request.operation_id THEN
   RETURN jsonb_build_object('ok',false,'code','z02_originating_sent_source_unavailable');END IF;
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
      normalized_facility_id = coalesce(v_facility_id, normalized_facility_id),
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
  INSERT INTO gridex_received_sources.z02_core_applications(source_message_id,company_id,environment,source_payload_hash,canonical_assessment_id,originating_z01_message_id,request_id,customer_id,site_id,object_id,identity_agency,metering_point_id,result)
  VALUES(p_message_id,p_company_id,v_source.environment,v_source.payload_hash,v_assessment.id,v_original.id,p_request_id,p_customer_id,p_site_id,v_object->>'objectId',v_object->>'identityAgency',v_meter.id,v_result);
  RETURN v_result;
end;
$$;


REVOKE ALL ON FUNCTION public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid) IS
 'Atomic exact Z02 own-object application from immutable original + latest canonical facet + sealed originating Z01; excluded field213 and caller JSON never mutate business values. Final source-scoped outcomes are append-only.';
COMMIT;
