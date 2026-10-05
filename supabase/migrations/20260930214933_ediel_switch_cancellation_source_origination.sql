-- AT-Z03C-SUPPLIER/P14: withdraw one genuine own L/LK original. SMTP is
-- transport acceptance only. Old LI/original/provider receipts remain intact.
BEGIN;
CREATE SCHEMA gridex_switch_cancellations;
REVOKE ALL ON SCHEMA gridex_switch_cancellations FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_switch_cancellations.origins(
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),switch_id uuid NOT NULL REFERENCES public.supplier_switch_requests(id),
 original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),original_hash text NOT NULL,
 intent_id uuid UNIQUE NOT NULL REFERENCES public.ediel_message_intents(id),outbound_request_id uuid UNIQUE NOT NULL REFERENCES public.outbound_requests(id),actor_user_id uuid NOT NULL,
 message_id uuid UNIQUE REFERENCES public.ediel_messages(id),payload_hash text,basis jsonb NOT NULL,intent_binding jsonb NOT NULL,
 reserved_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,switch_id,original_message_id),CHECK((message_id IS NULL)=(payload_hash IS NULL)));
ALTER TABLE gridex_switch_cancellations.origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_switch_cancellations.origins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_switch_cancellations.origins FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_switch_cancellations.origin_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN
 IF TG_OP='UPDATE' AND OLD.message_id IS NULL AND NEW.message_id IS NOT NULL AND NEW.payload_hash IS NOT NULL
  AND to_jsonb(NEW)-ARRAY['message_id','payload_hash'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['message_id','payload_hash'] THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'switch_cancellation_origin_immutable';END $$;
CREATE TRIGGER cancellation_origin_immutable BEFORE UPDATE OR DELETE ON gridex_switch_cancellations.origins FOR EACH ROW EXECUTE FUNCTION gridex_switch_cancellations.origin_immutable_v1();
CREATE TRIGGER cancellation_origin_no_truncate BEFORE TRUNCATE ON gridex_switch_cancellations.origins FOR EACH STATEMENT EXECUTE FUNCTION gridex_switch_cancellations.origin_immutable_v1();

CREATE FUNCTION gridex_switch_cancellations.context_v1(c uuid,sw uuid,actor uuid,prepare_execution boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE s public.supplier_switch_requests%rowtype;m public.ediel_messages%rowtype;o gridex_received_sources.switch_originals%rowtype;
 ct public.customer_contracts%rowtype;mp public.metering_points%rowtype;w jsonb;own jsonb;current_legal jsonb;prior_legal jsonb;t jsonb;ud jsonb;
 original_id uuid;start_day date;deadline date;today date:=(clock_timestamp()+interval '1 hour')::date;reserved gridex_switch_cancellations.origins%rowtype;
BEGIN
 -- Discover only a selector. Recheck the parent after ordered genuine original,
 -- executor and parent locks; no public metadata constitutes source authority.
 SELECT outbound_z03_message_id INTO original_id FROM public.supplier_switch_requests WHERE id=sw AND company_id=c;
 SELECT * INTO m FROM public.ediel_messages WHERE id=original_id AND company_id=c FOR UPDATE;
 IF prepare_execution IS NULL THEN RAISE EXCEPTION 'switch_cancellation_execution_phase_required';END IF;
 IF prepare_execution THEN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 IF c IS NULL OR sw IS NULL OR actor IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'switch_cancellation_actor_forbidden' USING ERRCODE='42501';END IF;
 END IF;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=sw AND company_id=c FOR UPDATE;
 SELECT * INTO o FROM gridex_received_sources.switch_originals WHERE message_id=m.id AND company_id=c AND switch_id=s.id;
 IF s.id IS NULL OR m.id IS NULL OR o.message_id IS NULL OR s.outbound_z03_message_id IS DISTINCT FROM m.id OR m.direction IS DISTINCT FROM 'outbound'
  OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03'
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR gridex_received_sources.sent_source_is_current_v1(m) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['genuine_own_source_bound_accepted_z03_original']);END IF;
 w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);own:=w#>'{objects,0}';
 IF w IS NULL OR own IS DISTINCT FROM o.original_object OR (own->>'reason' IN('Z22','Z23')) IS NOT TRUE OR nullif(own->>'li','') IS NULL
  OR own->>'li' IS DISTINCT FROM s.rff_li_reference OR nullif(own->>'customerIdentity','') IS NULL OR nullif(own->>'installationPoint','') IS NULL
  OR nullif(own->>'gridArea','') IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['immutable_original_customer_point_li_subtype']);END IF;
 prior_legal:=gridex_ediel_inbound_context.require_v1(c,m.id);
 current_legal:=gridex_ediel_inbound_context.derive(m,clock_timestamp());
 IF prior_legal->>'legalActorId' IS DISTINCT FROM current_legal->>'legalActorId' OR current_legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier'
  OR current_legal->>'legalEdielId' IS DISTINCT FROM w->>'sender' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_same_legal_supplier_source_context']);END IF;
 SELECT * INTO ct FROM public.customer_contracts WHERE id=o.contract_id AND company_id=c FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=s.metering_point_id AND company_id=c FOR SHARE;
 PERFORM site.id FROM public.customer_sites site WHERE site.id=coalesce(s.site_id,s.customer_site_id) AND site.company_id=c FOR SHARE;
 IF ct.id IS NULL OR mp.id IS NULL OR ct.customer_id IS DISTINCT FROM s.customer_id OR ct.metering_point_id IS DISTINCT FROM mp.id
  OR coalesce(s.customer_contract_id,s.contract_id) IS DISTINCT FROM o.contract_id
  OR NOT EXISTS(SELECT FROM public.customer_sites site WHERE site.id=mp.site_id AND site.company_id=c)
  OR s.customer_id::text IS DISTINCT FROM o.resulting_switch->>'customer_id' OR s.metering_point_id::text IS DISTINCT FROM o.resulting_switch->>'metering_point_id'
  OR coalesce(s.site_id,s.customer_site_id)::text IS DISTINCT FROM coalesce(o.resulting_switch->>'site_id',o.resulting_switch->>'customer_site_id')
  OR (s.contract_id IS NOT NULL AND s.contract_id IS DISTINCT FROM ct.id) OR (s.customer_contract_id IS NOT NULL AND s.customer_contract_id IS DISTINCT FROM ct.id)
  OR mp.customer_id IS DISTINCT FROM s.customer_id OR mp.site_id IS DISTINCT FROM coalesce(s.site_id,s.customer_site_id)
  OR own->>'installationPoint' IS DISTINCT FROM coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,''))
  OR own->>'gridArea' IS DISTINCT FROM mp.grid_area_code OR w->>'receiver' IS DISTINCT FROM mp.grid_owner_ediel_id
  OR s.lifecycle_blocked IS TRUE OR (s.status IN('prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancellation_sent')) IS NOT TRUE
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_owned_switch_customer_contract_physical_scope']);END IF;
 start_day:=gridex_received_sources.permission_date_v1(own->>'start');
 deadline:=CASE own->>'reason' WHEN 'Z22' THEN start_day-4 WHEN 'Z23' THEN start_day END;
 IF start_day IS NULL OR start_day IS DISTINCT FROM s.requested_start_date OR deadline IS NULL OR today>deadline THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_z03_cancellation_calendar_window']);END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(m.raw_payload))x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='UD' LOOP
  IF ud IS NOT NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_original_customer_identity']);END IF;ud:=t;
 END LOOP;
 IF ud IS NULL OR (ud#>>'{elements,2,1}' IN('SE1','SE2')) IS NOT TRUE OR ud#>>'{elements,2,2}' IS DISTINCT FROM '260' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['qualified_original_customer_identity']);END IF;
 SELECT * INTO reserved FROM gridex_switch_cancellations.origins WHERE company_id=c AND switch_id=s.id AND original_message_id=m.id;
 RETURN jsonb_build_object('status','authorized','companyId',c,'environment',m.environment,'switchRequestId',s.id,'originalMessageId',m.id,'originalHash',o.payload_hash,
  'operationId',reserved.id,'intentId',reserved.intent_id,'outboundRequestId',reserved.outbound_request_id,'messageId',reserved.message_id,
  'customerId',s.customer_id,'siteId',mp.site_id,'meteringPointId',mp.id,'legalActorId',current_legal->>'legalActorId','legalSenderId',w->>'sender','legalReceiverId',w->>'receiver',
  'pointId',own->>'installationPoint','identityAgency',own->>'installationAgency','gridArea',own->>'gridArea','li',own->>'li','startAt',gridex_received_sources.permission_time_v1(own->>'start'),
  'originalSubtype',CASE own->>'reason' WHEN 'Z22' THEN 'L' ELSE 'LK' END,'deadline',deadline,'customerIdentity',own->>'customerIdentity','customerQualifier',ud#>>'{elements,2,1}',
  'customerName',coalesce(ud#>>'{elements,4,0}',''),'sourceObject',own);
END $$;
REVOKE ALL ON FUNCTION gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_switch_cancellation_source_v1(p_company_id uuid,p_switch_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN gridex_switch_cancellations.context_v1(p_company_id,p_switch_id,p_actor_user_id);END $$;
REVOKE ALL ON FUNCTION public.ediel_switch_cancellation_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_switch_cancellation_source_v1(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ediel_reserve_switch_cancellation_v1(p_company_id uuid,p_switch_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b jsonb;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;o gridex_switch_cancellations.origins%rowtype;binding jsonb;
BEGIN
 b:=gridex_switch_cancellations.context_v1(p_company_id,p_switch_id,p_actor_user_id);IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=p_outbound_request_id AND company_id=p_company_id FOR SHARE;
 IF i.id IS NULL OR r.id IS NULL OR i.environment IS DISTINCT FROM b->>'environment' OR i.direction IS DISTINCT FROM 'outbound' OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z03'
  OR i.business_process IS DISTINCT FROM 'supplier_switch' OR i.customer_id::text IS DISTINCT FROM b->>'customerId' OR i.metering_point_id IS DISTINCT FROM b->>'pointId' OR i.grid_area_code IS DISTINCT FROM b->>'gridArea'
  OR i.operation_id IS NULL OR i.validation_status IS DISTINCT FROM 'validated' OR i.transaction_reference IS DISTINCT FROM b->>'li'
  OR r.environment IS DISTINCT FROM b->>'environment' OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id::text IS DISTINCT FROM i.id::text OR r.request_type IS DISTINCT FROM 'supplier_switch'
  OR r.operation_id IS DISTINCT FROM i.operation_id OR r.customer_id::text IS DISTINCT FROM b->>'customerId' OR r.metering_point_id::text IS DISTINCT FROM b->>'meteringPointId' OR r.site_id::text IS DISTINCT FROM b->>'siteId'
 THEN RAISE EXCEPTION 'switch_cancellation_validated_intent_request_required';END IF;
 binding:=to_jsonb(i)-ARRAY['created_at','updated_at','validation_status','validation_report','render_status','outbox_status','ack_status','ediel_message_id','outbound_request_id'];
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE company_id=p_company_id AND switch_id=p_switch_id AND original_message_id=(b->>'originalMessageId')::uuid FOR UPDATE;
 IF FOUND THEN IF o.intent_id IS DISTINCT FROM i.id OR o.outbound_request_id IS DISTINCT FROM r.id OR o.intent_binding IS DISTINCT FROM binding OR o.original_hash IS DISTINCT FROM b->>'originalHash' THEN RAISE EXCEPTION 'switch_cancellation_reservation_conflict';END IF;
 ELSE INSERT INTO gridex_switch_cancellations.origins(id,company_id,switch_id,original_message_id,original_hash,intent_id,outbound_request_id,actor_user_id,basis,intent_binding)
 VALUES(i.operation_id::uuid,p_company_id,p_switch_id,(b->>'originalMessageId')::uuid,b->>'originalHash',i.id,r.id,p_actor_user_id,b-ARRAY['operationId','intentId','outboundRequestId','messageId'],binding) RETURNING * INTO o;END IF;
 RETURN jsonb_build_object('status','reserved','operationId',o.id,'intentId',o.intent_id,'outboundRequestId',o.outbound_request_id,'messageId',o.message_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_reserve_switch_cancellation_v1(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_reserve_switch_cancellation_v1(uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_switch_cancellations.bind_message_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o gridex_switch_cancellations.origins%rowtype;b jsonb;w jsonb;own jsonb;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;
BEGIN
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE intent_id=NEW.intent_id;IF NOT FOUND THEN RETURN NEW;END IF;
 b:=gridex_switch_cancellations.context_v1(o.company_id,o.switch_id,o.actor_user_id);
 SELECT * INTO STRICT o FROM gridex_switch_cancellations.origins WHERE intent_id=NEW.intent_id FOR UPDATE;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id AND company_id=o.company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id AND company_id=o.company_id FOR SHARE;
 IF b->>'status' IS DISTINCT FROM 'authorized' OR (b-ARRAY['operationId','intentId','outboundRequestId','messageId']) IS DISTINCT FROM o.basis
  OR to_jsonb(i)-ARRAY['created_at','updated_at','validation_status','validation_report','render_status','outbox_status','ack_status','ediel_message_id','outbound_request_id'] IS DISTINCT FROM o.intent_binding
  OR i.validation_status IS DISTINCT FROM 'validated' OR r.source_type IS DISTINCT FROM 'manual' OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.source_id::text IS DISTINCT FROM i.id::text OR r.operation_id IS DISTINCT FROM i.operation_id OR r.environment IS DISTINCT FROM NEW.environment
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
CREATE TRIGGER ediel_switch_cancellation_bind AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_switch_cancellations.bind_message_v1();
REVOKE ALL ON FUNCTION gridex_switch_cancellations.bind_message_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_require_switch_cancellation_source_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
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
  OR r.environment IS DISTINCT FROM m.environment OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id THEN RAISE EXCEPTION 'switch_cancellation_current_intent_request_required';END IF;
 IF b->>'status' IS DISTINCT FROM 'authorized' OR (b-ARRAY['operationId','intentId','outboundRequestId','messageId']) IS DISTINCT FROM o.basis THEN RAISE EXCEPTION 'switch_cancellation_current_source_held';END IF;
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid) TO service_role;
CREATE FUNCTION gridex_switch_cancellations.bound_message_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN
 IF EXISTS(SELECT FROM gridex_switch_cancellations.origins o WHERE o.message_id=OLD.id) AND
 ROW(NEW.id,NEW.company_id,NEW.environment,NEW.direction,NEW.message_standard,NEW.message_family,NEW.message_code,NEW.intent_id,NEW.outbound_request_id,NEW.source_operation_id,
 NEW.original_message_id,NEW.switch_request_id,NEW.customer_id,NEW.site_id,NEW.metering_point_id,NEW.raw_payload,NEW.immutable_payload_hash,NEW.immutable_rendered_at,
 NEW.sender_ediel_id,NEW.receiver_ediel_id,NEW.sender_sub_address,NEW.receiver_sub_address,NEW.communication_route_id,NEW.route_profile_id,NEW.application_reference,NEW.interchange_reference,NEW.transaction_reference)
 IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.direction,OLD.message_standard,OLD.message_family,OLD.message_code,OLD.intent_id,OLD.outbound_request_id,OLD.source_operation_id,
 OLD.original_message_id,OLD.switch_request_id,OLD.customer_id,OLD.site_id,OLD.metering_point_id,OLD.raw_payload,OLD.immutable_payload_hash,OLD.immutable_rendered_at,
 OLD.sender_ediel_id,OLD.receiver_ediel_id,OLD.sender_sub_address,OLD.receiver_sub_address,OLD.communication_route_id,OLD.route_profile_id,OLD.application_reference,OLD.interchange_reference,OLD.transaction_reference)
 THEN RAISE EXCEPTION 'switch_cancellation_bound_message_immutable';END IF;RETURN NEW;END $$;
CREATE TRIGGER ediel_switch_cancellation_message_immutable BEFORE UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_switch_cancellations.bound_message_immutable_v1();
REVOKE ALL ON FUNCTION gridex_switch_cancellations.bound_message_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;

-- Delegate established attempt/outcome replay first. A fresh ordinary entry
-- then proves this exact private cancellation origin in the same transaction.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_switch_cancellation_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN r:=gridex_ediel_transport.mutate_before_switch_cancellation_v1(i);
 IF (i->>'action' IN('prepare','enter')) IS TRUE AND r->>'proceed'='true' THEN
  PERFORM public.ediel_require_switch_cancellation_source_current_v1((i->>'companyId')::uuid,(i->>'messageId')::uuid);END IF;
 RETURN r;END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_switch_cancellation_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
