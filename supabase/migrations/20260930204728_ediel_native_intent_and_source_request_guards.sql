-- CALL03: native ordinary PRODAT/UTILTS entries use the same current intent as
-- rendering/outbox. The prior native owner returns established outcomes first.
BEGIN;
CREATE FUNCTION gridex_ediel_transport.require_message_intent_v1(m public.ediel_messages) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;p public.ediel_message_profiles%rowtype;r public.ediel_rule_packs%rowtype;
 route public.communication_routes%rowtype;profile public.ediel_route_profiles%rowtype;point public.metering_points%rowtype;
 tokens jsonb;unb jsonb;unh jsonb;bgm jsonb;physical_points text[];
BEGIN
 -- Prescribed technical/application ACKs keep their own exact source owner;
 -- ordinary P/U messages, including test fixtures, require their own intent.
 IF m.direction IS DISTINCT FROM 'outbound' OR (m.message_family IN('PRODAT','UTILTS')) IS NOT TRUE THEN RETURN;END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=m.intent_id AND company_id=m.company_id FOR SHARE;
 SELECT * INTO p FROM public.ediel_message_profiles WHERE id=m.rule_profile_version_id FOR SHARE;
 SELECT * INTO r FROM public.ediel_rule_packs WHERE id=m.canonical_rule_pack_id FOR SHARE;
 SELECT * INTO route FROM public.communication_routes WHERE id=m.communication_route_id FOR SHARE;
 SELECT * INTO profile FROM public.ediel_route_profiles WHERE id=m.route_profile_id FOR SHARE;
 IF i.id IS NULL OR i.environment IS DISTINCT FROM m.environment OR i.market IS DISTINCT FROM 'electricity' OR i.message_family IS DISTINCT FROM m.message_family OR i.message_code IS DISTINCT FROM m.message_code
  OR (i.direction IN('outbound','inbound_response')) IS NOT TRUE OR i.validation_status IS DISTINCT FROM 'validated' OR i.validation_result->>'ok' IS DISTINCT FROM 'true' OR i.validation_result->>'status' IS DISTINCT FROM 'validated' OR i.blocking_reasons IS DISTINCT FROM '[]'::jsonb
  OR i.ediel_message_id IS DISTINCT FROM m.id OR i.outbound_request_id IS DISTINCT FROM m.outbound_request_id OR i.route_profile_id IS DISTINCT FROM m.route_profile_id OR i.communication_route_id IS DISTINCT FROM m.communication_route_id
  OR i.customer_id IS DISTINCT FROM m.customer_id OR i.customer_site_id IS DISTINCT FROM m.site_id OR i.supplier_switch_request_id IS DISTINCT FROM m.switch_request_id
  OR route.id IS NULL OR profile.id IS NULL OR (route.company_id IS NOT NULL AND route.company_id IS DISTINCT FROM m.company_id) OR (profile.company_id IS NOT NULL AND profile.company_id IS DISTINCT FROM m.company_id)
  OR route.is_active IS DISTINCT FROM true OR profile.is_enabled IS DISTINCT FROM true OR profile.environment IS DISTINCT FROM m.environment OR profile.communication_route_id IS DISTINCT FROM route.id
  OR p.id IS NULL OR p.is_enabled IS DISTINCT FROM true OR p.rule_pack_id IS DISTINCT FROM r.id OR p.message_code IS DISTINCT FROM m.message_code OR r.family IS DISTINCT FROM m.message_family
  OR (i.expected_rule_version IS NOT NULL AND i.expected_rule_version IS DISTINCT FROM m.rule_profile_version) OR (i.expected_field_matrix_version IS NOT NULL AND i.expected_field_matrix_version IS DISTINCT FROM r.field_matrix_version)
  OR (i.payload->>'transactionSubtype' IS NOT NULL AND i.payload->>'transactionSubtype' IS DISTINCT FROM p.transaction_subtype) THEN RAISE EXCEPTION 'ediel_native_validated_intent_required';END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_native_intent_wire_required';END IF;
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 IF unh#>>'{elements,2,0}' IS DISTINCT FROM i.message_family OR bgm#>>'{elements,1,0}' IS DISTINCT FROM i.message_code
  OR unh#>>'{elements,1,0}' IS DISTINCT FROM i.message_reference OR unb#>>'{elements,5,0}' IS DISTINCT FROM i.interchange_reference OR unb#>>'{elements,7,0}' IS DISTINCT FROM i.application_reference
  OR unb#>>'{elements,2,0}' IS DISTINCT FROM i.sender_ediel_id OR unb#>>'{elements,3,0}' IS DISTINCT FROM i.receiver_ediel_id
  OR nullif(unb#>>'{elements,2,2}','') IS DISTINCT FROM nullif(i.sender_subaddress,'') OR nullif(unb#>>'{elements,3,2}','') IS DISTINCT FROM nullif(i.receiver_subaddress,'')
  OR (i.transaction_reference IS NOT NULL AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE (t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI' AND t#>>'{elements,1,1}'=i.transaction_reference) OR (t->>'tag'='IDE' AND t#>>'{elements,2,0}'=i.transaction_reference))) THEN RAISE EXCEPTION 'ediel_native_intent_wire_scope_changed';END IF;
 IF m.metering_point_id IS NOT NULL THEN
  SELECT * INTO point FROM public.metering_points WHERE id=m.metering_point_id AND company_id=m.company_id FOR SHARE;
  IF point.id IS NULL OR nullif(i.metering_point_id,'') IS NULL OR point.customer_id IS DISTINCT FROM m.customer_id OR point.site_id IS DISTINCT FROM m.site_id
   OR (i.metering_point_id IS DISTINCT FROM point.id::text AND i.metering_point_id IS DISTINCT FROM point.meter_point_id AND i.metering_point_id IS DISTINCT FROM point.ediel_metering_point_id)
   OR (i.grid_area_code IS NOT NULL AND i.grid_area_code IS DISTINCT FROM point.grid_area_code) THEN RAISE EXCEPTION 'ediel_native_intent_owned_point_required';END IF;
  SELECT array_agg(DISTINCT t#>>'{elements,3,0}') INTO physical_points FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('LIN','LOC') AND t#>>'{elements,3,0}' IS NOT NULL;
  IF m.message_family='PRODAT' AND physical_points IS NOT NULL AND (cardinality(physical_points)<>1 OR (physical_points[1] IS DISTINCT FROM point.meter_point_id AND physical_points[1] IS DISTINCT FROM point.ediel_metering_point_id)) THEN RAISE EXCEPTION 'ediel_native_intent_physical_point_scope_changed';END IF;
 ELSIF i.metering_point_id IS NOT NULL THEN RAISE EXCEPTION 'ediel_native_intent_owned_point_required';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.require_message_intent_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_mandatory_intent_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_ediel_transport.mutate_before_mandatory_intent_v1(i);
 IF (i->>'action' IN('prepare','enter')) IS NOT TRUE OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);
 PERFORM public.ediel_require_brp_change_source_current_v1(m.company_id,m.id);
 RETURN result;
END $$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_mandatory_intent_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_outbound_dispatch.mutate_before_mandatory_intent_v1(i);
 IF (i->>'action' IN('prepare','enter')) IS NOT TRUE OR result->>'scoped' IS DISTINCT FROM 'true' OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_mandatory_intent_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_before_mandatory_intent_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Forward UUID-safe request identity corrections, preserving frozen source
-- reservations, selected requests and all previously applied migrations.
CREATE OR REPLACE FUNCTION public.ediel_reserve_production_contract_origin_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;e gridex_received_sources.production_contract_events%rowtype;o gridex_received_sources.production_contract_origins%rowtype;i public.ediel_message_intents%rowtype;period gridex_received_sources.production_contract_periods%rowtype;
BEGIN
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR UPDATE;
 PERFORM mp.id FROM public.metering_points mp WHERE mp.id=e.metering_point_id AND mp.company_id=e.company_id FOR UPDATE;
 b:=public.ediel_production_contract_source_v1(p_company_id,p_event_id,p_actor_user_id);IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 IF i.id IS NULL OR i.environment IS DISTINCT FROM e.environment OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z09' OR i.customer_id IS DISTINCT FROM e.customer_id OR i.metering_point_id IS DISTINCT FROM e.point_id OR i.operation_id IS DISTINCT FROM e.id
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_intent_scope_mismatch'));END IF;
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE event_id=e.id FOR UPDATE;
 IF FOUND THEN IF o.intent_id IS DISTINCT FROM i.id THEN RAISE EXCEPTION 'production_contract_origin_conflict';END IF;RETURN jsonb_build_object('status','reserved','messageId',o.message_id,'outboundRequestId',o.outbound_request_id);END IF;
 IF NOT EXISTS(SELECT FROM public.outbound_requests r WHERE r.id=p_outbound_request_id AND r.company_id=e.company_id AND r.customer_id=e.customer_id AND r.source_type='manual' AND r.source_id::text=i.id::text AND r.request_type='customer_masterdata') THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_request_required'));END IF;
 IF e.event_kind='signed' THEN
 IF EXISTS(SELECT FROM gridex_received_sources.production_contract_periods p WHERE p.company_id=e.company_id AND p.environment=e.environment AND p.metering_point_id=e.metering_point_id AND (p.end_at IS NULL OR p.end_at>e.boundary_at)) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_overlapping_owned_period'));END IF;
 INSERT INTO gridex_received_sources.production_contract_periods(start_event_id,company_id,environment,contract_id,customer_id,metering_point_id,start_at) VALUES(e.id,e.company_id,e.environment,e.contract_id,e.customer_id,e.metering_point_id,e.boundary_at);
 ELSE
 SELECT * INTO period FROM gridex_received_sources.production_contract_periods WHERE start_event_id=e.start_event_id AND company_id=e.company_id FOR UPDATE;
 IF NOT FOUND OR period.end_event_id IS NOT NULL THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_open_period_required'));END IF;
 UPDATE gridex_received_sources.production_contract_periods SET end_at=e.boundary_at,end_event_id=e.id WHERE start_event_id=period.start_event_id;
 END IF;
 INSERT INTO gridex_received_sources.production_contract_origins(event_id,intent_id,company_id,actor_user_id,outbound_request_id) VALUES(e.id,i.id,e.company_id,p_actor_user_id,p_outbound_request_id);
 RETURN jsonb_build_object('status','reserved','messageId',null,'outboundRequestId',p_outbound_request_id);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_reserve_prodat_recovery_origin_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;o gridex_received_sources.prodat_recovery_origins%rowtype;i public.ediel_message_intents%rowtype;m public.ediel_messages%rowtype;r public.outbound_requests%rowtype;basis jsonb;w jsonb;request_type text;
BEGIN
 basis:=public.ediel_prodat_recovery_operation_basis_v1(p_company_id,p_operation_id,p_actor_user_id);
 IF basis IS NULL THEN RAISE EXCEPTION 'prodat_recovery_correction_basis_required';END IF;
 SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id;
 -- The preceding source qualification already holds the sealed original lock.
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id;
 w:=gridex_received_sources.prodat_recovery_wire_v1(op.corrected_raw_payload);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 request_type:=CASE WHEN w->>'code' IN ('Z03','Z08') THEN 'supplier_switch' WHEN w->>'code' IN ('Z13','Z18') THEN 'metering_access' ELSE 'customer_masterdata' END;
 IF i.id IS NULL OR i.environment IS DISTINCT FROM op.environment OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM w->>'code'
 OR i.direction IS DISTINCT FROM 'outbound' OR i.customer_id IS DISTINCT FROM m.customer_id OR i.operation_id IS DISTINCT FROM op.id
 OR i.validation_status IS DISTINCT FROM 'validated' OR i.interchange_reference IS DISTINCT FROM w->>'interchange' OR i.message_reference IS DISTINCT FROM w->>'messageReference'
 OR i.sender_ediel_id IS DISTINCT FROM w#>>'{transportSender,0}' OR i.receiver_ediel_id IS DISTINCT FROM w#>>'{transportReceiver,0}'
 OR i.communication_route_id IS NULL OR i.route_profile_id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_intent_scope_required';END IF;
 SELECT * INTO o FROM gridex_received_sources.prodat_recovery_origins WHERE operation_id=op.id FOR UPDATE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=coalesce(o.outbound_request_id,p_outbound_request_id) FOR SHARE;
 IF r.id IS NULL OR r.company_id IS DISTINCT FROM p_company_id OR r.customer_id IS DISTINCT FROM m.customer_id OR r.environment IS DISTINCT FROM op.environment OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id::text IS DISTINCT FROM i.id::text OR r.request_type IS DISTINCT FROM request_type THEN RAISE EXCEPTION 'prodat_recovery_owned_request_required';END IF;
 IF o.operation_id IS NOT NULL THEN
  IF o.company_id IS DISTINCT FROM p_company_id OR o.intent_id IS DISTINCT FROM i.id THEN RAISE EXCEPTION 'prodat_recovery_origin_conflict';END IF;
  RETURN jsonb_build_object('status','reserved','intentId',o.intent_id,'outboundRequestId',o.outbound_request_id,'messageId',(SELECT message_id FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=op.id));
 END IF;
 IF EXISTS(SELECT FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=op.id) THEN RAISE EXCEPTION 'prodat_recovery_legacy_bound_origin_held';END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_origins(operation_id,company_id,intent_id,outbound_request_id,actor_user_id) VALUES(op.id,p_company_id,i.id,p_outbound_request_id,p_actor_user_id);
 RETURN jsonb_build_object('status','reserved','intentId',i.id,'outboundRequestId',p_outbound_request_id,'messageId',null);
END $$;
-- The same actual native sent receipt survives its positive ACK projection.
CREATE OR REPLACE FUNCTION gridex_received_sources.apply_supply_before_legal_context_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;sp public.customer_supply_periods%rowtype;sw public.supplier_switch_requests%rowtype;origin public.ediel_messages%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;ground gridex_received_sources.regulated_supply_ground_versions%rowtype;
 wire jsonb;original jsonb;own jsonb;entry jsonb;plan jsonb;plans jsonb:='[]';before_states jsonb:='[]';after_states jsonb;old jsonb;
 ids uuid[];point public.metering_points%rowtype;consumption public.metering_points%rowtype;legal_actor uuid;dso_actor uuid;
 event_at timestamptz;start_at timestamptz;reason text;period_id uuid;expected_version bigint;qualified boolean;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_source_unavailable');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN RETURN jsonb_build_object('applied',false,'reason','supply_execution_actor_unqualified');END IF;
 SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM m.company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'supply_replay_conflict';END IF;RETURN jsonb_build_object('applied',true,'idempotent',true,'periods',prior.resulting_states);END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','canonical_supply_source_not_accepted');END IF;
 wire:=gridex_received_sources.supply_wire_v1(m.raw_payload);
 IF wire IS NULL OR (wire->>'code' IN ('Z04','Z05')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_wire_unavailable');END IF;
 -- No mixed physical subtype, duplicate point, or partially applied message.
 SELECT o->>'reason' INTO reason FROM jsonb_array_elements(wire->'objects') o LIMIT 1;
 IF nullif(reason,'') IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IS DISTINCT FROM reason OR nullif(o->>'point','') IS NULL OR nullif(o->>'li','') IS NULL)
 OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects') o)<>jsonb_array_length(wire->'objects') THEN RETURN jsonb_build_object('applied',false,'reason','supply_object_scope_unqualified');END IF;
 PERFORM tp.id FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment ORDER BY tp.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=m.company_id AND i.environment=m.environment ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=m.company_id AND r.environment=m.environment ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment AND tp.market='electricity' AND tp.is_enabled AND tp.valid_from<=m.message_received_at AND (tp.valid_to IS NULL OR m.message_received_at<tp.valid_to)) THEN RETURN jsonb_build_object('applied',false,'reason','supply_tenant_profile_unqualified');END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.tenant_actor_identifiers i JOIN public.tenant_actor_roles r ON r.company_id=i.company_id AND r.environment=i.environment AND r.actor_id=i.actor_id
 WHERE i.company_id=m.company_id AND i.environment=m.environment AND i.identifier_type='EdielId' AND i.identifier_value=wire->>'receiver' AND i.valid_from<=m.message_received_at AND (i.valid_to IS NULL OR m.message_received_at<i.valid_to)
 AND r.role_code='electricity_supplier' AND r.valid_from<=m.message_received_at AND (r.valid_to IS NULL OR m.message_received_at<r.valid_to);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','supply_legal_actor_unqualified');END IF;legal_actor:=ids[1];
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects') o ORDER BY o->>'point' LOOP
  event_at:=gridex_received_sources.permission_time_v1(own->>CASE WHEN wire->>'code'='Z04' THEN 'start' ELSE 'end' END);
  IF event_at IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_effective_time_unavailable');END IF;
  IF wire->>'code'='Z04' AND reason IN ('Z26','Z70') THEN
   SELECT array_agg(mp.id ORDER BY mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_area_code=own->>'gridArea' AND mp.grid_owner_ediel_id=wire->>'sender'
    AND mp.customer_id IS NOT NULL AND (m.customer_id IS NULL OR m.customer_id=mp.customer_id) AND (m.metering_point_id IS NULL OR m.metering_point_id=mp.id);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_exact_object_unavailable');END IF;
   SELECT * INTO point FROM public.metering_points WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   PERFORM customer.id FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id FOR SHARE;
   IF NOT EXISTS(SELECT FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id AND own->>'customerIdentity'=coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),''))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_customer_identity_unqualified');END IF;
   PERFORM ai.id FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' ORDER BY ai.id FOR SHARE;
   SELECT array_agg(DISTINCT ai.actor_id) INTO ids FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' AND ai.is_verified AND (ai.valid_from IS NULL OR ai.valid_from<=(m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date) AND (ai.valid_to IS NULL OR (m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date<=ai.valid_to);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_dso_registry_unavailable');END IF;dso_actor:=ids[1];
   PERFORM ba.id FROM public.tenant_bilateral_agreements ba WHERE ba.company_id=m.company_id AND ba.environment=m.environment AND ba.counterparty_actor_id=dso_actor ORDER BY ba.id FOR SHARE;
   PERFORM g.id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' ORDER BY g.id FOR SHARE;
   SELECT array_agg(g.id ORDER BY g.id) INTO ids FROM gridex_received_sources.regulated_supply_ground_versions g JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
   WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' AND g.process=CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END
    AND g.approved_at<=m.message_received_at AND g.revoked_at IS NULL AND g.valid_from<=event_at AND (g.valid_to IS NULL OR event_at<g.valid_to) AND ba.is_enabled AND ba.valid_from<=event_at AND (ba.valid_to IS NULL OR event_at<ba.valid_to) AND ba.source_reference=g.source_reference;
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_authentic_ground_required');END IF;
   SELECT * INTO ground FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ids[1] FOR SHARE;
   IF reason='Z70' THEN
    SELECT cp.* INTO consumption FROM public.customer_supply_periods rel JOIN public.metering_points cp ON cp.id=rel.metering_point_id AND cp.company_id=rel.company_id JOIN public.customer_contracts cc ON cc.id=coalesce(rel.customer_contract_id,rel.contract_id) AND cc.company_id=rel.company_id AND cc.customer_id=rel.customer_id
    WHERE rel.id=ground.consumption_supply_period_id AND rel.company_id=m.company_id AND rel.customer_id=point.customer_id AND cp.ediel_metering_point_id=own->>'consumptionPoint' AND cp.product_direction='consumption' AND cc.energy_direction='consumption' AND cc.status IN ('signed','active') AND rel.status IN ('active','confirmed_by_grid_owner')
    AND rel.start_date<=gridex_received_sources.permission_date_v1(own->>'start') AND (rel.end_date IS NULL OR rel.end_date>gridex_received_sources.permission_date_v1(own->>'start')) FOR SHARE OF rel,cp,cc;
    IF NOT FOUND OR point.product_direction IS DISTINCT FROM 'production' THEN RETURN jsonb_build_object('applied',false,'reason','production_obligation_own_consumption_link_required');END IF;
   END IF;
   IF EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=point.id AND p.status NOT IN ('cancelled','ended') AND (p.end_date IS NULL OR p.end_date>gridex_received_sources.permission_date_v1(own->>'start'))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_conflicting_period');END IF;
   period_id:=gen_random_uuid();plans:=plans||jsonb_build_array(jsonb_build_object('kind','regulated','periodId',period_id,'pointId',point.id,'customerId',point.customer_id,'eventAt',event_at,'groundId',ground.id,'object',own));
  ELSIF wire->>'code'='Z04' AND reason='Z24' THEN
   -- Match every cancellation to its sealed, actually sent original Z03.
   SELECT array_agg(s.id ORDER BY s.id) INTO ids FROM public.supplier_switch_requests s JOIN public.ediel_messages z ON z.id=s.outbound_z03_message_id AND z.company_id=s.company_id AND z.environment=m.environment
    WHERE s.company_id=m.company_id AND z.direction='outbound' AND gridex_received_sources.sent_source_is_current_v1(z)
    AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.supply_wire_v1(z.raw_payload)->'objects') o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'sender'=wire->>'receiver' AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'receiver'=wire->>'sender';
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_exact_original_unavailable');END IF;
   SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO origin FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);
   IF NOT FOUND OR origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE
    OR original IS NULL OR original->>'code' IS DISTINCT FROM 'Z03' OR original->>'sender' IS DISTINCT FROM wire->>'receiver' OR original->>'receiver' IS DISTINCT FROM wire->>'sender'
    OR origin.customer_id IS DISTINCT FROM sw.customer_id OR origin.metering_point_id IS DISTINCT FROM sw.metering_point_id OR (m.customer_id IS NOT NULL AND m.customer_id<>sw.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sw.metering_point_id)
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    THEN RETURN jsonb_build_object('applied',false,'reason','z04c_locked_original_mismatch');END IF;
   IF (sw.status IN ('draft','prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancelled_before_start')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.source_switch_request_id=sw.id OR p.source_message_id=sw.inbound_z04_message_id);
   IF coalesce(cardinality(ids),0)>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_conflicting_periods');END IF;
   IF coalesce(cardinality(ids),0)=1 THEN
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
    IF sp.status IS DISTINCT FROM 'confirmed_by_grid_owner' OR sp.customer_id IS DISTINCT FROM sw.customer_id OR sp.metering_point_id IS DISTINCT FROM sw.metering_point_id OR sp.start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'start') OR coalesce(sp.market_start_at,sp.start_date::timestamp AT TIME ZONE 'Etc/GMT-1')<=now() THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    before_states:=before_states||jsonb_build_array(to_jsonb(sp));period_id:=sp.id;
   ELSE period_id:=NULL;END IF;
   plans:=plans||jsonb_build_array(jsonb_build_object('kind','cancel_start','periodId',period_id,'switchId',sw.id,'object',own));
  ELSIF wire->>'code'='Z05' AND reason='Z24' THEN
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id
    JOIN public.ediel_messages z ON z.id=tr.source_message_id AND z.company_id=tr.company_id AND z.environment=m.environment
    WHERE p.company_id=m.company_id AND z.direction='inbound' AND tr.payload_hash=encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'sender'=wire->>'sender' AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'receiver'=wire->>'receiver'
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'end'=own->>'end')
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND (state->>'market_state_version')::bigint=p.market_state_version AND (state-ARRAY['updated_at','status'])=(to_jsonb(p)-ARRAY['updated_at','status']));
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05c_exact_original_ending_unavailable');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=sp.source_end_message_id AND company_id=m.company_id;
   SELECT state INTO old FROM jsonb_array_elements(prior.previous_states) state WHERE state->>'id'=sp.id::text;
   IF old IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE saved->>'id'=sp.id::text AND (sp.status=saved->>'status' OR sp.status='ended' AND saved->>'status'='ending' AND sp.market_end_at<=now())) OR EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=sp.metering_point_id AND p.id<>sp.id AND p.status NOT IN ('ended','cancelled') AND (p.end_date IS NULL OR p.end_date>sp.start_date)) THEN RETURN jsonb_build_object('applied',false,'reason','z05c_conflicting_continuation');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','restore_end','periodId',sp.id,'previous',old,'object',own));
  ELSIF wire->>'code'='Z05' AND reason IN ('Z22','Z23') THEN
   -- Actual accepted baseline owner ties the physical object to a relationship;
   -- a unique local row or DATE similarity is never sufficient authority.
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
    WHERE p.company_id=m.company_id AND p.status IN ('active','confirmed_by_grid_owner','ending') AND p.source_end_message_id IS NULL AND (
     EXISTS(SELECT FROM gridex_received_sources.object_assessments assessment JOIN gridex_received_sources.sources src ON src.source_message_id=assessment.source_message_id AND src.company_id=assessment.company_id AND src.payload_hash=assessment.source_payload_hash
      JOIN public.ediel_messages base ON base.id=src.source_message_id AND base.company_id=src.company_id AND base.environment=src.environment AND base.direction='inbound' AND src.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
      CROSS JOIN LATERAL jsonb_array_elements(assessment.facts_text::jsonb->'objects') object
      WHERE assessment.company_id=p.company_id AND assessment.environment=m.environment AND assessment.source_message_id=p.source_message_id
       AND object->>'disposition'='accepted' AND object#>>'{object,objectId}'=own->>'point' AND object#>>'{object,identityAgency}'='9'
       AND object#>>'{business,supplyPeriodId}'=p.id::text AND object#>>'{business,customerId}'=p.customer_id::text AND object#>>'{business,meteringPointId}'=p.metering_point_id::text
       AND object#>>'{business,owner}' IN ('inbound-z04-switch-confirmation-v1','reviewed-received-structure-v1')
       AND object#>>'{party,parties,legalSender}'=wire->>'sender' AND object#>>'{party,parties,legalReceiver}'=wire->>'receiver'
       AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=assessment.id))
     OR EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr JOIN public.ediel_messages base ON base.id=tr.source_message_id AND base.company_id=tr.company_id AND base.environment=m.environment AND base.direction='inbound'
      WHERE tr.company_id=p.company_id AND tr.source_message_id=p.source_message_id AND tr.source_code='Z04' AND tr.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND state->>'customer_id'=p.customer_id::text AND state->>'metering_point_id'=p.metering_point_id::text)
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) object WHERE object->>'point'=own->>'point' AND object->>'customerIdentity'=own->>'customerIdentity' AND object->>'gridArea'=own->>'gridArea' AND object->>'reason' IN ('Z26','Z70')))
    );
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05_accepted_relationship_baseline_required');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO origin FROM public.ediel_messages WHERE id=sp.source_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);
   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04' OR original->>'sender' IS DISTINCT FROM wire->>'sender' OR original->>'receiver' IS DISTINCT FROM wire->>'receiver'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at)
    OR (m.customer_id IS NOT NULL AND m.customer_id<>sp.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sp.metering_point_id) THEN RETURN jsonb_build_object('applied',false,'reason','z05_original_object_mismatch');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','end','periodId',sp.id,'eventAt',event_at,'object',own));
  ELSE RETURN jsonb_build_object('applied',false,'reason','supply_profile_not_qualified');END IF;
 END LOOP;
 -- All owned objects, current originals and ground records are locked/qualified.
 FOR plan IN SELECT x FROM jsonb_array_elements(plans) x LOOP
  IF plan->>'kind'='regulated' THEN
   INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,market_start_at,source,source_process,source_message_id,status,market_state_version,metadata)
    VALUES((plan->>'periodId')::uuid,m.company_id,(plan->>'customerId')::uuid,(plan->>'pointId')::uuid,gridex_received_sources.permission_date_v1(plan#>>'{object,start}'),(plan->>'eventAt')::timestamptz,'ediel_qualified_source',CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END,m.id,'confirmed_by_grid_owner',1,jsonb_build_object('sourceGroundId',plan->>'groundId','sourceObject',plan->'object','sourceReceivedAt',m.message_received_at));
  ELSIF plan->>'kind'='cancel_start' THEN
   UPDATE public.supplier_switch_requests SET status='cancelled_before_start',inbound_z04_message_id=m.id,completed_at=now(),updated_at=now() WHERE id=(plan->>'switchId')::uuid AND company_id=m.company_id;
   UPDATE public.customer_supply_periods SET status='cancelled',market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('startCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='end' THEN
   UPDATE public.customer_supply_periods SET end_date=gridex_received_sources.permission_date_v1(plan#>>'{object,end}'),market_end_at=(plan->>'eventAt')::timestamptz,source_end_message_id=m.id,status=CASE WHEN (plan->>'eventAt')::timestamptz<=now() THEN 'ended' ELSE 'ending' END,market_state_version=market_state_version+1,updated_at=now() WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='restore_end' THEN
   UPDATE public.customer_supply_periods SET status=plan#>>'{previous,status}',end_date=(plan#>>'{previous,end_date}')::date,market_end_at=(plan#>>'{previous,market_end_at}')::timestamptz,source_end_message_id=(plan#>>'{previous,source_end_message_id}')::uuid,market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('endCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) INTO after_states FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.id IN (SELECT (plan->>'periodId')::uuid FROM jsonb_array_elements(plans) plan);
 INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),wire->>'code',wire->'objects',before_states,after_states,ARRAY(SELECT (plan->>'switchId')::uuid FROM jsonb_array_elements(plans) plan WHERE plan->>'kind'='cancel_start'),p_actor_user_id);
 RETURN jsonb_build_object('applied',true,'periods',after_states,'regulated',wire->>'code'='Z04' AND reason IN ('Z26','Z70'));
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.apply_supply_before_legal_context_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
