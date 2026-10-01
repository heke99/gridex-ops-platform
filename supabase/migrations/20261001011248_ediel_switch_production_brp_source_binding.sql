-- P262: actual first and current normal/production origins consume the same
-- protected BRP source as their renderer. Neither a portal scalar nor a desired
-- B change supplies current responsibility. Existing receipts are not rewritten.
BEGIN;
CREATE FUNCTION gridex_received_sources.outbound_single_brp_v1(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE token jsonb;active_object boolean:=false;brp text;lines integer:=0;
BEGIN
 FOR token IN SELECT item FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(raw)) item LOOP
  IF token->>'tag'='LIN' THEN lines:=lines+1;active_object:=true;CONTINUE;END IF;
  IF token->>'tag'='UNT' THEN active_object:=false;END IF;
  IF active_object AND token->>'tag'='NAD' AND token#>>'{elements,1,0}'='Z02' THEN
   IF brp IS NOT NULL OR token#>>'{elements,2,1}' IS DISTINCT FROM '160' OR token#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' OR jsonb_array_length(token#>'{elements,2}') IS DISTINCT FROM 3 THEN RETURN NULL;END IF;
   brp:=token#>>'{elements,2,0}';
   IF nullif(brp,'') IS NULL OR brp<>btrim(brp) OR length(brp)>35 OR brp~'[[:cntrl:]]' THEN RETURN NULL;END IF;
  END IF;
 END LOOP;
 IF lines<>1 THEN RETURN NULL;END IF;RETURN brp;
END$$;
CREATE TABLE gridex_received_sources.switch_brp_source_bindings(
 message_id uuid PRIMARY KEY REFERENCES gridex_received_sources.switch_originals(message_id),
 company_id uuid NOT NULL REFERENCES public.companies(id),brp_ediel_id text NOT NULL,source_basis jsonb NOT NULL,payload_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.switch_brp_source_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.switch_brp_source_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.switch_brp_source_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER switch_brp_binding_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.switch_brp_source_bindings FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER switch_brp_binding_no_truncate BEFORE TRUNCATE ON gridex_received_sources.switch_brp_source_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE FUNCTION gridex_received_sources.switch_brp_source_basis_v1(c uuid,message uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_received_sources.switch_originals%rowtype;b jsonb;wire jsonb;at timestamptz;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR SHARE;
 SELECT * INTO o FROM gridex_received_sources.switch_originals WHERE message_id=m.id AND company_id=c;
 IF m.id IS NULL OR o.message_id IS NULL THEN RAISE EXCEPTION 'switch_brp_original_required';END IF;
 wire:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);at:=gridex_received_sources.permission_time_v1(o.original_object->>'start');
 b:=gridex_brp_sources.require_source_v1(c,o.contract_id,actor,phase,m.environment,m.customer_id,m.site_id,m.metering_point_id,at,NULL);
 IF b->>'status' IS DISTINCT FROM 'authorized' OR b->>'sourceKind' IS DISTINCT FROM 'signed_contract_brp_declaration' OR wire IS NULL OR at IS NULL
  OR b->>'companyId' IS DISTINCT FROM c::text OR b->>'environment' IS DISTINCT FROM m.environment OR b->>'contractId' IS DISTINCT FROM o.contract_id::text
  OR b->>'customerId' IS DISTINCT FROM m.customer_id::text OR b->>'siteId' IS DISTINCT FROM m.site_id::text OR b->>'meteringPointId' IS DISTINCT FROM m.metering_point_id::text
  OR (b->>'at')::timestamptz IS DISTINCT FROM at OR b->>'legalSenderId' IS DISTINCT FROM wire->>'sender' OR b->>'legalReceiverId' IS DISTINCT FROM wire->>'receiver'
  OR b->>'pointId' IS DISTINCT FROM o.original_object->>'point' OR b->>'identityAgency' IS DISTINCT FROM o.original_object->>'identityAgency' OR b->>'gridArea' IS DISTINCT FROM o.original_object->>'gridArea'
  OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR m.immutable_rendered_at IS NULL
  OR gridex_received_sources.outbound_single_brp_v1(m.raw_payload) IS DISTINCT FROM b->>'brpEdielId'
 THEN RAISE EXCEPTION 'switch_signed_source_brp_required';END IF;RETURN b;
END$$;
CREATE FUNCTION gridex_received_sources.bind_switch_brp_source_v1(c uuid,message uuid,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE b jsonb;m public.ediel_messages%rowtype;BEGIN
 b:=gridex_received_sources.switch_brp_source_basis_v1(c,message,actor,'prepare');SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=message AND company_id=c;
 INSERT INTO gridex_received_sources.switch_brp_source_bindings(message_id,company_id,brp_ediel_id,source_basis,payload_hash) VALUES(message,c,b->>'brpEdielId',b,m.immutable_payload_hash);
END$$;
ALTER FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid) RENAME TO ediel_bind_switch_original_before_brp_source_v1;
CREATE FUNCTION public.ediel_bind_switch_original_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=public.ediel_bind_switch_original_before_brp_source_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);
 IF result->>'status'='bound' AND result->>'idempotent' IS DISTINCT FROM 'true' THEN PERFORM gridex_received_sources.bind_switch_brp_source_v1(p_company_id,p_message_id,p_actor_user_id);END IF;RETURN result;
