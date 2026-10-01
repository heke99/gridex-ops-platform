-- Each prospective correction has its own intent and first chosen tenant
-- request. The immutable original/negative ACK remains the recovery authority.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_recovery_origins(
 operation_id uuid PRIMARY KEY REFERENCES gridex_received_sources.prodat_recovery_operations(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 intent_id uuid NOT NULL UNIQUE REFERENCES public.ediel_message_intents(id),
 outbound_request_id uuid NOT NULL UNIQUE REFERENCES public.outbound_requests(id),
 actor_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.prodat_recovery_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_recovery_origins FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_recovery_origin_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_recovery_origins FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_recovery_origin_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_recovery_origins FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE FUNCTION public.ediel_reserve_prodat_recovery_origin_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;o gridex_received_sources.prodat_recovery_origins%rowtype;i public.ediel_message_intents%rowtype;m public.ediel_messages%rowtype;r public.outbound_requests%rowtype;basis jsonb;w jsonb;request_type text;
BEGIN
 basis:=public.ediel_prodat_recovery_operation_basis_v1(p_company_id,p_operation_id,p_actor_user_id);
 IF basis IS NULL THEN RAISE EXCEPTION 'prodat_recovery_correction_basis_required';END IF;
 SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id;
 -- The preceding source qualification already holds the sealed original lock.
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id;
 w:=gridex_received_sources.prodat_recovery_wire_v1(op.corrected_raw_payload);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 request_type:=CASE WHEN w->>'code' IN ('Z03','Z08') THEN 'supplier_switch' WHEN w->>'code' IN ('Z13','Z18') THEN 'metering_access' ELSE 'customer_masterdata' END;
 IF i.id IS NULL OR i.environment IS DISTINCT FROM op.environment OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM w->>'code'
 OR i.direction IS DISTINCT FROM 'outbound' OR i.customer_id IS DISTINCT FROM m.customer_id OR i.operation_id IS DISTINCT FROM op.id
 OR i.validation_status IS DISTINCT FROM 'validated' OR i.interchange_reference IS DISTINCT FROM w->>'interchange' OR i.message_reference IS DISTINCT FROM w->>'messageReference'
 OR i.sender_ediel_id IS DISTINCT FROM w#>>'{transportSender,0}' OR i.receiver_ediel_id IS DISTINCT FROM w#>>'{transportReceiver,0}'
 OR i.communication_route_id IS NULL OR i.route_profile_id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_intent_scope_required';END IF;
 SELECT * INTO o FROM gridex_received_sources.prodat_recovery_origins WHERE operation_id=op.id FOR UPDATE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=coalesce(o.outbound_request_id,p_outbound_request_id) FOR SHARE;
 IF r.id IS NULL OR r.company_id IS DISTINCT FROM p_company_id OR r.customer_id IS DISTINCT FROM m.customer_id OR r.environment IS DISTINCT FROM op.environment OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id::text OR r.request_type IS DISTINCT FROM request_type THEN RAISE EXCEPTION 'prodat_recovery_owned_request_required';END IF;
 IF o.operation_id IS NOT NULL THEN
  IF o.company_id IS DISTINCT FROM p_company_id OR o.intent_id IS DISTINCT FROM i.id THEN RAISE EXCEPTION 'prodat_recovery_origin_conflict';END IF;
  RETURN jsonb_build_object('status','reserved','intentId',o.intent_id,'outboundRequestId',o.outbound_request_id,'messageId',(SELECT message_id FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=op.id));
 END IF;
 IF EXISTS(SELECT FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=op.id) THEN RAISE EXCEPTION 'prodat_recovery_legacy_bound_origin_held';END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_origins(operation_id,company_id,intent_id,outbound_request_id,actor_user_id) VALUES(op.id,p_company_id,i.id,p_outbound_request_id,p_actor_user_id);
 RETURN jsonb_build_object('status','reserved','intentId',i.id,'outboundRequestId',p_outbound_request_id,'messageId',null);
END $$;
REVOKE ALL ON FUNCTION public.ediel_reserve_prodat_recovery_origin_v1(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_reserve_prodat_recovery_origin_v1(uuid,uuid,uuid,uuid,uuid) TO service_role;
CREATE FUNCTION gridex_received_sources.require_recovery_insert_origin_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;o gridex_received_sources.prodat_recovery_origins%rowtype;i public.ediel_message_intents%rowtype;
BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id::text=NEW.source_operation_id AND kind IN ('contrl_correction','aperak_correction');
 IF NOT FOUND THEN RETURN NEW;END IF;
 PERFORM public.ediel_prodat_recovery_operation_basis_v1(op.company_id,op.id,NEW.created_by);
 SELECT * INTO o FROM gridex_received_sources.prodat_recovery_origins WHERE operation_id=op.id;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id AND company_id=op.company_id FOR SHARE;
 PERFORM public.ediel_reserve_prodat_recovery_origin_v1(op.company_id,op.id,NEW.created_by,o.intent_id,o.outbound_request_id);
 IF o.operation_id IS NULL OR i.id IS NULL OR NEW.company_id IS DISTINCT FROM o.company_id OR NEW.intent_id IS DISTINCT FROM o.intent_id OR NEW.outbound_request_id IS DISTINCT FROM o.outbound_request_id
 OR NEW.environment IS DISTINCT FROM i.environment OR NEW.message_family IS DISTINCT FROM i.message_family OR NEW.message_code IS DISTINCT FROM i.message_code OR NEW.customer_id IS DISTINCT FROM i.customer_id
 OR NEW.raw_payload IS DISTINCT FROM op.corrected_raw_payload OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.original_message_id IS DISTINCT FROM op.original_message_id THEN RAISE EXCEPTION 'prodat_recovery_private_origin_required';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.require_recovery_insert_origin_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_recovery_insert_origin BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.require_recovery_insert_origin_v1();
COMMIT;
