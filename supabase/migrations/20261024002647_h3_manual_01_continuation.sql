-- PRIVATE DESIGN CANDIDATE; not installed, not yet approved for integration.
-- Prospective receipt producer. Historical mutable metadata is never imported.
BEGIN;
DO $source_guard$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure) IS DISTINCT FROM 'c520bd2003548ad7b2eb39383eb9c7d0a7deb7b10e0cde3b47c4eff29e7ce9f9' THEN RAISE EXCEPTION 'manual_billing_source_predecessor_required';END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)'::regprocedure) IS DISTINCT FROM 'bb199ad37956b3e07ce0bee093f024c184d4f7f5e732e901ec7329a54d0558c7' THEN RAISE EXCEPTION 'manual_billing_source_predecessor_required';END IF;
END$source_guard$;
CREATE TABLE gridex_received_sources.manual_billing_continuations_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, period_id uuid NOT NULL,
 contract_id uuid NOT NULL, customer_id uuid NOT NULL, actor_user_id uuid NOT NULL,
 command text NOT NULL CHECK(command IN('supply_move_out','customer_lifecycle')),
 end_date date NOT NULL, original_period jsonb NOT NULL, original_contract_status text NOT NULL,
 original_contract_hash text NOT NULL, original_basis jsonb NOT NULL,
 resulting_period_hash text NOT NULL, resulting_contract_hash text NOT NULL,
 contract_disposition text NOT NULL CHECK(contract_disposition IN('continues','terminated')),
 contract_event_id uuid, contract_event_hash text, captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,period_id,contract_event_id),
 UNIQUE(company_id,period_id,resulting_period_hash,resulting_contract_hash),
 CHECK((contract_disposition='terminated' AND contract_event_id IS NOT NULL AND contract_event_hash IS NOT NULL)
  OR (contract_disposition='continues' AND contract_event_id IS NULL AND contract_event_hash IS NULL)),
 CHECK(original_contract_status IN('signed','active')),
 CHECK(original_basis->>'qualified'='true' AND original_basis->>'activated'='true')
);
ALTER TABLE gridex_received_sources.manual_billing_continuations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.manual_billing_continuations_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX manual_billing_continuations_period_v1 ON gridex_received_sources.manual_billing_continuations_v1(company_id,period_id);
CREATE FUNCTION gridex_received_sources.manual_billing_continuation_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'manual_billing_continuation_immutable';END$$;
CREATE TRIGGER manual_billing_continuation_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON gridex_received_sources.manual_billing_continuations_v1
 FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.manual_billing_continuation_immutable_v1();
ALTER TABLE gridex_received_sources.manual_billing_continuations_v1 ENABLE ALWAYS TRIGGER manual_billing_continuation_immutable_v1;

