-- P11/CALL03 normal Z04 L/LK business effects derive from the whole accepted
-- physical source and sealed sent Z03. ACKs and operational DATE projections
-- cannot approve a market relationship or advance a future start.
BEGIN;
CREATE TABLE gridex_received_sources.normal_switch_confirmations(
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),period_id uuid PRIMARY KEY REFERENCES public.customer_supply_periods(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),switch_id uuid NOT NULL UNIQUE REFERENCES public.supplier_switch_requests(id),
 original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),original_payload_hash text NOT NULL,
 contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),protected_contract_hash text NOT NULL,
 source_object jsonb NOT NULL,legal_context jsonb NOT NULL,market_start_at timestamptz NOT NULL,
 confirmed_period jsonb NOT NULL,confirmed_switch jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_received_sources.normal_supply_activations(
 period_id uuid PRIMARY KEY REFERENCES gridex_received_sources.normal_switch_confirmations(period_id),
 company_id uuid NOT NULL REFERENCES public.companies(id),source_message_id uuid NOT NULL,
 actor_user_id uuid NOT NULL,previous_period jsonb NOT NULL,resulting_period jsonb NOT NULL,result jsonb NOT NULL,activated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.normal_switch_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.normal_supply_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.normal_switch_confirmations,gridex_received_sources.normal_supply_activations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER normal_confirmation_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.normal_switch_confirmations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER normal_confirmation_no_truncate BEFORE TRUNCATE ON gridex_received_sources.normal_switch_confirmations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER normal_activation_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.normal_supply_activations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER normal_activation_no_truncate BEFORE TRUNCATE ON gridex_received_sources.normal_supply_activations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

-- Operational scan cursor only. It grants no relationship or activation and
-- advances across held candidates so old held starts cannot starve new ones.
CREATE TABLE gridex_received_sources.normal_activation_sweep_cursors(scope_key text PRIMARY KEY,last_start timestamptz,last_period uuid);
ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.normal_activation_sweep_cursors FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.sent_source_is_current_v1(m public.ediel_messages) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR (m.status IN('sent','acknowledged')) IS NOT TRUE OR m.message_sent_at IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false;END IF;
 -- The shared private provider journal supplies actual acceptance. A positive
 -- ACK projection does not approve a supply or manufacture a sent original.
 RETURN gridex_ediel_transport.accepted_source_basis_v1(m) IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.sent_source_is_current_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;

-- Physical projection, not a rule selector. The canonical register owner
-- supplies acceptance and grouping; only its first register owns common fields.
CREATE FUNCTION gridex_received_sources.normal_switch_wire_v1(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE w jsonb:=gridex_received_sources.supply_wire_v1(p_raw);tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(p_raw);
 own jsonb;lin jsonb;objects jsonb:='[]';seen text[]:=ARRAY[]::text[];key text;
BEGIN
 IF w IS NULL OR tokens IS NULL THEN RETURN NULL;END IF;
 FOR own IN SELECT o FROM jsonb_array_elements(w->'objects') o LOOP
  SELECT t INTO lin FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,1,0}'=own->>'line';
  IF lin IS NULL OR lin#>>'{elements,3,0}' IS DISTINCT FROM own->>'point' THEN RETURN NULL;END IF;
  key:=jsonb_build_array(own->>'point',lin#>>'{elements,3,3}')::text;
  IF key=ANY(seen) THEN CONTINUE;END IF;
  seen:=array_append(seen,key);
  objects:=objects||jsonb_build_array(own||jsonb_build_object('identityAgency',lin#>>'{elements,3,3}',
   'registerCount',(SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,3,0}'=own->>'point' AND t#>>'{elements,3,3}'=lin#>>'{elements,3,3}')));
 END LOOP;
 RETURN w||jsonb_build_object('objects',objects);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.normal_switch_wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.normal_switch_confirm_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;original public.ediel_messages%rowtype;sw public.supplier_switch_requests%rowtype;
 point public.metering_points%rowtype;site public.customer_sites%rowtype;contract public.customer_contracts%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;
 wire jsonb;oldwire jsonb;own jsonb;basis jsonb;plans jsonb:='[]';plan jsonb;after_states jsonb;before_switches jsonb:='[]';period public.customer_supply_periods%rowtype;
 ids uuid[];original_ids uuid[];switch_ids uuid[]:=ARRAY[]::uuid[];pid uuid;event_at timestamptz;customer_identity text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z04' THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_source_required');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write') IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_execution_actor_required');END IF;
 SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id;
 IF FOUND THEN
  IF prior.company_id IS DISTINCT FROM m.company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'normal_z04_replay_conflict';END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'periods',prior.resulting_states,'switchIds',prior.qualified_switch_ids);
 END IF;
 basis:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
 IF basis->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR basis->>'code' IS DISTINCT FROM 'Z04' OR basis->>'family' IS DISTINCT FROM 'PRODAT' THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_frozen_legal_context_required');END IF;
 IF (SELECT count(*) FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id))<>1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_canonical_leaf_ambiguous');END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR canonical.facts_text::jsonb#>>'{registerValidation,owner}' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR canonical.facts_text::jsonb#>>'{registerValidation,coverage}' IS DISTINCT FROM 'canonical_register_only'
  OR jsonb_typeof(canonical.facts_text::jsonb#>'{registerValidation,objects}') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_canonical_source_not_accepted');END IF;
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'receiver' IS DISTINCT FROM basis->>'legalEdielId' OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE (o->>'reason' IN('Z22','Z23')) IS NOT TRUE OR (o->>'identityAgency' IN('9','89')) IS NOT TRUE OR nullif(o->>'li','') IS NULL OR nullif(o->>'customerIdentity','') IS NULL OR gridex_received_sources.permission_time_v1(o->>'start') IS NULL)
  OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects') o)<>jsonb_array_length(wire->'objects')
  OR jsonb_array_length(canonical.facts_text::jsonb#>'{registerValidation,objects}')<>jsonb_array_length(wire->'objects') THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_whole_physical_scope_required');END IF;
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
 RETURN jsonb_build_object('applied',true,'idempotent',false,'periods',after_states,'switchIds',switch_ids,'commits',(SELECT jsonb_agg(jsonb_build_object('switchRequestId',switch_id,'supplyPeriodId',period_id,'customerId',confirmed_period->>'customer_id','meteringPointId',confirmed_period->>'metering_point_id','siteId',coalesce(confirmed_switch->>'site_id',confirmed_switch->>'customer_site_id'))) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=m.id AND company_id=m.company_id));
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.normal_switch_confirm_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve existing A/D/C/Z05 authority; direct/native/manual callers share
-- this same physical-source dispatch and cannot opt into the legacy mutation.
ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_received_sources;
ALTER FUNCTION gridex_received_sources.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_normal_switch_v1;
REVOKE ALL ON FUNCTION gridex_received_sources.apply_supply_before_normal_switch_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;w jsonb;ids uuid[];
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 w:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF m.direction='inbound' AND m.message_family='PRODAT' AND w->>'code'='Z04' THEN
  -- A normal replay returns its immutable receipt before original locks.
  -- Original-before-switch order protects the preserved cancellation path.
  IF EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason' IN('Z22','Z23')) THEN RETURN gridex_received_sources.normal_switch_confirm_v1(p_company_id,p_source_message_id,p_actor_user_id);END IF;
  SELECT array_agg(DISTINCT s.outbound_z03_message_id ORDER BY s.outbound_z03_message_id) INTO ids FROM public.supplier_switch_requests s WHERE s.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'li'=s.rff_li_reference);
  PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ids) ORDER BY z.id FOR SHARE;
 END IF;
 RETURN gridex_received_sources.apply_supply_before_normal_switch_v1(p_company_id,p_source_message_id,p_actor_user_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;

-- Existing activation effects (workflow, notification job and billing) remain
-- one transaction, but only a due immutable exact confirmation may call them.
ALTER FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text) SET SCHEMA gridex_received_sources;
ALTER FUNCTION gridex_received_sources.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text) RENAME TO activate_supply_before_source_guard_v1;
REVOKE ALL ON FUNCTION gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.activate_customer_supply_v1(p_company_id uuid,p_supplier_switch_request_id uuid,p_source_message_id uuid,p_actual_start_date date DEFAULT NULL,p_actor_user_id uuid DEFAULT NULL,p_idempotency_key text DEFAULT NULL)
RETURNS TABLE(supplier_switch_request_id uuid,supply_period_id uuid,contract_id uuid,customer_application_id uuid,workflow_id uuid,domain_event_id uuid,notification_job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof gridex_received_sources.normal_switch_confirmations%rowtype;prior gridex_received_sources.normal_supply_activations%rowtype;
 p public.customer_supply_periods%rowtype;s public.supplier_switch_requests%rowtype;m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;c public.customer_contracts%rowtype;result jsonb;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'normal_supply_activation_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=p_company_id AND switch_id=p_supplier_switch_request_id AND source_message_id=p_source_message_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'normal_supply_activation_immutable_confirmation_required';END IF;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ARRAY[proof.source_message_id,proof.original_message_id]) ORDER BY z.id FOR UPDATE;
 SELECT * INTO m FROM public.ediel_messages WHERE id=proof.source_message_id AND company_id=p_company_id;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr WHERE tr.source_message_id=m.id AND tr.company_id=p_company_id AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND proof.switch_id=ANY(tr.qualified_switch_ids)) THEN RAISE EXCEPTION 'normal_supply_activation_source_changed';END IF;
 SELECT * INTO prior FROM gridex_received_sources.normal_supply_activations WHERE period_id=proof.period_id;
 IF FOUND THEN
  -- Established own activation is returned before today's profile, contract,
  -- deadline or rule decisions. It cannot authorize a second market effect.
  RETURN QUERY SELECT (prior.result->>'supplier_switch_request_id')::uuid,(prior.result->>'supply_period_id')::uuid,(prior.result->>'contract_id')::uuid,(prior.result->>'customer_application_id')::uuid,(prior.result->>'workflow_id')::uuid,(prior.result->>'domain_event_id')::uuid,(prior.result->>'notification_job_id')::uuid;RETURN;
 END IF;
 PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 IF proof.market_start_at>now() THEN RAISE EXCEPTION 'normal_supply_activation_not_due';END IF;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=proof.original_message_id AND company_id=p_company_id AND environment=m.environment;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=proof.switch_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=proof.period_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO c FROM public.customer_contracts WHERE id=proof.contract_id AND company_id=p_company_id FOR SHARE;
 PERFORM profile.id FROM public.tenant_ediel_profiles profile WHERE profile.company_id=p_company_id AND profile.environment=m.environment ORDER BY profile.id FOR SHARE;
 PERFORM role.id FROM public.tenant_actor_roles role WHERE role.company_id=p_company_id AND role.environment=m.environment ORDER BY role.id FOR SHARE;
 PERFORM identifier.id FROM public.tenant_actor_identifiers identifier WHERE identifier.company_id=p_company_id AND identifier.environment=m.environment ORDER BY identifier.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles profile WHERE profile.company_id=p_company_id AND profile.environment=m.environment AND profile.market='electricity' AND profile.is_enabled AND profile.valid_from<=now() AND (profile.valid_to IS NULL OR now()<profile.valid_to))
  OR NOT EXISTS(SELECT FROM public.tenant_actor_roles role WHERE role.company_id=p_company_id AND role.environment=m.environment AND role.actor_id::text=proof.legal_context->>'legalActorId' AND role.role_code='electricity_supplier' AND role.valid_from<=now() AND (role.valid_to IS NULL OR now()<role.valid_to))
  OR (SELECT count(DISTINCT (identifier.actor_id,identifier.identifier_value)) FROM public.tenant_actor_identifiers identifier WHERE identifier.company_id=p_company_id AND identifier.environment=m.environment AND identifier.identifier_type='EdielId' AND identifier.valid_from<=now() AND (identifier.valid_to IS NULL OR now()<identifier.valid_to))<>1
  OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers identifier WHERE identifier.company_id=p_company_id AND identifier.environment=m.environment AND identifier.actor_id::text=proof.legal_context->>'legalActorId' AND identifier.identifier_type='EdielId' AND identifier.identifier_value=proof.legal_context->>'legalEdielId' AND identifier.valid_from<=now() AND (identifier.valid_to IS NULL OR now()<identifier.valid_to)) THEN RAISE EXCEPTION 'normal_supply_activation_current_legal_actor_required';END IF;
 IF origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE OR origin.immutable_rendered_at IS NULL OR origin.immutable_payload_hash IS DISTINCT FROM proof.original_payload_hash OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
  OR p.status IS DISTINCT FROM 'confirmed_by_grid_owner' OR p.market_state_version IS DISTINCT FROM (proof.confirmed_period->>'market_state_version')::bigint OR p.market_start_at IS DISTINCT FROM proof.market_start_at
  OR p.source_message_id IS DISTINCT FROM proof.source_message_id OR p.source_switch_request_id IS DISTINCT FROM proof.switch_id OR p.customer_id IS DISTINCT FROM (proof.confirmed_period->>'customer_id')::uuid OR p.metering_point_id IS DISTINCT FROM (proof.confirmed_period->>'metering_point_id')::uuid OR p.market_end_at IS NOT NULL OR p.metadata IS DISTINCT FROM proof.confirmed_period->'metadata'
  OR s.status IS DISTINCT FROM 'accepted' OR s.inbound_z04_message_id IS DISTINCT FROM proof.source_message_id OR s.outbound_z03_message_id IS DISTINCT FROM proof.original_message_id OR s.lifecycle_blocked OR s.customer_id IS DISTINCT FROM p.customer_id OR s.metering_point_id IS DISTINCT FROM p.metering_point_id
  OR s.contract_id IS DISTINCT FROM (proof.confirmed_switch->>'contract_id')::uuid OR s.customer_contract_id IS DISTINCT FROM (proof.confirmed_switch->>'customer_contract_id')::uuid OR s.site_id IS DISTINCT FROM (proof.confirmed_switch->>'site_id')::uuid OR s.customer_site_id IS DISTINCT FROM (proof.confirmed_switch->>'customer_site_id')::uuid
  OR p.contract_id IS DISTINCT FROM (proof.confirmed_period->>'contract_id')::uuid OR p.customer_contract_id IS DISTINCT FROM (proof.confirmed_period->>'customer_contract_id')::uuid
  OR c.id IS NULL OR c.customer_id IS DISTINCT FROM p.customer_id OR c.metering_point_id IS DISTINCT FROM p.metering_point_id OR (c.status IN('signed','active')) IS NOT TRUE OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM proof.protected_contract_hash
  OR (p_actual_start_date IS NOT NULL AND p_actual_start_date IS DISTINCT FROM p.start_date) THEN RAISE EXCEPTION 'normal_supply_activation_current_confirmation_changed';END IF;
 SELECT to_jsonb(effect) INTO result FROM gridex_received_sources.activate_supply_before_source_guard_v1(p_company_id,proof.switch_id,proof.source_message_id,p.start_date,p_actor_user_id,'ediel-normal-activation:'||proof.period_id) effect;
 IF result->>'supply_period_id' IS DISTINCT FROM proof.period_id::text THEN RAISE EXCEPTION 'normal_supply_activation_period_replaced';END IF;
 INSERT INTO gridex_received_sources.normal_supply_activations(period_id,company_id,source_message_id,actor_user_id,previous_period,resulting_period,result)
 SELECT proof.period_id,p_company_id,proof.source_message_id,p_actor_user_id,to_jsonb(p),to_jsonb(current),result FROM public.customer_supply_periods current WHERE current.id=proof.period_id AND current.company_id=p_company_id;
 RETURN QUERY SELECT (result->>'supplier_switch_request_id')::uuid,(result->>'supply_period_id')::uuid,(result->>'contract_id')::uuid,(result->>'customer_application_id')::uuid,(result->>'workflow_id')::uuid,(result->>'domain_event_id')::uuid,(result->>'notification_job_id')::uuid;
