-- E corrections retain the immediate failed original and a bounded immutable
-- path to the independently classified event. No intent or metadata alias is
-- made authoritative, and a successful previously omitted scope cannot return.
BEGIN;
CREATE FUNCTION gridex_customer_life_events.recovery_lineage_v1(c uuid,operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;prior gridex_received_sources.prodat_recovery_operations%rowtype;
 own gridex_customer_life_events.originals%rowtype;mid uuid;seen uuid[]:=ARRAY[]::uuid[];source_ids uuid[];steps jsonb:='[]';depth integer;
BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=operation AND company_id=c;
 IF op.id IS NULL OR(op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE THEN RETURN NULL;END IF;
 mid:=op.original_message_id;source_ids:=ARRAY[mid,op.source_ack_message_id];
 FOR depth IN 1..32 LOOP
  IF mid IS NULL OR mid=ANY(seen) THEN RAISE EXCEPTION 'customer_life_event_recovery_lineage_cycle';END IF;
  seen:=array_append(seen,mid);
  SELECT * INTO own FROM gridex_customer_life_events.originals WHERE message_id=mid AND company_id=c;
  IF own.message_id IS NOT NULL THEN
   RETURN jsonb_build_object('classifiedOriginalMessageId',mid,'immediateOriginalMessageId',op.original_message_id,'steps',steps,'sourceIds',
    (SELECT jsonb_agg(x ORDER BY x) FROM(SELECT DISTINCT x FROM unnest(source_ids)x WHERE x IS NOT NULL)cohort));
  END IF;
  SELECT previous.* INTO prior FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations previous ON previous.id=link.operation_id
   WHERE link.message_id=mid AND previous.company_id=c;
  IF prior.id IS NULL THEN RETURN NULL;END IF;
  IF(prior.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE OR prior.original_message_id IS NULL OR prior.corrected_payload_hash IS NULL OR prior.source_ack_message_id IS NULL THEN RAISE EXCEPTION 'customer_life_event_recovery_lineage_unqualified';END IF;
  steps:=steps||jsonb_build_array(jsonb_build_object('messageId',mid,'operationId',prior.id,'originalMessageId',prior.original_message_id,'payloadHash',prior.corrected_payload_hash));
  source_ids:=source_ids||ARRAY[prior.original_message_id,prior.source_ack_message_id];mid:=prior.original_message_id;
 END LOOP;
 RAISE EXCEPTION 'customer_life_event_recovery_lineage_bound_exceeded';
END$$;
-- Only lock discovery. Provider owners invoke before dependent contract/event
-- locks; this function confers no rule, classification, retry or send grant.
CREATE FUNCTION gridex_customer_life_events.prelock_recovery_lineage_v1(c uuid,mid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation uuid;lineage jsonb;
BEGIN
 SELECT op.id INTO operation FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations op ON op.id=link.operation_id WHERE link.message_id=mid AND op.company_id=c;
 IF operation IS NULL THEN RETURN;END IF;
 lineage:=gridex_customer_life_events.recovery_lineage_v1(c,operation);
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=c AND (m.id=mid OR m.id IN(SELECT value::uuid FROM jsonb_array_elements_text(lineage->'sourceIds'))) ORDER BY m.id FOR UPDATE;
END$$;

CREATE OR REPLACE FUNCTION gridex_customer_life_events.recovery_basis_v1(c uuid,operation uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;qualified jsonb;op gridex_received_sources.prodat_recovery_operations%rowtype;lineage jsonb;step jsonb;original gridex_customer_life_events.originals%rowtype;
 base public.ediel_messages%rowtype;immediate public.ediel_messages%rowtype;alias_message public.ediel_messages%rowtype;previous public.ediel_messages%rowtype;
 b jsonb;corrected jsonb;source_wire jsonb;alias_wire jsonb;previous_wire jsonb;obj jsonb;facts jsonb:='[]';
BEGIN
 IF(phase IN('prepare','send')) IS NOT TRUE THEN RAISE EXCEPTION 'customer_life_event_recovery_phase_required';END IF;
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=operation AND company_id=c;
 lineage:=gridex_customer_life_events.recovery_lineage_v1(c,operation);IF lineage IS NULL THEN RETURN NULL;END IF;
 -- Immutable links discover the entire source/negative-ACK cohort before any
 -- current classified event/customer/contract qualification or dependent lock.
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=c AND m.id IN(SELECT value::uuid FROM jsonb_array_elements_text(lineage->'sourceIds')) ORDER BY m.id FOR UPDATE;
 IF gridex_customer_life_events.recovery_lineage_v1(c,operation) IS DISTINCT FROM lineage THEN RAISE EXCEPTION 'customer_life_event_recovery_lineage_changed';END IF;
 q:=public.ediel_prodat_recovery_operation_basis_v1(c,operation,actor);
 IF q IS NULL OR q->>'operationId' IS DISTINCT FROM op.id::text OR q->>'originalMessageId' IS DISTINCT FROM op.original_message_id::text OR q->>'correctedPayloadHash' IS DISTINCT FROM op.corrected_payload_hash THEN RAISE EXCEPTION 'customer_life_event_recovery_operation_required';END IF;
 SELECT * INTO original FROM gridex_customer_life_events.originals WHERE message_id=(lineage->>'classifiedOriginalMessageId')::uuid AND company_id=c;
 SELECT * INTO base FROM public.ediel_messages WHERE id=original.message_id AND company_id=c;
 SELECT * INTO immediate FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=c;
 IF base.id IS NULL OR immediate.id IS NULL OR base.environment IS DISTINCT FROM op.environment OR immediate.environment IS DISTINCT FROM op.environment
  OR base.direction IS DISTINCT FROM 'outbound' OR base.message_family IS DISTINCT FROM 'PRODAT' OR base.message_code IS DISTINCT FROM 'Z09'
  OR immediate.direction IS DISTINCT FROM 'outbound' OR immediate.message_family IS DISTINCT FROM 'PRODAT' OR immediate.message_code IS DISTINCT FROM 'Z09'
  OR original.payload_hash IS DISTINCT FROM encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex') OR base.immutable_payload_hash IS DISTINCT FROM original.payload_hash OR base.immutable_rendered_at IS NULL
  OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(immediate.raw_payload,'UTF8')),'hex') OR immediate.immutable_payload_hash IS DISTINCT FROM op.original_payload_hash OR immediate.immutable_rendered_at IS NULL THEN RAISE EXCEPTION 'customer_life_event_recovery_original_source_changed';END IF;
 FOR step IN SELECT value FROM jsonb_array_elements(lineage->'steps') LOOP
  qualified:=public.ediel_prodat_recovery_original_basis_v1(c,(step->>'messageId')::uuid,actor);
  SELECT * INTO alias_message FROM public.ediel_messages WHERE id=(step->>'messageId')::uuid AND company_id=c;
  SELECT * INTO previous FROM public.ediel_messages WHERE id=(step->>'originalMessageId')::uuid AND company_id=c;
  alias_wire:=gridex_customer_life_events.wire_v1(alias_message.raw_payload);previous_wire:=gridex_customer_life_events.wire_v1(previous.raw_payload);
  IF qualified IS NULL OR qualified->>'operationId' IS DISTINCT FROM step->>'operationId' OR qualified->>'originalMessageId' IS DISTINCT FROM step->>'originalMessageId' OR qualified->>'correctedPayloadHash' IS DISTINCT FROM step->>'payloadHash'
   OR alias_message.environment IS DISTINCT FROM op.environment OR previous.environment IS DISTINCT FROM op.environment
   OR alias_message.original_message_id IS DISTINCT FROM previous.id OR alias_message.source_operation_id IS DISTINCT FROM step->>'operationId'
   OR alias_message.raw_payload IS NULL OR alias_message.immutable_rendered_at IS NULL OR alias_message.immutable_payload_hash IS DISTINCT FROM step->>'payloadHash' OR alias_message.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(alias_message.raw_payload,'UTF8')),'hex')
   OR alias_wire IS NULL OR previous_wire IS NULL OR alias_wire->>'code' IS DISTINCT FROM 'Z09' OR alias_wire->>'legalSender' IS DISTINCT FROM previous_wire->>'legalSender' OR alias_wire->>'legalReceiver' IS DISTINCT FROM previous_wire->>'legalReceiver'
   OR EXISTS(SELECT FROM jsonb_array_elements(alias_wire->'objects')own WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(previous_wire->'objects')approved WHERE approved=own)) THEN RAISE EXCEPTION 'customer_life_event_recovery_alias_source_changed';END IF;
 END LOOP;
 -- Today's independent classified-event source remains the SAME original owner.
 b:=gridex_customer_life_events.require_current_v1(c,base.id,actor,phase)->'basis';
 corrected:=gridex_customer_life_events.wire_v1(op.corrected_raw_payload);source_wire:=gridex_customer_life_events.wire_v1(immediate.raw_payload);
 IF b->>'status' IS DISTINCT FROM 'authorized' OR corrected IS NULL OR source_wire IS NULL OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(op.corrected_raw_payload,'UTF8')),'hex')
  OR corrected->>'code' IS DISTINCT FROM 'Z09' OR corrected->>'legalSender' IS DISTINCT FROM source_wire->>'legalSender' OR corrected->>'legalReceiver' IS DISTINCT FROM source_wire->>'legalReceiver' THEN RAISE EXCEPTION 'customer_life_event_recovery_current_source_required';END IF;
 FOR obj IN SELECT value FROM jsonb_array_elements(corrected->'objects') LOOP
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(source_wire->'objects')own WHERE own=obj) THEN RAISE EXCEPTION 'customer_life_event_recovery_approved_tuple_changed';END IF;
  facts:=facts||(SELECT coalesce(jsonb_agg(f),'[]') FROM jsonb_array_elements(b#>'{selection,objects}')f WHERE f#>>'{installation,id}'=obj->>'point' AND f#>>'{installation,agency}'=obj->>'identityAgency' AND f->>'lineItemReference'=obj->>'li');
 END LOOP;
 IF jsonb_array_length(facts) IS DISTINCT FROM jsonb_array_length(corrected->'objects') THEN RAISE EXCEPTION 'customer_life_event_recovery_whole_scope_required';END IF;
 RETURN b||jsonb_build_object('rawPayload',op.corrected_raw_payload,'recoveryOperationId',op.id,'originalMessageId',immediate.id,'classifiedOriginalMessageId',base.id,'selection',jsonb_set(b->'selection','{objects}',facts));
END$$;
REVOKE ALL ON FUNCTION gridex_customer_life_events.recovery_lineage_v1(uuid,uuid),gridex_customer_life_events.prelock_recovery_lineage_v1(uuid,uuid),gridex_customer_life_events.recovery_basis_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