END$$;
ALTER FUNCTION public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) RENAME TO ediel_bind_switch_correction_before_brp_source_v1;
CREATE FUNCTION public.ediel_bind_switch_correction_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=public.ediel_bind_switch_correction_before_brp_source_v1(p_company_id,p_message_id,p_actor_user_id);
 IF result->>'status'='bound' AND result->>'idempotent' IS DISTINCT FROM 'true' THEN PERFORM gridex_received_sources.bind_switch_brp_source_v1(p_company_id,p_message_id,p_actor_user_id);END IF;RETURN result;
END$$;
CREATE FUNCTION gridex_received_sources.require_switch_brp_source_current_v1(c uuid,message uuid,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;s gridex_received_sources.switch_brp_source_bindings%rowtype;b jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' OR NOT EXISTS(SELECT FROM gridex_received_sources.switch_originals o WHERE o.message_id=m.id AND o.company_id=c) THEN RETURN;END IF;
 SELECT * INTO s FROM gridex_received_sources.switch_brp_source_bindings WHERE message_id=m.id AND company_id=c;
 IF s.message_id IS NULL THEN RAISE EXCEPTION 'switch_historical_brp_source_unavailable';END IF;
 b:=gridex_received_sources.switch_brp_source_basis_v1(c,m.id,actor,'send');
 IF b IS DISTINCT FROM s.source_basis OR s.brp_ediel_id IS DISTINCT FROM b->>'brpEdielId' OR s.payload_hash IS DISTINCT FROM m.immutable_payload_hash THEN RAISE EXCEPTION 'switch_current_brp_source_changed';END IF;
END$$;
CREATE TABLE gridex_received_sources.production_contract_brp_bindings(
 message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),event_id uuid NOT NULL REFERENCES gridex_received_sources.production_contract_events(id),brp_ediel_id text NOT NULL,source_basis jsonb NOT NULL,payload_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.production_contract_brp_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.production_contract_brp_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.production_contract_brp_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER production_brp_binding_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.production_contract_brp_bindings FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER production_brp_binding_no_truncate BEFORE TRUNCATE ON gridex_received_sources.production_contract_brp_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
ALTER FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text) RENAME TO production_contract_source_before_brp_v1;
CREATE FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_permission text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;brp jsonb;event gridex_received_sources.production_contract_events%rowtype;start_event gridex_received_sources.production_contract_events%rowtype;origin gridex_received_sources.production_contract_origins%rowtype;original public.ediel_messages%rowtype;proof gridex_received_sources.production_contract_brp_bindings%rowtype;wire jsonb;BEGIN
 -- Discovery is not authority. Lock the linked original before the existing
 -- owner locks contract/customer/point, then requalify the immutable exact tuple.
 SELECT * INTO event FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id;
 IF event.event_kind='ceased' THEN
  SELECT * INTO origin FROM gridex_received_sources.production_contract_origins WHERE event_id=event.start_event_id AND company_id=p_company_id;
  SELECT * INTO original FROM public.ediel_messages WHERE id=origin.message_id AND company_id=p_company_id FOR SHARE;
 END IF;
 basis:=gridex_received_sources.production_contract_source_before_brp_v1(p_company_id,p_event_id,p_actor_user_id,p_permission);
 IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;END IF;
 SELECT * INTO STRICT event FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id;
 IF event.event_kind='ceased' THEN
  SELECT * INTO start_event FROM gridex_received_sources.production_contract_events WHERE id=event.start_event_id AND company_id=p_company_id;
  SELECT * INTO proof FROM gridex_received_sources.production_contract_brp_bindings WHERE message_id=original.id AND company_id=p_company_id;
  wire:=gridex_received_sources.prodat_recovery_wire_v1(original.raw_payload);
  IF start_event.id IS NULL OR original.id IS NULL OR proof.message_id IS NULL OR proof.event_id IS DISTINCT FROM start_event.id OR origin.event_id IS DISTINCT FROM start_event.id
   OR start_event.event_kind IS DISTINCT FROM 'signed' OR start_event.contract_id IS DISTINCT FROM event.contract_id OR start_event.contract_revision IS DISTINCT FROM event.contract_revision OR start_event.protected_contract_hash IS DISTINCT FROM event.protected_contract_hash
   OR start_event.customer_id IS DISTINCT FROM event.customer_id OR start_event.metering_point_id IS DISTINCT FROM event.metering_point_id OR start_event.point_id IS DISTINCT FROM event.point_id OR start_event.identity_agency IS DISTINCT FROM event.identity_agency
   OR start_event.legal_actor_id IS DISTINCT FROM event.legal_actor_id OR start_event.legal_sender_id IS DISTINCT FROM event.legal_sender_id OR start_event.legal_receiver_id IS DISTINCT FROM event.legal_receiver_id OR start_event.environment IS DISTINCT FROM event.environment OR start_event.grid_area_code IS DISTINCT FROM event.grid_area_code
   OR original.environment IS DISTINCT FROM event.environment OR original.direction IS DISTINCT FROM 'outbound' OR original.message_family IS DISTINCT FROM 'PRODAT' OR original.message_code IS DISTINCT FROM 'Z09' OR original.immutable_rendered_at IS NULL
   OR proof.payload_hash IS DISTINCT FROM origin.payload_hash OR original.immutable_payload_hash IS DISTINCT FROM proof.payload_hash OR proof.payload_hash IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex')
   OR wire IS NULL OR wire->>'legalSender' IS DISTINCT FROM event.legal_sender_id OR wire->>'legalReceiver' IS DISTINCT FROM event.legal_receiver_id OR jsonb_array_length(wire->'objects') IS DISTINCT FROM 1
   OR wire#>>'{objects,0,point}' IS DISTINCT FROM event.point_id OR wire#>>'{objects,0,identityAgency}' IS DISTINCT FROM event.identity_agency OR wire#>>'{objects,0,reason}' IS DISTINCT FROM 'Z70' OR gridex_received_sources.outbound_single_brp_v1(original.raw_payload) IS DISTINCT FROM proof.brp_ediel_id
   OR proof.source_basis->>'sourceKind' IS DISTINCT FROM 'signed_contract_brp_declaration' OR proof.source_basis->>'contractId' IS DISTINCT FROM event.contract_id::text
  THEN RETURN jsonb_build_object('status','held','missing',ARRAY['production_contract_exact_original_brp_party']);END IF;
  RETURN basis||jsonb_build_object('brpEdielId',proof.brp_ediel_id,'brpBasis',proof.source_basis,'brpBasisKind','production_original_contract_party','brpOriginalMessageId',original.id);
 END IF;
 brp:=gridex_brp_sources.require_source_v1(p_company_id,(basis->>'contractId')::uuid,p_actor_user_id,CASE p_permission WHEN 'communication.send' THEN 'send' ELSE 'prepare' END,basis->>'environment',(basis->>'customerId')::uuid,(basis->>'siteId')::uuid,(basis->>'meteringPointId')::uuid,(basis->>'boundaryAt')::timestamptz,NULL);
 IF brp->>'status' IS DISTINCT FROM 'authorized' THEN RETURN coalesce(brp,jsonb_build_object('status','held','missing',ARRAY['production_contract_source_brp_required']));END IF;
 IF brp->>'sourceKind' IS DISTINCT FROM 'signed_contract_brp_declaration' OR brp->>'companyId' IS DISTINCT FROM basis->>'companyId' OR brp->>'environment' IS DISTINCT FROM basis->>'environment' OR brp->>'contractId' IS DISTINCT FROM basis->>'contractId'
 OR brp->>'customerId' IS DISTINCT FROM basis->>'customerId' OR brp->>'siteId' IS DISTINCT FROM basis->>'siteId' OR brp->>'meteringPointId' IS DISTINCT FROM basis->>'meteringPointId' OR (brp->>'at')::timestamptz IS DISTINCT FROM (basis->>'boundaryAt')::timestamptz
 OR brp->>'pointId' IS DISTINCT FROM basis->>'pointId' OR brp->>'identityAgency' IS DISTINCT FROM basis->>'identityAgency' OR brp->>'gridArea' IS DISTINCT FROM basis->>'gridArea' OR brp->>'legalSenderId' IS DISTINCT FROM basis->>'legalSenderId' OR brp->>'legalReceiverId' IS DISTINCT FROM basis->>'legalReceiverId' OR brp->>'legalActorId' IS DISTINCT FROM basis->>'legalActorId' THEN RAISE EXCEPTION 'production_contract_brp_scope_required';END IF;
 RETURN basis||jsonb_build_object('brpEdielId',brp->>'brpEdielId','brpBasis',brp);
