-- SC-037 component: a late negative ACK retains an already confirmed dispatch.
-- Only single-object, single-LIN Z03 originals are supported here. Multi-object
-- or collapsed repeated-LIN originals retain the existing negative behavior.
-- All protocol-negative columns, immutable outcomes and diagnostics remain exact;
-- this never revives failed originals or authorizes activation. Existing current
-- period/contract/legal/cancellation/start-time gates still own business effects.
-- Read only protected confirmation/capture/transition history under the existing
-- ACK message mutex; acquire no mutable supply locks in the opposite order.
BEGIN;
DO $migration$
DECLARE
 target CONSTANT regprocedure := 'gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)'::regprocedure;
 old_hash CONSTANT text := '411317aec4133e8b580331c5202264c29de10fe31bc0330e7236d99a03c9e692';
 new_hash CONSTANT text := '2d6de050f3b0ee503eacd82396806cbef45dce63e1380e95bd4ca4869e8f4c19';
 old_fragment CONSTANT text := $old$status=CASE WHEN whole_negative THEN 'failed' WHEN source_accepted THEN 'acknowledged' ELSE status END,$old$;
 new_fragment CONSTANT text := $new$status=CASE WHEN whole_negative AND source.direction='outbound'
   AND source.message_family='PRODAT' AND source.message_code='Z03'
   AND source.status IN ('sent','acknowledged')
   AND (SELECT count(*)=1
    FROM (SELECT gridex_received_sources.normal_switch_wire_v1(source.raw_payload) AS wire) original_wire
    JOIN gridex_received_sources.normal_switch_confirmations confirmation
     ON confirmation.company_id=source.company_id
      AND confirmation.original_message_id=source.id
      AND confirmation.original_payload_hash=source.immutable_payload_hash
    JOIN public.ediel_messages confirmed
     ON confirmed.id=confirmation.source_message_id AND confirmed.company_id=source.company_id
      AND confirmed.environment=source.environment AND confirmed.direction='inbound'
      AND confirmed.message_standard='edifact' AND confirmed.message_family='PRODAT' AND confirmed.message_code='Z04'
    JOIN gridex_received_sources.sources confirmation_capture
     ON confirmation_capture.source_message_id=confirmed.id AND confirmation_capture.company_id=confirmed.company_id
      AND confirmation_capture.environment=confirmed.environment AND confirmation_capture.origin='database_insert'
      AND confirmation_capture.message_code='Z04' AND confirmation_capture.source_received_at IS NOT NULL AND confirmation_capture.received_context IS NOT NULL
      AND confirmation_capture.raw_payload=confirmed.raw_payload AND confirmation_capture.payload_hash=confirmed.immutable_payload_hash
      AND confirmation_capture.payload_hash=encode(sha256(convert_to(confirmed.raw_payload,'UTF8')),'hex')
    JOIN gridex_received_sources.supply_source_transitions transition
     ON transition.source_message_id=confirmed.id AND transition.company_id=confirmed.company_id
      AND transition.source_code='Z04' AND transition.payload_hash=confirmation_capture.payload_hash
      AND confirmation.switch_id=ANY(transition.qualified_switch_ids)
    WHERE original_wire.wire->>'code'='Z03'
     AND jsonb_array_length(CASE WHEN jsonb_typeof(original_wire.wire->'objects')='array' THEN original_wire.wire->'objects' ELSE '[]'::jsonb END)=1
     AND ((original_wire.wire#>>'{objects,0,point}' IS NOT NULL AND original_wire.wire#>'{objects,0,registerCount}'='1'::jsonb)
      OR (original_wire.wire#>>'{objects,0,point}' IS NULL AND original_wire.wire#>'{objects,0,registerCount}'='0'::jsonb))
     AND (SELECT count(*) FROM jsonb_array_elements(coalesce(gridex_received_sources.closure_wire_tokens_v2(source.raw_payload),'[]'::jsonb)) token WHERE token->>'tag'='LIN')=1
     AND original_wire.wire#>>'{objects,0,li}'=confirmation.source_object->>'li'
     AND original_wire.wire#>>'{objects,0,customerIdentity}'=confirmation.source_object->>'customerIdentity'
     AND original_wire.wire#>>'{objects,0,start}'=confirmation.source_object->>'start'
     AND original_wire.wire#>>'{objects,0,reason}'=confirmation.source_object->>'reason'
     AND (original_wire.wire#>>'{objects,0,point}' IS NULL OR
      (original_wire.wire#>>'{objects,0,point}'=confirmation.source_object->>'point'
       AND original_wire.wire#>>'{objects,0,identityAgency}'=confirmation.source_object->>'identityAgency'))
     AND transition.source_objects @> jsonb_build_array(confirmation.source_object)
     AND EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(transition.resulting_states)='array' THEN transition.resulting_states ELSE '[]'::jsonb END) state WHERE state=confirmation.confirmed_period)
     AND confirmation.confirmed_period->>'id'=confirmation.period_id::text
     AND confirmation.confirmed_period->>'company_id'=confirmation.company_id::text
     AND confirmation.confirmed_period->>'source_message_id'=confirmation.source_message_id::text
     AND confirmation.confirmed_period->>'source_switch_request_id'=confirmation.switch_id::text
     AND confirmation.confirmed_period->>'source_process'='supplier_switch_confirmation'
     AND confirmation.confirmed_period->>'status'='confirmed_by_grid_owner'
     AND confirmation.confirmed_period->'market_start_at'=to_jsonb(confirmation.market_start_at)
     AND coalesce(confirmation.confirmed_period->>'contract_id',confirmation.confirmed_period->>'customer_contract_id')=confirmation.contract_id::text
     AND confirmation.confirmed_switch->>'id'=confirmation.switch_id::text
     AND confirmation.confirmed_switch->>'company_id'=confirmation.company_id::text
     AND confirmation.confirmed_switch->>'outbound_z03_message_id'=confirmation.original_message_id::text
     AND confirmation.confirmed_switch->>'inbound_z04_message_id'=confirmation.source_message_id::text
     AND confirmation.confirmed_switch->>'status'='accepted'
     AND confirmation.confirmed_switch->>'customer_id'=confirmation.confirmed_period->>'customer_id'
     AND confirmation.confirmed_switch->>'metering_point_id'=confirmation.confirmed_period->>'metering_point_id'
     AND coalesce(confirmation.confirmed_switch->>'contract_id',confirmation.confirmed_switch->>'customer_contract_id')=confirmation.contract_id::text
   ) THEN source.status WHEN whole_negative THEN 'failed' WHEN source_accepted THEN 'acknowledged' ELSE status END,$new$;
 installed text;replacement text;definition text;metadata jsonb;current_metadata jsonb;digest text;
BEGIN
 SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT installed,metadata FROM pg_catalog.pg_proc p WHERE p.oid=target;
 digest:=encode(sha256(convert_to(installed,'UTF8')),'hex');
 IF digest=new_hash THEN RETURN;END IF;
 IF digest<>old_hash THEN RAISE EXCEPTION 'sc037_confirmed_dispatch_unexpected_preimage';END IF;
 IF (length(installed)-length(replace(installed,old_fragment,'')))/length(old_fragment)<>1 THEN RAISE EXCEPTION 'sc037_confirmed_dispatch_anchor_not_unique';END IF;
 replacement:=replace(installed,old_fragment,new_fragment);
 IF encode(sha256(convert_to(replacement,'UTF8')),'hex')<>new_hash OR replace(replacement,new_fragment,old_fragment)<>installed THEN RAISE EXCEPTION 'sc037_confirmed_dispatch_inverse_mismatch';END IF;
 definition:=pg_catalog.pg_get_functiondef(target);
 IF (length(definition)-length(replace(definition,installed,'')))/length(installed)<>1 THEN RAISE EXCEPTION 'sc037_confirmed_dispatch_definition_not_unique';END IF;
 EXECUTE replace(definition,installed,replacement);
 SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT installed,current_metadata FROM pg_catalog.pg_proc p WHERE p.oid=target;
 IF installed<>replacement OR current_metadata IS DISTINCT FROM metadata THEN RAISE EXCEPTION 'sc037_confirmed_dispatch_catalog_changed';END IF;
END;
$migration$;
COMMIT;
