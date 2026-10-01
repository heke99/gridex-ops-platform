-- Full canonical own-object guide facts and committed partial Z04 outcomes.
-- Original bytes, original global decisions and existing whole-source gates
-- remain unchanged. Register-only accepted facets never authorize this path.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_object_validation_facets(
 assessment_id uuid PRIMARY KEY REFERENCES gridex_received_sources.validation_assessments(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 source_payload_hash text NOT NULL,facts_text text NOT NULL,facts_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_received_sources.prodat_mixed_object_receipts(
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 source_payload_hash text NOT NULL,assessment_id uuid NOT NULL REFERENCES gridex_received_sources.prodat_object_validation_facets(assessment_id),
 object_facts_hash text NOT NULL,processed_objects jsonb NOT NULL,result jsonb NOT NULL,actor_user_id uuid NOT NULL,committed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_received_sources.prodat_mixed_reply_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid UNIQUE NOT NULL REFERENCES gridex_received_sources.prodat_mixed_object_receipts(source_message_id),
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,source_payload_hash text NOT NULL,
 object_facts_hash text NOT NULL,own_outcomes jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_received_sources.prodat_mixed_reply_consumptions(
 reply_intent_id uuid PRIMARY KEY REFERENCES gridex_received_sources.prodat_mixed_reply_outbox(id),
 acknowledgement_id uuid UNIQUE NOT NULL REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),acknowledgement_payload_hash text NOT NULL,
 actor_user_id uuid NOT NULL,consumed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.prodat_mixed_reply_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_mixed_reply_consumptions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_mixed_consumption_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_mixed_reply_consumptions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_mixed_consumption_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_mixed_reply_consumptions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
ALTER TABLE gridex_received_sources.prodat_mixed_reply_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_mixed_reply_outbox FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_mixed_reply_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_mixed_reply_outbox FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_mixed_reply_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_mixed_reply_outbox FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
ALTER TABLE gridex_received_sources.prodat_object_validation_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.prodat_mixed_object_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_object_validation_facets,gridex_received_sources.prodat_mixed_object_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_object_facet_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_object_validation_facets FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_object_facet_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_object_validation_facets FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_mixed_receipt_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_mixed_object_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_mixed_receipt_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_mixed_object_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

CREATE FUNCTION public.gridex_record_prodat_object_validation_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_assessment_id uuid,p_facts_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;c gridex_received_sources.validation_assessments%rowtype;facts jsonb;facet jsonb;own jsonb;scope jsonb;physical jsonb;tokens jsonb;lin jsonb;li text;next_line integer;hash text;existing gridex_received_sources.prodat_object_validation_facets%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_standard IS DISTINCT FROM 'edifact' OR p_source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR p_facts_text IS NULL OR octet_length(p_facts_text)>262144 THEN RAISE EXCEPTION 'prodat_full_object_original_required';END IF;
 SELECT * INTO c FROM gridex_received_sources.validation_assessments WHERE id=p_assessment_id AND company_id=p_company_id AND environment=p_environment AND source_message_id=m.id AND source_payload_hash=p_source_payload_hash FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=c.id) THEN RAISE EXCEPTION 'prodat_full_object_current_assessment_required';END IF;
 PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 facts:=p_facts_text::jsonb;facet:=c.facts_text::jsonb->'registerValidation';tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);
 IF NOT facts ?& ARRAY['version','owner','coverage','sharedAccepted','reasonCodes','objects'] OR facts-ARRAY['version','owner','coverage','sharedAccepted','reasonCodes','objects']<>'{}'::jsonb OR facts->'version' IS DISTINCT FROM '1'::jsonb
  OR facts->>'owner' IS DISTINCT FROM 'canonical-full-prodat-object-validation-v1' OR facts->>'coverage' IS DISTINCT FROM 'full_canonical_guide_objects_only'
  OR jsonb_typeof(facts->'sharedAccepted') IS DISTINCT FROM 'boolean' OR (facts->>'sharedAccepted'='true' AND c.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted')
  OR facts->'reasonCodes' IS DISTINCT FROM c.facts_text::jsonb->'reasonCodes' OR facet->>'owner' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR facet->>'coverage' IS DISTINCT FROM 'canonical_register_only'
  OR jsonb_typeof(facts->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(facts->'objects') IS DISTINCT FROM jsonb_array_length(facet->'objects') OR jsonb_array_length(facts->'objects') NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'prodat_full_object_canonical_scope_required';END IF;
 FOR own IN SELECT o FROM jsonb_array_elements(facts->'objects') o LOOP
  IF NOT own ?& ARRAY['objectId','identityAgency','messageReference','firstLineIndex','lineItemReference','disposition','reasons','negativeFields'] OR own-ARRAY['objectId','identityAgency','messageReference','firstLineIndex','lineItemReference','disposition','reasons','negativeFields']<>'{}'::jsonb
   OR coalesce(own->>'disposition','') NOT IN('accepted','rejected','unavailable') OR jsonb_typeof(own->'reasons') IS DISTINCT FROM 'array' OR jsonb_typeof(own->'negativeFields') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'prodat_full_object_facet_invalid';END IF;
  SELECT o INTO scope FROM jsonb_array_elements(facet->'objects') o WHERE o->'objectId'=own->'objectId' AND o->'identityAgency'=own->'identityAgency' AND o->'messageReference'=own->'messageReference' AND o#>'{registers,0,lineIndex}'=own->'firstLineIndex';
  IF scope IS NULL OR scope->>'messageIndex'<>'0' OR (own->>'disposition'='accepted' AND (facts->>'sharedAccepted'<>'true' OR scope->>'disposition'<>'accepted' OR own->'reasons'<>'[]'::jsonb OR own->'negativeFields'<>'[]'::jsonb)) OR (own->>'disposition'='rejected' AND (jsonb_array_length(own->'negativeFields')=0 OR jsonb_array_length(own->'reasons')=0)) THEN RAISE EXCEPTION 'prodat_full_object_own_decision_required';END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(own->'reasons') r WHERE r#>>'{}'<>'shared_source_not_qualified' AND NOT c.facts_text::jsonb->'reasonCodes' @> jsonb_build_array(r)) THEN RAISE EXCEPTION 'prodat_full_object_reason_changed';END IF;
  -- The canonical LIN number independently binds the full-guide owner to
  -- the stored original. Parser indexes are never caller supplied offsets.
  SELECT t INTO lin FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,1,0}'=scope#>>'{registers,0,lineNumber}';
  IF lin IS NULL OR lin#>>'{elements,3,0}' IS DISTINCT FROM own->>'objectId' OR lin#>>'{elements,3,3}' IS DISTINCT FROM own->>'identityAgency' THEN RAISE EXCEPTION 'prodat_full_object_physical_scope_required';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (o->>'objectId',o->>'identityAgency',o->>'firstLineIndex')) FROM jsonb_array_elements(facts->'objects') o)<>jsonb_array_length(facts->'objects') THEN RAISE EXCEPTION 'prodat_full_object_duplicate_scope';END IF;
 hash:=encode(sha256(convert_to(p_facts_text,'UTF8')),'hex');SELECT * INTO existing FROM gridex_received_sources.prodat_object_validation_facets WHERE assessment_id=c.id;
 IF FOUND AND existing.facts_hash IS DISTINCT FROM hash THEN RAISE EXCEPTION 'prodat_full_object_facet_replay_conflict';END IF;
 INSERT INTO gridex_received_sources.prodat_object_validation_facets(assessment_id,company_id,environment,source_message_id,source_payload_hash,facts_text,facts_hash) VALUES(c.id,p_company_id,p_environment,m.id,p_source_payload_hash,p_facts_text,hash) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('assessmentId',c.id,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',m.id,'sourcePayloadHash',p_source_payload_hash,'objectFactsHash',hash);
END $$;
REVOKE ALL ON FUNCTION public.gridex_record_prodat_object_validation_v1(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_prodat_object_validation_v1(uuid,text,uuid,text,uuid,text) TO service_role;
CREATE FUNCTION gridex_received_sources.normal_switch_confirm_mixed_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;original public.ediel_messages%rowtype;sw public.supplier_switch_requests%rowtype;
 point public.metering_points%rowtype;site public.customer_sites%rowtype;contract public.customer_contracts%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;
 wire jsonb;oldwire jsonb;own jsonb;basis jsonb;plans jsonb:='[]';plan jsonb;after_states jsonb;before_switches jsonb:='[]';period public.customer_supply_periods%rowtype;
 guide gridex_received_sources.prodat_object_validation_facets%rowtype;mixed_receipt gridex_received_sources.prodat_mixed_object_receipts%rowtype;whole_wire jsonb;guides jsonb;result jsonb;
 ids uuid[];original_ids uuid[];switch_ids uuid[]:=ARRAY[]::uuid[];pid uuid;event_at timestamptz;customer_identity text;
BEGIN
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
REVOKE ALL ON FUNCTION gridex_received_sources.normal_switch_confirm_mixed_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_process_prodat_mixed_z04_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RETURN gridex_received_sources.normal_switch_confirm_mixed_v1(p_company_id,p_source_message_id,p_actor_user_id);END $$;
REVOKE ALL ON FUNCTION public.ediel_process_prodat_mixed_z04_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_process_prodat_mixed_z04_v1(uuid,uuid,uuid) TO service_role;

-- A mixed positive ERC is an execution receipt, never mere caller intent. The
-- shared native prepare/enter gateways call this same acknowledgement guard.
ALTER FUNCTION gridex_ediel_ack_guide.require_v1(public.ediel_messages) RENAME TO require_before_mixed_object_results_v1;
CREATE FUNCTION gridex_ediel_ack_guide.require_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;tokens jsonb;t jsonb;group_tokens jsonb;next_group integer;li text;point text;r gridex_received_sources.prodat_mixed_object_receipts%rowtype;
BEGIN
 PERFORM gridex_ediel_ack_guide.require_before_mixed_object_results_v1(m);
 IF m.message_family IS DISTINCT FROM 'APERAK' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
 IF source.message_family IS DISTINCT FROM 'PRODAT' THEN RETURN;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='ERC' AND x#>>'{elements,1,0}'='100') THEN RETURN;END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='ERC' AND x#>>'{elements,1,0}'<>'100') THEN
  IF EXISTS(SELECT FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=source.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') AND a.facts_text::jsonb->>'applicationDecision'='rejected' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id)) THEN RAISE EXCEPTION 'prodat_mixed_ack_whole_source_success_forbidden';END IF;
  RETURN;
 END IF;
 SELECT * INTO r FROM gridex_received_sources.prodat_mixed_object_receipts WHERE source_message_id=source.id AND company_id=m.company_id AND environment=m.environment AND source_payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments a JOIN gridex_received_sources.prodat_object_validation_facets f ON f.assessment_id=a.id AND f.facts_hash=r.object_facts_hash AND f.source_payload_hash=r.source_payload_hash WHERE a.facts_hash=(SELECT initial.facts_hash FROM gridex_received_sources.validation_assessments initial WHERE initial.id=r.assessment_id) AND a.source_message_id=source.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=r.source_payload_hash AND a.facts_text::jsonb->>'syntaxDecision'='accepted' AND a.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id))
 OR NOT EXISTS(SELECT FROM gridex_received_sources.prodat_mixed_reply_outbox o WHERE o.source_message_id=source.id AND o.company_id=m.company_id AND o.environment=m.environment AND o.source_payload_hash=r.source_payload_hash AND o.object_facts_hash=r.object_facts_hash) THEN RAISE EXCEPTION 'prodat_mixed_ack_committed_own_results_required';END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='ERC' AND x#>>'{elements,1,0}'='100' LOOP
  SELECT min((x->>'index')::integer) INTO next_group FROM jsonb_array_elements(tokens) x WHERE (x->>'index')::integer>(t->>'index')::integer AND x->>'tag' IN('ERC','UNT');
  SELECT jsonb_agg(x) INTO group_tokens FROM jsonb_array_elements(tokens) x WHERE (x->>'index')::integer>(t->>'index')::integer AND (x->>'index')::integer<next_group;
  SELECT x#>>'{elements,1,1}' INTO li FROM jsonb_array_elements(group_tokens) x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI';
  SELECT x#>>'{elements,1,1}' INTO point FROM jsonb_array_elements(group_tokens) x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='Z07';
  IF li IS NULL OR point IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(r.processed_objects) o WHERE o->>'objectId'=point AND o->>'lineItemReference'=li AND o->>'disposition'='accepted')
   OR NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations c WHERE c.company_id=m.company_id AND c.source_message_id=source.id AND c.source_object->>'point'=point AND c.source_object->>'li'=li) THEN RAISE EXCEPTION 'prodat_mixed_ack_own_commit_mismatch';END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.require_before_mixed_object_results_v1(public.ediel_messages),gridex_ediel_ack_guide.require_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;


-- Private durable reply intents are read and consumed through source identity,
-- with current execution actor/legal/rule/full-guide revalidation on EACH call.
CREATE FUNCTION public.ediel_read_prodat_mixed_reply_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;o gridex_received_sources.prodat_mixed_reply_outbox%rowtype;
BEGIN
 receipt:=gridex_received_sources.normal_switch_confirm_mixed_v1(p_company_id,p_source_message_id,p_actor_user_id);
 IF receipt->>'applied' IS DISTINCT FROM 'true' THEN RETURN NULL;END IF;
 SELECT * INTO o FROM gridex_received_sources.prodat_mixed_reply_outbox WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=receipt->>'environment' AND source_payload_hash=receipt->>'sourcePayloadHash' AND object_facts_hash=receipt->>'objectFactsHash' FOR SHARE;
 IF NOT FOUND OR o.own_outcomes IS DISTINCT FROM receipt->'processedObjects' THEN RAISE EXCEPTION 'prodat_mixed_reply_intent_scope_conflict';END IF;
 RETURN receipt||jsonb_build_object('replyIntentId',o.id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_read_prodat_mixed_reply_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_prodat_mixed_reply_v1(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_consume_prodat_mixed_reply_v1(p_company_id uuid,p_source_message_id uuid,p_acknowledgement_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;m public.ediel_messages%rowtype;tokens jsonb;intent uuid;prior gridex_received_sources.prodat_mixed_reply_consumptions%rowtype;hash text;
BEGIN
 receipt:=public.ediel_read_prodat_mixed_reply_v1(p_company_id,p_source_message_id,p_actor_user_id);
 IF receipt IS NULL THEN RAISE EXCEPTION 'prodat_mixed_reply_current_intent_required';END IF;
 intent:=(receipt->>'replyIntentId')::uuid;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_acknowledgement_id AND company_id=p_company_id AND environment=receipt->>'environment' AND related_message_id=p_source_message_id FOR SHARE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' THEN RAISE EXCEPTION 'prodat_mixed_reply_actual_ack_required';END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,3,0}'='34')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'<>'100') THEN RAISE EXCEPTION 'prodat_mixed_reply_own_ack_required';END IF;
 PERFORM gridex_ediel_ack_guide.require_v1(m);
 PERFORM o.id FROM public.ediel_outbox o WHERE o.company_id=p_company_id AND o.environment=m.environment AND o.ediel_message_id=m.id AND o.source_message_id=p_source_message_id AND o.message_family='APERAK' AND o.status IN('prepared','queued','sending','sent') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'prodat_mixed_reply_actual_dispatch_outbox_required';END IF;
 hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 SELECT * INTO prior FROM gridex_received_sources.prodat_mixed_reply_consumptions WHERE reply_intent_id=intent FOR SHARE;
 IF FOUND THEN
  IF prior.acknowledgement_id IS DISTINCT FROM m.id OR prior.acknowledgement_payload_hash IS DISTINCT FROM hash THEN RAISE EXCEPTION 'prodat_mixed_reply_consumption_replay_conflict';END IF;
  RETURN jsonb_build_object('consumed',true,'idempotent',true,'replyIntentId',intent,'acknowledgementId',m.id);
 END IF;
 INSERT INTO gridex_received_sources.prodat_mixed_reply_consumptions(reply_intent_id,acknowledgement_id,company_id,environment,source_message_id,acknowledgement_payload_hash,actor_user_id) VALUES(intent,m.id,p_company_id,m.environment,p_source_message_id,hash,p_actor_user_id);
 RETURN jsonb_build_object('consumed',true,'idempotent',false,'replyIntentId',intent,'acknowledgementId',m.id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_consume_prodat_mixed_reply_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_consume_prodat_mixed_reply_v1(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_received_sources.mixed_owned_confirmation_v1(c uuid,env text,msg uuid,assessment uuid,scope jsonb,business jsonb) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM gridex_received_sources.prodat_mixed_object_receipts r JOIN gridex_received_sources.prodat_object_validation_facets f ON f.assessment_id=assessment AND f.source_message_id=r.source_message_id AND f.company_id=r.company_id AND f.environment=r.environment AND f.source_payload_hash=r.source_payload_hash AND f.facts_hash=r.object_facts_hash
  JOIN gridex_received_sources.normal_switch_confirmations n ON n.source_message_id=r.source_message_id AND n.company_id=r.company_id AND n.period_id::text=business->>'supplyPeriodId' AND n.switch_id::text=business->>'switchRequestId'
  WHERE r.company_id=c AND r.environment=env AND r.source_message_id=msg AND (SELECT current.facts_hash FROM gridex_received_sources.validation_assessments current WHERE current.id=assessment)=(SELECT initial.facts_hash FROM gridex_received_sources.validation_assessments initial WHERE initial.id=r.assessment_id) AND business->>'owner'='inbound-z04-switch-confirmation-v1' AND n.source_object->>'point'=scope->>'objectId'
   AND EXISTS(SELECT FROM jsonb_array_elements(r.processed_objects) o WHERE o->>'objectId'=scope->>'objectId' AND o->>'identityAgency'=scope->>'identityAgency' AND o->'firstLineIndex'=scope#>'{registers,0,lineIndex}' AND o->>'disposition'='accepted'))
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.mixed_owned_confirmation_v1(uuid,text,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_received_sources.append_object_assessment(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_canonical_assessment_id uuid,p_facts_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; canonical gridex_received_sources.validation_assessments%rowtype;
 facts jsonb; original jsonb; entry jsonb; scope jsonb; register_fact jsonb; business jsonb; party jsonb; records jsonb;
 position integer:=0; prior uuid; result_id uuid; digest text; snapshot_text text; valid_owners boolean; owner_readsets jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR UPDATE;
 IF NOT FOUND OR src.payload_hash IS DISTINCT FROM p_source_payload_hash OR src.received_context IS NULL OR p_facts_text IS NULL OR octet_length(p_facts_text)>262144 THEN RAISE EXCEPTION 'source_object_scope_unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments WHERE id=p_canonical_assessment_id AND source_message_id=src.source_message_id AND company_id=p_company_id AND environment=p_environment AND source_payload_hash=src.payload_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_object_canonical_unavailable' USING ERRCODE='23514'; END IF;
 facts:=p_facts_text::jsonb; original:=canonical.facts_text::jsonb;
 IF jsonb_typeof(facts) IS DISTINCT FROM 'object' OR NOT facts ?& ARRAY['version','owner','ruleVersion','canonicalFactsHash','objects']
 OR facts-ARRAY['version','owner','ruleVersion','canonicalFactsHash','objects']<>'{}'::jsonb
 OR facts->'version' IS DISTINCT FROM '1'::jsonb OR facts->>'owner' IS DISTINCT FROM 'received-source-object-decisions-v1'
 OR facts->>'ruleVersion' IS DISTINCT FROM '1' OR facts->>'canonicalFactsHash' IS DISTINCT FROM canonical.facts_hash
 OR jsonb_typeof(facts->'objects') IS DISTINCT FROM 'array' OR jsonb_typeof(original#>'{registerValidation,objects}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'source_object_facts_invalid' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(facts->'objects')<>jsonb_array_length(original#>'{registerValidation,objects}') OR jsonb_array_length(facts->'objects') NOT BETWEEN 1 AND 8192 THEN RAISE EXCEPTION 'source_object_membership_incomplete' USING ERRCODE='23514'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(facts->'objects') LOOP
  register_fact:=original#>ARRAY['registerValidation','objects',position::text];position:=position+1;
  scope:=entry->'object';business:=entry->'business';party:=entry->'party';
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['object','disposition','reasons','business','party']
   OR entry-ARRAY['object','disposition','reasons','business','party']<>'{}'::jsonb OR scope IS DISTINCT FROM register_fact-ARRAY['disposition','reasons']
   OR coalesce(entry->>'disposition','') NOT IN ('accepted','rejected','unavailable') OR jsonb_typeof(entry->'reasons') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'source_object_decision_invalid' USING ERRCODE='23514';END IF;
  IF (entry->>'disposition'='accepted') IS DISTINCT FROM (jsonb_array_length(entry->'reasons')=0)
   OR jsonb_array_length(entry->'reasons')>128 OR EXISTS(SELECT FROM jsonb_array_elements(entry->'reasons') r WHERE jsonb_typeof(r) IS DISTINCT FROM 'string' OR r#>>'{}' !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN RAISE EXCEPTION 'source_object_reason_invalid' USING ERRCODE='23514'; END IF;
  IF business<>'null'::jsonb AND (jsonb_typeof(business) IS DISTINCT FROM 'object' OR business->>'sourceMessageId' IS DISTINCT FROM src.source_message_id::text OR business->>'sourcePayloadHash' IS DISTINCT FROM src.payload_hash OR business->>'companyId' IS DISTINCT FROM p_company_id::text OR business->>'environment' IS DISTINCT FROM p_environment OR business->'object' IS DISTINCT FROM scope) THEN RAISE EXCEPTION 'source_object_business_scope_invalid' USING ERRCODE='23514'; END IF;
  IF party<>'null'::jsonb AND (jsonb_typeof(party) IS DISTINCT FROM 'object' OR party#>>'{source,sourceMessageId}' IS DISTINCT FROM src.source_message_id::text OR party#>>'{source,sourcePayloadHash}' IS DISTINCT FROM src.payload_hash OR party#>>'{source,companyId}' IS DISTINCT FROM p_company_id::text OR party#>>'{source,environment}' IS DISTINCT FROM p_environment OR party->'object' IS DISTINCT FROM scope) THEN RAISE EXCEPTION 'source_object_party_scope_invalid' USING ERRCODE='23514'; END IF;
  IF entry->>'disposition'='accepted' THEN
   IF register_fact->>'disposition' IS DISTINCT FROM 'accepted' OR original->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR (original->>'applicationDecision' IS DISTINCT FROM 'accepted' AND gridex_received_sources.mixed_owned_confirmation_v1(p_company_id,p_environment,src.source_message_id,canonical.id,scope,business) IS NOT TRUE) OR original->>'functionalDecision' IS DISTINCT FROM 'accepted'
    OR (CASE business->>'owner' WHEN 'inbound-z04-switch-confirmation-v1' THEN business->>'businessDisposition'='committed' WHEN 'reviewed-received-structure-v1' THEN business->>'businessDisposition'='reviewed' WHEN 'reviewed-received-closure-v1' THEN business->>'businessDisposition'='reviewed' ELSE false END) IS DISTINCT FROM true
    OR business->'version' IS DISTINCT FROM '1'::jsonb OR party->'version' IS DISTINCT FROM '1'::jsonb
    OR party->>'owner' IS DISTINCT FROM 'received-source-party-binding-v1' OR party->>'ruleVersion' IS DISTINCT FROM '1' OR party->>'disposition' IS DISTINCT FROM 'accepted'
    OR party->'reasons' IS DISTINCT FROM '[]'::jsonb OR party#>>'{receiver,evidence,completeness}' IS DISTINCT FROM 'exact_count'
    OR scope->>'identityAgency' IS DISTINCT FROM '9' OR party#>>'{facility,meteringPoint,id}' IS DISTINCT FROM business->>'meteringPointId'
    OR party#>>'{facility,site,id}' IS DISTINCT FROM business->>'siteId' THEN RAISE EXCEPTION 'source_object_acceptance_unproven' USING ERRCODE='23514'; END IF;
   records:=party#>'{receiver,evidence,records}';
   -- All owner revalidation calls below share this SELECT's snapshot, rather
   -- than treating independent earlier network reads as an atomic observation.
   SELECT pg_current_snapshot()::text,
    (CASE business->>'owner' WHEN 'inbound-z04-switch-confirmation-v1' THEN gridex_received_sources.object_owner_proof_consistent(party,business,src.source_received_at) WHEN 'reviewed-received-structure-v1' THEN gridex_received_sources.review_business_proof_consistent(party,business,src.source_message_id) WHEN 'reviewed-received-closure-v1' THEN gridex_received_sources.review_closure_proof_consistent(party,business,src.source_message_id) ELSE false END)
    AND gridex_received_sources.owner_rows_match('profiles',records->'profiles',p_company_id,p_environment,NULL)
    AND gridex_received_sources.owner_rows_match('identifiers',records->'identifiers',p_company_id,p_environment,NULL)
    AND gridex_received_sources.owner_rows_match('roles',records->'roles',p_company_id,p_environment,(party#>>'{receiver,identity,legalActorId}')::uuid)
    AND gridex_received_sources.owner_rows_match('relations',records->'relations',p_company_id,p_environment,NULL)
    AND (CASE WHEN party#>>'{receiver,identity,representedByTransportAgent}'='true' THEN gridex_received_sources.owner_rows_match('transportIdentifiers',records->'transportIdentifiers',p_company_id,p_environment,(party#>>'{receiver,identity,transportActorId}')::uuid) ELSE records->'transportIdentifiers'='[]'::jsonb END)
    AND gridex_received_sources.owner_rows_match('point',jsonb_build_array(party#>'{facility,meteringPoint}'),p_company_id,p_environment,(business->>'meteringPointId')::uuid)
    AND gridex_received_sources.owner_rows_match('site',jsonb_build_array(party#>'{facility,site}'),p_company_id,p_environment,(business->>'siteId')::uuid)
    AND gridex_received_sources.owner_rows_match('gridOwner',jsonb_build_array(party#>'{facility,gridOwner}'),p_company_id,p_environment,(party#>>'{facility,gridOwner,id}')::uuid)
    AND (business->>'owner' IN ('reviewed-received-structure-v1','reviewed-received-closure-v1') OR EXISTS(SELECT FROM public.supplier_switch_requests sw JOIN public.customer_supply_periods sp ON sp.id=(business->>'supplyPeriodId')::uuid
      WHERE sw.id=(business->>'switchRequestId')::uuid AND sw.company_id=p_company_id AND sp.company_id=p_company_id
      AND sw.inbound_z04_message_id=src.source_message_id AND sp.source_message_id=src.source_message_id
      AND sw.metering_point_id=(business->>'meteringPointId')::uuid AND sp.metering_point_id=sw.metering_point_id
      AND sw.site_id=(business->>'siteId')::uuid AND sw.customer_id=(business->>'customerId')::uuid AND sp.customer_id=sw.customer_id
      AND sw.status='accepted' AND sp.status='confirmed_by_grid_owner'
      AND EXISTS(SELECT FROM public.metering_points mp JOIN public.customer_sites cs ON cs.id=mp.site_id WHERE mp.id=sw.metering_point_id AND mp.company_id=p_company_id AND cs.company_id=p_company_id AND mp.customer_id=sw.customer_id AND cs.customer_id=sw.customer_id AND cs.id=sw.site_id)
      AND sw.confirmed_start_date::text=business#>>'{committedRecords,switch,confirmedStartDate}' AND sp.start_date::text=business#>>'{committedRecords,supply,startDate}'))
   INTO snapshot_text,valid_owners;
   IF valid_owners IS DISTINCT FROM true THEN RAISE EXCEPTION 'source_object_owner_snapshot_changed' USING ERRCODE='23514'; END IF;
   owner_readsets:=owner_readsets||jsonb_build_array(jsonb_build_object('object',scope,'snapshot',snapshot_text,'observedAt',clock_timestamp()));
  END IF;
 END LOOP;
 SELECT id INTO prior FROM gridex_received_sources.object_assessments a WHERE source_message_id=src.source_message_id AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id);
 digest:=encode(sha256(convert_to(p_facts_text,'UTF8')),'hex');
 INSERT INTO gridex_received_sources.object_assessments(source_message_id,company_id,environment,source_payload_hash,canonical_assessment_id,previous_assessment_id,facts_text,facts_hash,owner_readsets)
 VALUES(src.source_message_id,p_company_id,p_environment,src.payload_hash,canonical.id,prior,p_facts_text,digest,owner_readsets) RETURNING id INTO result_id;
 RETURN jsonb_build_object('version',1,'assessmentId',result_id,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',src.source_message_id,'sourcePayloadHash',src.payload_hash,'canonicalAssessmentId',canonical.id,'factsHash',digest);
END $$;

-- A globally rejected source can qualify only its actual committed own period,
-- against the CURRENT immutable full-guide facet. Later source revisions revoke
-- the prior mixed receipt instead of retaining blanket source acceptance.
CREATE FUNCTION gridex_received_sources.mixed_period_canonical_v1(assessment uuid,c uuid,period uuid,msg uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM gridex_received_sources.prodat_mixed_object_receipts r
 JOIN gridex_received_sources.prodat_object_validation_facets f ON f.assessment_id=assessment AND f.source_payload_hash=r.source_payload_hash AND f.facts_hash=r.object_facts_hash
 JOIN gridex_received_sources.normal_switch_confirmations n ON n.source_message_id=r.source_message_id AND n.company_id=r.company_id AND n.period_id=period
 WHERE r.company_id=c AND r.source_message_id=msg AND (SELECT current.facts_hash FROM gridex_received_sources.validation_assessments current WHERE current.id=assessment)=(SELECT initial.facts_hash FROM gridex_received_sources.validation_assessments initial WHERE initial.id=r.assessment_id) AND f.facts_text::jsonb->>'sharedAccepted'='true'
 AND EXISTS(SELECT FROM jsonb_array_elements(r.processed_objects) o WHERE o->>'objectId'=n.source_object->>'point' AND o->>'identityAgency'=n.source_object->>'identityAgency' AND o->>'lineItemReference'=n.source_object->>'li' AND o->>'disposition'='accepted'))
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.mixed_period_canonical_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
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
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=initial_message.id AND v.company_id=p_company_id AND v.environment=initial_message.environment AND v.source_payload_hash=initial_transition.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND (v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
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
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=tr.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND (v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 accepted_original:=gridex_ediel_transport.accepted_source_basis_v1(origin);
 IF accepted_original IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('qualified',true,'periodId',p.id,'companyId',p.company_id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'siteId',coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id'),'switchId',proof.switch_id,
  'sourceMessageId',m.id,'initialSourceMessageId',proof.source_message_id,'currentSourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,
  'legalActorId',proof.legal_context->>'legalActorId','sourceObjects',jsonb_build_array(proof.source_object),'dsoEdielId',initial_wire->>'sender','originalMessageId',origin.id,'originalPayloadHash',origin.immutable_payload_hash,'originalAcceptedAt',accepted_original->>'observedAt','activated',activation.period_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
