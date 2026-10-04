-- Replay-corrected successor of 20261001121000 (preserved, classified noncanonical:
-- its trigger watch list names ediel_messages.sender_subaddress/receiver_subaddress,
-- which do not exist, so it cannot apply on any database with this history).
-- Only those two column names are changed to the actual sender_sub_address and
-- receiver_sub_address; every other byte, predicate, grant and owner is identical.
-- P09/TR05/TM-METHOD40. A corrected carrier keeps its genuine selected
-- customer agreement event; 217/216/262 and source ownership cannot be relabelled.
BEGIN;
CREATE TABLE gridex_metering_method_changes.recovery_receipts(
 operation_id uuid PRIMARY KEY REFERENCES gridex_received_sources.prodat_recovery_operations(id),company_id uuid NOT NULL REFERENCES public.companies(id),
 event_id uuid NOT NULL REFERENCES gridex_metering_method_changes.events(id),source_origin_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),message_id uuid UNIQUE NOT NULL REFERENCES public.ediel_messages(id),
 intent_id uuid UNIQUE NOT NULL REFERENCES public.ediel_message_intents(id),outbound_request_id uuid UNIQUE NOT NULL REFERENCES public.outbound_requests(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),environment text NOT NULL,basis jsonb NOT NULL,payload_hash text NOT NULL,message_scope jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_metering_method_changes.recovery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_metering_method_changes.recovery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_metering_method_changes.recovery_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER recovery_method_immutable BEFORE UPDATE OR DELETE ON gridex_metering_method_changes.recovery_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER recovery_method_no_truncate BEFORE TRUNCATE ON gridex_metering_method_changes.recovery_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_metering_method_changes.wire_brp_matches_v1(raw text,b jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb;nad jsonb;n integer;first_line integer;BEGIN
 tokens:=gridex_received_sources.closure_wire_tokens_v2(raw);SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN';
 SELECT count(*),jsonb_agg(t)->0 INTO n,nad FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='Z02' AND (t->>'index')::integer>first_line;
 RETURN n=1 AND nad#>>'{elements,2,0}' IS NOT DISTINCT FROM b->>'brpEdielId' AND nad#>>'{elements,2,1}'='160' AND nad#>>'{elements,2,2}'='SVK' AND jsonb_array_length(nad#>'{elements,2}')=3;
END$$;
CREATE FUNCTION gridex_metering_method_changes.recovery_source_v1(c uuid,op_id uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;source public.ediel_messages%rowtype;o gridex_metering_method_changes.origins%rowtype;
 q jsonb;b jsonb;original_wire jsonb;corrected_wire jsonb;tokens jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(c,actor,phase);
 PERFORM gridex_received_sources.prelock_recovery_source_cohort_v1(c,op_id);
 q:=gridex_received_sources.qualified_recovery_origin_v1(c,op_id);
 SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=op_id AND company_id=c;
 IF (op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE THEN RETURN NULL;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(op.corrected_raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z09')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}' IN(SELECT value->>'reason' FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()))) THEN RETURN NULL;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=(q->>'sourceOriginMessageId')::uuid AND company_id=c AND environment=op.environment FOR SHARE;
 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE message_id=source.id AND company_id=c FOR SHARE;
 -- This port owns genuine customer-agreed metering events only. Other source
 -- owners retain their explicit native lanes; nothing manufactures a new event.
 IF o.event_id IS NULL THEN RETURN NULL;END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(c,actor,phase);
 b:=gridex_metering_method_changes.context_v1(c,o.event_id,actor,CASE phase WHEN 'send' THEN 'send' ELSE 'origination' END);
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 original_wire:=gridex_metering_method_changes.wire_v1(source.raw_payload);corrected_wire:=gridex_metering_method_changes.wire_v1(op.corrected_raw_payload);
 IF source.direction IS DISTINCT FROM 'outbound' OR source.message_family IS DISTINCT FROM 'PRODAT' OR source.message_code IS DISTINCT FROM 'Z09'
  OR source.immutable_rendered_at IS NULL OR source.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
  OR o.payload_hash IS DISTINCT FROM source.immutable_payload_hash OR gridex_metering_method_changes.message_binding_v1(source,o) IS NOT TRUE
  OR b IS DISTINCT FROM o.basis OR original_wire IS NULL OR corrected_wire IS NULL
  OR gridex_metering_method_changes.wire_brp_matches_v1(source.raw_payload,b) IS NOT TRUE OR gridex_metering_method_changes.wire_brp_matches_v1(op.corrected_raw_payload,b) IS NOT TRUE
  OR corrected_wire->>'code' IS DISTINCT FROM 'Z09' OR corrected_wire->>'application' IS DISTINCT FROM '23-DDQ-PRODAT'
  OR corrected_wire->>'sender' IS DISTINCT FROM b->>'legalSenderId' OR corrected_wire->>'receiver' IS DISTINCT FROM b->>'legalReceiverId'
  OR corrected_wire->'object' IS DISTINCT FROM original_wire->'object'
  OR corrected_wire#>>'{object,reason}' IS DISTINCT FROM b->>'reason' OR corrected_wire#>>'{object,method}' IS DISTINCT FROM b->>'method'
  OR corrected_wire#>>'{object,effective}' IS DISTINCT FROM to_char((b->>'effectiveAt')::timestamptz AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI')
  OR corrected_wire#>>'{object,point}' IS DISTINCT FROM b->>'pointId' OR corrected_wire#>>'{object,agency}' IS DISTINCT FROM b->>'identityAgency'
  OR corrected_wire#>>'{object,gridArea}' IS DISTINCT FROM b->>'gridArea'
  OR (op.environment='test' AND corrected_wire->>'testIndicator' IS DISTINCT FROM '1')
  OR (op.environment='production' AND (corrected_wire->>'testIndicator' IN('','0')) IS NOT TRUE)
  THEN RAISE EXCEPTION 'metering_method_recovery_current_original_tuple_required';END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(c,actor,phase);
 RETURN b||jsonb_build_object('recoveryOperationId',op.id,'originalMessageId',op.original_message_id,'sourceOriginMessageId',source.id,'correctedPayloadHash',op.corrected_payload_hash);
END$$;
-- A discovery selector for the existing BRP preparation adapter. It grants
-- no source status; actual selected event/context is qualified again below.
CREATE FUNCTION public.ediel_metering_method_recovery_scope_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE q jsonb;op gridex_received_sources.prodat_recovery_operations%rowtype;o gridex_metering_method_changes.origins%rowtype;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 PERFORM gridex_received_sources.prelock_recovery_source_cohort_v1(p_company_id,p_operation_id);q:=gridex_received_sources.qualified_recovery_origin_v1(p_company_id,p_operation_id);
 SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id;
 IF (op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=p_company_id AND message_id=(q->>'sourceOriginMessageId')::uuid FOR SHARE;
 IF o.event_id IS NULL THEN RETURN NULL;END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 RETURN jsonb_build_object('companyId',p_company_id,'recoveryOperationId',op.id,'eventId',o.event_id,'originalMessageId',op.original_message_id,'sourceOriginMessageId',o.message_id,'environment',op.environment,'correctedPayloadHash',op.corrected_payload_hash);
END$$;
CREATE FUNCTION public.ediel_metering_method_recovery_source_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$SELECT gridex_metering_method_changes.recovery_source_v1(p_company_id,p_operation_id,p_actor_user_id,'prepare')$$;
CREATE FUNCTION gridex_metering_method_changes.require_recovery_message_v1(m public.ediel_messages,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE b jsonb;q jsonb;o gridex_received_sources.prodat_recovery_origins%rowtype;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;w jsonb;
 op uuid;prior gridex_metering_method_changes.recovery_receipts%rowtype;
BEGIN
 SELECT id INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id::text=m.source_operation_id AND company_id=m.company_id AND kind IN('contrl_correction','aperak_correction');
 IF op IS NULL THEN RETURN NULL;END IF;
 b:=gridex_metering_method_changes.recovery_source_v1(m.company_id,op,actor,phase);
 IF b IS NULL THEN RETURN NULL;END IF;
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'metering_method_recovery_current_source_held';END IF;
 SELECT * INTO o FROM gridex_received_sources.prodat_recovery_origins WHERE operation_id=op AND company_id=m.company_id FOR SHARE;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=m.intent_id AND company_id=m.company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=m.outbound_request_id AND company_id=m.company_id FOR SHARE;
 w:=gridex_metering_method_changes.wire_v1(m.raw_payload);
 IF o.operation_id IS NULL OR i.id IS NULL OR r.id IS NULL OR m.intent_id IS DISTINCT FROM o.intent_id OR m.outbound_request_id IS DISTINCT FROM o.outbound_request_id
  OR m.original_message_id::text IS DISTINCT FROM b->>'originalMessageId' OR m.customer_id IS DISTINCT FROM (b->>'customerId')::uuid
  OR m.site_id IS DISTINCT FROM (b->>'siteId')::uuid OR m.metering_point_id IS DISTINCT FROM (b->>'meteringPointId')::uuid
  OR m.environment IS DISTINCT FROM b->>'environment' OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact'
  OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z09' OR m.created_by IS DISTINCT FROM o.actor_user_id
  OR encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') IS DISTINCT FROM b->>'correctedPayloadHash'
  OR i.operation_id IS DISTINCT FROM op OR i.direction IS DISTINCT FROM m.direction OR i.message_family IS DISTINCT FROM m.message_family OR i.message_code IS DISTINCT FROM m.message_code
  OR i.validation_status IS DISTINCT FROM 'validated' OR i.validation_result->>'ok' IS DISTINCT FROM 'true' OR i.blocking_reasons IS DISTINCT FROM '[]'::jsonb
  OR i.customer_id IS DISTINCT FROM m.customer_id OR i.customer_site_id IS DISTINCT FROM m.site_id
  OR i.environment IS DISTINCT FROM m.environment OR i.communication_route_id IS DISTINCT FROM m.communication_route_id OR i.route_profile_id IS DISTINCT FROM m.route_profile_id
  OR i.application_reference IS DISTINCT FROM '23-DDQ-PRODAT' OR i.interchange_reference IS DISTINCT FROM w->>'interchange'
  OR i.message_reference IS DISTINCT FROM w->>'message' OR i.transaction_reference IS DISTINCT FROM w#>>'{object,li}'
  OR i.sender_ediel_id IS DISTINCT FROM w->>'transportSender' OR i.receiver_ediel_id IS DISTINCT FROM w->>'transportReceiver'
  OR i.sender_subaddress IS DISTINCT FROM w->>'senderSubaddress' OR i.receiver_subaddress IS DISTINCT FROM w->>'receiverSubaddress'
  OR m.sender_ediel_id IS DISTINCT FROM i.sender_ediel_id OR m.receiver_ediel_id IS DISTINCT FROM i.receiver_ediel_id
  OR m.interchange_reference IS DISTINCT FROM i.interchange_reference OR m.transaction_reference IS DISTINCT FROM i.transaction_reference
  OR r.source_type IS DISTINCT FROM 'manual' OR r.request_type IS DISTINCT FROM 'customer_masterdata' OR r.source_id::text IS DISTINCT FROM i.id::text
  OR r.operation_id IS DISTINCT FROM op OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id
  OR r.metering_point_id IS DISTINCT FROM m.metering_point_id OR r.communication_route_id IS DISTINCT FROM m.communication_route_id
  OR r.payload->>'environment' IS DISTINCT FROM m.environment THEN RAISE EXCEPTION 'metering_method_recovery_owned_carrier_required';END IF;
 SELECT * INTO prior FROM gridex_metering_method_changes.recovery_receipts WHERE operation_id=op FOR SHARE;
 IF prior.operation_id IS NOT NULL AND(prior.message_id IS DISTINCT FROM m.id OR prior.basis IS DISTINCT FROM b OR prior.payload_hash IS DISTINCT FROM b->>'correctedPayloadHash'
  OR prior.message_scope IS DISTINCT FROM gridex_requested_method_watches.message_scope_v1(m)) THEN RAISE EXCEPTION 'metering_method_recovery_bound_carrier_changed';END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(m.company_id,actor,phase);
 RETURN b;
END$$;
CREATE FUNCTION gridex_metering_method_changes.bind_recovery_message_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE b jsonb;BEGIN
 b:=gridex_metering_method_changes.require_recovery_message_v1(NEW,NEW.created_by,'prepare');
 IF b IS NULL THEN RETURN NEW;END IF;
 INSERT INTO gridex_metering_method_changes.recovery_receipts(operation_id,company_id,event_id,source_origin_message_id,original_message_id,message_id,intent_id,outbound_request_id,actor_user_id,environment,basis,payload_hash,message_scope)
 VALUES((b->>'recoveryOperationId')::uuid,NEW.company_id,(b->>'eventId')::uuid,(b->>'sourceOriginMessageId')::uuid,(b->>'originalMessageId')::uuid,NEW.id,NEW.intent_id,NEW.outbound_request_id,NEW.created_by,NEW.environment,b,b->>'correctedPayloadHash',gridex_requested_method_watches.message_scope_v1(NEW)) ON CONFLICT(operation_id) DO NOTHING;
 RETURN NEW;
END$$;
CREATE TRIGGER method_recovery_bind_message AFTER INSERT OR UPDATE OF created_by,intent_id,raw_payload,company_id,environment,direction,message_family,message_code,message_standard,source_operation_id,outbound_request_id,customer_id,site_id,metering_point_id,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,application_reference,interchange_reference,transaction_reference,immutable_payload_hash,immutable_rendered_at,original_message_id ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.bind_recovery_message_v1();
DO $brp$ DECLARE body text;needle text:=$old$ tokens:=gridex_received_sources.closure_wire_tokens_v2(NEW.raw_payload);SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN';
 SELECT count(*),jsonb_agg(t)->0 INTO n,nad FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='Z02' AND (t->>'index')::integer>first_line;
 IF n<>1 OR nad#>>'{elements,2,0}' IS DISTINCT FROM b->>'brpEdielId' OR nad#>>'{elements,2,1}' IS DISTINCT FROM '160' OR nad#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' OR jsonb_array_length(nad#>'{elements,2}')<>3 THEN RAISE EXCEPTION 'metering_method_change_own_source_field262_required';END IF;RETURN NEW;
$old$;BEGIN
 body:=pg_get_functiondef('gridex_metering_method_changes.guard_brp_wire_v1()'::regprocedure);
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_brp_shared_owner_shape_changed';END IF;
 EXECUTE replace(body,needle,$new$ IF gridex_metering_method_changes.wire_brp_matches_v1(NEW.raw_payload,b) IS NOT TRUE THEN RAISE EXCEPTION 'metering_method_change_own_source_field262_required';END IF;RETURN NEW;
$new$);
END$brp$;
DO $patch$
DECLARE fn regprocedure;body text;needle text;replacement text;
BEGIN
 fn:='gridex_metering_method_changes.require_origin_before_insert_v1()'::regprocedure;body:=pg_get_functiondef(fn);needle:='BEGIN';
 IF strpos(body,'authentic_metering_method_change_origin_required')=0 THEN RAISE EXCEPTION 'metering_method_recovery_insert_owner_shape_changed';END IF;
 body:=overlay(body placing E'BEGIN\n IF gridex_metering_method_changes.require_recovery_message_v1(NEW,NEW.created_by,''prepare'') IS NOT NULL THEN RETURN NEW;END IF;' from strpos(body,needle) for length(needle));EXECUTE body;
 fn:='gridex_metering_method_changes.require_source_before_requested_changes_v1(uuid,uuid,uuid)'::regprocedure;body:=pg_get_functiondef(fn);needle:='tokens:=gridex_received_sources.closure_wire_tokens_v2(m.raw_payload);';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_provider_owner_shape_changed';END IF;
 EXECUTE replace(body,needle,needle||E'\nIF gridex_metering_method_changes.require_recovery_message_v1(m,p_actor_user_id,''send'') IS NOT NULL THEN RETURN;END IF;');
 fn:='public.ediel_metering_method_change_message_basis_v1(uuid,uuid,uuid)'::regprocedure;body:=pg_get_functiondef(fn);needle:=' SELECT * INTO o FROM gridex_metering_method_changes.origins WHERE company_id=p_company_id AND message_id=p_message_id;';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_message_reader_shape_changed';END IF;
 EXECUTE replace(body,needle,E' SELECT gridex_metering_method_changes.require_recovery_message_v1(m,p_actor_user_id,''send'') INTO b FROM public.ediel_messages m WHERE m.company_id=p_company_id AND m.id=p_message_id;\n IF b IS NOT NULL THEN RETURN jsonb_build_object(''basis'',b,''intentId'',(SELECT intent_id FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id));END IF;\n'||needle);
 fn:='gridex_metering_method_changes.certification_basis_v1(public.ediel_messages)'::regprocedure;body:=pg_get_functiondef(fn);needle:=' OR EXISTS(SELECT FROM gridex_metering_method_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id)';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_certification_shape_changed';END IF;
 EXECUTE replace(body,needle,needle||E'\n OR EXISTS(SELECT FROM gridex_metering_method_changes.recovery_receipts o WHERE o.company_id=m.company_id AND o.message_id=m.id)');
 fn:='public.ediel_metering_method_change_send_basis_v1(uuid,uuid,uuid)'::regprocedure;body:=pg_get_functiondef(fn);needle:='ELSIF EXISTS(SELECT FROM gridex_metering_method_changes.origins o WHERE o.company_id=m.company_id AND o.message_id=m.id) THEN kind:=''agreement'';';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_send_kind_shape_changed';END IF;
 EXECUTE replace(body,needle,'ELSIF EXISTS(SELECT FROM gridex_metering_method_changes.recovery_receipts o WHERE o.company_id=m.company_id AND o.message_id=m.id) THEN kind:=''agreement'';'||E'\n '||needle);
END$patch$;
-- Frozen observational proof depends on immutable genuine event/carrier, not
-- mutable today's customer state. Provider entry independently rechecks it.
DO $patch$ DECLARE body text;needle text:='BEGIN';BEGIN
 body:=pg_get_functiondef('gridex_metering_method_changes.frozen_original_basis_v1(uuid,uuid)'::regprocedure);
 IF strpos(body,'frozen_original_before_requested_changes_v1')=0 THEN RAISE EXCEPTION 'metering_method_recovery_frozen_owner_shape_changed';END IF;
 EXECUTE overlay(body placing E'BEGIN\n IF EXISTS(SELECT FROM gridex_metering_method_changes.recovery_receipts r WHERE r.company_id=c AND r.message_id=msg) THEN RETURN gridex_metering_method_changes.frozen_recovery_basis_v1(c,msg);END IF;' from strpos(body,needle) for length(needle));
END$patch$;
CREATE FUNCTION gridex_metering_method_changes.frozen_recovery_basis_v1(c uuid,msg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE r gridex_metering_method_changes.recovery_receipts%rowtype;m public.ediel_messages%rowtype;source jsonb;w jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO r FROM gridex_metering_method_changes.recovery_receipts WHERE company_id=c AND message_id=msg FOR SHARE;
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=c AND id=msg FOR SHARE;
 IF r.operation_id IS NULL OR m.id IS NULL OR r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR m.immutable_payload_hash IS DISTINCT FROM r.payload_hash
  OR m.immutable_rendered_at IS NULL OR r.message_scope IS DISTINCT FROM gridex_requested_method_watches.message_scope_v1(m) THEN RETURN NULL;END IF;
 source:=gridex_metering_method_changes.frozen_original_before_requested_changes_v1(c,r.source_origin_message_id);w:=gridex_metering_method_changes.wire_v1(m.raw_payload);
 IF source IS NULL OR source->>'eventId' IS DISTINCT FROM r.event_id::text OR (r.basis-ARRAY['recoveryOperationId','originalMessageId','sourceOriginMessageId','correctedPayloadHash']) IS DISTINCT FROM source->'basis'
  OR w IS NULL OR w->'object' IS DISTINCT FROM source->'physicalObject' THEN RETURN NULL;END IF;
 RETURN source||jsonb_build_object('sourceMessageId',m.id,'sourcePayloadHash',r.payload_hash,'sourceOwner','metering_method_recovery_v1','recoveryOperationId',r.operation_id,'sourceOriginMessageId',r.source_origin_message_id);
END$$;
-- One genuine desired event has one TM-METHOD40 watch. Accepted correction
-- carriers reference that same immutable watch, with their own accepted receipt.
CREATE TABLE gridex_method_expectations.recovery_carriers(message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,environment text NOT NULL,expectation_id uuid NOT NULL REFERENCES gridex_method_expectations.bindings(expectation_id),operation_id uuid UNIQUE NOT NULL REFERENCES gridex_received_sources.prodat_recovery_operations(id),payload_hash text NOT NULL,accepted_basis jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gridex_method_expectations.recovery_carriers ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_method_expectations.recovery_carriers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_method_expectations.recovery_carriers FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER method_recovery_carrier_immutable BEFORE UPDATE OR DELETE ON gridex_method_expectations.recovery_carriers FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER method_recovery_carrier_no_truncate BEFORE TRUNCATE ON gridex_method_expectations.recovery_carriers FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
DO $patch$ DECLARE body text;needle text;replacement text;BEGIN
 body:=pg_get_functiondef('gridex_method_expectations.mutate_before_requested_method_original_v1(jsonb)'::regprocedure);
 needle:='  SELECT projection INTO STRICT cfg FROM gridex_method_expectations.editions';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_watch_owner_shape_changed';END IF;
 replacement:=$new$  SELECT * INTO b FROM gridex_method_expectations.bindings WHERE company_id=c AND environment=env AND event_id=(original->>'eventId')::uuid FOR SHARE;
  IF b.expectation_id IS NOT NULL AND EXISTS(SELECT FROM gridex_metering_method_changes.recovery_receipts own WHERE own.company_id=c AND own.message_id=mid AND own.event_id=b.event_id) THEN
   IF b.original_basis->'basis' IS DISTINCT FROM original->'basis' OR b.validity_day IS DISTINCT FROM to_date(original->>'validityDay','YYYYMMDD') THEN RAISE EXCEPTION 'metering_method_recovery_watch_event_changed';END IF;
   INSERT INTO gridex_method_expectations.recovery_carriers(message_id,company_id,environment,expectation_id,operation_id,payload_hash,accepted_basis)
    VALUES(mid,c,env,b.expectation_id,(original->>'recoveryOperationId')::uuid,original->>'sourcePayloadHash',accepted) ON CONFLICT(message_id) DO NOTHING;
   IF NOT EXISTS(SELECT FROM gridex_method_expectations.recovery_carriers own WHERE own.company_id=c AND own.message_id=mid AND own.expectation_id=b.expectation_id AND own.operation_id=(original->>'recoveryOperationId')::uuid AND own.payload_hash=original->>'sourcePayloadHash' AND own.accepted_basis=accepted) THEN RAISE EXCEPTION 'metering_method_recovery_watch_carrier_changed';END IF;
   PERFORM gridex_method_expectations.reconcile_v1(b.expectation_id);
   RETURN jsonb_build_array((SELECT to_jsonb(x) FROM public.ediel_business_expectations x WHERE x.id=b.expectation_id));
  END IF;
$new$||needle;
 EXECUTE replace(body,needle,replacement);
 body:=pg_get_functiondef('gridex_method_expectations.mutate_before_requested_method_original_v1(jsonb)'::regprocedure);
 needle:='owned.source_message_id=mid';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_watch_reader_shape_changed';END IF;
 EXECUTE replace(body,needle,'(owned.source_message_id=mid OR EXISTS(SELECT FROM gridex_method_expectations.recovery_carriers alias WHERE alias.company_id=c AND alias.environment=env AND alias.message_id=mid AND alias.expectation_id=owned.expectation_id))');
 -- All eligible carrier candidates are visible. Count each genuine event once;
 -- a correction of the same desired event cannot create a second business request.
 body:=pg_get_functiondef('gridex_method_expectations.reconcile_v1(uuid,uuid)'::regprocedure);
 needle:=' OR EXISTS(SELECT FROM gridex_requested_changes.origins r WHERE r.company_id=b.company_id AND r.message_id=m.id AND r.basis->>''variant'' IN(''F'',''G'')))';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_watch_candidates_shape_changed';END IF;
 body:=replace(body,needle,' OR EXISTS(SELECT FROM gridex_requested_changes.origins r WHERE r.company_id=b.company_id AND r.message_id=m.id AND r.basis->>''variant'' IN(''F'',''G'')) OR EXISTS(SELECT FROM gridex_metering_method_changes.recovery_receipts r WHERE r.company_id=b.company_id AND r.environment=b.environment AND r.message_id=m.id))');
 body:=replace(body,'compatible_count integer;','compatible_count integer;seen_events text[];');
 body:=replace(body,'compatible_count:=0;','compatible_count:=0;seen_events:=''{}''::text[];');
 needle:='IF accepted IS NOT NULL AND gridex_method_expectations.compatible_v1(original,accepted,own) THEN compatible_count:=compatible_count+1;END IF;';
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'metering_method_recovery_watch_distinct_events_shape_changed';END IF;
 EXECUTE replace(body,needle,'IF accepted IS NOT NULL AND gridex_method_expectations.compatible_v1(original,accepted,own) AND NOT(original->>''eventId''=ANY(seen_events)) THEN compatible_count:=compatible_count+1;seen_events:=array_append(seen_events,original->>''eventId'');END IF;');
END$patch$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_metering_method_changes' AND p.proname IN('wire_brp_matches_v1','recovery_source_v1','require_recovery_message_v1','bind_recovery_message_v1','frozen_recovery_basis_v1') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_metering_method_recovery_scope_v1(uuid,uuid,uuid),public.ediel_metering_method_recovery_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_metering_method_recovery_scope_v1(uuid,uuid,uuid),public.ediel_metering_method_recovery_source_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
