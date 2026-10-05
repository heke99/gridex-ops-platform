-- P09 / AT-Z09F-SUPPLIER / AT-Z09G-SUPPLIER. A NEW genuine customer
-- agreement supplies field217 and exact field216. A previous DSO method or a
-- mutable portal value is never a new contract event. No approval seeds/API.
BEGIN;
CREATE SCHEMA gridex_metering_method_changes;
REVOKE ALL ON SCHEMA gridex_metering_method_changes FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_metering_method_changes.events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 supply_period_id uuid NOT NULL REFERENCES public.customer_supply_periods(id),customer_id uuid NOT NULL REFERENCES public.customers(id),metering_point_id uuid NOT NULL REFERENCES public.metering_points(id),
 legal_actor_id uuid NOT NULL,legal_sender_id text NOT NULL,legal_receiver_id text NOT NULL,point_id text NOT NULL,identity_agency text NOT NULL CHECK(identity_agency IN('9','89')),grid_area_code text NOT NULL,
 supply_source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),supply_state_version bigint NOT NULL CHECK(supply_state_version>0),
 subtype text NOT NULL CHECK(subtype IN('F','G')),effective_at timestamptz NOT NULL CHECK(isfinite(effective_at) AND extract(second FROM effective_at)=0),
 contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),contract_revision text NOT NULL CHECK(length(contract_revision)>0),protected_contract_hash text NOT NULL CHECK(protected_contract_hash~'^[a-f0-9]{64}$'),
 agreement_original bytea NOT NULL CHECK(octet_length(agreement_original)>0 AND octet_length(agreement_original)<=10485760),agreement_sha256 text NOT NULL CHECK(agreement_sha256=encode(sha256(agreement_original),'hex')),
 source_reference text NOT NULL CHECK(length(source_reference)>0),source_original bytea NOT NULL CHECK(octet_length(source_original)>0 AND octet_length(source_original)<=10485760),source_sha256 text NOT NULL CHECK(source_sha256=encode(sha256(source_original),'hex')),source_version text NOT NULL CHECK(length(source_version)>0),
 approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,
 UNIQUE(company_id,environment,supply_period_id,effective_at),UNIQUE(company_id,environment,source_reference,source_version));
