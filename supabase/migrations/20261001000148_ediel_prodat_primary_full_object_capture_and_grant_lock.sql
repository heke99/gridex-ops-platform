-- Prospective primary-owner capture. Prior v2 assessments retain UNKNOWN full
-- object qualification; a secondary service caller cannot add or promote it.
BEGIN;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_object_validation_v1(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.append_prodat_validation_v3(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_object_facts_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;facet_receipt jsonb;assessment_id uuid;
BEGIN
 receipt:=gridex_received_sources.append_prodat_validation_v2(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text);
 assessment_id:=(receipt->>'assessmentId')::uuid;
 IF p_object_facts_text IS NOT NULL THEN
  facet_receipt:=public.gridex_record_prodat_object_validation_v1(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,assessment_id,p_object_facts_text);
  IF facet_receipt->>'assessmentId' IS DISTINCT FROM assessment_id::text OR facet_receipt->>'companyId' IS DISTINCT FROM p_company_id::text
   OR facet_receipt->>'environment' IS DISTINCT FROM p_environment OR facet_receipt->>'sourceMessageId' IS DISTINCT FROM p_source_message_id::text
   OR facet_receipt->>'sourcePayloadHash' IS DISTINCT FROM p_source_payload_hash
   OR facet_receipt->>'objectFactsHash' IS DISTINCT FROM encode(sha256(convert_to(p_object_facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_primary_object_receipt_required';END IF;
 END IF;
 RETURN receipt||jsonb_build_object('version',3,'objectFactsHash',facet_receipt->>'objectFactsHash');
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.append_prodat_validation_v3(uuid,text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.append_prodat_validation_v3(uuid,text,uuid,text,text,text,text) TO service_role;
CREATE FUNCTION public.gridex_record_prodat_source_validation_v3(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text,p_ignored_fields_text text,p_object_facts_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_received_sources.append_prodat_validation_v3(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text,p_ignored_fields_text,p_object_facts_text);
END $$;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_source_validation_v3(uuid,text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_record_prodat_source_validation_v3(uuid,text,uuid,text,text,text,text) TO service_role;
-- Existing grant rows AND concurrent graph mutations are serialized. These
-- SHARE table locks are the same authorization prefix/order as ACK replay v2.
-- No message, metering point, switch or supply period is locked first.
CREATE FUNCTION gridex_received_sources.lock_prodat_execution_actor_graph_v1() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.admin_users,public.user_roles,public.roles,public.role_permissions,public.permissions,public.user_permissions IN SHARE MODE;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.lock_prodat_execution_actor_graph_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_received_sources.normal_switch_confirm_mixed_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;original public.ediel_messages%rowtype;sw public.supplier_switch_requests%rowtype;
 point public.metering_points%rowtype;site public.customer_sites%rowtype;contract public.customer_contracts%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;
 wire jsonb;oldwire jsonb;own jsonb;basis jsonb;plans jsonb:='[]';plan jsonb;after_states jsonb;before_switches jsonb:='[]';period public.customer_supply_periods%rowtype;
 guide gridex_received_sources.prodat_object_validation_facets%rowtype;mixed_receipt gridex_received_sources.prodat_mixed_object_receipts%rowtype;whole_wire jsonb;guides jsonb;result jsonb;
 ids uuid[];original_ids uuid[];switch_ids uuid[]:=ARRAY[]::uuid[];pid uuid;event_at timestamptz;customer_identity text;
BEGIN
 PERFORM gridex_received_sources.lock_prodat_execution_actor_graph_v1();
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z04' THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_source_required');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write') IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_execution_actor_required');END IF;
 PERFORM gridex_ediel_inbound_context.require_v1(m.company_id,m.id);PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
 SELECT * INTO mixed_receipt FROM gridex_received_sources.prodat_mixed_object_receipts WHERE source_message_id=m.id FOR SHARE;
 IF FOUND THEN
  IF mixed_receipt.company_id IS DISTINCT FROM m.company_id OR mixed_receipt.environment IS DISTINCT FROM m.environment OR mixed_receipt.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_mixed_replay_conflict';END IF;
  IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments a JOIN gridex_received_sources.prodat_object_validation_facets f ON f.assessment_id=a.id AND f.source_payload_hash=a.source_payload_hash AND f.facts_hash=mixed_receipt.object_facts_hash AND a.facts_hash=(SELECT initial.facts_hash FROM gridex_received_sources.validation_assessments initial WHERE initial.id=mixed_receipt.assessment_id)
   WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=mixed_receipt.source_payload_hash
   AND a.facts_text::jsonb->>'syntaxDecision'='accepted' AND a.facts_text::jsonb->>'applicationDecision'='rejected' AND a.facts_text::jsonb->>'functionalDecision'='accepted'
   AND f.facts_text::jsonb->>'sharedAccepted'='true' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)) THEN RETURN jsonb_build_object('applied',false,'reason','prodat_mixed_current_guide_changed');END IF;
  RETURN mixed_receipt.result||jsonb_build_object('idempotent',true);
 END IF;
 SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id;
 IF FOUND THEN RETURN jsonb_build_object('applied',false,'reason','prodat_mixed_existing_other_source_transition');END IF;
 basis:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
 IF basis->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR basis->>'code' IS DISTINCT FROM 'Z04' OR basis->>'family' IS DISTINCT FROM 'PRODAT' THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_frozen_legal_context_required');END IF;
 IF (SELECT count(*) FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id))<>1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_canonical_leaf_ambiguous');END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'rejected' OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR canonical.facts_text::jsonb#>>'{registerValidation,owner}' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR canonical.facts_text::jsonb#>>'{registerValidation,coverage}' IS DISTINCT FROM 'canonical_register_only'
  OR jsonb_typeof(canonical.facts_text::jsonb#>'{registerValidation,objects}') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_canonical_source_not_accepted');END IF;
 SELECT * INTO guide FROM gridex_received_sources.prodat_object_validation_facets WHERE assessment_id=canonical.id AND company_id=m.company_id AND environment=m.environment AND source_message_id=m.id AND source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') FOR SHARE;
 IF NOT FOUND OR guide.facts_text::jsonb->>'sharedAccepted' IS DISTINCT FROM 'true' OR EXISTS(SELECT FROM jsonb_array_elements(guide.facts_text::jsonb->'objects') o WHERE o->>'disposition'='unavailable') OR NOT EXISTS(SELECT FROM jsonb_array_elements(guide.facts_text::jsonb->'objects') o WHERE o->>'disposition'='accepted') OR NOT EXISTS(SELECT FROM jsonb_array_elements(guide.facts_text::jsonb->'objects') o WHERE o->>'disposition'='rejected') THEN RETURN jsonb_build_object('applied',false,'reason','prodat_mixed_full_own_guides_required');END IF;
 guides:=guide.facts_text::jsonb->'objects';whole_wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF whole_wire IS NULL OR jsonb_array_length(whole_wire->'objects') IS DISTINCT FROM jsonb_array_length(guides) OR EXISTS(SELECT FROM jsonb_array_elements(guides) g WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(whole_wire->'objects') o WHERE o->>'point'=g->>'objectId' AND o->>'identityAgency'=g->>'identityAgency' AND o->>'li'=g->>'lineItemReference')) THEN RETURN jsonb_build_object('applied',false,'reason','prodat_mixed_whole_physical_scope_required');END IF;
 wire:=whole_wire||jsonb_build_object('objects',(SELECT jsonb_agg(o ORDER BY o->>'point') FROM jsonb_array_elements(whole_wire->'objects') o WHERE EXISTS(SELECT FROM jsonb_array_elements(guides) g WHERE g->>'objectId'=o->>'point' AND g->>'identityAgency'=o->>'identityAgency' AND g->>'disposition'='accepted')));

 IF wire IS NULL OR wire->>'receiver' IS DISTINCT FROM basis->>'legalEdielId' OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE (o->>'reason' IN('Z22','Z23')) IS NOT TRUE OR (o->>'identityAgency' IN('9','89')) IS NOT TRUE OR nullif(o->>'li','') IS NULL OR nullif(o->>'customerIdentity','') IS NULL OR gridex_received_sources.permission_time_v1(o->>'start') IS NULL)
  OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects') o)<>jsonb_array_length(wire->'objects')
  OR jsonb_array_length(canonical.facts_text::jsonb#>'{registerValidation,objects}')<>jsonb_array_length(whole_wire->'objects') THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_whole_physical_scope_required');END IF;
 -- Discover all original rows first. No switch/period is locked before its
 -- original, so confirmation, cancellation and future activation share order.
 SELECT array_agg(DISTINCT s.outbound_z03_message_id ORDER BY s.outbound_z03_message_id) INTO original_ids FROM public.supplier_switch_requests s
 WHERE s.company_id=m.company_id AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE s.rff_li_reference=o->>'li');
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=m.company_id AND z.id=ANY(original_ids) ORDER BY z.id FOR SHARE;
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects') o ORDER BY o->>'point' LOOP
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(canonical.facts_text::jsonb#>'{registerValidation,objects}') o WHERE o->>'disposition'='accepted' AND o->>'messageIndex'='0' AND o->>'objectId'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND jsonb_array_length(o->'registers')=(own->>'registerCount')::integer) THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_register_owner_scope_required');END IF;
  SELECT array_agg(s.id ORDER BY s.id) INTO ids FROM public.supplier_switch_requests s JOIN public.ediel_messages z ON z.id=s.outbound_z03_message_id AND z.company_id=s.company_id AND z.environment=m.environment
   WHERE s.company_id=m.company_id AND s.rff_li_reference=own->>'li' AND z.direction='outbound' AND z.message_family='PRODAT' AND z.message_code='Z03' AND gridex_received_sources.sent_source_is_current_v1(z)
    AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'sender'=wire->>'receiver' AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'receiver'=wire->>'sender'
    AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->'objects') o WHERE o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason'=own->>'reason' AND (o->>'point' IS NULL OR o->>'point'=own->>'point'));
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_exact_sent_original_required');END IF;
  SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
  SELECT * INTO original FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
  oldwire:=gridex_received_sources.normal_switch_wire_v1(original.raw_payload);
  IF original.direction IS DISTINCT FROM 'outbound' OR original.message_family IS DISTINCT FROM 'PRODAT' OR original.message_code IS DISTINCT FROM 'Z03' OR gridex_received_sources.sent_source_is_current_v1(original) IS NOT TRUE
   OR original.customer_id IS DISTINCT FROM sw.customer_id OR original.metering_point_id IS DISTINCT FROM sw.metering_point_id OR oldwire->>'sender' IS DISTINCT FROM wire->>'receiver' OR oldwire->>'receiver' IS DISTINCT FROM wire->>'sender'
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(oldwire->'objects') o WHERE o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason'=own->>'reason' AND (o->>'point' IS NULL OR o->>'point'=own->>'point'))
   OR (sw.status IN('prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation')) IS NOT TRUE OR sw.lifecycle_blocked
   OR sw.id=ANY(switch_ids) OR (m.customer_id IS NOT NULL AND m.customer_id IS DISTINCT FROM sw.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id IS DISTINCT FROM sw.metering_point_id) THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_locked_original_scope_required');END IF;
  SELECT * INTO point FROM public.metering_points WHERE id=sw.metering_point_id AND company_id=m.company_id FOR UPDATE;
  SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(sw.site_id,sw.customer_site_id) AND company_id=m.company_id FOR SHARE;
  SELECT * INTO contract FROM public.customer_contracts WHERE id=coalesce(sw.contract_id,sw.customer_contract_id) AND company_id=m.company_id FOR SHARE;
  PERFORM c.id FROM public.customers c WHERE c.id=sw.customer_id AND c.company_id=m.company_id FOR SHARE;
  SELECT coalesce(nullif(btrim(c.org_number),''),nullif(btrim(c.personal_number),'')) INTO customer_identity FROM public.customers c WHERE c.id=sw.customer_id AND c.company_id=m.company_id;
  IF point.id IS NULL OR site.id IS NULL OR contract.id IS NULL OR point.ediel_metering_point_id IS DISTINCT FROM own->>'point' OR point.customer_id IS DISTINCT FROM sw.customer_id OR point.site_id IS DISTINCT FROM site.id OR site.customer_id IS DISTINCT FROM sw.customer_id OR own->>'customerIdentity' IS DISTINCT FROM customer_identity
   OR (sw.site_id IS NOT NULL AND sw.site_id IS DISTINCT FROM site.id) OR (sw.customer_site_id IS NOT NULL AND sw.customer_site_id IS DISTINCT FROM site.id) OR (sw.contract_id IS NOT NULL AND sw.contract_id IS DISTINCT FROM contract.id) OR (sw.customer_contract_id IS NOT NULL AND sw.customer_contract_id IS DISTINCT FROM contract.id)
   OR point.grid_owner_ediel_id IS DISTINCT FROM wire->>'sender' OR point.grid_area_code IS DISTINCT FROM own->>'gridArea' OR contract.customer_id IS DISTINCT FROM sw.customer_id OR contract.metering_point_id IS DISTINCT FROM point.id
   OR (contract.status IN('signed','active')) IS NOT TRUE OR contract.signed_at IS NULL OR nullif(contract.signed_version,'') IS NULL OR nullif(contract.contract_version,'') IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_owned_signed_contract_scope_required');END IF;
  event_at:=gridex_received_sources.permission_time_v1(own->>'start');
  IF EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=point.id AND p.status NOT IN('cancelled','ended') AND (p.market_end_at IS NULL OR p.market_end_at>event_at)) THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_conflicting_supply_period');END IF;
  pid:=gen_random_uuid();switch_ids:=array_append(switch_ids,sw.id);before_switches:=before_switches||jsonb_build_array(to_jsonb(sw));
  plans:=plans||jsonb_build_array(jsonb_build_object('periodId',pid,'switchId',sw.id,'pointId',point.id,'siteId',site.id,'customerId',sw.customer_id,'contractId',contract.id,'contractHash',gridex_received_sources.production_contract_hash_v1(contract),'originalId',original.id,'originalHash',original.immutable_payload_hash,'eventAt',event_at,'object',own));
 END LOOP;
 -- Every required source, original and owned relationship is qualified before
 -- the first market write; any downstream effect failure rolls back all scopes.
 FOR plan IN SELECT p FROM jsonb_array_elements(plans) p LOOP
  UPDATE public.supplier_switch_requests SET status='accepted',site_id=(plan->>'siteId')::uuid,inbound_z04_message_id=m.id,confirmed_start_date=gridex_received_sources.permission_date_v1(plan#>>'{object,start}'),updated_at=now(),updated_by=p_actor_user_id WHERE id=(plan->>'switchId')::uuid AND company_id=m.company_id;
  INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,market_start_at,source,source_process,source_message_id,source_switch_request_id,status,market_state_version,metadata)
   VALUES((plan->>'periodId')::uuid,m.company_id,(plan->>'customerId')::uuid,(plan->>'pointId')::uuid,(plan->>'contractId')::uuid,(plan->>'contractId')::uuid,gridex_received_sources.permission_date_v1(plan#>>'{object,start}'),(plan->>'eventAt')::timestamptz,'ediel_qualified_source','supplier_switch_confirmation',m.id,(plan->>'switchId')::uuid,'confirmed_by_grid_owner',1,jsonb_build_object('normalSourceBasis',jsonb_build_object('sourceMessageId',m.id,'originalMessageId',plan->>'originalId','siteId',plan->>'siteId','contractHash',plan->>'contractHash','object',plan->'object','legalActorId',basis->>'legalActorId')));
  SELECT * INTO period FROM public.customer_supply_periods WHERE id=(plan->>'periodId')::uuid;
  SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=(plan->>'switchId')::uuid;
  INSERT INTO gridex_received_sources.normal_switch_confirmations(source_message_id,period_id,company_id,switch_id,original_message_id,original_payload_hash,contract_id,protected_contract_hash,source_object,legal_context,market_start_at,confirmed_period,confirmed_switch)
   VALUES(m.id,period.id,m.company_id,sw.id,(plan->>'originalId')::uuid,plan->>'originalHash',(plan->>'contractId')::uuid,plan->>'contractHash',plan->'object',basis,period.market_start_at,to_jsonb(period),to_jsonb(sw));
 END LOOP;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO after_states FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.id IN(SELECT (chosen->>'periodId')::uuid FROM jsonb_array_elements(plans) chosen);
 INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'Z04',wire->'objects','[]',after_states,switch_ids,p_actor_user_id);
 result:=jsonb_build_object('applied',true,'idempotent',false,'periods',after_states,'switchIds',switch_ids,'commits',(SELECT jsonb_agg(jsonb_build_object('switchRequestId',switch_id,'supplyPeriodId',period_id,'customerId',confirmed_period->>'customer_id','meteringPointId',confirmed_period->>'metering_point_id','siteId',coalesce(confirmed_switch->>'site_id',confirmed_switch->>'customer_site_id'))) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=m.id AND company_id=m.company_id));
 result:=result||jsonb_build_object('processedObjects',guides,'sourceMessageId',m.id,'sourcePayloadHash',guide.source_payload_hash,'companyId',m.company_id,'environment',m.environment,'objectFactsHash',guide.facts_hash);
 INSERT INTO gridex_received_sources.prodat_mixed_object_receipts(source_message_id,company_id,environment,source_payload_hash,assessment_id,object_facts_hash,processed_objects,result,actor_user_id) VALUES(m.id,m.company_id,m.environment,guide.source_payload_hash,canonical.id,guide.facts_hash,guides,result,p_actor_user_id);
 INSERT INTO gridex_received_sources.prodat_mixed_reply_outbox(source_message_id,company_id,environment,source_payload_hash,object_facts_hash,own_outcomes) VALUES(m.id,m.company_id,m.environment,guide.source_payload_hash,guide.facts_hash,guides);
 RETURN result;
END $$;
COMMIT;
