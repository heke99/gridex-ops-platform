-- PRIVATE candidate: source-qualified manual end to actual received Z05.
-- Does not rewrite the original received baseline or commercial termination.
BEGIN;
CREATE TABLE gridex_received_sources.manual_received_end_successors_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, period_id uuid NOT NULL,
 contract_id uuid NOT NULL, manual_receipt_id uuid NOT NULL REFERENCES gridex_received_sources.manual_billing_continuations_v1(id),
 source_message_id uuid NOT NULL, effect_receipt_id uuid NOT NULL,
 source_payload_hash text NOT NULL, effect_hash text NOT NULL, resulting_period jsonb NOT NULL,
 resulting_contract_hash text NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,period_id,source_message_id), UNIQUE(effect_receipt_id)
);
ALTER TABLE gridex_received_sources.manual_received_end_successors_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.manual_received_end_successors_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX manual_received_end_successors_period_v1 ON gridex_received_sources.manual_received_end_successors_v1(company_id,period_id);
CREATE TRIGGER manual_received_end_successors_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON gridex_received_sources.manual_received_end_successors_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.manual_billing_continuation_immutable_v1();
ALTER TABLE gridex_received_sources.manual_received_end_successors_v1 ENABLE ALWAYS TRIGGER manual_received_end_successors_immutable_v1;

