-- P03 / P57 / PRODAT 2.2: the new Z03 requested217 comes from the
-- independently approved signed agreement declaration, never prior DSO data.
-- Existing immutable original/provider outcomes are neither backfilled nor reset.
BEGIN;
CREATE TABLE gridex_received_sources.switch_contract_request_bindings(
 message_id uuid PRIMARY KEY REFERENCES gridex_received_sources.switch_originals(message_id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 declaration_id uuid NOT NULL REFERENCES gridex_metering_method_changes.contract_request_declarations(id),
 requested_method text NOT NULL,source_basis jsonb NOT NULL,payload_hash text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.switch_contract_request_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.switch_contract_request_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.switch_contract_request_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER switch_method_binding_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.switch_contract_request_bindings FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER switch_method_binding_no_truncate BEFORE TRUNCATE ON gridex_received_sources.switch_contract_request_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
-- A projection of the sole release/UNA decoder. Canonical admission still owns
-- grammar, cardinality and the national tuple; this extracts only the common217.
CREATE FUNCTION gridex_received_sources.switch_requested_method_v1(raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE token jsonb;active_object boolean:=false;common_open boolean:=true;attribute text;method text;
BEGIN
 FOR token IN SELECT item FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(raw)) item LOOP
  IF token->>'tag'='LIN' THEN IF active_object THEN RETURN NULL;END IF;active_object:=true;attribute:=NULL;CONTINUE;END IF;
  IF NOT active_object OR NOT common_open THEN CONTINUE;END IF;
  IF token->>'tag' IN('RFF','NAD','DTM','UNT') THEN common_open:=false;attribute:=NULL;CONTINUE;END IF;
  IF token->>'tag'='CCI' THEN attribute:=token#>>'{elements,2,0}';CONTINUE;END IF;
  IF token->>'tag'='CAV' AND attribute='Z04' THEN
   IF method IS NOT NULL OR nullif(token#>>'{elements,1,0}','') IS NULL THEN RETURN NULL;END IF;
   method:=token#>>'{elements,1,0}';attribute:=NULL;
  END IF;
 END LOOP;
 RETURN method;
END$$;
CREATE FUNCTION gridex_received_sources.switch_contract_request_basis_v1(c uuid,message uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_received_sources.switch_originals%rowtype;basis jsonb;wire jsonb;method text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR SHARE;
 SELECT * INTO o FROM gridex_received_sources.switch_originals WHERE message_id=m.id AND company_id=c;
 IF m.id IS NULL OR o.message_id IS NULL THEN RAISE EXCEPTION 'switch_signed_requested_method_original_required';END IF;
 basis:=gridex_metering_method_changes.contract_request_basis_v1(c,o.contract_id,actor,phase,m.environment);
 wire:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);
 method:=gridex_received_sources.switch_requested_method_v1(m.raw_payload);
 IF basis->>'status' IS DISTINCT FROM 'authorized' OR wire IS NULL OR method IS NULL OR method IS DISTINCT FROM basis->>'requestedMethod'
  OR basis->>'companyId' IS DISTINCT FROM c::text OR basis->>'environment' IS DISTINCT FROM m.environment OR basis->>'contractId' IS DISTINCT FROM o.contract_id::text OR basis->>'protectedContractHash' IS DISTINCT FROM o.contract_hash
  OR basis->>'customerId' IS DISTINCT FROM m.customer_id::text OR basis->>'siteId' IS DISTINCT FROM m.site_id::text OR basis->>'meteringPointId' IS DISTINCT FROM m.metering_point_id::text
  OR basis->>'legalSenderId' IS DISTINCT FROM wire->>'sender' OR basis->>'legalReceiverId' IS DISTINCT FROM wire->>'receiver'
  OR basis->>'pointId' IS DISTINCT FROM o.original_object->>'point' OR basis->>'identityAgency' IS DISTINCT FROM o.original_object->>'identityAgency' OR basis->>'gridArea' IS DISTINCT FROM o.original_object->>'gridArea'
  OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR m.immutable_rendered_at IS NULL
 THEN RAISE EXCEPTION 'switch_signed_new_agreement_requested_method_required';END IF;
 RETURN basis;
END$$;
CREATE FUNCTION gridex_received_sources.bind_switch_contract_request_v1(c uuid,message uuid,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE basis jsonb;m public.ediel_messages%rowtype;BEGIN
 basis:=gridex_received_sources.switch_contract_request_basis_v1(c,message,actor,'prepare');
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=message AND company_id=c;
 INSERT INTO gridex_received_sources.switch_contract_request_bindings(message_id,company_id,declaration_id,requested_method,source_basis,payload_hash)
 VALUES(message,c,(basis->>'declarationId')::uuid,basis->>'requestedMethod',basis,m.immutable_payload_hash);
END$$;
ALTER FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid) RENAME TO ediel_bind_switch_original_before_method_v1;
CREATE FUNCTION public.ediel_bind_switch_original_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=public.ediel_bind_switch_original_before_method_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);
 -- The original owner returns its authentic established outcome before today's
 -- declaration checks. A first effect and its declaration binding are one TX.
 IF result->>'status'='bound' AND result->>'idempotent' IS DISTINCT FROM 'true' THEN PERFORM gridex_received_sources.bind_switch_contract_request_v1(p_company_id,p_message_id,p_actor_user_id);END IF;
 RETURN result;
END$$;
ALTER FUNCTION public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) RENAME TO ediel_bind_switch_correction_before_method_v1;
CREATE FUNCTION public.ediel_bind_switch_correction_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=public.ediel_bind_switch_correction_before_method_v1(p_company_id,p_message_id,p_actor_user_id);
 IF result->>'status'='bound' AND result->>'idempotent' IS DISTINCT FROM 'true' THEN PERFORM gridex_received_sources.bind_switch_contract_request_v1(p_company_id,p_message_id,p_actor_user_id);END IF;
 RETURN result;
END$$;
CREATE FUNCTION gridex_received_sources.require_switch_contract_request_current_v1(c uuid,message uuid,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;binding gridex_received_sources.switch_contract_request_bindings%rowtype;basis jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' THEN RETURN;END IF;
 -- Cancellation has its own withdrawal authority. Genuine consumed fixtures
 -- have their own normal canonical owner and never create a live switch original.
 IF NOT EXISTS(SELECT FROM gridex_received_sources.switch_originals o WHERE o.message_id=m.id AND o.company_id=c) THEN RETURN;END IF;
 SELECT * INTO binding FROM gridex_received_sources.switch_contract_request_bindings WHERE message_id=m.id AND company_id=c;
 IF binding.message_id IS NULL THEN RAISE EXCEPTION 'switch_historical_requested_method_basis_unavailable';END IF;
 basis:=gridex_received_sources.switch_contract_request_basis_v1(c,m.id,actor,'send');
 IF basis IS DISTINCT FROM binding.source_basis OR binding.requested_method IS DISTINCT FROM basis->>'requestedMethod' OR binding.declaration_id::text IS DISTINCT FROM basis->>'declarationId' OR binding.payload_hash IS DISTINCT FROM m.immutable_payload_hash THEN RAISE EXCEPTION 'switch_current_requested_method_declaration_changed';END IF;
END$$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_signed_switch_method_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=gridex_ediel_transport.mutate_before_signed_switch_method_v1(input);
 IF (input->>'action' IN('prepare','enter')) IS NOT TRUE OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 PERFORM gridex_received_sources.require_switch_contract_request_current_v1((input->>'companyId')::uuid,(input->>'messageId')::uuid,(input->>'actorUserId')::uuid);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid),public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid),public.ediel_bind_switch_correction_v1(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_bind_switch_original_before_method_v1(uuid,uuid,uuid,uuid),public.ediel_bind_switch_correction_before_method_v1(uuid,uuid,uuid),gridex_received_sources.switch_requested_method_v1(text),gridex_received_sources.switch_contract_request_basis_v1(uuid,uuid,uuid,text),gridex_received_sources.bind_switch_contract_request_v1(uuid,uuid,uuid),gridex_received_sources.require_switch_contract_request_current_v1(uuid,uuid,uuid),gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_signed_switch_method_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
