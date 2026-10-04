-- Forward correction of own source tuple and genuine protected TEST originals.
-- No production event/source failure can fall back to a certification fixture.
BEGIN;

CREATE OR REPLACE FUNCTION public.ediel_reserve_metering_method_change_origin_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  OR r.site_id IS DISTINCT FROM (basis->>'siteId')::uuid
  OR r.payload->>'environment' IS DISTINCT FROM basis->>'environment'
  OR r.customer_id IS DISTINCT FROM i.customer_id
  OR r.communication_route_id IS DISTINCT FROM i.communication_route_id THEN RAISE EXCEPTION 'metering_method_change_owned_intent_request_required';
END IF;

 INSERT INTO gridex_metering_method_changes.origins(event_id,company_id,intent_id,outbound_request_id,actor_user_id,basis,intent_binding) VALUES(p_event_id,p_company_id,p_intent_id,p_outbound_request_id,p_actor_user_id,basis,gridex_metering_method_changes.intent_binding_v1(i));

 RETURN jsonb_build_object('status','reserved','messageId',NULL,'outboundRequestId',p_outbound_request_id);
END$$;

CREATE OR REPLACE FUNCTION gridex_metering_method_changes.request_binding_v1(r public.outbound_requests,o gridex_metering_method_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 r.id IS NOT DISTINCT FROM o.outbound_request_id
  AND r.company_id IS NOT DISTINCT FROM o.company_id
  AND r.source_id::text IS NOT DISTINCT FROM o.intent_id::text
  AND r.source_type IS NOT DISTINCT FROM 'manual'
  AND r.request_type IS NOT DISTINCT FROM 'customer_masterdata'
  AND r.site_id IS NOT DISTINCT FROM (o.basis->>'siteId')::uuid
  AND r.payload->>'environment' IS NOT DISTINCT FROM o.basis->>'environment'
  AND r.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND r.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND r.operation_id IS NOT DISTINCT FROM o.event_id
  AND r.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid$$;

CREATE OR REPLACE FUNCTION gridex_metering_method_changes.message_binding_v1(m public.ediel_messages,o gridex_metering_method_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 m.created_by IS NOT DISTINCT FROM o.actor_user_id AND m.id IS NOT DISTINCT FROM o.message_id
  AND m.intent_id IS NOT DISTINCT FROM o.intent_id
  AND m.company_id IS NOT DISTINCT FROM o.company_id
  AND m.environment IS NOT DISTINCT FROM o.basis->>'environment'
  AND m.direction IS NOT DISTINCT FROM 'outbound'
  AND m.message_family IS NOT DISTINCT FROM 'PRODAT'
  AND m.message_code IS NOT DISTINCT FROM 'Z09'
  AND m.source_operation_id IS NOT DISTINCT FROM o.event_id::text
  AND m.outbound_request_id IS NOT DISTINCT FROM o.outbound_request_id
  AND m.site_id IS NOT DISTINCT FROM (o.basis->>'siteId')::uuid
  AND m.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND m.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND m.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid
  AND m.route_profile_id IS NOT DISTINCT FROM (o.intent_binding->>'routeProfile')::uuid
  AND m.sender_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'sender'
  AND m.receiver_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'receiver'
  AND m.interchange_reference IS NOT DISTINCT FROM o.intent_binding->>'interchange'
  AND m.transaction_reference IS NOT DISTINCT FROM o.intent_binding->>'transaction'
  AND o.payload_hash IS NOT DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')$$;

ALTER FUNCTION gridex_metering_method_changes.wire_v1(text) RENAME TO wire_before_complete_scope_v1;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.wire_before_complete_scope_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_metering_method_changes.wire_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE w jsonb;tokens jsonb;unb jsonb;
BEGIN
 w:=gridex_metering_method_changes.wire_before_complete_scope_v1(raw);
 IF w IS NULL THEN RETURN NULL;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(raw);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='PRODAT') THEN RETURN NULL;END IF;
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';
 RETURN w||jsonb_build_object('testIndicator',coalesce(unb#>>'{elements,11,0}',''));
END$$;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_metering_method_changes.fixture_qualification_v1(q jsonb,c uuid,positive boolean) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT
 q IS NOT NULL AND q->>'companyId'=c::text AND q->>'version'='1' AND q->>'roleCode'='supplier' AND q->>'suite'='PRODAT' AND q->'authorizesBusinessEffect'='false'::jsonb
 AND CASE WHEN positive THEN q->>'kind'='source_qualified_positive_fixture' AND q->>'expectedOutcome'='positive' AND q->'expectedDiagnosticCodes'='[]'::jsonb
 ELSE q->>'kind'='source_qualified_negative_fixture' AND q->>'expectedOutcome'='negative' AND jsonb_typeof(q->'expectedDiagnosticCodes')='array' AND jsonb_array_length(q->'expectedDiagnosticCodes') BETWEEN 1 AND 256 END$$;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.fixture_qualification_v1(jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_metering_method_changes.require_origin_before_insert_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE positive uuid;negative uuid;q jsonb;w jsonb;tokens jsonb;o gridex_metering_method_changes.origins%rowtype;BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.raw_payload IS NULL THEN RETURN NEW;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(NEW.raw_payload);w:=gridex_metering_method_changes.wire_v1(NEW.raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z09') OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}' IN(SELECT value->>'reason' FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()))) THEN RETURN NEW;END IF;
 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=NEW.company_id AND intent_id=NEW.intent_id;
 IF o.event_id IS NULL AND NEW.environment='test' AND NEW.direction='outbound' AND NEW.message_standard='edifact' AND NEW.message_family='PRODAT' AND NEW.message_code='Z09' THEN
  positive:=nullif(NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId','')::uuid;
  negative:=nullif(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId','')::uuid;
  IF positive IS NOT NULL AND negative IS NOT NULL THEN RAISE EXCEPTION 'metering_method_change_fixture_source_ambiguous';END IF;
  IF positive IS NOT NULL OR negative IS NOT NULL THEN
   q:=CASE WHEN positive IS NOT NULL THEN gridex_negative_fixtures.prepared_positive_fixture_v1(NEW.company_id,positive,NEW.raw_payload,NEW.created_by) ELSE gridex_negative_fixtures.prepared_negative_fixture_v1(NEW.company_id,negative,NEW.raw_payload,NEW.created_by) END;
   IF gridex_metering_method_changes.fixture_qualification_v1(q,NEW.company_id,positive IS NOT NULL) IS NOT TRUE THEN RAISE EXCEPTION 'metering_method_change_prepared_test_original_required';END IF;
   RETURN NEW; -- Same normal fixture consumption seals this exact original; no desired-change receipt.
  END IF;
 END IF;
 IF w IS NULL OR o.event_id IS NULL OR o.actor_user_id IS DISTINCT FROM NEW.created_by OR NEW.source_operation_id IS DISTINCT FROM o.event_id::text THEN RAISE EXCEPTION 'authentic_metering_method_change_origin_required';END IF;
 RETURN NEW;
END$$;

CREATE OR REPLACE FUNCTION gridex_metering_method_changes.bind_message_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
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
  OR NEW.site_id IS DISTINCT FROM (b->>'siteId')::uuid
  OR NEW.customer_id IS DISTINCT FROM (b->>'customerId')::uuid
  OR NEW.metering_point_id IS DISTINCT FROM (b->>'meteringPointId')::uuid
  OR NEW.communication_route_id IS DISTINCT FROM (o.intent_binding->>'route')::uuid
  OR NEW.route_profile_id IS DISTINCT FROM (o.intent_binding->>'routeProfile')::uuid
  OR NEW.sender_ediel_id IS DISTINCT FROM o.intent_binding->>'sender'
  OR NEW.receiver_ediel_id IS DISTINCT FROM o.intent_binding->>'receiver'
  OR NEW.interchange_reference IS DISTINCT FROM o.intent_binding->>'interchange'
  OR NEW.transaction_reference IS DISTINCT FROM o.intent_binding->>'transaction'
  OR w IS NULL
  OR (b->>'environment'='test' AND w->>'testIndicator' IS DISTINCT FROM '1')
  OR (b->>'environment'='production' AND (w->>'testIndicator' IN ('','0')) IS NOT TRUE)
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
DROP TRIGGER method_bind_message ON public.ediel_messages;
CREATE TRIGGER method_bind_message AFTER INSERT OR UPDATE OF created_by,intent_id,raw_payload,company_id,environment,direction,message_family,message_code,source_operation_id,outbound_request_id,customer_id,site_id,metering_point_id,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,interchange_reference,transaction_reference ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.bind_message_v1();

CREATE OR REPLACE FUNCTION public.ediel_require_metering_method_change_source_current_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ediel_messages%rowtype;
o gridex_metering_method_changes.origins%rowtype;
b jsonb;
w jsonb;
tokens jsonb;q jsonb;positive boolean;negative boolean;
r public.outbound_requests%rowtype;i public.ediel_message_intents%rowtype;

BEGIN SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id
  AND id=p_message_id FOR SHARE;
tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);
PERFORM gridex_ai_processing.authorize_purpose_phase_v1(p_company_id,p_actor_user_id,'send',NULL);
SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=p_company_id AND message_id=p_message_id;
IF NOT FOUND AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z09')
 AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}' IN(SELECT value->>'reason' FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()))) THEN
 IF m.environment='test' AND m.direction='outbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z09' THEN
  SELECT EXISTS(SELECT FROM gridex_negative_fixtures.positive_consumptions f WHERE f.message_id=m.id AND f.company_id=p_company_id),EXISTS(SELECT FROM gridex_negative_fixtures.negative_prepared_consumptions f WHERE f.message_id=m.id AND f.company_id=p_company_id) INTO positive,negative;
  IF positive AND negative THEN RAISE EXCEPTION 'metering_method_change_fixture_source_ambiguous';END IF;
  IF positive OR negative THEN
   q:=CASE WHEN positive THEN gridex_negative_fixtures.require_positive_message_v1(p_company_id,m.id,'Z09') ELSE gridex_negative_fixtures.require_negative_message_v1(p_company_id,m.id,'Z09') END;
   IF gridex_metering_method_changes.fixture_qualification_v1(q,p_company_id,positive) IS NOT TRUE THEN RAISE EXCEPTION 'metering_method_change_current_test_original_required';END IF;
   RETURN; -- Actual live source/run/role/step/expiry/revision checks; never business authority.
  END IF;
 END IF;

END IF;
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

 IF NOT FOUND THEN
 RAISE EXCEPTION 'authentic_metering_method_change_origin_required';
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
COMMIT;
