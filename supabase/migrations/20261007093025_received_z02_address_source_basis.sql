-- Generated with Supabase CLI 2.101.0. Read authority for field229 before
-- canonical assessment: an incoming reply cannot supply its own availability.
BEGIN;

CREATE FUNCTION gridex_received_sources.z02_address_source_basis_v1(
 p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
 m public.ediel_messages%rowtype;s gridex_received_sources.sources%rowtype;
 original public.ediel_messages%rowtype;candidate public.ediel_messages%rowtype;
 request public.customer_info_requests%rowtype;candidate_request public.customer_info_requests%rowtype;
 site public.customer_sites%rowtype;customer public.customers%rowtype;
 snapshot public.customer_operation_request_snapshots%rowtype;
 dispatch gridex_ediel_transport.attempts%rowtype;
 source_wire jsonb;original_wire jsonb;source_object jsonb;original_object jsonb;
 candidate_wire jsonb;candidate_object jsonb;receipt jsonb;
 source_transport jsonb;candidate_transport jsonb;
 matches integer:=0;object_matches integer;request_id uuid;original_id uuid;
 expected_object text;expected_identity text;expected_qualifier text;address_hash text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN
  RAISE EXCEPTION 'z02_address_source_service_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 -- Service execution is not authority to disclose another company's source.
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'z02_address_source_actor_required' USING ERRCODE='42501';END IF;
 PERFORM cm.user_id FROM public.company_memberships cm
  WHERE cm.company_id=s.company_id AND cm.user_id=p_actor_user_id
   AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL FOR SHARE;
 IF NOT FOUND OR NOT (
  coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,s.company_id,'ediel.read'),false)
  OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,s.company_id,'communication.read'),false)) THEN
  RAISE EXCEPTION 'z02_address_source_actor_read_required' USING ERRCODE='42501';
 END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(s.company_id,s.source_message_id);
 SELECT * INTO m FROM public.ediel_messages WHERE id=s.source_message_id
  AND company_id=s.company_id AND environment=s.environment FOR SHARE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact'
  OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z02'
  OR s.message_code IS DISTINCT FROM 'Z02' OR s.raw_payload IS NULL
  OR s.raw_payload IS DISTINCT FROM m.raw_payload
  OR s.payload_hash IS DISTINCT FROM m.immutable_payload_hash
  OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')
  OR s.source_received_at IS NULL OR NOT isfinite(s.source_received_at)
  OR s.source_received_at IS DISTINCT FROM m.message_received_at
  OR m.customer_id IS NULL OR m.site_id IS NULL THEN RETURN NULL;END IF;

 SELECT * INTO site FROM public.customer_sites WHERE id=m.site_id
  AND company_id=s.company_id AND customer_id=m.customer_id FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO customer FROM public.customers WHERE id=m.customer_id AND company_id=s.company_id FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 expected_object:=coalesce(nullif(btrim(site.normalized_facility_id),''),nullif(btrim(site.facility_id),''));
 expected_identity:=coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),''));
 expected_qualifier:=CASE WHEN nullif(btrim(customer.org_number),'') IS NOT NULL THEN 'SE1'
  WHEN nullif(btrim(customer.personal_number),'') IS NOT NULL THEN 'SE2' ELSE NULL END;
 IF expected_object IS NULL OR expected_identity IS NULL THEN RETURN NULL;END IF;
 source_wire:=gridex_received_sources.z02_core_wire_v1(s.raw_payload);
 IF source_wire IS NULL OR source_wire->>'code' IS DISTINCT FROM 'Z02' THEN RETURN NULL;END IF;
 SELECT x->'elements' INTO source_transport FROM jsonb_array_elements(
  gridex_received_sources.closure_wire_tokens_v2(s.raw_payload)) x WHERE x->>'tag'='UNB';
 SELECT count(*) INTO object_matches FROM jsonb_array_elements(source_wire->'objects') x
  WHERE x->>'objectId'=expected_object;
 IF object_matches<>1 THEN RETURN NULL;END IF;
 SELECT x INTO source_object FROM jsonb_array_elements(source_wire->'objects') x WHERE x->>'objectId'=expected_object;
 IF nullif(source_object->>'identityAgency','') IS NULL OR nullif(source_object->>'lineReference','') IS NULL
  OR (source_object->>'reason' IN ('Z22','Z23')) IS NOT TRUE THEN RETURN NULL;END IF;

 -- Select by the physical source correlation, not latest request or mutable
 -- sent_at/parsed_payload. Multiple matching requests are unavailable authority.
 FOR candidate_request IN SELECT r.* FROM public.customer_info_requests r
  WHERE r.company_id=s.company_id AND r.customer_id=m.customer_id AND r.site_id=m.site_id
   AND r.operation_id IS NOT NULL AND r.ediel_message_id IS NOT NULL FOR SHARE
 LOOP
  SELECT * INTO candidate FROM public.ediel_messages o WHERE o.id=candidate_request.ediel_message_id
   AND o.company_id=s.company_id AND o.environment=s.environment AND o.direction='outbound'
   AND o.message_standard='edifact' AND o.message_family='PRODAT' AND o.message_code='Z01'
   AND o.customer_id=m.customer_id AND o.site_id=m.site_id FOR SHARE;
  IF NOT FOUND OR candidate.raw_payload IS NULL OR candidate.immutable_rendered_at IS NULL
   OR NOT isfinite(candidate.immutable_rendered_at)
   OR candidate.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(candidate.raw_payload,'UTF8')),'hex')
   THEN CONTINUE;END IF;
  candidate_wire:=gridex_received_sources.z02_core_wire_v1(candidate.raw_payload);
  SELECT x->'elements' INTO candidate_transport FROM jsonb_array_elements(
   gridex_received_sources.closure_wire_tokens_v2(candidate.raw_payload)) x WHERE x->>'tag'='UNB';
  IF candidate_wire IS NULL OR candidate_wire->>'code' IS DISTINCT FROM 'Z01'
   OR source_wire->>'sender' IS DISTINCT FROM candidate_wire->>'receiver'
   OR source_wire->>'receiver' IS DISTINCT FROM candidate_wire->>'sender'
   OR nullif(source_wire->>'transportSender','') IS NULL OR nullif(source_wire->>'transportReceiver','') IS NULL
   OR source_wire->>'transportSender' IS DISTINCT FROM candidate_wire->>'transportReceiver'
   OR source_wire->>'transportReceiver' IS DISTINCT FROM candidate_wire->>'transportSender'
   OR source_transport->2 IS DISTINCT FROM candidate_transport->3
   OR source_transport->3 IS DISTINCT FROM candidate_transport->2 THEN CONTINUE;END IF;
  SELECT count(*) INTO object_matches FROM jsonb_array_elements(candidate_wire->'objects') x
   WHERE x->>'objectId'=expected_object;
  IF object_matches<>1 THEN CONTINUE;END IF;
  SELECT x INTO candidate_object FROM jsonb_array_elements(candidate_wire->'objects') x WHERE x->>'objectId'=expected_object;
  IF candidate_object->>'identityAgency' IS DISTINCT FROM source_object->>'identityAgency'
   OR candidate_object->>'lineReference' IS DISTINCT FROM source_object->>'lineReference'
   OR candidate_object->>'reason' IS DISTINCT FROM source_object->>'reason'
   OR candidate_object->>'customerId' IS DISTINCT FROM expected_identity
   OR candidate_object->>'customerQualifier' IS DISTINCT FROM expected_qualifier
   OR candidate_object->>'customerAgency' IS DISTINCT FROM '260'
   OR nullif(candidate_object->>'customerName','') IS NULL
   OR NOT EXISTS(SELECT FROM public.ediel_business_references br WHERE br.company_id=s.company_id
    AND br.source_message_id=candidate.id AND br.message_family='PRODAT' AND br.message_code='Z01'
    AND br.reference_type='RFF_LI' AND br.reference_value=source_object->>'lineReference') THEN CONTINUE;END IF;
  matches:=matches+1;request_id:=candidate_request.id;original_id:=candidate.id;
  original_wire:=candidate_wire;original_object:=candidate_object;
 END LOOP;
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT * INTO request FROM public.customer_info_requests WHERE id=request_id;
 SELECT * INTO original FROM public.ediel_messages WHERE id=original_id;
 PERFORM public.ediel_require_source_bytes_available_v1(s.company_id,original.id);
 IF request.grid_owner_id IS NOT NULL AND (
  request.grid_owner_id IS DISTINCT FROM site.grid_owner_id
  OR m.grid_owner_id IS NOT NULL AND m.grid_owner_id IS DISTINCT FROM request.grid_owner_id
  OR original.grid_owner_id IS NOT NULL AND original.grid_owner_id IS DISTINCT FROM request.grid_owner_id)
  THEN RETURN NULL;END IF;
 SELECT count(*) INTO matches FROM public.customer_operation_request_snapshots x
  WHERE x.company_id=s.company_id AND x.operation_id=request.operation_id AND x.customer_id=m.customer_id
   AND x.customer_site_id=m.site_id AND x.request_kind='customer_data_request'
   AND x.request_reference=request.id::text AND x.superseded_at IS NULL;
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT * INTO snapshot FROM public.customer_operation_request_snapshots x
  WHERE x.company_id=s.company_id AND x.operation_id=request.operation_id AND x.customer_id=m.customer_id
   AND x.customer_site_id=m.site_id AND x.request_kind='customer_data_request'
   AND x.request_reference=request.id::text AND x.superseded_at IS NULL FOR SHARE;
 address_hash:=coalesce(nullif(btrim(site.address_hash),''),lower(concat_ws('|',nullif(btrim(site.street),''),
  nullif(regexp_replace(coalesce(site.postal_code,''),'[^0-9]','','g'),''),nullif(btrim(site.city),''))));
 IF snapshot.site_address_hash IS DISTINCT FROM address_hash OR snapshot.grid_owner_id IS DISTINCT FROM site.grid_owner_id
  OR nullif(original_object->>'installationAddress','') IS NOT NULL
   AND btrim(original_object->>'installationAddress') IS DISTINCT FROM btrim(site.street) THEN RETURN NULL;END IF;

 -- Reuse the genuine private provider receipt reader after READ authorization.
 -- Its historical sender is not requalified against present-day SEND rights.
 receipt:=gridex_ediel_transport.accepted_source_basis_v1(original);
 IF receipt IS NULL OR receipt->>'status' IS DISTINCT FROM 'accepted_projection'
  OR receipt->>'lane' IS DISTINCT FROM 'generic_journal' THEN RETURN NULL;END IF;
 SELECT * INTO dispatch FROM gridex_ediel_transport.attempts a WHERE a.id=(receipt->>'attemptId')::uuid
  AND a.company_id=s.company_id AND a.environment=s.environment AND a.message_id=original.id
  AND a.classification='accepted' AND a.binding->>'originalHash'=original.immutable_payload_hash
  AND a.entered_at IS NOT NULL AND a.observed_at IS NOT NULL
  AND isfinite(a.entered_at) AND isfinite(a.observed_at)
  AND original.immutable_rendered_at<=a.entered_at AND a.entered_at<=a.observed_at
  AND a.observed_at<=s.source_received_at
  AND a.observed_at=(receipt->>'observedAt')::timestamptz FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;

 -- Incoming UD fields are intentionally absent from the authority predicate.
 -- The caller parses original C059 bytes and validates reply fields separately.
 RETURN jsonb_build_object('status','z02_address_source_basis','version',1,
  'companyId',s.company_id,'environment',s.environment,'sourceMessageId',m.id,
  'sourcePayloadHash',s.payload_hash,'sourceReceivedAt',s.source_received_at,'sourceRawPayload',s.raw_payload,
  'sourceMessage',to_jsonb(m),'sourceContext',s.received_context,
  'originalMessageId',original.id,'originalPayloadHash',original.immutable_payload_hash,
  'originalRenderedAt',original.immutable_rendered_at,'originalRawPayload',original.raw_payload,
  'originalMessage',to_jsonb(original),'sourceObject',source_object,'originalObject',original_object,
  'request',to_jsonb(request),'requestSnapshot',to_jsonb(snapshot),'customer',to_jsonb(customer),'site',to_jsonb(site),
  'acceptedTransport',to_jsonb(dispatch),'acceptedTransportReceipt',receipt);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.z02_address_source_basis_v1(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_ediel_received_z02_address_source_basis_v1(
 p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT gridex_received_sources.z02_address_source_basis_v1(p_source_message_id,p_actor_user_id)
$$;
REVOKE ALL ON FUNCTION public.gridex_ediel_received_z02_address_source_basis_v1(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_received_z02_address_source_basis_v1(uuid,uuid) TO service_role;
COMMIT;