END$$;
CREATE FUNCTION gridex_received_sources.production_contract_brp_wire_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE o gridex_received_sources.production_contract_origins%rowtype;b jsonb;BEGIN
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE message_id=NEW.id AND company_id=NEW.company_id;
 IF o.event_id IS NULL THEN RETURN NEW;END IF;
 b:=gridex_received_sources.production_contract_source_for_execution_v1(o.company_id,o.event_id,o.actor_user_id,'communication.write');
 IF b->>'status' IS DISTINCT FROM 'authorized' OR gridex_received_sources.outbound_single_brp_v1(NEW.raw_payload) IS DISTINCT FROM b->>'brpEdielId' THEN RAISE EXCEPTION 'production_contract_physical_source_brp_required';END IF;
 INSERT INTO gridex_received_sources.production_contract_brp_bindings(message_id,company_id,event_id,brp_ediel_id,source_basis,payload_hash) VALUES(NEW.id,o.company_id,o.event_id,b->>'brpEdielId',b->'brpBasis',NEW.immutable_payload_hash);RETURN NEW;
END$$;
CREATE TRIGGER production_contract_source_brp_after_bind AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.production_contract_brp_wire_guard_v1();
ALTER FUNCTION gridex_received_sources.require_production_contract_source_current_v1(uuid,uuid,uuid) RENAME TO require_production_contract_before_brp_current_v1;
CREATE FUNCTION gridex_received_sources.require_production_contract_source_current_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_received_sources.production_contract_origins%rowtype;b jsonb;original public.ediel_messages%rowtype;
BEGIN
 PERFORM gridex_received_sources.require_production_contract_before_brp_current_v1(p_company_id,p_message_id,p_actor_user_id);
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z09' THEN RETURN;END IF;
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE message_id=m.id AND company_id=p_company_id;
 IF o.event_id IS NOT NULL THEN
  b:=gridex_received_sources.production_contract_source_for_execution_v1(p_company_id,o.event_id,p_actor_user_id,'communication.send');
  IF b->>'status' IS DISTINCT FROM 'authorized' OR gridex_received_sources.outbound_single_brp_v1(m.raw_payload) IS DISTINCT FROM b->>'brpEdielId' THEN RAISE EXCEPTION 'production_contract_current_physical_brp_required';END IF;RETURN;
 END IF;
 -- The delegated owner has already qualified this recovery's exact original,
 -- scope and current authentic source. Keep its physical262 through correction.
 SELECT source.* INTO original FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id JOIN public.ediel_messages source ON source.id=operation.original_message_id AND source.company_id=operation.company_id WHERE link.message_id=m.id AND operation.company_id=p_company_id;
 IF original.id IS NOT NULL AND gridex_received_sources.outbound_single_brp_v1(m.raw_payload) IS DISTINCT FROM gridex_received_sources.outbound_single_brp_v1(original.raw_payload) THEN RAISE EXCEPTION 'production_contract_recovery_physical_brp_changed';END IF;