-- Internal callers derive this basis from the actual source verifier or the
-- append-only receipt. No caller-supplied source list grants availability.
CREATE FUNCTION gridex_received_sources.require_manual_billing_records_v1(c uuid,contract uuid,b jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE source uuid;BEGIN
 IF c IS NULL OR contract IS NULL OR b->>'companyId' IS DISTINCT FROM c::text
  OR b->>'qualified' IS DISTINCT FROM 'true' OR b->>'activated' IS DISTINCT FROM 'true'
  OR nullif(b->>'initialSourceMessageId','') IS NULL OR nullif(b->>'currentSourceMessageId','') IS NULL
  OR nullif(b->>'originalMessageId','') IS NULL THEN RAISE EXCEPTION 'manual_billing_record_scope_required';END IF;
 PERFORM public.ediel_require_contract_records_available_v1(c,contract);
 FOR source IN SELECT DISTINCT v::uuid FROM unnest(ARRAY[b->>'initialSourceMessageId',b->>'currentSourceMessageId',b->>'originalMessageId'])v LOOP
  PERFORM public.ediel_require_source_bytes_available_v1(c,source);
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.require_manual_billing_records_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.prepare_manual_billing_v1(c uuid, customer uuid, point uuid, ending date, actor uuid, command text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;b jsonb;prepared jsonb:='[]';finish timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR c IS NULL OR customer IS NULL OR ending IS NULL
  OR command NOT IN('supply_move_out','customer_lifecycle') OR actor IS NULL
  OR public.gridex_actor_has_company_permission(actor,c,'customers.write') IS NOT TRUE
  OR public.gridex_actor_has_company_permission(actor,c,'contracts.write') IS NOT TRUE THEN RETURN prepared;END IF;
 -- Follow the received-source graph lock order before any customer/period lock.
 PERFORM gridex_bilateral_prodat.lock_supply_v1();PERFORM gridex_regulated_supply.lock_graph_v1();
 PERFORM id FROM public.customers WHERE id=customer AND company_id=c FOR UPDATE;
 finish:=(ending+1)::timestamp AT TIME ZONE 'Europe/Stockholm';
 FOR p IN SELECT s.* FROM public.customer_supply_periods s WHERE s.company_id=c AND s.customer_id=customer
  AND (point IS NULL OR s.metering_point_id=point) AND s.status IN('active','confirmed_by_grid_owner')
  AND s.start_date<=ending AND (s.end_date IS NULL OR s.end_date>ending OR (command='supply_move_out' AND s.end_date=ending)) ORDER BY s.id FOR UPDATE LOOP
  SELECT * INTO ct FROM public.customer_contracts WHERE id=p.contract_id AND company_id=c AND customer_id=customer FOR UPDATE;
  IF ct.id IS NULL OR ct.status NOT IN('signed','active') OR ct.metering_point_id IS DISTINCT FROM p.metering_point_id
   OR p.market_start_at IS NULL OR p.market_start_at>=finish OR p.source_end_message_id IS NOT NULL
   OR NOT EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations n WHERE n.period_id=p.id AND n.company_id=c) THEN CONTINUE;END IF;
  BEGIN
   b:=gridex_received_sources.billing_supply_basis_v1(c,p.id,p.market_start_at,finish);
   IF b->>'qualified'='true' AND b->>'activated'='true' THEN PERFORM gridex_received_sources.require_manual_billing_records_v1(c,ct.id,b);END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' OR insufficient_privilege OR check_violation THEN
   -- These existing authority refusals produce no billing continuation. The
   -- manual operation keeps its prior behavior and its billing remains held.
   CONTINUE;
  END;
  IF b->>'qualified' IS DISTINCT FROM 'true' OR b->>'activated' IS DISTINCT FROM 'true' THEN CONTINUE;END IF;
  prepared:=prepared||jsonb_build_array(jsonb_build_object('period',to_jsonb(p),'contractStatus',ct.status,
   'contractHash',gridex_received_sources.production_contract_hash_v1(ct),'contractStateHash',encode(sha256(convert_to(to_jsonb(ct)::text,'UTF8')),'hex'),'basis',b,'actor',actor,'command',command,'end',ending,
   'existingEvents',(SELECT coalesce(jsonb_agg(e.id),'[]') FROM public.customer_contract_events e WHERE e.company_id=c AND e.customer_contract_id=ct.id)));
 END LOOP;
 RETURN prepared;
END$$;

CREATE FUNCTION gridex_received_sources.finish_manual_billing_v1(prepared jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;before_p public.customer_supply_periods%rowtype;p public.customer_supply_periods%rowtype;ct public.customer_contracts%rowtype;
 e public.customer_contract_events%rowtype;ending date;actor uuid;allowed text[];expected_key text;command text;disposition text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'manual_billing_service_required';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(prepared) LOOP
  before_p:=jsonb_populate_record(NULL::public.customer_supply_periods,item->'period');ending:=(item->>'end')::date;actor:=(item->>'actor')::uuid;command:=item->>'command';
  SELECT * INTO p FROM public.customer_supply_periods WHERE id=before_p.id AND company_id=before_p.company_id FOR UPDATE;
  SELECT * INTO ct FROM public.customer_contracts WHERE id=before_p.contract_id AND company_id=before_p.company_id FOR UPDATE;
  IF p.id IS NULL OR ct.id IS NULL
   OR ct.customer_id IS DISTINCT FROM before_p.customer_id OR ct.metering_point_id IS DISTINCT FROM before_p.metering_point_id
   OR gridex_received_sources.production_contract_hash_v1(ct) IS DISTINCT FROM item->>'contractHash'
   OR p.end_date IS DISTINCT FROM ending
   OR public.gridex_actor_has_company_permission(actor,p.company_id,'customers.write') IS NOT TRUE
   OR public.gridex_actor_has_company_permission(actor,p.company_id,'contracts.write') IS NOT TRUE THEN CONTINUE;END IF;
  IF command='supply_move_out' AND ct.status IN('signed','active') AND ct.status=item->>'contractStatus'
   AND encode(sha256(convert_to(to_jsonb(ct)::text,'UTF8')),'hex')=item->>'contractStateHash' THEN disposition:='continues';
  ELSIF ct.status='terminated' AND ct.termination_reason IN('move_out','grid_contract_ended','customer_termination') AND ct.ended_at IS NOT NULL
   AND ((ct.ended_at AT TIME ZONE 'UTC')::date>=ending OR (ct.ended_at AT TIME ZONE 'Europe/Stockholm')::date>=ending) THEN disposition:='terminated';
  ELSE CONTINUE;END IF;
  IF command='supply_move_out' THEN
   allowed:=ARRAY['end_date','actual_end_date','status','metadata','updated_at'];expected_key:='supply-end:'||ct.id||':'||p.metering_point_id||':'||ending;
   IF p.status IS DISTINCT FROM 'ended' OR p.actual_end_date IS DISTINCT FROM ending
    OR p.metadata IS DISTINCT FROM (coalesce(before_p.metadata,'{}')||jsonb_build_object('end_reason','move_out','end_key',p.metering_point_id||':'||ending,'ended_by_grid_owner_at',now())) THEN CONTINUE;END IF;
  ELSIF command='customer_lifecycle' THEN
   allowed:=ARRAY['end_date','metadata','updated_at'];expected_key:='customer-lifecycle-close:'||p.customer_id||':'||ct.id;
   IF p.metadata IS DISTINCT FROM (coalesce(before_p.metadata,'{}')||jsonb_build_object('planned_end_source','customer_lifecycle_close','planned_end_reason',p.metadata->>'planned_end_reason','planned_end_recorded_at',now()))
    OR p.metadata->>'planned_end_reason' NOT IN('move_out','terminate','grid_contract_ended') THEN CONTINUE;END IF;
  ELSE CONTINUE;END IF;
  IF (to_jsonb(p)-allowed) IS DISTINCT FROM (to_jsonb(before_p)-allowed) THEN CONTINUE;END IF;
  e:=NULL;
  IF disposition='terminated' THEN
   SELECT * INTO e FROM public.customer_contract_events z WHERE z.company_id=p.company_id AND z.customer_id=p.customer_id
   AND z.customer_contract_id=ct.id AND z.actor_user_id=actor AND z.event_type='terminated'
   AND z.metadata->>'idempotency_key'=expected_key AND z.metadata->>'termination_reason'=ct.termination_reason AND ct.termination_reason=CASE WHEN command='supply_move_out' THEN 'move_out' WHEN p.metadata->>'planned_end_reason'='terminate' THEN 'customer_termination' ELSE p.metadata->>'planned_end_reason' END
   AND z.metadata->>'ends_at'=ending::text AND NOT(item->'existingEvents' @> jsonb_build_array(z.id)) ORDER BY z.id LIMIT 1 FOR SHARE;
   IF e.id IS NULL THEN CONTINUE;END IF;
  END IF;
  BEGIN
   PERFORM gridex_received_sources.require_manual_billing_records_v1(p.company_id,ct.id,item->'basis');
  EXCEPTION WHEN SQLSTATE 'P0001' OR insufficient_privilege OR check_violation THEN CONTINUE;END;
  INSERT INTO gridex_received_sources.manual_billing_continuations_v1(company_id,period_id,contract_id,customer_id,actor_user_id,command,end_date,
   original_period,original_contract_status,original_contract_hash,original_basis,resulting_period_hash,resulting_contract_hash,contract_disposition,contract_event_id,contract_event_hash)
  VALUES(p.company_id,p.id,ct.id,p.customer_id,actor,command,ending,to_jsonb(before_p),item->>'contractStatus',item->>'contractHash',item->'basis',
   encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),encode(sha256(convert_to(to_jsonb(ct)::text,'UTF8')),'hex'),disposition,e.id,CASE WHEN disposition='terminated' THEN encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') END) ON CONFLICT DO NOTHING;
 END LOOP;
END$$;
CREATE FUNCTION gridex_received_sources.manual_billing_source_basis_v1(p_company_id uuid, p_period_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_receipt_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE receipt gridex_received_sources.manual_billing_continuations_v1%rowtype;actual_period public.customer_supply_periods%rowtype;actual_contract public.customer_contracts%rowtype;receipt_event public.customer_contract_events%rowtype;
DECLARE p public.customer_supply_periods%rowtype;proof gridex_received_sources.normal_switch_confirmations%rowtype;
 tr gridex_received_sources.supply_source_transitions%rowtype;activation gridex_received_sources.normal_supply_activations%rowtype;
 m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;initial_message public.ediel_messages%rowtype;c public.customer_contracts%rowtype;s public.supplier_switch_requests%rowtype;
 expected jsonb;baseline jsonb;legal jsonb;initial_owned jsonb;source_objects jsonb;initial_wire jsonb;accepted_original jsonb;initial_transition gridex_received_sources.supply_source_transitions%rowtype;ids uuid[];version bigint;source_id uuid;
BEGIN
 SELECT * INTO receipt FROM gridex_received_sources.manual_billing_continuations_v1 WHERE id=p_receipt_id AND company_id=p_company_id AND period_id=p_period_id FOR SHARE;
 IF receipt.id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start
  OR p_end>(receipt.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm' THEN RETURN NULL;END IF;
 PERFORM gridex_bilateral_prodat.lock_supply_v1();PERFORM gridex_regulated_supply.lock_graph_v1();
 SELECT * INTO actual_period FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO actual_contract FROM public.customer_contracts WHERE id=receipt.contract_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO receipt_event FROM public.customer_contract_events WHERE id=receipt.contract_event_id AND company_id=p_company_id FOR SHARE;
 IF actual_period.id IS NULL OR actual_contract.id IS NULL
  OR actual_period.customer_id IS DISTINCT FROM receipt.customer_id OR actual_period.contract_id IS DISTINCT FROM receipt.contract_id
  OR actual_contract.customer_id IS DISTINCT FROM receipt.customer_id
  OR (receipt.contract_disposition='terminated' AND (receipt_event.id IS NULL OR actual_contract.status IS DISTINCT FROM 'terminated' OR NOT coalesce(actual_contract.termination_reason IN('move_out','grid_contract_ended','customer_termination'),false)
   OR encode(sha256(convert_to(to_jsonb(receipt_event)::text,'UTF8')),'hex') IS DISTINCT FROM receipt.contract_event_hash))
  OR (receipt.contract_disposition='continues' AND (actual_contract.status IS DISTINCT FROM receipt.original_contract_status OR actual_contract.status NOT IN('signed','active') OR receipt.contract_event_id IS NOT NULL OR receipt.contract_event_hash IS NOT NULL))
  OR encode(sha256(convert_to(to_jsonb(actual_period)::text,'UTF8')),'hex') IS DISTINCT FROM receipt.resulting_period_hash
  OR encode(sha256(convert_to(to_jsonb(actual_contract)::text,'UTF8')),'hex') IS DISTINCT FROM receipt.resulting_contract_hash
  OR gridex_received_sources.production_contract_hash_v1(actual_contract) IS DISTINCT FROM receipt.original_contract_hash
  OR receipt.original_period->>'id' IS DISTINCT FROM p_period_id::text OR receipt.original_period->>'company_id' IS DISTINCT FROM p_company_id::text
  OR receipt.original_basis->>'periodId' IS DISTINCT FROM p_period_id::text OR receipt.original_basis->>'companyId' IS DISTINCT FROM p_company_id::text
  OR receipt.original_basis->>'qualified' IS DISTINCT FROM 'true' OR receipt.original_basis->>'activated' IS DISTINCT FROM 'true'
  OR receipt.original_period->>'customer_id' IS DISTINCT FROM receipt.customer_id::text
  OR receipt.original_period->>'contract_id' IS DISTINCT FROM receipt.contract_id::text THEN RETURN NULL;END IF;
 PERFORM gridex_received_sources.require_manual_billing_records_v1(p_company_id,receipt.contract_id,receipt.original_basis);
 PERFORM gridex_bilateral_prodat.lock_supply_v1();
 PERFORM gridex_regulated_supply.lock_graph_v1();
 IF p_company_id IS NULL OR p_period_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN RETURN NULL;END IF;
 p:=jsonb_populate_record(NULL::public.customer_supply_periods,receipt.original_period);
 IF p.id IS NULL THEN RETURN NULL;END IF;
 IF p.source_process IN('assigned_supply','production_receipt_obligation') AND gridex_regulated_supply.ground_current_v1((p.metadata->>'sourceGroundId')::uuid,p_company_id,p.metering_point_id,p.market_start_at) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=p.id AND company_id=p_company_id;
 IF NOT FOUND THEN
  baseline:=gridex_received_sources.billing_supply_before_normal_switch_v1(p_company_id,p_period_id,p_start,p_end);
  IF baseline IS NULL THEN RETURN NULL;END IF;
  p:=jsonb_populate_record(NULL::public.customer_supply_periods,receipt.original_period);
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
 p:=jsonb_populate_record(NULL::public.customer_supply_periods,receipt.original_period);
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
 IF c.id IS DISTINCT FROM receipt.contract_id THEN RETURN NULL;END IF;
 c.status:=receipt.original_contract_status;
 IF origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE OR origin.immutable_payload_hash IS DISTINCT FROM proof.original_payload_hash OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
  OR c.id IS NULL OR c.customer_id IS DISTINCT FROM p.customer_id OR c.metering_point_id IS DISTINCT FROM p.metering_point_id OR (c.status IN('signed','active') OR c.status='terminated' AND c.termination_reason='supply_end' AND p.end_date IS NOT NULL AND c.ended_at IS NOT NULL
   AND ((c.ended_at AT TIME ZONE 'UTC')::date=p.end_date OR (c.ended_at AT TIME ZONE 'Europe/Stockholm')::date=p.end_date)) IS NOT TRUE OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM proof.protected_contract_hash
  OR legal->>'legalActorId' IS DISTINCT FROM proof.legal_context->>'legalActorId' OR legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier'
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=tr.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND ((v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.supply_effect_assessment_owns_period_v1(p_company_id,v.source_message_id,p.id,v.id)) OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 accepted_original:=gridex_ediel_transport.accepted_source_basis_v1(origin);
 IF accepted_original IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('manualContinuationId',receipt.id,'manualBillingEndAt',(receipt.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm','qualified',true,'periodId',p.id,'companyId',p.company_id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'siteId',coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id'),'switchId',proof.switch_id,
  'sourceMessageId',m.id,'initialSourceMessageId',proof.source_message_id,'currentSourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,
  'legalActorId',proof.legal_context->>'legalActorId','sourceObjects',jsonb_build_array(proof.source_object),'dsoEdielId',initial_wire->>'sender','originalMessageId',origin.id,'originalPayloadHash',origin.immutable_payload_hash,'originalAcceptedAt',accepted_original->>'observedAt','activated',activation.period_id IS NOT NULL);
END $$;

CREATE FUNCTION gridex_received_sources.manual_billing_continuation_qualified_v1(c uuid,p uuid,starting timestamptz,ending timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r record;BEGIN
 FOR r IN SELECT id FROM gridex_received_sources.manual_billing_continuations_v1 WHERE company_id=c AND period_id=p ORDER BY captured_at,id LOOP
  IF gridex_received_sources.manual_billing_source_basis_v1(c,p,starting,ending,r.id) IS NOT NULL THEN RETURN true;END IF;
 END LOOP;
 RETURN false;
END$$;

DO $guard$ DECLARE f record;b text;needle text;replacement text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '37b236ff81f79a93ed90422ccc1f8e57fb85d47139f2568c06a398b260eac51a' THEN RAISE EXCEPTION 'manual_billing_exact_predecessor_required:gridex_end_customer_supply_v1';END IF;
 b:=f.prosrc;
 needle:=$needle$declare
$needle$;replacement:=$replacement$declare
  v_manual_billing_prepared jsonb := '[]';
$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$  select * into v_customer
$needle$;replacement:=$replacement$  IF p_end_reason='move_out' AND p_source_message_id IS NULL THEN
    v_manual_billing_prepared := gridex_received_sources.prepare_manual_billing_v1(p_company_id,p_customer_id,p_metering_point_id,p_end_date,p_actor_user_id,'supply_move_out');
  END IF;
  select * into v_customer
$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$  return jsonb_build_object(
    'supply_period_id', v_period.id,$needle$;replacement:=$replacement$  PERFORM gridex_received_sources.finish_manual_billing_v1(v_manual_billing_prepared);

  return jsonb_build_object(
    'supply_period_id', v_period.id,$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 EXECUTE replace(f.definition,f.prosrc,b);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata OR (SELECT prosrc FROM pg_proc WHERE oid=f.oid) IS DISTINCT FROM b THEN RAISE EXCEPTION 'manual_billing_metadata_changed';END IF;
END$guard$;

DO $guard$ DECLARE f record;b text;needle text;replacement text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_close_customer_lifecycle_v2(uuid,uuid,uuid,text,date,text,text,boolean,date)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM '179ae66fb9ee97fb90b83d95e331ff088afbe7aef4df6a37916a5459f97ac631' THEN RAISE EXCEPTION 'manual_billing_exact_predecessor_required:gridex_close_customer_lifecycle_v2';END IF;
 b:=f.prosrc;
 needle:=$needle$declare
$needle$;replacement:=$replacement$declare
  v_manual_billing_prepared jsonb := '[]';
$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$  select * into v_before
$needle$;replacement:=$replacement$  v_manual_billing_prepared := gridex_received_sources.prepare_manual_billing_v1(p_company_id,p_customer_id,NULL,p_move_out_date,p_actor_user_id,'customer_lifecycle');

  select * into v_before
$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$  return jsonb_build_object(
    'customer_before', to_jsonb(v_before),$needle$;replacement:=$replacement$  PERFORM gridex_received_sources.finish_manual_billing_v1(v_manual_billing_prepared);

  return jsonb_build_object(
    'customer_before', to_jsonb(v_before),$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 EXECUTE replace(f.definition,f.prosrc,b);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata OR (SELECT prosrc FROM pg_proc WHERE oid=f.oid) IS DISTINCT FROM b THEN RAISE EXCEPTION 'manual_billing_metadata_changed';END IF;
END$guard$;

DO $guard$ DECLARE f record;b text;needle text;replacement text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'c520bd2003548ad7b2eb39383eb9c7d0a7deb7b10e0cde3b47c4eff29e7ce9f9' THEN RAISE EXCEPTION 'manual_billing_exact_predecessor_required:gridex_received_sources.supply_period_source_basis_v1';END IF;
 b:=f.prosrc;
 needle:=$needle$AND (p.end_date IS NOT NULL AND p.end_date>=p.start_date AND p.end_date<=coalesce((baseline->>'end_date')::date,p.end_date)$needle$;replacement:=$replacement$AND (gridex_received_sources.manual_billing_continuation_qualified_v1(p_company_id,p_period_id,p_start,p_end) IS TRUE AND p.end_date IS NOT NULL AND p.end_date>=p.start_date AND p.end_date<=coalesce((baseline->>'end_date')::date,p.end_date)$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 needle:=$needle$c.termination_reason IN('supply_end','move_out','grid_contract_ended','customer_termination')$needle$;replacement:=$replacement$(c.termination_reason='supply_end' OR c.termination_reason IN('move_out','grid_contract_ended','customer_termination') AND gridex_received_sources.manual_billing_continuation_qualified_v1(p_company_id,p_period_id,p_start,p_end) IS TRUE)$replacement$;
 IF (length(b)-length(replace(b,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'manual_billing_exact_needle_required';END IF;
 b:=replace(b,needle,replacement);
 EXECUTE replace(f.definition,f.prosrc,b);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata OR (SELECT prosrc FROM pg_proc WHERE oid=f.oid) IS DISTINCT FROM b THEN RAISE EXCEPTION 'manual_billing_metadata_changed';END IF;
END$guard$;

REVOKE ALL ON FUNCTION gridex_received_sources.prepare_manual_billing_v1(uuid,uuid,uuid,date,uuid,text),gridex_received_sources.finish_manual_billing_v1(jsonb),gridex_received_sources.manual_billing_source_basis_v1(uuid,uuid,timestamptz,timestamptz,uuid),gridex_received_sources.manual_billing_continuation_qualified_v1(uuid,uuid,timestamptz,timestamptz),gridex_received_sources.manual_billing_continuation_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