CREATE TABLE gridex_metering_method_changes.revocations(event_id uuid PRIMARY KEY REFERENCES gridex_metering_method_changes.events(id),source_reference text NOT NULL CHECK(length(source_reference)>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),actor_user_id uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_metering_method_changes.origins(event_id uuid PRIMARY KEY REFERENCES gridex_metering_method_changes.events(id),company_id uuid NOT NULL REFERENCES public.companies(id),intent_id uuid UNIQUE NOT NULL REFERENCES public.ediel_message_intents(id),outbound_request_id uuid UNIQUE NOT NULL REFERENCES public.outbound_requests(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),message_id uuid UNIQUE REFERENCES public.ediel_messages(id),payload_hash text,basis jsonb NOT NULL,intent_binding jsonb NOT NULL,reserved_at timestamptz NOT NULL DEFAULT now(),CHECK((message_id IS NULL)=(payload_hash IS NULL)));
-- This receipt records the desired change only. Accepted ACK/transport is not
-- received confirmed structure and never activates a new meter or customer.
CREATE TABLE gridex_metering_method_changes.desired_change_receipts(event_id uuid PRIMARY KEY REFERENCES gridex_metering_method_changes.events(id),company_id uuid NOT NULL,environment text NOT NULL,message_id uuid UNIQUE NOT NULL REFERENCES public.ediel_messages(id),payload_hash text NOT NULL,basis jsonb NOT NULL,effective_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['events','revocations','origins','desired_change_receipts'] LOOP
 EXECUTE format('ALTER TABLE gridex_metering_method_changes.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE gridex_metering_method_changes.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_metering_method_changes.%I FROM PUBLIC,anon,authenticated,service_role',t);
 IF t<>'origins' THEN EXECUTE format('CREATE TRIGGER method_source_immutable BEFORE UPDATE OR DELETE ON gridex_metering_method_changes.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);END IF;
 EXECUTE format('CREATE TRIGGER method_source_no_truncate BEFORE TRUNCATE ON gridex_metering_method_changes.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 END LOOP;
END$$;
CREATE FUNCTION gridex_metering_method_changes.revocation_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM gridex_metering_method_changes.events WHERE id=NEW.event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'method_revocation_event_required';END IF;RETURN NEW;
END$$;
CREATE TRIGGER method_revocation_lock BEFORE INSERT ON gridex_metering_method_changes.revocations FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.revocation_lock_v1();
CREATE FUNCTION gridex_metering_method_changes.canonical_tuple_projection_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
-- BEGIN CANONICAL METHOD CHANGE PROJECTION
 SELECT '{"F":{"subtype":"F","reason":"E64","method":"Z04"},"G":{"subtype":"G","reason":"E32","method":"Z03"}}'::jsonb
-- END CANONICAL METHOD CHANGE PROJECTION
$$;
CREATE FUNCTION gridex_metering_method_changes.context_v1(c uuid,event uuid,actor uuid,phase text DEFAULT 'origination') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e gridex_metering_method_changes.events%rowtype;contract public.customer_contracts%rowtype;point public.metering_points%rowtype;supply jsonb;header jsonb;network jsonb;tuple jsonb;
BEGIN
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(c,actor,phase,NULL);
 SELECT * INTO e FROM gridex_metering_method_changes.events WHERE id=event AND company_id=c FOR SHARE;
 IF NOT FOUND OR e.approved_at>statement_timestamp() OR EXISTS(SELECT FROM gridex_metering_method_changes.revocations WHERE event_id=e.id) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_customer_agreed_method_event']);END IF;
 -- The exact same current source owner supplies the supply relation and locks.
 supply:=gridex_received_sources.supply_period_source_at_v1(c,e.supply_period_id,e.effective_at);
 IF supply IS NULL OR supply->>'qualified' IS DISTINCT FROM 'true' OR nullif(supply->>'siteId','') IS NULL OR supply->>'customerId' IS DISTINCT FROM e.customer_id::text OR supply->>'meteringPointId' IS DISTINCT FROM e.metering_point_id::text OR supply->>'legalActorId' IS DISTINCT FROM e.legal_actor_id::text OR supply->>'sourceMessageId' IS DISTINCT FROM e.supply_source_message_id::text OR (supply->>'marketStateVersion')::bigint IS DISTINCT FROM e.supply_state_version OR supply->>'dsoEdielId' IS DISTINCT FROM e.legal_receiver_id
 OR (SELECT count(*) FROM jsonb_array_elements(supply->'sourceObjects') own WHERE own->>'point'=e.point_id AND own->>'identityAgency'=e.identity_agency AND own->>'gridArea'=e.grid_area_code)<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_source_owned_supply_relation']);END IF;
 SELECT * INTO contract FROM public.customer_contracts WHERE id=e.contract_id AND company_id=c FOR SHARE;
 SELECT * INTO point FROM public.metering_points WHERE id=e.metering_point_id AND company_id=c FOR SHARE;
 IF contract.id IS NULL OR point.id IS NULL OR contract.customer_id IS DISTINCT FROM e.customer_id OR contract.metering_point_id IS DISTINCT FROM e.metering_point_id OR point.customer_id IS DISTINCT FROM e.customer_id
 OR point.ediel_metering_point_id IS DISTINCT FROM e.point_id OR point.grid_owner_ediel_id IS DISTINCT FROM e.legal_receiver_id OR point.grid_area_code IS DISTINCT FROM e.grid_area_code
 OR contract.signed_at IS NULL OR contract.signed_version IS DISTINCT FROM e.contract_revision OR (contract.status IN('signed','active')) IS NOT TRUE
 OR gridex_received_sources.production_contract_hash_v1(contract) IS DISTINCT FROM e.protected_contract_hash
 OR to_jsonb(contract)->>'document_sha256' IS DISTINCT FROM e.agreement_sha256 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_customer_signed_agreement_original_revision_and_point']);END IF;
 network:=gridex_ai_processing.network_registry_basis_v1(e.legal_receiver_id,e.environment);
 IF network->>'status' IS DISTINCT FROM 'authorized' THEN RETURN jsonb_build_object('status','held','missing',ARRAY[coalesce(network->>'blocker','authenticated_versioned_network_owner_basis_required')]);END IF;
 -- This existing helper owns tenant legal supplier/role and authenticated
 -- versioned network context. Its AI purpose/list processing is not invoked.
 header:=gridex_ai_processing.header_company_basis_v1(c,e.environment,e.legal_sender_id,e.legal_receiver_id);
 IF header->>'legalActorId' IS DISTINCT FROM e.legal_actor_id::text THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_legal_supplier_original_scope_changed']);END IF;
 tuple:=gridex_metering_method_changes.canonical_tuple_projection_v1()->e.subtype;
 RETURN jsonb_build_object('status','authorized','companyId',c,'environment',e.environment,'eventId',e.id,'supplyPeriodId',e.supply_period_id,'supplyStateVersion',e.supply_state_version,'supplySourceMessageId',e.supply_source_message_id,'customerId',e.customer_id,'siteId',supply->>'siteId','meteringPointId',e.metering_point_id,'legalActorId',e.legal_actor_id,'legalSenderId',e.legal_sender_id,'legalReceiverId',e.legal_receiver_id,'pointId',e.point_id,'identityAgency',e.identity_agency,'gridArea',e.grid_area_code,'effectiveAt',e.effective_at,'contractId',e.contract_id,'contractRevision',e.contract_revision,'agreementSha256',e.agreement_sha256,'sourceReference',e.source_reference,'sourceVersion',e.source_version,'sourceDigest',e.source_sha256,'subtype',e.subtype,'reason',tuple->>'reason','method',tuple->>'method','headerBasis',header);
END$$;
CREATE FUNCTION public.ediel_metering_method_change_source_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_metering_method_changes.context_v1(p_company_id,p_event_id,p_actor_user_id)$$;
CREATE FUNCTION gridex_metering_method_changes.wire_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);
v_token jsonb;
obj jsonb:='{}';
head jsonb:='{}';
characteristic text;
key text;

BEGIN IF tokens IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='UNB')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='BGM')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='UNH')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='LIN')<>1 THEN RETURN NULL;
END IF;

 FOR v_token IN SELECT j.value FROM jsonb_array_elements(tokens) AS j(value) LOOP
 IF v_token->>'tag'='BGM' THEN head:=head||jsonb_build_object('code',v_token#>>'{elements,1,0}');
ELSIF v_token->>'tag'='UNB' THEN head:=head||jsonb_build_object('application',v_token#>>'{elements,7,0}','interchange',v_token#>>'{elements,5,0}','transportSender',v_token#>>'{elements,2,0}','transportReceiver',v_token#>>'{elements,3,0}','senderSubaddress',nullif(v_token#>>'{elements,2,2}',''),'receiverSubaddress',nullif(v_token#>>'{elements,3,2}',''));
ELSIF v_token->>'tag'='UNH' THEN head:=head||jsonb_build_object('message',v_token#>>'{elements,1,0}');
ELSIF v_token->>'tag'='NAD'
  AND v_token#>>'{elements,1,0}' IN('FR','DO') THEN key:=CASE v_token#>>'{elements,1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;
IF head?key
  OR v_token#>>'{elements,2,1}' IS DISTINCT FROM '160'
  OR v_token#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL;
END IF;
head:=head||jsonb_build_object(key,v_token#>>'{elements,2,0}');

 ELSIF v_token->>'tag'='LIN' THEN obj:=obj||jsonb_build_object('point',v_token#>>'{elements,3,0}','agency',v_token#>>'{elements,3,3}');

 ELSIF v_token->>'tag'='CCI' THEN characteristic:=v_token#>>'{elements,2,0}';

 ELSIF v_token->>'tag'='CAV'
  AND characteristic='Z04' THEN IF obj?'method' THEN RETURN NULL;END IF;obj:=obj||jsonb_build_object('method',v_token#>>'{elements,1,0}');
 ELSIF v_token->>'tag'='CAV'
  AND characteristic='Z13' THEN IF obj?'reason' THEN RETURN NULL;
END IF;
obj:=obj||jsonb_build_object('reason',v_token#>>'{elements,1,0}');

 ELSIF v_token->>'tag'='RFF'
  AND v_token#>>'{elements,1,0}' IN('LI','Z05') THEN key:=CASE v_token#>>'{elements,1,0}' WHEN 'LI' THEN 'li' ELSE 'gridArea' END;
IF obj?key THEN RETURN NULL;
END IF;
obj:=obj||jsonb_build_object(key,v_token#>>'{elements,1,1}');

 ELSIF v_token->>'tag'='DTM'
  AND v_token#>>'{elements,1,0}'='157' THEN IF obj?'effective'
  OR v_token#>>'{elements,1,2}' IS DISTINCT FROM '203' THEN RETURN NULL;
END IF;
obj:=obj||jsonb_build_object('effective',v_token#>>'{elements,1,1}');

 ELSIF v_token->>'tag'='NAD' AND v_token#>>'{elements,1,0}' IN('UD','IT') THEN RETURN NULL;

END IF;
END LOOP;

 RETURN head||jsonb_build_object('object',obj);
END$$;
CREATE FUNCTION gridex_metering_method_changes.intent_binding_v1(i public.ediel_message_intents) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT jsonb_build_object('company',i.company_id,'environment',i.environment,'operation',i.operation_id,'customer',i.customer_id,'site',i.customer_site_id,'point',i.metering_point_id,'application',i.application_reference,'direction',i.direction,'family',i.message_family,'code',i.message_code,'validationStatus',i.validation_status,'businessProcess',i.business_process,'market',i.market,'sender',i.sender_ediel_id,'receiver',i.receiver_ediel_id,'senderSubaddress',i.sender_subaddress,'receiverSubaddress',i.receiver_subaddress,'interchange',i.interchange_reference,'message',i.message_reference,'transaction',i.transaction_reference,'route',i.communication_route_id,'routeProfile',i.route_profile_id)$$;
CREATE FUNCTION public.ediel_reserve_metering_method_change_origin_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE basis jsonb;
prior gridex_metering_method_changes.origins%rowtype;
i public.ediel_message_intents%rowtype;
r public.outbound_requests%rowtype;

BEGIN basis:=gridex_metering_method_changes.context_v1(p_company_id,p_event_id,p_actor_user_id);
IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;
END IF;

 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('metering-method-change:'||p_company_id::text||':'||p_event_id::text,0));
SELECT * INTO prior FROM gridex_metering_method_changes.origins WHERE company_id=p_company_id
  AND event_id=p_event_id FOR UPDATE;

 IF FOUND THEN IF prior.intent_id IS DISTINCT FROM p_intent_id
  OR prior.basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'metering_method_change_frozen_origin_conflict';
END IF;
RETURN jsonb_build_object('status','reserved','messageId',prior.message_id,'outboundRequestId',prior.outbound_request_id);
END IF;

 SELECT * INTO i FROM public.ediel_message_intents WHERE company_id=p_company_id
  AND id=p_intent_id FOR SHARE;
SELECT * INTO r FROM public.outbound_requests WHERE company_id=p_company_id
  AND id=p_outbound_request_id FOR SHARE;

 IF i.id IS NULL
  OR r.id IS NULL
  OR i.business_process IS DISTINCT FROM 'customer_masterdata' OR i.market IS DISTINCT FROM 'electricity' OR i.environment IS DISTINCT FROM basis->>'environment'
  OR i.direction IS DISTINCT FROM 'outbound'
  OR i.message_family IS DISTINCT FROM 'PRODAT'
  OR i.message_code IS DISTINCT FROM 'Z09'
  OR i.operation_id IS DISTINCT FROM p_event_id
  OR i.customer_site_id IS DISTINCT FROM (basis->>'siteId')::uuid OR i.customer_id IS DISTINCT FROM (basis->>'customerId')::uuid
  OR i.metering_point_id IS DISTINCT FROM basis->>'pointId'
  OR i.validation_status IS DISTINCT FROM 'validated' OR i.validation_result->>'ok' IS DISTINCT FROM 'true' OR i.blocking_reasons IS DISTINCT FROM '[]'::jsonb
  OR i.application_reference IS DISTINCT FROM '23-DDQ-PRODAT'
  OR r.request_type IS DISTINCT FROM 'customer_masterdata'
  OR r.source_type IS DISTINCT FROM 'manual'
  OR i.communication_route_id IS NULL
  OR i.route_profile_id IS NULL
  OR nullif(i.interchange_reference,'') IS NULL
  OR nullif(i.message_reference,'') IS NULL
  OR nullif(i.transaction_reference,'') IS NULL
  OR r.source_id::text IS DISTINCT FROM i.id::text
  OR r.metering_point_id IS DISTINCT FROM (basis->>'meteringPointId')::uuid
  OR r.operation_id IS DISTINCT FROM p_event_id
  OR r.customer_id IS DISTINCT FROM i.customer_id
  OR r.communication_route_id IS DISTINCT FROM i.communication_route_id THEN RAISE EXCEPTION 'metering_method_change_owned_intent_request_required';
END IF;

 INSERT INTO gridex_metering_method_changes.origins(event_id,company_id,intent_id,outbound_request_id,actor_user_id,basis,intent_binding) VALUES(p_event_id,p_company_id,p_intent_id,p_outbound_request_id,p_actor_user_id,basis,gridex_metering_method_changes.intent_binding_v1(i));

 RETURN jsonb_build_object('status','reserved','messageId',NULL,'outboundRequestId',p_outbound_request_id);
END$$;
CREATE FUNCTION gridex_metering_method_changes.origin_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN IF TG_OP IS DISTINCT FROM 'UPDATE'
  OR (to_jsonb(NEW)-ARRAY['message_id','payload_hash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['message_id','payload_hash'])
  OR OLD.message_id IS NOT NULL
  OR NEW.message_id IS NULL
  OR NEW.payload_hash IS NULL THEN RAISE EXCEPTION 'method_origin_immutable';
END IF;
RETURN NEW;
END$$;
CREATE TRIGGER method_origin_immutable BEFORE UPDATE OR DELETE ON gridex_metering_method_changes.origins FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.origin_guard_v1();
CREATE FUNCTION gridex_metering_method_changes.request_binding_v1(r public.outbound_requests,o gridex_metering_method_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 r.id IS NOT DISTINCT FROM o.outbound_request_id
  AND r.company_id IS NOT DISTINCT FROM o.company_id
  AND r.source_id::text IS NOT DISTINCT FROM o.intent_id::text
  AND r.source_type IS NOT DISTINCT FROM 'manual'
  AND r.request_type IS NOT DISTINCT FROM 'customer_masterdata'
  AND r.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND r.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND r.operation_id IS NOT DISTINCT FROM o.event_id
  AND r.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid$$;
CREATE FUNCTION gridex_metering_method_changes.message_binding_v1(m public.ediel_messages,o gridex_metering_method_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 m.created_by IS NOT DISTINCT FROM o.actor_user_id AND m.id IS NOT DISTINCT FROM o.message_id
  AND m.intent_id IS NOT DISTINCT FROM o.intent_id
  AND m.company_id IS NOT DISTINCT FROM o.company_id
  AND m.environment IS NOT DISTINCT FROM o.basis->>'environment'
  AND m.direction IS NOT DISTINCT FROM 'outbound'
  AND m.message_family IS NOT DISTINCT FROM 'PRODAT'
  AND m.message_code IS NOT DISTINCT FROM 'Z09'
  AND m.source_operation_id IS NOT DISTINCT FROM o.event_id::text
  AND m.outbound_request_id IS NOT DISTINCT FROM o.outbound_request_id
  AND m.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND m.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND m.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid
  AND m.route_profile_id IS NOT DISTINCT FROM (o.intent_binding->>'routeProfile')::uuid
  AND m.sender_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'sender'
  AND m.receiver_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'receiver'
  AND m.interchange_reference IS NOT DISTINCT FROM o.intent_binding->>'interchange'
  AND m.transaction_reference IS NOT DISTINCT FROM o.intent_binding->>'transaction'
  AND o.payload_hash IS NOT DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')$$;
CREATE FUNCTION gridex_metering_method_changes.require_origin_before_insert_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w jsonb;tokens jsonb;o gridex_metering_method_changes.origins%rowtype;BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.raw_payload IS NULL THEN RETURN NEW;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(NEW.raw_payload);w:=gridex_metering_method_changes.wire_v1(NEW.raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z09') OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}' IN(SELECT value->>'reason' FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()))) THEN RETURN NEW;END IF;
 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=NEW.company_id AND intent_id=NEW.intent_id;
 IF w IS NULL OR o.event_id IS NULL OR o.actor_user_id IS DISTINCT FROM NEW.created_by OR NEW.source_operation_id IS DISTINCT FROM o.event_id::text THEN RAISE EXCEPTION 'authentic_metering_method_change_origin_required';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER method_source_required_before_insert BEFORE INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.require_origin_before_insert_v1();
CREATE FUNCTION gridex_metering_method_changes.bind_message_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE o gridex_metering_method_changes.origins%rowtype;
b jsonb;
w jsonb;
r public.outbound_requests%rowtype;i public.ediel_message_intents%rowtype;

BEGIN SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE intent_id=NEW.intent_id
  OR message_id=NEW.id;
IF NOT FOUND THEN RETURN NEW;
END IF;

 IF o.message_id IS NOT NULL THEN IF gridex_metering_method_changes.message_binding_v1(NEW,o) IS NOT TRUE THEN RAISE EXCEPTION 'method_bound_message_immutable';
END IF;
RETURN NEW;
END IF;

 b:=gridex_metering_method_changes.context_v1(o.company_id,o.event_id,o.actor_user_id);
SELECT * INTO STRICT o FROM gridex_metering_method_changes.origins WHERE intent_id=NEW.intent_id FOR UPDATE;

 IF o.message_id IS NOT NULL THEN IF gridex_metering_method_changes.message_binding_v1(NEW,o) IS NOT TRUE THEN RAISE EXCEPTION 'method_bound_message_immutable';
END IF;
RETURN NEW;
END IF;

 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id
  AND company_id=o.company_id FOR SHARE;

 IF gridex_metering_method_changes.request_binding_v1(r,o) IS NOT TRUE THEN RAISE EXCEPTION 'metering_method_change_owned_request_changed';
END IF;

 SELECT * INTO i FROM public.ediel_message_intents WHERE company_id=o.company_id AND id=o.intent_id FOR SHARE;
 IF i.id IS NULL OR gridex_metering_method_changes.intent_binding_v1(i) IS DISTINCT FROM o.intent_binding OR i.validation_result->>'ok' IS DISTINCT FROM 'true' OR i.blocking_reasons IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'metering_method_change_owned_intent_changed';END IF;
 w:=gridex_metering_method_changes.wire_v1(NEW.raw_payload);

 IF b IS DISTINCT FROM o.basis
  OR b->>'status' IS DISTINCT FROM 'authorized'
  OR NEW.created_by IS DISTINCT FROM o.actor_user_id OR NEW.company_id IS DISTINCT FROM o.company_id
  OR NEW.environment IS DISTINCT FROM b->>'environment'
  OR NEW.direction IS DISTINCT FROM 'outbound'
  OR NEW.message_family IS DISTINCT FROM 'PRODAT'
  OR NEW.message_code IS DISTINCT FROM 'Z09'
  OR NEW.source_operation_id IS DISTINCT FROM o.event_id::text
  OR NEW.outbound_request_id IS DISTINCT FROM o.outbound_request_id
  OR NEW.customer_id IS DISTINCT FROM (b->>'customerId')::uuid
  OR NEW.metering_point_id IS DISTINCT FROM (b->>'meteringPointId')::uuid
  OR NEW.communication_route_id IS DISTINCT FROM (o.intent_binding->>'route')::uuid
  OR NEW.route_profile_id IS DISTINCT FROM (o.intent_binding->>'routeProfile')::uuid
  OR NEW.sender_ediel_id IS DISTINCT FROM o.intent_binding->>'sender'
  OR NEW.receiver_ediel_id IS DISTINCT FROM o.intent_binding->>'receiver'
  OR NEW.interchange_reference IS DISTINCT FROM o.intent_binding->>'interchange'
  OR NEW.transaction_reference IS DISTINCT FROM o.intent_binding->>'transaction'
  OR w IS NULL
  OR w->>'code' IS DISTINCT FROM 'Z09'
  OR w->>'application' IS DISTINCT FROM '23-DDQ-PRODAT'
  OR w->>'sender' IS DISTINCT FROM b->>'legalSenderId'
  OR w->>'receiver' IS DISTINCT FROM b->>'legalReceiverId'
  OR w#>>'{object,reason}' IS DISTINCT FROM b->>'reason'
  OR w#>>'{object,point}' IS DISTINCT FROM b->>'pointId'
  OR w#>>'{object,agency}' IS DISTINCT FROM b->>'identityAgency'
  OR w#>>'{object,gridArea}' IS DISTINCT FROM b->>'gridArea'
  OR w#>>'{object,method}' IS DISTINCT FROM b->>'method'
  OR w#>>'{object,effective}' IS DISTINCT FROM to_char((b->>'effectiveAt')::timestamptz AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI')
  OR w#>>'{object,li}' IS DISTINCT FROM o.intent_binding->>'transaction'
  OR w->>'interchange' IS DISTINCT FROM o.intent_binding->>'interchange'
  OR w->>'message' IS DISTINCT FROM o.intent_binding->>'message'
  OR w->>'transportSender' IS DISTINCT FROM o.intent_binding->>'sender'
  OR w->>'transportReceiver' IS DISTINCT FROM o.intent_binding->>'receiver'
  OR w->>'senderSubaddress' IS DISTINCT FROM o.intent_binding->>'senderSubaddress'
  OR w->>'receiverSubaddress' IS DISTINCT FROM o.intent_binding->>'receiverSubaddress' THEN RAISE EXCEPTION 'metering_method_change_exact_wire_basis_required';
END IF;

 UPDATE gridex_metering_method_changes.origins SET message_id=NEW.id,payload_hash=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') WHERE event_id=o.event_id;

 INSERT INTO gridex_metering_method_changes.desired_change_receipts(event_id,company_id,environment,message_id,payload_hash,basis,effective_at) VALUES(o.event_id,o.company_id,b->>'environment',NEW.id,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),b,(b->>'effectiveAt')::timestamptz);

 RETURN NEW;
END$$;
CREATE TRIGGER method_bind_message AFTER INSERT
  OR UPDATE OF created_by,intent_id,raw_payload,company_id,environment,direction,message_family,message_code,source_operation_id,outbound_request_id,customer_id,metering_point_id,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,interchange_reference,transaction_reference ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.bind_message_v1();
CREATE FUNCTION public.ediel_require_metering_method_change_source_current_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ediel_messages%rowtype;
o gridex_metering_method_changes.origins%rowtype;
b jsonb;
w jsonb;
tokens jsonb;
r public.outbound_requests%rowtype;i public.ediel_message_intents%rowtype;

BEGIN SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id
  AND id=p_message_id FOR SHARE;
tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);
w:=gridex_metering_method_changes.wire_v1(m.raw_payload);
IF w IS NULL
  AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM'
  AND t#>>'{elements,1,0}'='Z09')
  AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV'
  AND t#>>'{elements,1,0}' IN(SELECT value->>'reason' FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()))) THEN RAISE EXCEPTION 'metering_method_change_physical_scope_required';
END IF;
IF w IS NULL
  OR w->>'code' IS DISTINCT FROM 'Z09'
  OR NOT EXISTS(SELECT FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()) pair WHERE pair.value->>'reason'=w#>>'{object,reason}') THEN RETURN;
END IF;

 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=p_company_id
  AND message_id=p_message_id;

 IF NOT FOUND THEN RAISE EXCEPTION 'authentic_metering_method_change_origin_required';
END IF;

 b:=gridex_metering_method_changes.context_v1(o.company_id,o.event_id,p_actor_user_id,'send');
SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id
  AND company_id=o.company_id FOR SHARE;
SELECT * INTO i FROM public.ediel_message_intents WHERE company_id=o.company_id AND id=o.intent_id FOR SHARE;
 IF i.id IS NULL OR gridex_metering_method_changes.intent_binding_v1(i) IS DISTINCT FROM o.intent_binding OR i.validation_result->>'ok' IS DISTINCT FROM 'true' OR i.blocking_reasons IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'metering_method_change_owned_intent_changed';END IF;
 IF gridex_metering_method_changes.request_binding_v1(r,o) IS NOT TRUE
  OR b IS DISTINCT FROM o.basis
  OR b->>'status' IS DISTINCT FROM 'authorized'
  OR gridex_metering_method_changes.message_binding_v1(m,o) IS NOT TRUE THEN RAISE EXCEPTION 'metering_method_change_current_source_held';
END IF;
END$$;
CREATE FUNCTION public.ediel_metering_method_change_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_metering_method_changes.origins%rowtype;b jsonb;BEGIN
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(p_company_id,p_actor_user_id,'send',NULL);
 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=p_company_id AND message_id=p_message_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 b:=gridex_metering_method_changes.context_v1(o.company_id,o.event_id,p_actor_user_id,'send');
 IF b IS DISTINCT FROM o.basis THEN RETURN jsonb_build_object('status','held','missing',ARRAY['metering_method_change_current_source_changed']);END IF;
 PERFORM public.ediel_require_metering_method_change_source_current_v1(p_company_id,p_message_id,p_actor_user_id);
 RETURN jsonb_build_object('basis',b,'intentId',o.intent_id,'actorUserId',o.actor_user_id);
END$$;
-- Timers consume frozen exact original authority after an actual accepted send.
-- Subsequent contract changes do not manufacture or relabel this frozen tuple.
CREATE FUNCTION gridex_metering_method_changes.frozen_original_basis_v1(c uuid,msg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_metering_method_changes.desired_change_receipts%rowtype;m public.ediel_messages%rowtype;o gridex_metering_method_changes.origins%rowtype;w jsonb;BEGIN
 SELECT * INTO r FROM gridex_metering_method_changes.desired_change_receipts WHERE company_id=c AND message_id=msg;
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=c AND id=msg;
 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=c AND message_id=msg;
 IF r.event_id IS NULL OR o.event_id IS DISTINCT FROM r.event_id OR o.payload_hash IS DISTINCT FROM r.payload_hash OR o.basis IS DISTINCT FROM r.basis OR gridex_metering_method_changes.message_binding_v1(m,o) IS NOT TRUE THEN RETURN NULL;END IF;
 w:=gridex_metering_method_changes.wire_v1(m.raw_payload);
 IF w IS NULL OR w#>>'{object,effective}' IS DISTINCT FROM to_char(r.effective_at AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('authorized',true,'eventId',r.event_id,'sourceMessageId',msg,'sourcePayloadHash',r.payload_hash,'basis',r.basis,'physicalObject',w->'object','validityDay',substring(w#>>'{object,effective}',1,8));
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_metering_method_changes' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_metering_method_change_source_v1(uuid,uuid,uuid),public.ediel_reserve_metering_method_change_origin_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_metering_method_change_message_basis_v1(uuid,uuid,uuid),public.ediel_require_metering_method_change_source_current_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_metering_method_change_source_v1(uuid,uuid,uuid),public.ediel_reserve_metering_method_change_origin_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_metering_method_change_message_basis_v1(uuid,uuid,uuid),public.ediel_require_metering_method_change_source_current_v1(uuid,uuid,uuid) TO service_role;
-- Immutable source-owned projection for TM-METHOD40. The receipt references
-- its actual at-apply assessments; no newer rule/masterdata selection replaces it.
CREATE FUNCTION gridex_received_sources.applied_structural_method_objects_v1(c uuid,msg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_received_sources.structural_apply_receipts%rowtype;s gridex_received_sources.sources%rowtype;a gridex_received_sources.object_assessments%rowtype;f gridex_received_sources.prodat_ignored_field_facets%rowtype;
 own jsonb;assessed jsonb;business jsonb;first_register jsonb;token jsonb;characteristic text;method text;method_count integer;out jsonb:='[]';
BEGIN
 SELECT * INTO r FROM gridex_received_sources.structural_apply_receipts WHERE company_id=c AND source_message_id=msg;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE company_id=c AND source_message_id=msg AND environment=r.environment;
 SELECT * INTO a FROM gridex_received_sources.object_assessments WHERE id=r.object_assessment_id AND company_id=c AND source_message_id=msg AND environment=r.environment;
 SELECT * INTO f FROM gridex_received_sources.prodat_ignored_field_facets WHERE canonical_assessment_id=r.canonical_assessment_id AND company_id=c AND source_message_id=msg AND environment=r.environment;
 IF s.source_message_id IS NULL OR a.id IS NULL OR f.canonical_assessment_id IS NULL OR s.payload_hash IS DISTINCT FROM r.payload_hash OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') OR a.source_payload_hash IS DISTINCT FROM s.payload_hash OR a.canonical_assessment_id IS DISTINCT FROM r.canonical_assessment_id OR f.source_payload_hash IS DISTINCT FROM s.payload_hash OR f.fields_hash IS DISTINCT FROM encode(sha256(convert_to(f.fields_text,'UTF8')),'hex') THEN RETURN NULL;END IF;
 FOR own IN SELECT value FROM jsonb_array_elements(r.objects) LOOP
  SELECT value INTO assessed FROM jsonb_array_elements(a.facts_text::jsonb->'objects') value WHERE value->'object'=own->'object';
  business:=assessed->'business';first_register:=own#>'{sourceRegisters,0}';
  IF assessed->>'disposition' IS DISTINCT FROM 'accepted' OR business->>'owner' IS DISTINCT FROM 'reviewed-received-structure-v1' OR business->'wire' IS DISTINCT FROM own->'wire' OR business->>'companyId' IS DISTINCT FROM c::text OR business->>'environment' IS DISTINCT FROM r.environment OR business->>'meteringPointId' IS DISTINCT FROM own->>'meteringPointId' OR business->>'siteId' IS DISTINCT FROM own->>'siteId' OR nullif(business->>'customerId','') IS NULL OR own#>>'{wire,messageCode}' IS DISTINCT FROM 'Z06' OR (own#>>'{wire,businessCase}' IN('change_with_reading','change_without_reading')) IS NOT TRUE THEN CONTINUE;END IF;
  characteristic:=NULL;method:=NULL;method_count:=0;
  FOR token IN SELECT value FROM jsonb_array_elements(first_register->'tokens') LOOP
   IF token->>'tag'='CCI' THEN characteristic:=token#>>'{elements,2,0}';
   ELSIF token->>'tag'='CAV' AND characteristic='Z04' THEN method_count:=method_count+1;method:=token#>>'{elements,1,0}';END IF;
  END LOOP;
  IF method_count<>1 OR EXISTS(SELECT FROM jsonb_array_elements(f.fields_text::jsonb) ignored WHERE ignored->>'fieldNumber'='217' AND ignored#>>'{occurrence,objectId}'=own#>>'{object,objectId}' AND ignored#>>'{occurrence,identityAgency}'=own#>>'{object,identityAgency}' AND ignored#>>'{occurrence,messageReference}'=own#>>'{object,messageReference}' AND ignored#>>'{occurrence,lineIndex}'=first_register#>>'{register,lineIndex}') THEN method:=NULL;END IF;
  out:=out||jsonb_build_array(jsonb_build_object('companyId',c,'environment',r.environment,'sourceMessageId',msg,'sourcePayloadHash',r.payload_hash,'customerId',business->>'customerId','siteId',own->>'siteId','meteringPointId',own->>'meteringPointId','objectId',own#>>'{object,objectId}','identityAgency',own#>>'{object,identityAgency}','businessCase',own#>>'{wire,businessCase}','effectiveAt',own->'effectiveAt','legalNetwork',own#>>'{wire,legalSender}','legalSupplier',own#>>'{wire,legalReceiver}','measurementMethod',nullif(method,''),'sourceReceivedAt',r.source_received_at,'appliedAt',r.applied_at));
 END LOOP;
 RETURN out;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.applied_structural_method_objects_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
