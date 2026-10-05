-- Exact initial approved scope remains locked and hash-bound even after later
-- accepted closure transitions. The provider observation supplies its own clock.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_received_sources.supply_period_source_basis_v1(p_company_id uuid,p_period_id uuid,p_start timestamptz,p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.customer_supply_periods%rowtype;proof gridex_received_sources.normal_switch_confirmations%rowtype;
 tr gridex_received_sources.supply_source_transitions%rowtype;activation gridex_received_sources.normal_supply_activations%rowtype;
 m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;initial_message public.ediel_messages%rowtype;c public.customer_contracts%rowtype;s public.supplier_switch_requests%rowtype;
 expected jsonb;baseline jsonb;legal jsonb;initial_owned jsonb;source_objects jsonb;initial_wire jsonb;accepted_original jsonb;initial_transition gridex_received_sources.supply_source_transitions%rowtype;ids uuid[];version bigint;source_id uuid;
BEGIN
 IF p_company_id IS NULL OR p_period_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=p.id AND company_id=p_company_id;
 IF NOT FOUND THEN
  baseline:=gridex_received_sources.billing_supply_before_normal_switch_v1(p_company_id,p_period_id,p_start,p_end);
  IF baseline IS NULL THEN RETURN NULL;END IF;
  SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
  IF p.market_state_version IS DISTINCT FROM (baseline->>'marketStateVersion')::bigint THEN RETURN NULL;END IF;
  SELECT own#>'{metadata,sourceObject}' INTO initial_owned FROM gridex_received_sources.supply_source_transitions initial,jsonb_array_elements(initial.resulting_states) own WHERE initial.source_message_id=p.source_message_id AND initial.company_id=p_company_id AND own->>'id'=p.id::text;
  SELECT * INTO origin FROM public.ediel_messages WHERE id=p.source_message_id AND company_id=p_company_id;
  SELECT jsonb_agg(own) INTO source_objects FROM jsonb_array_elements(gridex_received_sources.normal_switch_wire_v1(origin.raw_payload)->'objects') own WHERE own->>'point'=initial_owned->>'point' AND own->>'li'=initial_owned->>'li' AND own->>'start'=initial_owned->>'start';
  IF jsonb_array_length(source_objects) IS DISTINCT FROM 1 OR (source_objects#>>'{0,identityAgency}' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
  RETURN baseline||jsonb_build_object('initialSourceMessageId',p.source_message_id,'legalActorId',(SELECT g.legal_actor_id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.id::text=baseline->>'groundId' AND g.company_id=p_company_id),'sourceObjects',source_objects,'dsoEdielId',gridex_received_sources.normal_switch_wire_v1(origin.raw_payload)->>'sender');
 END IF;
 version:=p.market_state_version;source_id:=p.source_message_id;
 SELECT array_agg(t.source_message_id) INTO ids FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) own WHERE own->>'id'=p.id::text AND (own->>'market_state_version')::bigint=version);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ARRAY[ids[1],source_id,proof.source_message_id,proof.original_message_id]) ORDER BY z.id FOR UPDATE;
 legal:=gridex_ediel_inbound_context.require_v1(p_company_id,proof.source_message_id);
 SELECT * INTO initial_message FROM public.ediel_messages WHERE id=proof.source_message_id AND company_id=p_company_id;
 SELECT * INTO initial_transition FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=proof.source_message_id AND company_id=p_company_id;
 initial_wire:=gridex_received_sources.normal_switch_wire_v1(initial_message.raw_payload);
 IF initial_message.direction IS DISTINCT FROM 'inbound' OR initial_message.message_family IS DISTINCT FROM 'PRODAT' OR initial_message.message_code IS DISTINCT FROM 'Z04'
  OR initial_transition.payload_hash IS DISTINCT FROM encode(sha256(convert_to(initial_message.raw_payload,'UTF8')),'hex')
  OR initial_wire->>'receiver' IS DISTINCT FROM proof.legal_context->>'legalEdielId' OR nullif(initial_wire->>'sender','') IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(initial_wire->'objects') own WHERE own=proof.source_object)<>1
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=initial_message.id AND v.company_id=p_company_id AND v.environment=initial_message.environment AND v.source_payload_hash=initial_transition.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=proof.switch_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id FOR SHARE;
 IF p.market_state_version IS DISTINCT FROM version OR p.source_message_id IS DISTINCT FROM source_id OR p.source_message_id IS DISTINCT FROM proof.source_message_id OR p.source_switch_request_id IS DISTINCT FROM proof.switch_id
  OR p.customer_id IS DISTINCT FROM (proof.confirmed_period->>'customer_id')::uuid OR p.metering_point_id IS DISTINCT FROM (proof.confirmed_period->>'metering_point_id')::uuid
  OR p.market_start_at IS DISTINCT FROM proof.market_start_at OR p.market_start_at>p_start OR (p.market_end_at IS NOT NULL AND p_end>p.market_end_at)
  OR (p.status IN('confirmed_by_grid_owner','active','ending','ended')) IS NOT TRUE OR s.inbound_z04_message_id IS DISTINCT FROM proof.source_message_id OR s.outbound_z03_message_id IS DISTINCT FROM proof.original_message_id
  OR s.customer_id IS DISTINCT FROM p.customer_id OR s.metering_point_id IS DISTINCT FROM p.metering_point_id OR s.lifecycle_blocked THEN RETURN NULL;END IF;
 SELECT * INTO tr FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=ids[1] AND company_id=p_company_id;
 SELECT * INTO m FROM public.ediel_messages WHERE id=tr.source_message_id AND company_id=p_company_id;
 SELECT own INTO expected FROM jsonb_array_elements(tr.resulting_states) own WHERE own->>'id'=p.id::text;
 SELECT * INTO activation FROM gridex_received_sources.normal_supply_activations WHERE period_id=p.id AND company_id=p_company_id;
 baseline:=CASE WHEN activation.period_id IS NOT NULL AND tr.source_message_id=proof.source_message_id THEN activation.resulting_period ELSE expected END;
 IF expected IS NULL OR baseline IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR (to_jsonb(p)-ARRAY['updated_at','status']) IS DISTINCT FROM (baseline-ARRAY['updated_at','status'])
  OR (p.status IS DISTINCT FROM baseline->>'status' AND NOT(p.status='ended' AND baseline->>'status'='ending' AND p.market_end_at<=now()))
  OR (s.status IS DISTINCT FROM proof.confirmed_switch->>'status' AND NOT(s.status='completed' AND activation.period_id IS NOT NULL)) THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=proof.original_message_id AND company_id=p_company_id AND environment=m.environment;
 SELECT * INTO c FROM public.customer_contracts WHERE id=proof.contract_id AND company_id=p_company_id FOR SHARE;
 IF origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE OR origin.immutable_payload_hash IS DISTINCT FROM proof.original_payload_hash OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
  OR c.id IS NULL OR c.customer_id IS DISTINCT FROM p.customer_id OR c.metering_point_id IS DISTINCT FROM p.metering_point_id OR (c.status IN('signed','active')) IS NOT TRUE OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM proof.protected_contract_hash
  OR legal->>'legalActorId' IS DISTINCT FROM proof.legal_context->>'legalActorId' OR legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier'
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=tr.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 accepted_original:=gridex_ediel_transport.accepted_source_basis_v1(origin);
 IF accepted_original IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('qualified',true,'periodId',p.id,'companyId',p.company_id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'siteId',coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id'),'switchId',proof.switch_id,
  'sourceMessageId',m.id,'initialSourceMessageId',proof.source_message_id,'currentSourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,
  'legalActorId',proof.legal_context->>'legalActorId','sourceObjects',jsonb_build_array(proof.source_object),'dsoEdielId',initial_wire->>'sender','originalMessageId',origin.id,'originalPayloadHash',origin.immutable_payload_hash,'originalAcceptedAt',accepted_original->>'observedAt','activated',activation.period_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