END $$;
REVOKE ALL ON FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text) TO service_role;

ALTER FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) SET SCHEMA gridex_received_sources;
ALTER FUNCTION gridex_received_sources.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) RENAME TO advance_supply_before_normal_switch_v1;
REVOKE ALL ON FUNCTION gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_advance_supply_deadlines_v1(p_company_id uuid,p_actor_user_id uuid,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE own record;result jsonb;activated integer:=0;cursor_row gridex_received_sources.normal_activation_sweep_cursors%rowtype;scope text:=coalesce(p_company_id::text,'all');
BEGIN
 result:=gridex_received_sources.advance_supply_before_normal_switch_v1(p_company_id,p_actor_user_id,p_limit);
 INSERT INTO gridex_received_sources.normal_activation_sweep_cursors(scope_key) VALUES(scope) ON CONFLICT DO NOTHING;
 SELECT * INTO cursor_row FROM gridex_received_sources.normal_activation_sweep_cursors WHERE scope_key=scope FOR UPDATE;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id) AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))) THEN cursor_row.last_start:=NULL;cursor_row.last_period:=NULL;END IF;
 FOR own IN SELECT c.* FROM gridex_received_sources.normal_switch_confirmations c JOIN public.customer_supply_periods p ON p.id=c.period_id AND p.company_id=c.company_id
  WHERE (p_company_id IS NULL OR c.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND c.market_start_at<=now() AND NOT EXISTS(SELECT FROM gridex_received_sources.normal_supply_activations a WHERE a.period_id=c.period_id)
   AND (cursor_row.last_start IS NULL OR (c.market_start_at,c.period_id)>(cursor_row.last_start,cursor_row.last_period))
  ORDER BY c.market_start_at,c.period_id LIMIT least(greatest(coalesce(p_limit,100),1),200) LOOP
  BEGIN
   PERFORM public.activate_customer_supply_v1(own.company_id,own.switch_id,own.source_message_id,NULL,p_actor_user_id,NULL);activated:=activated+1;
  EXCEPTION WHEN SQLSTATE '42501' OR raise_exception THEN
   -- A revoked/cancelled/changed scope stays held; the sweep cannot fabricate
   -- a new source decision or stop unrelated own candidates.
   NULL;
  END;
  UPDATE gridex_received_sources.normal_activation_sweep_cursors SET last_start=own.market_start_at,last_period=own.period_id WHERE scope_key=scope;
 END LOOP;
 RETURN jsonb_build_object('updated',coalesce((result->>'updated')::integer,0)+activated,'normalActivated',activated);
END $$;
REVOKE ALL ON FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) TO service_role;