END$$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_switch_production_brp_source_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=gridex_ediel_transport.mutate_before_switch_production_brp_source_v1(input);
 IF (input->>'action' IN('prepare','enter')) IS NOT TRUE OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 PERFORM gridex_received_sources.require_switch_brp_source_current_v1((input->>'companyId')::uuid,(input->>'messageId')::uuid,(input->>'actorUserId')::uuid);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid),public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid),public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_bind_switch_original_before_brp_source_v1(uuid,uuid,uuid,uuid),public.ediel_bind_switch_correction_before_brp_source_v1(uuid,uuid,uuid),gridex_received_sources.outbound_single_brp_v1(text),gridex_received_sources.switch_brp_source_basis_v1(uuid,uuid,uuid,text),gridex_received_sources.bind_switch_brp_source_v1(uuid,uuid,uuid),gridex_received_sources.require_switch_brp_source_current_v1(uuid,uuid,uuid),gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text),gridex_received_sources.production_contract_source_before_brp_v1(uuid,uuid,uuid,text),gridex_received_sources.production_contract_brp_wire_guard_v1(),gridex_received_sources.require_production_contract_source_current_v1(uuid,uuid,uuid),gridex_received_sources.require_production_contract_before_brp_current_v1(uuid,uuid,uuid),gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_switch_production_brp_source_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