CREATE FUNCTION gridex_received_sources.manual_end_for_received_v1(c uuid,p uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r gridex_received_sources.manual_billing_continuations_v1%rowtype;starting timestamptz;ending timestamptz;selected uuid;BEGIN
 FOR r IN SELECT * FROM gridex_received_sources.manual_billing_continuations_v1 WHERE company_id=c AND period_id=p ORDER BY id FOR SHARE LOOP
  starting:=(r.original_period->>'market_start_at')::timestamptz;ending:=(r.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm';
  IF starting IS NULL OR ending<=starting THEN CONTINUE;END IF;
  BEGIN
   IF gridex_received_sources.manual_billing_source_basis_v1(c,p,starting,least(ending,starting+interval '1 second'),r.id) IS NOT NULL THEN
    IF selected IS NOT NULL THEN RETURN NULL;END IF;selected:=r.id;
   END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' OR insufficient_privilege OR check_violation THEN CONTINUE;END;
 END LOOP;RETURN selected;
END$$;

CREATE FUNCTION gridex_received_sources.record_manual_received_end_v1(c uuid,mid uuid,eid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e gridex_received_sources.supply_object_effect_receipts%rowtype;r gridex_received_sources.manual_billing_continuations_v1%rowtype;
 p public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;m public.ediel_messages%rowtype;effect jsonb;previous jsonb;resulting jsonb;transition gridex_received_sources.supply_source_transitions%rowtype;
 prior_ct public.customer_contracts%rowtype;correction jsonb;contract_transition_valid boolean:=false;
BEGIN
 SELECT * INTO e FROM gridex_received_sources.supply_object_effect_receipts WHERE id=eid AND source_message_id=mid AND company_id=c FOR SHARE;
 effect:=e.effect_text::jsonb;
 IF effect#>>'{plan,manualReceiptId}' IS NULL THEN RETURN;END IF;
 SELECT * INTO r FROM gridex_received_sources.manual_billing_continuations_v1 WHERE id=(effect#>>'{plan,manualReceiptId}')::uuid AND company_id=c FOR SHARE;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=r.period_id AND company_id=c FOR SHARE;
 SELECT * INTO ct FROM public.customer_contracts WHERE id=r.contract_id AND company_id=c FOR SHARE;
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
 SELECT * INTO transition FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=mid AND company_id=c FOR SHARE;
 SELECT own INTO previous FROM jsonb_array_elements(effect->'previousStates')own WHERE own->>'id'=p.id::text;
 SELECT own INTO resulting FROM jsonb_array_elements(effect->'resultingStates')own WHERE own->>'id'=p.id::text;
 -- PART2's actual received-end trigger may correct only this manual contract's
 -- earlier end. Reconstruct and hash the exact authenticated manual predecessor;
 -- metadata is evidence only when every unchanged row byte still matches it.
 contract_transition_valid:=encode(sha256(convert_to(to_jsonb(ct)::text,'UTF8')),'hex')=r.resulting_contract_hash;
 IF contract_transition_valid IS NOT TRUE THEN
  correction:=ct.metadata->'ended_at_corrected_by_received_end';
  IF ct.status='terminated' AND ct.termination_reason IN('move_out','grid_contract_ended','customer_termination')
   AND jsonb_typeof(correction)='object' AND correction->>'previous_ended_at' IS NOT NULL
   AND ct.ended_at=(p.end_date::timestamp AT TIME ZONE 'Europe/Stockholm') AND ct.updated_at=now() THEN
   prior_ct:=ct;prior_ct.ended_at:=(correction->>'previous_ended_at')::timestamptz;
   prior_ct.metadata:=ct.metadata-'ended_at_corrected_by_received_end';prior_ct.updated_at:=r.captured_at;
   contract_transition_valid:=
    greatest((prior_ct.ended_at AT TIME ZONE 'UTC')::date,(prior_ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date)<p.end_date
    AND correction=jsonb_build_object('previous_ended_at',prior_ct.ended_at,'supply_end_date',p.end_date,
      'end_key','source-end:'||p.id::text||':'||p.end_date::text,'supply_period_id',p.id,'corrected_at',now())
    AND encode(sha256(convert_to(to_jsonb(prior_ct)::text,'UTF8')),'hex')=r.resulting_contract_hash;
  END IF;
 END IF;

 IF r.id IS NULL OR p.id IS NULL OR ct.id IS NULL OR m.id IS NULL OR transition.source_message_id IS NULL
  OR m.direction IS DISTINCT FROM 'inbound' OR m.message_code IS DISTINCT FROM 'Z05' OR m.environment IS DISTINCT FROM e.environment
  OR effect#>>'{plan,kind}' IS DISTINCT FROM 'end' OR effect#>>'{plan,periodId}' IS DISTINCT FROM p.id::text
  OR (effect#>>'{wire,reason}' IN('Z22','Z23')) IS NOT TRUE
  OR e.effect_hash IS DISTINCT FROM encode(sha256(convert_to(e.effect_text,'UTF8')),'hex')
  OR e.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR transition.payload_hash IS DISTINCT FROM e.payload_hash
  OR previous IS NULL OR resulting IS NULL OR encode(sha256(convert_to(previous::text,'UTF8')),'hex') IS DISTINCT FROM r.resulting_period_hash
  OR resulting IS DISTINCT FROM to_jsonb(p)
  OR (to_jsonb(p)-ARRAY['end_date','actual_end_date','market_end_at','source_end_message_id','status','market_state_version','updated_at']) IS DISTINCT FROM (previous-ARRAY['end_date','actual_end_date','market_end_at','source_end_message_id','status','market_state_version','updated_at'])
  OR p.actual_end_date IS NOT NULL OR p.source_end_message_id IS DISTINCT FROM mid OR p.market_state_version IS DISTINCT FROM (previous->>'market_state_version')::bigint+1
  OR p.market_end_at IS DISTINCT FROM (effect#>>'{plan,eventAt}')::timestamptz
  OR p.end_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(effect#>>'{wire,end}')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(transition.resulting_states)x WHERE x=to_jsonb(p))
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(transition.previous_states)x WHERE x=previous)
  OR contract_transition_valid IS NOT TRUE
  OR ct.customer_id IS DISTINCT FROM r.customer_id OR p.customer_id IS DISTINCT FROM r.customer_id OR p.contract_id IS DISTINCT FROM r.contract_id THEN
  RAISE EXCEPTION 'manual_received_end_actual_effect_required';
 END IF;
 PERFORM gridex_received_sources.require_manual_billing_records_v1(c,ct.id,r.original_basis);
 PERFORM public.ediel_require_source_bytes_available_v1(c,mid);
 INSERT INTO gridex_received_sources.manual_received_end_successors_v1(company_id,period_id,contract_id,manual_receipt_id,source_message_id,effect_receipt_id,source_payload_hash,effect_hash,resulting_period,resulting_contract_hash)
 VALUES(c,p.id,ct.id,r.id,mid,eid,e.payload_hash,e.effect_hash,to_jsonb(p),encode(sha256(convert_to(to_jsonb(ct)::text,'UTF8')),'hex'));
END$$;
CREATE FUNCTION gridex_received_sources.manual_received_source_basis_v1(p_company_id uuid, p_period_id uuid, p_start timestamp with time zone, p_end timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE receipt gridex_received_sources.manual_received_end_successors_v1%rowtype;manual gridex_received_sources.manual_billing_continuations_v1%rowtype;actual_p public.customer_supply_periods%rowtype;actual_ct public.customer_contracts%rowtype;own_effect gridex_received_sources.supply_object_effect_receipts%rowtype;
 p public.customer_supply_periods%rowtype;proof gridex_received_sources.normal_switch_confirmations%rowtype;
 tr gridex_received_sources.supply_source_transitions%rowtype;activation gridex_received_sources.normal_supply_activations%rowtype;
 m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;initial_message public.ediel_messages%rowtype;c public.customer_contracts%rowtype;s public.supplier_switch_requests%rowtype;
 expected jsonb;baseline jsonb;legal jsonb;initial_owned jsonb;source_objects jsonb;initial_wire jsonb;accepted_original jsonb;initial_transition gridex_received_sources.supply_source_transitions%rowtype;ids uuid[];version bigint;source_id uuid;
BEGIN
 SELECT * INTO actual_p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO receipt FROM gridex_received_sources.manual_received_end_successors_v1 WHERE company_id=p_company_id AND period_id=p_period_id AND source_message_id=actual_p.source_end_message_id FOR SHARE;
 IF receipt.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO manual FROM gridex_received_sources.manual_billing_continuations_v1 WHERE id=receipt.manual_receipt_id AND company_id=p_company_id AND period_id=p_period_id FOR SHARE;
 SELECT * INTO actual_ct FROM public.customer_contracts WHERE id=receipt.contract_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO own_effect FROM gridex_received_sources.supply_object_effect_receipts WHERE id=receipt.effect_receipt_id AND company_id=p_company_id AND source_message_id=receipt.source_message_id FOR SHARE;
 IF manual.id IS NULL OR actual_p.id IS NULL OR actual_ct.id IS NULL OR own_effect.id IS NULL
  OR p_end>(manual.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm'
  OR manual.contract_id IS DISTINCT FROM actual_ct.id OR receipt.contract_id IS DISTINCT FROM manual.contract_id
  OR actual_p.contract_id IS DISTINCT FROM manual.contract_id OR actual_ct.customer_id IS DISTINCT FROM manual.customer_id OR actual_p.customer_id IS DISTINCT FROM manual.customer_id
  OR encode(sha256(convert_to(to_jsonb(actual_ct)::text,'UTF8')),'hex') IS DISTINCT FROM receipt.resulting_contract_hash
  OR gridex_received_sources.production_contract_hash_v1(actual_ct) IS DISTINCT FROM manual.original_contract_hash
  OR (to_jsonb(actual_p)-ARRAY['updated_at','status']) IS DISTINCT FROM (receipt.resulting_period-ARRAY['updated_at','status'])
  OR (actual_p.status IS DISTINCT FROM receipt.resulting_period->>'status' AND NOT(actual_p.status='ended' AND receipt.resulting_period->>'status'='ending' AND actual_p.market_end_at<=now()))
  OR own_effect.effect_hash IS DISTINCT FROM receipt.effect_hash OR own_effect.effect_hash IS DISTINCT FROM encode(sha256(convert_to(own_effect.effect_text,'UTF8')),'hex')
  OR own_effect.payload_hash IS DISTINCT FROM receipt.source_payload_hash OR own_effect.effect_text::jsonb#>>'{plan,manualReceiptId}' IS DISTINCT FROM manual.id::text THEN RETURN NULL;END IF;
 PERFORM gridex_received_sources.require_manual_billing_records_v1(p_company_id,receipt.contract_id,manual.original_basis);
 PERFORM public.ediel_require_source_bytes_available_v1(p_company_id,receipt.source_message_id);
 PERFORM gridex_bilateral_prodat.lock_supply_v1();
 PERFORM gridex_regulated_supply.lock_graph_v1();
 IF p_company_id IS NULL OR p_period_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF p.source_process IN('assigned_supply','production_receipt_obligation') AND gridex_regulated_supply.ground_current_v1((p.metadata->>'sourceGroundId')::uuid,p_company_id,p.metering_point_id,p.market_start_at) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=p.id AND company_id=p_company_id;
 IF NOT FOUND THEN
  baseline:=gridex_received_sources.billing_supply_before_normal_switch_v1(p_company_id,p_period_id,p_start,p_end);
  IF baseline IS NULL THEN RETURN NULL;END IF;
  SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
  IF p.market_state_version IS DISTINCT FROM (baseline->>'marketStateVersion')::bigint THEN RETURN NULL;END IF;
  SELECT own#>'{metadata,sourceObject}' INTO initial_owned FROM gridex_received_sources.supply_source_transitions initial,jsonb_array_elements(initial.resulting_states) own WHERE initial.source_message_id=p.source_message_id AND initial.company_id=p_company_id AND own->>'id'=p.id::text;
  SELECT * INTO origin FROM public.ediel_messages WHERE id=p.source_message_id AND company_id=p_company_id;
  SELECT jsonb_agg(own) INTO source_objects FROM jsonb_array_elements(coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,origin.id,p.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload))->'objects') own WHERE own->>'point'=initial_owned->>'point' AND own->>'li'=initial_owned->>'li' AND own->>'start'=initial_owned->>'start';
  IF jsonb_array_length(source_objects) IS DISTINCT FROM 1 OR (source_objects#>>'{0,identityAgency}' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
  RETURN baseline||jsonb_build_object('initialSourceMessageId',p.source_message_id,'legalActorId',(SELECT g.legal_actor_id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.id::text=baseline->>'groundId' AND g.company_id=p_company_id),'sourceObjects',source_objects,'dsoEdielId',coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,origin.id,p.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload))->>'sender');
 END IF;
 IF gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,proof.source_message_id) IS NOT TRUE THEN RETURN NULL;END IF;
 IF p.source_end_message_id IS NOT NULL AND gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,p.source_end_message_id) IS NOT TRUE THEN RETURN NULL;END IF;
 version:=p.market_state_version;source_id:=p.source_message_id;
 SELECT array_agg(t.source_message_id) INTO ids FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) own WHERE own->>'id'=p.id::text AND (own->>'market_state_version')::bigint=version);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ARRAY[ids[1],source_id,proof.source_message_id,proof.original_message_id]) ORDER BY z.id FOR UPDATE;
 legal:=gridex_ediel_inbound_context.require_v1(p_company_id,proof.source_message_id);
 SELECT * INTO initial_message FROM public.ediel_messages WHERE id=proof.source_message_id AND company_id=p_company_id;
 SELECT * INTO initial_transition FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=proof.source_message_id AND company_id=p_company_id;
 initial_wire:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,initial_message.id,p.id),gridex_received_sources.normal_switch_wire_v1(initial_message.raw_payload));
 IF initial_message.direction IS DISTINCT FROM 'inbound' OR initial_message.message_family IS DISTINCT FROM 'PRODAT' OR initial_message.message_code IS DISTINCT FROM 'Z04'
  OR initial_transition.payload_hash IS DISTINCT FROM encode(sha256(convert_to(initial_message.raw_payload,'UTF8')),'hex')
  OR initial_wire->>'receiver' IS DISTINCT FROM proof.legal_context->>'legalEdielId' OR nullif(initial_wire->>'sender','') IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(initial_wire->'objects') own WHERE own=proof.source_object)<>1
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=initial_message.id AND v.company_id=p_company_id AND v.environment=initial_message.environment AND v.source_payload_hash=initial_transition.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND ((v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.supply_effect_assessment_owns_period_v1(p_company_id,v.source_message_id,p.id,v.id)) OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
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
 IF c.id IS DISTINCT FROM receipt.contract_id THEN RETURN NULL;END IF;c.status:=manual.original_contract_status;
 IF origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE OR origin.immutable_payload_hash IS DISTINCT FROM proof.original_payload_hash OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
  OR c.id IS NULL OR c.customer_id IS DISTINCT FROM p.customer_id OR c.metering_point_id IS DISTINCT FROM p.metering_point_id OR (c.status IN('signed','active') OR c.status='terminated' AND c.termination_reason='supply_end' AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL
   AND ((c.ended_at AT TIME ZONE 'UTC')::date>=p.end_date OR (c.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=p.end_date)) IS NOT TRUE OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM proof.protected_contract_hash
  OR legal->>'legalActorId' IS DISTINCT FROM proof.legal_context->>'legalActorId' OR legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier'
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=tr.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND ((v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.supply_effect_assessment_owns_period_v1(p_company_id,v.source_message_id,p.id,v.id)) OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 accepted_original:=gridex_ediel_transport.accepted_source_basis_v1(origin);
 IF accepted_original IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('manualReceivedEndReceiptId',receipt.id,'qualified',true,'periodId',p.id,'companyId',p.company_id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'siteId',coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id'),'switchId',proof.switch_id,
  'sourceMessageId',m.id,'initialSourceMessageId',proof.source_message_id,'currentSourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,
  'legalActorId',proof.legal_context->>'legalActorId','sourceObjects',jsonb_build_array(proof.source_object),'dsoEdielId',initial_wire->>'sender','originalMessageId',origin.id,'originalPayloadHash',origin.immutable_payload_hash,'originalAcceptedAt',accepted_original->>'observedAt','activated',activation.period_id IS NOT NULL);
END $$;
DO $patch$ DECLARE f record;b text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'c30e7398338c7b0a39da7220ea62bffa4d8ae0134f1c7d8b272b09e07736e03e' THEN RAISE EXCEPTION 'manual_received_end_exact_predecessor_required:gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)';END IF;
 b:=$replacement$
DECLARE m public.ediel_messages%rowtype;sp public.customer_supply_periods%rowtype;sw public.supplier_switch_requests%rowtype;origin public.ediel_messages%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;ground gridex_received_sources.regulated_supply_ground_versions%rowtype;
 wire jsonb;sender_basis jsonb;original jsonb;own jsonb;entry jsonb;plan jsonb;plans jsonb:='[]';before_states jsonb:='[]';previous_switches jsonb:='[]';after_states jsonb;old jsonb;
 ids uuid[];point public.metering_points%rowtype;consumption public.metering_points%rowtype;legal_actor uuid;dso_actor uuid;
 event_at timestamptz;start_at timestamptz;reason text;period_id uuid;expected_version bigint;qualified boolean;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE; IF gridex_received_sources.require_supply_scope_admission_v1(p_company_id,p_source_message_id,p_scope) IS DISTINCT FROM p_canonical_id THEN RAISE EXCEPTION 'supply_scoped_canonical_assessment_changed';END IF; IF jsonb_array_length(gridex_received_sources.require_prodat_application_objects_v1(p_company_id,p_source_message_id)->'objects')>1 THEN m.customer_id:=NULL;m.metering_point_id:=NULL;END IF;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_source_unavailable');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN RETURN jsonb_build_object('applied',false,'reason','supply_execution_actor_unqualified');END IF;
 SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id;
 IF FOUND AND (prior.company_id IS DISTINCT FROM m.company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'supply_replay_conflict';END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.id=p_canonical_id AND v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','canonical_supply_source_not_accepted');END IF;
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF wire IS NULL OR (wire->>'code' IN ('Z04','Z05')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_wire_unavailable');END IF;
 -- No mixed physical subtype, duplicate point, or partially applied message.
 SELECT o->>'reason' INTO reason FROM jsonb_array_elements(wire->'objects') o LIMIT 1;
 IF nullif(reason,'') IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IS DISTINCT FROM reason OR nullif(o->>'point','') IS NULL OR nullif(o->>'li','') IS NULL)
 OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects') o)<>jsonb_array_length(wire->'objects') THEN RETURN jsonb_build_object('applied',false,'reason','supply_object_scope_unqualified');END IF;
 IF prior.source_message_id IS NOT NULL THEN
  IF wire->>'code'='Z04' AND reason IN('Z26','Z70') AND EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE gridex_regulated_supply.ground_current_v1((saved#>>'{metadata,sourceGroundId}')::uuid,m.company_id,(saved->>'metering_point_id')::uuid,(saved->>'market_start_at')::timestamptz) IS NOT TRUE) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_current_ground_required');END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'periods',prior.resulting_states);
 END IF;
 -- Only a first Z05/C restoration requires today's actual sender registry.
 -- Historical recorded outcomes returned above retain their original truth.
 IF wire->>'code'='Z05' AND reason='Z24' THEN
  sender_basis:=gridex_network_registry_sources.network_for_company_v1(m.company_id,wire->>'sender',m.environment);
  IF sender_basis->>'status' IS DISTINCT FROM 'authorized'
   OR sender_basis#>>'{basis,companyId}' IS DISTINCT FROM m.company_id::text
   OR sender_basis#>>'{basis,environment}' IS DISTINCT FROM m.environment
   OR sender_basis#>>'{basis,networkEdielId}' IS DISTINCT FROM wire->>'sender'
   THEN RETURN jsonb_build_object('applied',false,'reason','z05c_current_sender_network_registry_required');END IF;
 END IF;
 -- Only a first Z04/C cancellation requires today's actual sender registry.
 -- Historical recorded outcomes returned above retain their original truth.
 IF wire->>'code'='Z04' AND reason='Z24' THEN
  sender_basis:=gridex_network_registry_sources.network_for_company_v1(m.company_id,wire->>'sender',m.environment);
  IF sender_basis->>'status' IS DISTINCT FROM 'authorized'
   OR sender_basis#>>'{basis,companyId}' IS DISTINCT FROM m.company_id::text
   OR sender_basis#>>'{basis,environment}' IS DISTINCT FROM m.environment
   OR sender_basis#>>'{basis,networkEdielId}' IS DISTINCT FROM wire->>'sender'
   THEN RETURN jsonb_build_object('applied',false,'reason','z04c_current_sender_network_registry_required');END IF;
 END IF;
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
    AND gridex_regulated_supply.ground_wire_current_v1(g.id,m.company_id,point.id,event_at,own) IS TRUE
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
    AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->'objects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'sender'=wire->>'receiver' AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'receiver'=wire->>'sender';
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_exact_original_unavailable');END IF;
   SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   IF coalesce(sw.outbound_z03_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_original_cohort_changed');END IF;SELECT * INTO origin FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(m.company_id,origin.id,sp.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload));
   IF NOT FOUND OR origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE
    OR original IS NULL OR original->>'code' IS DISTINCT FROM 'Z03' OR original->>'sender' IS DISTINCT FROM wire->>'receiver' OR original->>'receiver' IS DISTINCT FROM wire->>'sender'
    OR origin.customer_id IS DISTINCT FROM sw.customer_id OR origin.metering_point_id IS DISTINCT FROM sw.metering_point_id OR (m.customer_id IS NOT NULL AND m.customer_id<>sw.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sw.metering_point_id)
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    THEN RETURN jsonb_build_object('applied',false,'reason','z04c_locked_original_mismatch');END IF;
   -- A start already cancelled by another own C is a held duplicate.
   IF sw.status='cancelled_before_start' THEN RETURN jsonb_build_object('applied',false,'reason','z04c_start_already_cancelled');END IF;
   -- An executed own start is corrected under review; it is never reversed here.
   IF sw.status='completed' THEN
    IF EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts e WHERE e.company_id=m.company_id AND e.environment=m.environment
     AND e.effect_text::jsonb#>>'{plan,kind}'='executed_start_compensation' AND e.effect_text::jsonb#>>'{plan,executedSwitchId}'=sw.id::text) THEN RETURN jsonb_build_object('applied',false,'reason','z04c_executed_start_compensation_already_recorded');END IF;
    SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
     JOIN gridex_received_sources.normal_switch_confirmations c ON c.period_id=p.id AND c.company_id=p.company_id
     JOIN gridex_received_sources.normal_supply_activations a ON a.period_id=p.id AND a.company_id=p.company_id AND a.source_message_id=c.source_message_id
     WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.status IN ('active','ending','ended')) IS TRUE
      AND c.switch_id=sw.id AND c.original_message_id=origin.id AND c.original_payload_hash=origin.immutable_payload_hash AND c.source_message_id=sw.inbound_z04_message_id
      AND p.start_date=gridex_received_sources.permission_date_v1(own->>'start') AND c.market_start_at<=now();
    IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR SHARE;
    previous_switches:=previous_switches||jsonb_build_array(to_jsonb(sw));
    plans:=plans||jsonb_build_array(jsonb_build_object('kind','executed_start_compensation','switchId',NULL,'periodId',NULL,'disposition','controlled_review',
     'executedSwitchId',sw.id,'executedPeriodId',sp.id,'executedPeriod',to_jsonb(sp),'originalId',origin.id,'originalHash',origin.immutable_payload_hash,
     'confirmationSourceMessageId',sw.inbound_z04_message_id,'siteId',coalesce(sw.site_id,sw.customer_site_id),'caseId',gen_random_uuid(),'object',own));
    CONTINUE;
   END IF;
   IF (sw.status IN ('draft','prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancelled_before_start')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.source_switch_request_id=sw.id OR p.source_message_id=sw.inbound_z04_message_id);
   IF coalesce(cardinality(ids),0)>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_conflicting_periods');END IF;
   IF coalesce(cardinality(ids),0)=1 THEN
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
    IF sp.status IS DISTINCT FROM 'confirmed_by_grid_owner' OR sp.customer_id IS DISTINCT FROM sw.customer_id OR sp.metering_point_id IS DISTINCT FROM sw.metering_point_id OR sp.start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'start') OR coalesce(sp.market_start_at,sp.start_date::timestamp AT TIME ZONE 'Etc/GMT-1')<=now() THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    before_states:=before_states||jsonb_build_array(to_jsonb(sp));period_id:=sp.id;
   ELSE period_id:=NULL;END IF;
   previous_switches:=previous_switches||jsonb_build_array(to_jsonb(sw));plans:=plans||jsonb_build_array(jsonb_build_object('kind','cancel_start','periodId',period_id,'switchId',sw.id,'object',own));
  ELSIF wire->>'code'='Z05' AND reason='Z24' THEN
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id
    JOIN public.ediel_messages z ON z.id=tr.source_message_id AND z.company_id=tr.company_id AND z.environment=m.environment
    WHERE p.company_id=m.company_id AND z.direction='inbound' AND tr.payload_hash=encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') AND coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))->>'sender'=wire->>'sender' AND coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))->>'receiver'=wire->>'receiver' AND EXISTS(SELECT FROM jsonb_array_elements(coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))->'objects') original_scope WHERE original_scope->>'point'=own->>'point' AND original_scope->>'identityAgency'=own->>'identityAgency')
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'end'=own->>'end')
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND (state->>'market_state_version')::bigint=p.market_state_version AND (state-ARRAY['updated_at','status'])=(to_jsonb(p)-ARRAY['updated_at','status']));
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05c_exact_original_ending_unavailable');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   IF coalesce(sp.source_end_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_original_cohort_changed');END IF;SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=sp.source_end_message_id AND company_id=m.company_id;
   SELECT state INTO old FROM jsonb_array_elements(prior.previous_states) state WHERE state->>'id'=sp.id::text;
   IF old IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE saved->>'id'=sp.id::text AND (sp.status=saved->>'status' OR sp.status='ended' AND saved->>'status'='ending' AND sp.market_end_at<=now())) OR EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=sp.metering_point_id AND p.id<>sp.id AND p.status NOT IN ('ended','cancelled') AND (p.end_date IS NULL OR p.end_date>sp.start_date)) THEN RETURN jsonb_build_object('applied',false,'reason','z05c_conflicting_continuation');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','restore_end','periodId',sp.id,'previous',old,'object',own));
  ELSIF wire->>'code'='Z05' AND reason IN ('Z22','Z23') THEN
   -- Actual accepted baseline owner ties the physical object to a relationship;
   -- a unique local row or DATE similarity is never sufficient authority.
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
    WHERE p.company_id=m.company_id AND (p.status IN ('active','confirmed_by_grid_owner','ending') OR p.status='ended' AND gridex_received_sources.manual_end_for_received_v1(p.company_id,p.id) IS NOT NULL) AND p.source_end_message_id IS NULL AND (
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
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND state->>'customer_id'=p.customer_id::text AND state->>'metering_point_id'=p.metering_point_id::text AND(state#>>'{metadata,sourceObject,point}'=own->>'point' OR state#>>'{metadata,normalSourceBasis,object,point}'=own->>'point'))
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) object WHERE object->>'point'=own->>'point' AND object->>'customerIdentity'=own->>'customerIdentity' AND object->>'gridArea'=own->>'gridArea' AND (object->>'reason' IN ('Z26','Z70') OR object->>'reason' IN ('Z22','Z23') AND EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts own_effect WHERE own_effect.company_id=p.company_id AND own_effect.source_message_id=tr.source_message_id AND own_effect.object_scope->>'objectId'=own->>'point' AND own_effect.object_scope->>'identityAgency'=own->>'identityAgency' AND gridex_received_sources.supply_effect_assessment_owns_period_v1(p.company_id,tr.source_message_id,p.id,own_effect.canonical_assessment_id)))))
    );
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05_accepted_relationship_baseline_required');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   IF coalesce(sp.source_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_original_cohort_changed');END IF;SELECT * INTO origin FROM public.ediel_messages WHERE id=sp.source_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(m.company_id,origin.id,sp.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload));
   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04' OR original->>'sender' IS DISTINCT FROM wire->>'sender' OR original->>'receiver' IS DISTINCT FROM wire->>'receiver'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at)
    OR (m.customer_id IS NOT NULL AND m.customer_id<>sp.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sp.metering_point_id) THEN RETURN jsonb_build_object('applied',false,'reason','z05_original_object_mismatch');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','end','periodId',sp.id,'eventAt',event_at,'object',own,'manualReceiptId',gridex_received_sources.manual_end_for_received_v1(sp.company_id,sp.id)));
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
  ELSIF plan->>'kind'='executed_start_compensation' THEN
   INSERT INTO public.customer_cases(id,company_id,customer_id,site_id,metering_point_id,customer_contract_id,supplier_switch_request_id,case_type,status,priority,title,description,reason_category,next_action,source,metadata,created_by,updated_by,source_ediel_message_id,source_business_process)
    VALUES((plan->>'caseId')::uuid,m.company_id,(plan#>>'{executedPeriod,customer_id}')::uuid,(plan->>'siteId')::uuid,(plan#>>'{executedPeriod,metering_point_id}')::uuid,
     coalesce(plan#>>'{executedPeriod,customer_contract_id}',plan#>>'{executedPeriod,contract_id}')::uuid,(plan->>'executedSwitchId')::uuid,'other','manual_follow_up','high',
     'Annullering efter genomförd leveransstart – korrigera',
     'Nätägaren har annullerat en leveransstart som redan genomförts. Annulleringen är besvarad. Korrigera starten med bibehållen historik och kompensera vid behov.',
     'executed_start_cancellation','Utred och genomför korrigering av den genomförda starten.','ediel_inbound_state_machine',
     jsonb_build_object('review_intent','executed_start_compensation','source_ediel_message_id',m.id,'executed_switch_id',plan->'executedSwitchId','executed_period_id',plan->'executedPeriodId',
      'original_message_id',plan->'originalId','original_payload_hash',plan->'originalHash','confirmation_source_message_id',plan->'confirmationSourceMessageId','object',plan->'object'),
     p_actor_user_id,p_actor_user_id,m.id,'supplier_switch');
  ELSIF plan->>'kind'='end' THEN
   UPDATE public.customer_supply_periods SET actual_end_date=CASE WHEN plan->>'manualReceiptId' IS NOT NULL THEN NULL ELSE actual_end_date END,end_date=gridex_received_sources.permission_date_v1(plan#>>'{object,end}'),market_end_at=(plan->>'eventAt')::timestamptz,source_end_message_id=m.id,status=CASE WHEN (plan->>'eventAt')::timestamptz<=now() THEN 'ended' ELSE 'ending' END,market_state_version=market_state_version+1,updated_at=now() WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='restore_end' THEN
   UPDATE public.customer_supply_periods SET status=plan#>>'{previous,status}',end_date=(plan#>>'{previous,end_date}')::date,market_end_at=(plan#>>'{previous,market_end_at}')::timestamptz,source_end_message_id=(plan#>>'{previous,source_end_message_id}')::uuid,market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('endCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) INTO after_states FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.id IN (SELECT (chosen_plan->>'periodId')::uuid FROM jsonb_array_elements(plans) chosen_plan);

 RETURN jsonb_build_object('applied',true,'periods',after_states,'plans',plans,'previousStates',before_states,'previousSwitches',previous_switches,'regulated',wire->>'code'='Z04' AND reason IN ('Z26','Z70'));
END $replacement$;EXECUTE replace(f.definition,f.prosrc,b);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_end_function_metadata_changed';END IF;
END$patch$;

DO $patch$ DECLARE f record;b text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_bilateral_prodat.apply_supply_before_h_v1(uuid,uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '7a77d389b0b19572e388a555627eea238273efc044197b7779a60365acf2c72e' THEN RAISE EXCEPTION 'manual_received_end_exact_predecessor_required:gridex_bilateral_prodat.apply_supply_before_h_v1(uuid,uuid,uuid)';END IF;
 b:=$replacement$
DECLARE m public.ediel_messages%rowtype;old_partition gridex_received_sources.supply_object_partitions%rowtype;application jsonb;canonical uuid;context jsonb;scope jsonb;entry jsonb;wire jsonb;own jsonb;
 result jsonb;partition jsonb:='[]';periods jsonb:='[]';previous_states jsonb:='[]';source_objects jsonb:='[]';switch_ids uuid[]:=ARRAY[]::uuid[];source_ids uuid[];
 effect jsonb;effect_id uuid;effect_hash text;old_state jsonb;plan jsonb;raw_hash text;register_indices integer[];all_indices integer[];receipt_ids uuid[]:=ARRAY[]::uuid[];outcome jsonb;applied_count integer:=0;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'supply_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z04','Z05')) IS NOT TRUE THEN RETURN gridex_received_sources.apply_supply_before_own_partition_v1(p_company_id,p_source_message_id,p_actor_user_id);END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_execution_actor_unqualified');END IF;
 raw_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 -- Established first outcomes precede today's source selection. Historical
 -- global receipts remain their own truth, never prospectively backfilled.
 SELECT * INTO old_partition FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=m.id;
 IF old_partition.source_message_id IS NOT NULL THEN
  IF old_partition.company_id IS DISTINCT FROM m.company_id OR old_partition.environment IS DISTINCT FROM m.environment OR old_partition.payload_hash IS DISTINCT FROM raw_hash THEN RAISE EXCEPTION 'supply_partition_replay_conflict';END IF;
  RETURN old_partition.result||jsonb_build_object('idempotent',true);
 END IF;
 IF EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id) THEN RETURN gridex_received_sources.apply_supply_before_own_partition_v1(p_company_id,p_source_message_id,p_actor_user_id);END IF;
 context:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
 IF context->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR context->>'family' IS DISTINCT FROM 'PRODAT' OR context->>'code' IS DISTINCT FROM m.message_code THEN RETURN jsonb_build_object('applied',false,'reason','supply_frozen_legal_context_required');END IF;
 application:=gridex_received_sources.require_prodat_application_objects_v1(m.company_id,m.id);
 canonical:=(application->>'assessmentId')::uuid;
 IF application->>'headerDecision' IS DISTINCT FROM 'accepted' OR jsonb_typeof(application->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(application->'objects') NOT BETWEEN 1 AND 8192
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments a WHERE a.id=canonical AND a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=raw_hash AND a.facts_text::jsonb->>'syntaxDecision'='accepted' AND a.facts_text::jsonb->>'functionalDecision'='accepted') THEN RETURN jsonb_build_object('applied',false,'reason','supply_complete_own_application_and_function_required');END IF;
 SELECT array_agg((r->>'segmentIndex')::integer ORDER BY(r->>'segmentIndex')::integer) INTO register_indices FROM jsonb_array_elements(application->'objects')o CROSS JOIN LATERAL jsonb_array_elements(o->'registers')r;
 SELECT array_agg((t->>'index')::integer ORDER BY(t->>'index')::integer) INTO all_indices FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(m.raw_payload))t WHERE t->>'tag'='LIN';
 IF register_indices IS DISTINCT FROM all_indices OR cardinality(register_indices)<>(SELECT count(DISTINCT r) FROM unnest(register_indices)r) THEN RETURN jsonb_build_object('applied',false,'reason','supply_complete_physical_partition_required');END IF;
 -- Lock the whole discoverable source cohort before switch/period/point rows.
 -- A later baseline revision fails exact owner checks rather than acquiring a
 -- newly selected source after its dependent period has already been locked.
 SELECT array_agg(DISTINCT id ORDER BY id) INTO source_ids FROM(
  SELECT s.outbound_z03_message_id id FROM public.supplier_switch_requests s WHERE s.company_id=m.company_id AND EXISTS(SELECT FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=(SELECT p.ediel_metering_point_id FROM public.metering_points p WHERE p.id=s.metering_point_id AND p.company_id=s.company_id))
  UNION SELECT p.source_message_id FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=p.company_id WHERE p.company_id=m.company_id AND EXISTS(SELECT FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=mp.ediel_metering_point_id)
  UNION SELECT p.source_end_message_id FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=p.company_id WHERE p.company_id=m.company_id AND EXISTS(SELECT FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=mp.ediel_metering_point_id))discovered WHERE id IS NOT NULL;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=m.company_id AND z.id=ANY(source_ids) ORDER BY z.id FOR UPDATE;
 FOR entry IN SELECT o FROM jsonb_array_elements(application->'objects')o ORDER BY(o#>>'{registers,0,segmentIndex}')::integer LOOP
  scope:=entry-'applicationDecision'-'reasonCodes';result:=NULL;wire:=NULL;own:=NULL;effect_id:=NULL;
  IF gridex_received_sources.prodat_application_object_accepted_v1(m.company_id,m.id,canonical,scope) IS NOT TRUE THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason','own_application_not_accepted'));CONTINUE;
  END IF;
  -- Two separately represented scopes for the same physical point cannot
  -- compete for one relationship. All remain held, including the first one.
  IF(SELECT count(*) FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=scope->>'objectId')<>1 THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason','ambiguous_physical_supply_scope'));CONTINUE;
  END IF;
  wire:=gridex_received_sources.supply_wire_for_scope_v1(m.raw_payload,scope);own:=wire#>'{objects,0}';
  IF wire IS NULL OR wire->>'code' IS DISTINCT FROM m.message_code OR wire->>'receiver' IS DISTINCT FROM context->>'legalEdielId' THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason','own_supply_wire_or_legal_scope_unavailable'));CONTINUE;
  END IF;
  -- Each private adapter has no effect until its original complete business
  -- checks pass. A failed returned qualification has performed no writes.
  IF m.message_code='Z04' AND own->>'reason' IN('Z22','Z23') THEN
   result:=gridex_received_sources.normal_switch_scope_effect_v1(m.company_id,m.id,p_actor_user_id,scope,coalesce(source_ids,ARRAY[]::uuid[]),canonical);
  ELSE result:=gridex_received_sources.other_supply_scope_effect_v1(m.company_id,m.id,p_actor_user_id,scope,coalesce(source_ids,ARRAY[]::uuid[]),canonical);END IF;
  IF result->>'applied' IS DISTINCT FROM 'true' THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason',coalesce(result->>'reason','own_supply_business_unqualified')));CONTINUE;
  END IF;
  IF jsonb_typeof(result->'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'plans')<>1 OR jsonb_typeof(result->'periods') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'supply_scoped_business_receipt_required';END IF;
  plan:=result#>'{plans,0}';
  -- Exact effects are frozen in the same transaction as the actual source write.
  effect:=jsonb_build_object('version',1,'owner','inbound-supply-object-v1','sourceMessageId',m.id,'sourcePayloadHash',raw_hash,'companyId',m.company_id,'environment',m.environment,'canonicalAssessmentId',canonical,'object',scope,'wire',own,'legalContext',context,'plan',plan,'previousStates',coalesce(result->'previousStates','[]'::jsonb),'resultingStates',result->'periods','previousSwitches',coalesce(result->'previousSwitches','[]'::jsonb),'resultingSwitches',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM public.supplier_switch_requests s WHERE s.company_id=m.company_id AND s.id=(plan->>'switchId')::uuid),'[]'::jsonb));
  effect_hash:=encode(sha256(convert_to(effect::text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.supply_object_effect_receipts(source_message_id,company_id,environment,payload_hash,canonical_assessment_id,first_line_index,object_scope,effect_text,effect_hash)
   VALUES(m.id,m.company_id,m.environment,raw_hash,canonical,(scope#>>'{registers,0,segmentIndex}')::integer,scope,effect::text,effect_hash) RETURNING id INTO effect_id;
  receipt_ids:=array_append(receipt_ids,effect_id);applied_count:=applied_count+1;periods:=periods||(result->'periods');previous_states:=previous_states||coalesce(result->'previousStates','[]'::jsonb);source_objects:=source_objects||jsonb_build_array(own);
  IF plan->>'switchId' IS NOT NULL THEN switch_ids:=array_append(switch_ids,(plan->>'switchId')::uuid);END IF;
  partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','applied','effectReceiptId',effect_id,'effectFactsHash',effect_hash));
 END LOOP;
 -- No object was applied: preserve the source as held without minting an effect
 -- or preventing a later independently qualified source review.
 IF applied_count=0 THEN RETURN jsonb_build_object('applied',false,'reason','no_qualified_supply_objects','partition',partition,'periods','[]'::jsonb,'commits','[]'::jsonb);END IF;
 outcome:=jsonb_build_object('applied',true,'idempotent',false,'periods',periods,'partition',partition,'effectReceiptIds',to_jsonb(receipt_ids),'switchIds',to_jsonb(switch_ids),'commits',
  coalesce((SELECT jsonb_agg(jsonb_build_object('switchRequestId',switch_id,'supplyPeriodId',period_id,'customerId',confirmed_period->>'customer_id','meteringPointId',confirmed_period->>'metering_point_id','siteId',coalesce(confirmed_switch->>'site_id',confirmed_switch->>'customer_site_id'))) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=m.id AND company_id=m.company_id),'[]'::jsonb));
 INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,raw_hash,m.message_code,source_objects,previous_states,periods,switch_ids,p_actor_user_id);
 FOREACH effect_id IN ARRAY receipt_ids LOOP
  PERFORM gridex_received_sources.record_manual_received_end_v1(m.company_id,m.id,effect_id);
 END LOOP;
 INSERT INTO gridex_received_sources.supply_object_partitions(source_message_id,company_id,environment,payload_hash,canonical_assessment_id,partition_text,partition_hash,result,actor_user_id) VALUES(m.id,m.company_id,m.environment,raw_hash,canonical,partition::text,encode(sha256(convert_to(partition::text,'UTF8')),'hex'),outcome,p_actor_user_id);
 RETURN outcome;
END$replacement$;EXECUTE replace(f.definition,f.prosrc,b);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_end_function_metadata_changed';END IF;
END$patch$;

DO $patch$ DECLARE f record;b text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '29ff45bf3a3244617ee22eb13476215aaf7b12ca5b94f689b19f26d049423505' THEN RAISE EXCEPTION 'manual_received_end_exact_predecessor_required:gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)';END IF;
 b:=$replacement$
DECLARE received_basis jsonb;p public.customer_supply_periods%rowtype;proof gridex_received_sources.normal_switch_confirmations%rowtype;
 tr gridex_received_sources.supply_source_transitions%rowtype;activation gridex_received_sources.normal_supply_activations%rowtype;
 m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;initial_message public.ediel_messages%rowtype;c public.customer_contracts%rowtype;s public.supplier_switch_requests%rowtype;
 expected jsonb;baseline jsonb;legal jsonb;initial_owned jsonb;source_objects jsonb;initial_wire jsonb;accepted_original jsonb;initial_transition gridex_received_sources.supply_source_transitions%rowtype;ids uuid[];version bigint;source_id uuid;
BEGIN
 received_basis:=gridex_received_sources.manual_received_source_basis_v1(p_company_id,p_period_id,p_start,p_end);
 IF received_basis IS NOT NULL THEN RETURN received_basis;END IF;
 PERFORM gridex_bilateral_prodat.lock_supply_v1();
 PERFORM gridex_regulated_supply.lock_graph_v1();
 IF p_company_id IS NULL OR p_period_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF p.source_process IN('assigned_supply','production_receipt_obligation') AND gridex_regulated_supply.ground_current_v1((p.metadata->>'sourceGroundId')::uuid,p_company_id,p.metering_point_id,p.market_start_at) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=p.id AND company_id=p_company_id;
 IF NOT FOUND THEN
  baseline:=gridex_received_sources.billing_supply_before_normal_switch_v1(p_company_id,p_period_id,p_start,p_end);
  IF baseline IS NULL THEN RETURN NULL;END IF;
  SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
  IF p.market_state_version IS DISTINCT FROM (baseline->>'marketStateVersion')::bigint THEN RETURN NULL;END IF;
  SELECT own#>'{metadata,sourceObject}' INTO initial_owned FROM gridex_received_sources.supply_source_transitions initial,jsonb_array_elements(initial.resulting_states) own WHERE initial.source_message_id=p.source_message_id AND initial.company_id=p_company_id AND own->>'id'=p.id::text;
  SELECT * INTO origin FROM public.ediel_messages WHERE id=p.source_message_id AND company_id=p_company_id;
  SELECT jsonb_agg(own) INTO source_objects FROM jsonb_array_elements(coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,origin.id,p.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload))->'objects') own WHERE own->>'point'=initial_owned->>'point' AND own->>'li'=initial_owned->>'li' AND own->>'start'=initial_owned->>'start';
  IF jsonb_array_length(source_objects) IS DISTINCT FROM 1 OR (source_objects#>>'{0,identityAgency}' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
  RETURN baseline||jsonb_build_object('initialSourceMessageId',p.source_message_id,'legalActorId',(SELECT g.legal_actor_id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.id::text=baseline->>'groundId' AND g.company_id=p_company_id),'sourceObjects',source_objects,'dsoEdielId',coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,origin.id,p.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload))->>'sender');
 END IF;
 IF gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,proof.source_message_id) IS NOT TRUE THEN RETURN NULL;END IF;
 IF p.source_end_message_id IS NOT NULL AND gridex_bilateral_prodat.recorded_supply_current_v1(p_company_id,p.source_end_message_id) IS NOT TRUE THEN RETURN NULL;END IF;
 version:=p.market_state_version;source_id:=p.source_message_id;
 SELECT array_agg(t.source_message_id) INTO ids FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) own WHERE own->>'id'=p.id::text AND (own->>'market_state_version')::bigint=version);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ARRAY[ids[1],source_id,proof.source_message_id,proof.original_message_id]) ORDER BY z.id FOR UPDATE;
 legal:=gridex_ediel_inbound_context.require_v1(p_company_id,proof.source_message_id);
 SELECT * INTO initial_message FROM public.ediel_messages WHERE id=proof.source_message_id AND company_id=p_company_id;
 SELECT * INTO initial_transition FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=proof.source_message_id AND company_id=p_company_id;
 initial_wire:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,initial_message.id,p.id),gridex_received_sources.normal_switch_wire_v1(initial_message.raw_payload));
 IF initial_message.direction IS DISTINCT FROM 'inbound' OR initial_message.message_family IS DISTINCT FROM 'PRODAT' OR initial_message.message_code IS DISTINCT FROM 'Z04'
  OR initial_transition.payload_hash IS DISTINCT FROM encode(sha256(convert_to(initial_message.raw_payload,'UTF8')),'hex')
  OR initial_wire->>'receiver' IS DISTINCT FROM proof.legal_context->>'legalEdielId' OR nullif(initial_wire->>'sender','') IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(initial_wire->'objects') own WHERE own=proof.source_object)<>1
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=initial_message.id AND v.company_id=p_company_id AND v.environment=initial_message.environment AND v.source_payload_hash=initial_transition.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND ((v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.supply_effect_assessment_owns_period_v1(p_company_id,v.source_message_id,p.id,v.id)) OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
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
  OR (((to_jsonb(p)-ARRAY['updated_at','status']) IS DISTINCT FROM (baseline-ARRAY['updated_at','status'])
  OR (p.status IS DISTINCT FROM baseline->>'status' AND NOT(p.status='ended' AND baseline->>'status'='ending' AND p.market_end_at<=now())))
   -- H3c (20261023201000): a manual end after this received state (gridex_close_customer_lifecycle_v1, or
   -- gridex_end_customer_supply_v1 'move_out' without a source message) may shorten the period, never extend it.
   AND (gridex_received_sources.manual_billing_continuation_qualified_v1(p_company_id,p_period_id,p_start,p_end) IS TRUE AND p.end_date IS NOT NULL AND p.end_date>=p.start_date AND p.end_date<=coalesce((baseline->>'end_date')::date,p.end_date)
    AND p_end<=((p.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm') AND baseline->>'status' IN('active','confirmed_by_grid_owner')
    AND (to_jsonb(p)-ARRAY['updated_at','status','end_date','actual_end_date','metadata'])=(baseline-ARRAY['updated_at','status','end_date','actual_end_date','metadata'])
    AND (CASE WHEN jsonb_typeof(p.metadata)='object' THEN p.metadata ELSE '{}' END-ARRAY['planned_end_source','planned_end_reason','planned_end_recorded_at','end_reason','end_key','ended_by_grid_owner_at'])
     =(CASE WHEN jsonb_typeof(baseline->'metadata')='object' THEN baseline->'metadata' ELSE '{}' END-ARRAY['planned_end_source','planned_end_reason','planned_end_recorded_at','end_reason','end_key','ended_by_grid_owner_at'])
    AND ((p.metadata->'planned_end_source',p.metadata->'planned_end_reason',p.metadata->'planned_end_recorded_at')
      IS NOT DISTINCT FROM (baseline#>'{metadata,planned_end_source}',baseline#>'{metadata,planned_end_reason}',baseline#>'{metadata,planned_end_recorded_at}')
     OR p.metadata->>'planned_end_source'='customer_lifecycle_close' AND p.metadata->>'planned_end_reason' IN('move_out','terminate','grid_contract_ended') AND p.metadata->>'planned_end_recorded_at' IS NOT NULL)
    AND ((p.metadata->'end_reason',p.metadata->'end_key',p.metadata->'ended_by_grid_owner_at')
      IS NOT DISTINCT FROM (baseline#>'{metadata,end_reason}',baseline#>'{metadata,end_key}',baseline#>'{metadata,ended_by_grid_owner_at}')
      AND p.metadata->'planned_end_recorded_at' IS DISTINCT FROM baseline#>'{metadata,planned_end_recorded_at}'
      AND p.status=baseline->>'status' AND to_jsonb(p)->'actual_end_date' IS NOT DISTINCT FROM baseline->'actual_end_date'
     OR p.metadata->'end_key' IS DISTINCT FROM baseline#>'{metadata,end_key}' AND p.metadata->>'end_reason'='move_out'
      AND p.metadata->>'end_key'=p.metering_point_id::text||':'||to_char(p.end_date,'YYYY-MM-DD') AND p.metadata->>'ended_by_grid_owner_at' IS NOT NULL
      AND p.status='ended' AND p.actual_end_date=p.end_date)) IS NOT TRUE)
  OR (s.status IS DISTINCT FROM proof.confirmed_switch->>'status' AND NOT(s.status='completed' AND activation.period_id IS NOT NULL)) THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=proof.original_message_id AND company_id=p_company_id AND environment=m.environment;
 SELECT * INTO c FROM public.customer_contracts WHERE id=proof.contract_id AND company_id=p_company_id FOR SHARE;
 IF origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE OR origin.immutable_payload_hash IS DISTINCT FROM proof.original_payload_hash OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
  OR c.id IS NULL OR c.customer_id IS DISTINCT FROM p.customer_id OR c.metering_point_id IS DISTINCT FROM p.metering_point_id OR (c.status IN('signed','active') OR c.status='terminated' AND (c.termination_reason='supply_end' OR c.termination_reason IN('move_out','grid_contract_ended','customer_termination') AND gridex_received_sources.manual_billing_continuation_qualified_v1(p_company_id,p_period_id,p_start,p_end) IS TRUE) AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL
   AND ((c.ended_at AT TIME ZONE 'UTC')::date>=p.end_date OR (c.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=p.end_date)) IS NOT TRUE OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM proof.protected_contract_hash
  OR legal->>'legalActorId' IS DISTINCT FROM proof.legal_context->>'legalActorId' OR legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier'
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=tr.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND ((v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.supply_effect_assessment_owns_period_v1(p_company_id,v.source_message_id,p.id,v.id)) OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 accepted_original:=gridex_ediel_transport.accepted_source_basis_v1(origin);
 IF accepted_original IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('qualified',true,'periodId',p.id,'companyId',p.company_id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'siteId',coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id'),'switchId',proof.switch_id,
  'sourceMessageId',m.id,'initialSourceMessageId',proof.source_message_id,'currentSourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,
  'legalActorId',proof.legal_context->>'legalActorId','sourceObjects',jsonb_build_array(proof.source_object),'dsoEdielId',initial_wire->>'sender','originalMessageId',origin.id,'originalPayloadHash',origin.immutable_payload_hash,'originalAcceptedAt',accepted_original->>'observedAt','activated',activation.period_id IS NOT NULL);
END $replacement$;EXECUTE replace(f.definition,f.prosrc,b);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'manual_received_end_function_metadata_changed';END IF;
END$patch$;
REVOKE ALL ON FUNCTION gridex_received_sources.manual_end_for_received_v1(uuid,uuid),gridex_received_sources.record_manual_received_end_v1(uuid,uuid,uuid),gridex_received_sources.manual_received_source_basis_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