-- Shared exact current relation proof for structural history and later BRP
-- events. It grants no wire capability or invoice permission by itself.
ALTER FUNCTION gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) RENAME TO billing_supply_before_normal_switch_v1;
CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(p_company_id uuid,p_period_id uuid,p_start timestamptz,p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.customer_supply_periods%rowtype;proof gridex_received_sources.normal_switch_confirmations%rowtype;
 tr gridex_received_sources.supply_source_transitions%rowtype;activation gridex_received_sources.normal_supply_activations%rowtype;
 m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;initial_message public.ediel_messages%rowtype;c public.customer_contracts%rowtype;s public.supplier_switch_requests%rowtype;
 expected jsonb;baseline jsonb;legal jsonb;initial_owned jsonb;source_objects jsonb;ids uuid[];version bigint;source_id uuid;
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
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ARRAY[ids[1],source_id,proof.original_message_id]) ORDER BY z.id FOR UPDATE;
 legal:=gridex_ediel_inbound_context.require_v1(p_company_id,proof.source_message_id);
 SELECT * INTO initial_message FROM public.ediel_messages WHERE id=proof.source_message_id AND company_id=p_company_id;
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
 RETURN jsonb_build_object('qualified',true,'periodId',p.id,'companyId',p.company_id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'siteId',coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id'),'switchId',proof.switch_id,
  'sourceMessageId',m.id,'initialSourceMessageId',proof.source_message_id,'currentSourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,
  'legalActorId',proof.legal_context->>'legalActorId','sourceObjects',jsonb_build_array(proof.source_object),'activated',activation.period_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.billing_supply_basis_v1(p_company_id uuid,p_period_id uuid,p_start timestamptz,p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=p_period_id AND company_id=p_company_id) THEN RETURN gridex_received_sources.billing_supply_before_normal_switch_v1(p_company_id,p_period_id,p_start,p_end);END IF;
 b:=gridex_received_sources.supply_period_source_basis_v1(p_company_id,p_period_id,p_start,p_end);
 IF b->>'activated' IS DISTINCT FROM 'true' THEN RETURN NULL;END IF;
 RETURN b;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.normal_switch_coverage_is_current_v1(p_company_id uuid,p_period_id uuid,p_switch_id uuid,p_source_id uuid,p_start timestamptz,p_end timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;finish timestamptz:=coalesce(p_end,p_start+interval '1 minute');
BEGIN
 b:=gridex_received_sources.supply_period_source_basis_v1(p_company_id,p_period_id,p_start,finish);
 RETURN (b->>'qualified'='true' AND b->>'switchId'=p_switch_id::text AND b->>'initialSourceMessageId'=p_source_id::text AND (b->>'marketStartAt')::timestamptz=p_start AND (b->>'marketEndAt')::timestamptz IS NOT DISTINCT FROM p_end) IS TRUE;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.normal_switch_coverage_is_current_v1(uuid,uuid,uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- The primary received-source owner still owns the party/evidence contract.
-- Its older DATE precision flag is retained for old receipts; new exact minute
-- output additionally requires the immutable actual native confirmation.
ALTER FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) RENAME TO object_owner_before_normal_minute_v1;
CREATE FUNCTION gridex_received_sources.object_owner_proof_consistent(p_party jsonb,p_business jsonb,p_received timestamptz) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof gridex_received_sources.normal_switch_confirmations%rowtype;legacy_shape jsonb;
BEGIN
 IF p_business#>>'{effectiveFrom,committedDatePrecision}' IS DISTINCT FROM 'market_minute' THEN RETURN gridex_received_sources.object_owner_before_normal_minute_v1(p_party,p_business,p_received);END IF;
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=(p_business->>'supplyPeriodId')::uuid AND company_id=(p_business->>'companyId')::uuid AND source_message_id=(p_business->>'sourceMessageId')::uuid AND switch_id=(p_business->>'switchRequestId')::uuid;
 IF NOT FOUND OR p_business->>'owner' IS DISTINCT FROM 'inbound-z04-switch-confirmation-v1' OR p_business->>'sourcePayloadHash' IS DISTINCT FROM (SELECT payload_hash FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=proof.source_message_id AND company_id=proof.company_id)
  OR p_business#>>'{object,objectId}' IS DISTINCT FROM proof.source_object->>'point' OR p_business#>>'{object,identityAgency}' IS DISTINCT FROM proof.source_object->>'identityAgency'
  OR p_business->>'customerId' IS DISTINCT FROM proof.confirmed_period->>'customer_id' OR p_business->>'meteringPointId' IS DISTINCT FROM proof.confirmed_period->>'metering_point_id' OR p_business->>'siteId' IS DISTINCT FROM coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id')
  OR p_business#>>'{effectiveFrom,marketMinute}' IS DISTINCT FROM proof.source_object->>'start' OR (p_business#>>'{effectiveFrom,utc}')::timestamptz IS DISTINCT FROM proof.market_start_at
  OR p_party#>>'{receiver,identity,legalActorId}' IS DISTINCT FROM proof.legal_context->>'legalActorId' OR p_party#>>'{parties,legalReceiver}' IS DISTINCT FROM proof.legal_context->>'legalEdielId' THEN RETURN false;END IF;
 -- Reuse every existing source-party snapshot, scope, UTC and DATE-projection
 -- check. This local copy is only the legacy checker input; stored output and
 -- authoritative market timestamp remain precise and unchanged.
 legacy_shape:=jsonb_set(p_business,'{effectiveFrom,committedDatePrecision}','"market_calendar_day"');
 RETURN gridex_received_sources.object_owner_before_normal_minute_v1(p_party,legacy_shape,p_received) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.object_owner_before_normal_minute_v1(jsonb,jsonb,timestamptz),gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
