-- The genuine existing request schema stores the intended environment in
-- payload, not a fabricated SQL column. This is consistency only; private
-- original/source/intent authority still qualifies every fresh entry.
BEGIN;
CREATE OR REPLACE FUNCTION public.ediel_reserve_switch_cancellation_v1(p_company_id uuid,p_switch_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;o gridex_switch_cancellations.origins%rowtype;binding jsonb;
BEGIN
 b:=gridex_switch_cancellations.context_v1(p_company_id,p_switch_id,p_actor_user_id);IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=p_outbound_request_id AND company_id=p_company_id FOR SHARE;
 IF i.id IS NULL OR r.id IS NULL OR i.environment IS DISTINCT FROM b->>'environment' OR i.direction IS DISTINCT FROM 'outbound' OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z03'
  OR i.business_process IS DISTINCT FROM 'supplier_switch' OR i.customer_id::text IS DISTINCT FROM b->>'customerId' OR i.metering_point_id IS DISTINCT FROM b->>'pointId' OR i.grid_area_code IS DISTINCT FROM b->>'gridArea'
  OR i.operation_id IS NULL OR i.validation_status IS DISTINCT FROM 'validated' OR i.transaction_reference IS DISTINCT FROM b->>'li'
  OR r.payload->>'environment' IS DISTINCT FROM b->>'environment' OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id::text IS DISTINCT FROM i.id::text OR r.request_type IS DISTINCT FROM 'supplier_switch'
  OR r.operation_id IS DISTINCT FROM i.operation_id OR r.customer_id::text IS DISTINCT FROM b->>'customerId' OR r.metering_point_id::text IS DISTINCT FROM b->>'meteringPointId' OR r.site_id::text IS DISTINCT FROM b->>'siteId'
 THEN RAISE EXCEPTION 'switch_cancellation_validated_intent_request_required';END IF;
 binding:=to_jsonb(i)-ARRAY['created_at','updated_at','validation_status','validation_report','render_status','outbox_status','ack_status','ediel_message_id','outbound_request_id'];
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE company_id=p_company_id AND switch_id=p_switch_id AND original_message_id=(b->>'originalMessageId')::uuid FOR UPDATE;
 IF FOUND THEN IF o.intent_id IS DISTINCT FROM i.id OR o.outbound_request_id IS DISTINCT FROM r.id OR o.intent_binding IS DISTINCT FROM binding OR o.original_hash IS DISTINCT FROM b->>'originalHash' THEN RAISE EXCEPTION 'switch_cancellation_reservation_conflict';END IF;
 ELSE INSERT INTO gridex_switch_cancellations.origins(id,company_id,switch_id,original_message_id,original_hash,intent_id,outbound_request_id,actor_user_id,basis,intent_binding)
 VALUES(i.operation_id::uuid,p_company_id,p_switch_id,(b->>'originalMessageId')::uuid,b->>'originalHash',i.id,r.id,p_actor_user_id,b-ARRAY['operationId','intentId','outboundRequestId','messageId'],binding) RETURNING * INTO o;END IF;
 RETURN jsonb_build_object('status','reserved','operationId',o.id,'intentId',o.intent_id,'outboundRequestId',o.outbound_request_id,'messageId',o.message_id);
END $$;

CREATE OR REPLACE FUNCTION gridex_switch_cancellations.bind_message_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o gridex_switch_cancellations.origins%rowtype;b jsonb;w jsonb;own jsonb;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;
BEGIN
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE intent_id=NEW.intent_id;IF NOT FOUND THEN RETURN NEW;END IF;
 b:=gridex_switch_cancellations.context_v1(o.company_id,o.switch_id,o.actor_user_id);
 SELECT * INTO STRICT o FROM gridex_switch_cancellations.origins WHERE intent_id=NEW.intent_id FOR UPDATE;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id AND company_id=o.company_id FOR SHARE;
 IF b->>'status' IS DISTINCT FROM 'authorized' OR (b-ARRAY['operationId','intentId','outboundRequestId','messageId']) IS DISTINCT FROM o.basis
  OR to_jsonb(i)-ARRAY['created_at','updated_at','validation_status','validation_report','render_status','outbox_status','ack_status','ediel_message_id','outbound_request_id'] IS DISTINCT FROM o.intent_binding
  OR i.validation_status IS DISTINCT FROM 'validated' OR r.source_type IS DISTINCT FROM 'manual' OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.source_id::text IS DISTINCT FROM i.id::text OR r.operation_id IS DISTINCT FROM i.operation_id OR r.payload->>'environment' IS DISTINCT FROM NEW.environment
  OR r.customer_id IS DISTINCT FROM NEW.customer_id OR r.site_id IS DISTINCT FROM NEW.site_id OR r.metering_point_id IS DISTINCT FROM NEW.metering_point_id
 THEN RAISE EXCEPTION 'switch_cancellation_current_origin_required';END IF;
 w:=gridex_received_sources.switch_origin_wire_v1(NEW.raw_payload);own:=w#>'{objects,0}';
 IF w IS NULL OR w->>'code' IS DISTINCT FROM 'Z03' OR own->>'reason' IS DISTINCT FROM 'Z24' OR NEW.company_id IS DISTINCT FROM o.company_id OR NEW.environment IS DISTINCT FROM b->>'environment'
  OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_standard IS DISTINCT FROM 'edifact' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.message_code IS DISTINCT FROM 'Z03'
  OR NEW.intent_id IS DISTINCT FROM i.id OR NEW.interchange_reference IS DISTINCT FROM i.interchange_reference OR NEW.transaction_reference IS DISTINCT FROM i.transaction_reference
  OR NEW.application_reference IS DISTINCT FROM i.application_reference OR NEW.sender_ediel_id IS DISTINCT FROM i.sender_ediel_id OR NEW.receiver_ediel_id IS DISTINCT FROM i.receiver_ediel_id
  OR NEW.sender_sub_address IS DISTINCT FROM i.sender_subaddress OR NEW.receiver_sub_address IS DISTINCT FROM i.receiver_subaddress
  OR NEW.communication_route_id IS DISTINCT FROM i.communication_route_id OR NEW.route_profile_id IS DISTINCT FROM i.route_profile_id
  OR NEW.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR NEW.source_operation_id IS DISTINCT FROM o.id::text OR NEW.original_message_id IS DISTINCT FROM o.original_message_id
  OR NEW.switch_request_id IS DISTINCT FROM o.switch_id OR NEW.customer_id::text IS DISTINCT FROM b->>'customerId' OR NEW.metering_point_id::text IS DISTINCT FROM b->>'meteringPointId' OR NEW.site_id::text IS DISTINCT FROM b->>'siteId'
  OR own->>'li' IS DISTINCT FROM b->>'li' OR own->>'installationPoint' IS DISTINCT FROM b->>'pointId' OR own->>'installationAgency' IS DISTINCT FROM b->>'identityAgency'
  OR own->>'customerIdentity' IS DISTINCT FROM b->>'customerIdentity' OR own->>'customerQualifier' IS DISTINCT FROM b->>'customerQualifier' OR own->>'customerAgency' IS DISTINCT FROM '260' OR own->>'gridArea' IS DISTINCT FROM b->>'gridArea'
  OR own->>'start' IS DISTINCT FROM b#>>'{sourceObject,start}' OR w->>'sender' IS DISTINCT FROM b->>'legalSenderId' OR w->>'receiver' IS DISTINCT FROM b->>'legalReceiverId'
  OR NEW.immutable_rendered_at IS NULL OR NEW.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'switch_cancellation_exact_original_wire_required';END IF;
 IF o.message_id IS NOT NULL THEN RAISE EXCEPTION 'switch_cancellation_original_already_bound';END IF;
 UPDATE gridex_switch_cancellations.origins SET message_id=NEW.id,payload_hash=NEW.immutable_payload_hash WHERE id=o.id;
 UPDATE public.supplier_switch_requests SET status='cancellation_requested',updated_by=o.actor_user_id,updated_at=now() WHERE id=o.switch_id AND company_id=o.company_id;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.ediel_require_switch_cancellation_source_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_switch_cancellations.origins%rowtype;b jsonb;w jsonb;q jsonb;positive boolean;negative boolean;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'switch_cancellation_message_scope_required';END IF;
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE message_id=m.id AND company_id=p_company_id;
 IF o.message_id IS NULL AND m.environment='test' AND m.direction='outbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z03' THEN
  SELECT EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions c WHERE c.message_id=m.id AND c.company_id=p_company_id),
   EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions c WHERE c.message_id=m.id AND c.company_id=p_company_id) INTO positive,negative;
  IF positive AND negative THEN RAISE EXCEPTION 'switch_cancellation_fixture_source_ambiguous';END IF;
  IF positive OR negative THEN
   q:=CASE WHEN positive THEN gridex_negative_fixtures.require_positive_message_v1(p_company_id,m.id,'Z03') ELSE gridex_negative_fixtures.require_negative_message_v1(p_company_id,m.id,'Z03') END;
   IF q IS NULL OR q->>'companyId' IS DISTINCT FROM p_company_id::text OR q->>'version' IS DISTINCT FROM '1' OR q->>'roleCode' IS DISTINCT FROM 'supplier'
    OR q->'authorizesBusinessEffect' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(q->'expectedDiagnosticCodes') IS DISTINCT FROM 'array'
    OR (positive AND (q->>'kind' IS DISTINCT FROM 'source_qualified_positive_fixture' OR q->>'expectedOutcome' IS DISTINCT FROM 'positive' OR q->'expectedDiagnosticCodes' IS DISTINCT FROM '[]'::jsonb))
    OR (negative AND (q->>'kind' IS DISTINCT FROM 'source_qualified_negative_fixture' OR q->>'expectedOutcome' IS DISTINCT FROM 'negative' OR jsonb_array_length(q->'expectedDiagnosticCodes') NOT BETWEEN 1 AND 256))
   THEN RAISE EXCEPTION 'switch_cancellation_fixture_source_required';END IF;
   -- Genuine certification provenance only. No production cancellation origin,
   -- switch status or supply history is created by this branch.
   RETURN;
  END IF;
 END IF;
 w:=gridex_received_sources.supply_wire_v1(m.raw_payload);
 IF w->>'code' IS DISTINCT FROM 'Z03' OR NOT EXISTS(SELECT FROM jsonb_array_elements(w->'objects') own WHERE own->>'reason'='Z24') THEN RETURN;END IF;
 IF gridex_received_sources.switch_origin_wire_v1(m.raw_payload) IS NULL THEN RAISE EXCEPTION 'switch_cancellation_exact_original_wire_required';END IF;
 IF o.message_id IS NULL OR o.payload_hash IS DISTINCT FROM m.immutable_payload_hash OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'switch_cancellation_private_origin_required';END IF;
 b:=gridex_switch_cancellations.context_v1(o.company_id,o.switch_id,o.actor_user_id,false);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id AND company_id=o.company_id FOR SHARE;
 IF i.id IS NULL OR r.id IS NULL OR i.validation_status IS DISTINCT FROM 'validated' OR to_jsonb(i)-ARRAY['created_at','updated_at','validation_status','validation_report','render_status','outbox_status','ack_status','ediel_message_id','outbound_request_id'] IS DISTINCT FROM o.intent_binding
  OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id::text IS DISTINCT FROM i.id::text OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.operation_id IS DISTINCT FROM i.operation_id
  OR r.payload->>'environment' IS DISTINCT FROM m.environment OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id THEN RAISE EXCEPTION 'switch_cancellation_current_intent_request_required';END IF;
 IF b->>'status' IS DISTINCT FROM 'authorized' OR (b-ARRAY['operationId','intentId','outboundRequestId','messageId']) IS DISTINCT FROM o.basis THEN RAISE EXCEPTION 'switch_cancellation_current_source_held';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_switch_cancellations.bind_message_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_reserve_switch_cancellation_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_reserve_switch_cancellation_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid) TO service_role;
COMMIT;
