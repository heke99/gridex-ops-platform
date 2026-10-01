-- Internal site projection follows the SAME source-approved supply owner.
-- No historical BRP origin is backfilled and no local mapping grants authority.
BEGIN;
ALTER FUNCTION gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean) RENAME TO context_before_site_projection_v1;
REVOKE ALL ON FUNCTION gridex_brp_changes.context_before_site_projection_v1(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_brp_changes.context_v1(c uuid,event uuid,actor uuid,notice boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;supply jsonb;point public.metering_points%rowtype;site public.customer_sites%rowtype;
BEGIN
 basis:=gridex_brp_changes.context_before_site_projection_v1(c,event,actor,notice);
 IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;END IF;
 supply:=gridex_received_sources.supply_period_source_basis_v1(c,(basis->>'supplyPeriodId')::uuid,(basis->>'effectiveAt')::timestamptz,(basis->>'effectiveAt')::timestamptz+interval '1 minute');
 IF supply IS NULL OR supply->>'qualified' IS DISTINCT FROM 'true' OR supply->>'companyId' IS DISTINCT FROM c::text
  OR supply->>'customerId' IS DISTINCT FROM basis->>'customerId' OR supply->>'meteringPointId' IS DISTINCT FROM basis->>'meteringPointId'
  OR supply->>'marketStateVersion' IS DISTINCT FROM basis->>'supplyStateVersion' OR supply->>'sourceMessageId' IS DISTINCT FROM basis->>'supplySourceMessageId'
  OR coalesce(supply->>'siteId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['brp_source_qualified_internal_site']);END IF;
 SELECT * INTO point FROM public.metering_points WHERE id=(basis->>'meteringPointId')::uuid AND company_id=c FOR SHARE;
 SELECT * INTO site FROM public.customer_sites WHERE id=(supply->>'siteId')::uuid AND company_id=c FOR SHARE;
 IF point.id IS NULL OR site.id IS NULL OR point.site_id IS DISTINCT FROM site.id OR point.customer_id IS DISTINCT FROM (basis->>'customerId')::uuid
  OR site.customer_id IS DISTINCT FROM point.customer_id OR point.ediel_metering_point_id IS DISTINCT FROM basis->>'pointId' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['brp_source_qualified_internal_site']);END IF;
 RETURN basis||jsonb_build_object('siteId',site.id);
END $$;
REVOKE ALL ON FUNCTION gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ediel_reserve_brp_change_origin_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE basis jsonb;
prior gridex_brp_changes.origins%rowtype;
i public.ediel_message_intents%rowtype;
r public.outbound_requests%rowtype;

BEGIN basis:=gridex_brp_changes.context_v1(p_company_id,p_event_id,p_actor_user_id);
IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;
END IF;

 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brp-change:'||p_company_id::text||':'||p_event_id::text,0));
SELECT * INTO prior FROM gridex_brp_changes.origins WHERE company_id=p_company_id
  AND event_id=p_event_id FOR UPDATE;

 IF FOUND THEN IF prior.intent_id IS DISTINCT FROM p_intent_id
  OR prior.basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'brp_change_frozen_origin_conflict';
END IF;
RETURN jsonb_build_object('status','reserved','messageId',prior.message_id,'outboundRequestId',prior.outbound_request_id);
END IF;

 SELECT * INTO i FROM public.ediel_message_intents WHERE company_id=p_company_id
  AND id=p_intent_id FOR SHARE;
SELECT * INTO r FROM public.outbound_requests WHERE company_id=p_company_id
  AND id=p_outbound_request_id FOR SHARE;

 IF i.id IS NULL
  OR r.id IS NULL
  OR i.environment IS DISTINCT FROM basis->>'environment'
  OR i.direction IS DISTINCT FROM 'outbound'
  OR i.message_family IS DISTINCT FROM 'PRODAT'
  OR i.message_code IS DISTINCT FROM 'Z09'
  OR i.operation_id IS DISTINCT FROM p_event_id
  OR i.customer_site_id IS DISTINCT FROM (basis->>'siteId')::uuid
  OR i.customer_id IS DISTINCT FROM (basis->>'customerId')::uuid
  OR i.metering_point_id IS DISTINCT FROM basis->>'pointId'
  OR i.validation_status IS DISTINCT FROM 'validated'
  OR i.application_reference IS DISTINCT FROM '23-DDQ-PRODAT'
  OR r.payload->>'environment' IS DISTINCT FROM basis->>'environment'
  OR r.request_type IS DISTINCT FROM 'customer_masterdata'
  OR r.source_type IS DISTINCT FROM 'manual'
  OR i.communication_route_id IS NULL
  OR i.route_profile_id IS NULL
  OR nullif(i.interchange_reference,'') IS NULL
  OR nullif(i.message_reference,'') IS NULL
  OR nullif(i.transaction_reference,'') IS NULL
  OR r.source_id::text IS DISTINCT FROM i.id::text
  OR r.site_id IS DISTINCT FROM (basis->>'siteId')::uuid
  OR r.metering_point_id IS DISTINCT FROM (basis->>'meteringPointId')::uuid
  OR r.operation_id IS DISTINCT FROM p_event_id
  OR r.customer_id IS DISTINCT FROM i.customer_id
  OR r.communication_route_id IS DISTINCT FROM i.communication_route_id THEN RAISE EXCEPTION 'brp_change_owned_intent_request_required';
END IF;

 INSERT INTO gridex_brp_changes.origins(event_id,company_id,intent_id,outbound_request_id,actor_user_id,basis,intent_binding) VALUES(p_event_id,p_company_id,p_intent_id,p_outbound_request_id,p_actor_user_id,basis,jsonb_build_object('sender',i.sender_ediel_id,'receiver',i.receiver_ediel_id,'senderSubaddress',i.sender_subaddress,'receiverSubaddress',i.receiver_subaddress,'interchange',i.interchange_reference,'message',i.message_reference,'transaction',i.transaction_reference,'route',i.communication_route_id,'routeProfile',i.route_profile_id));

 RETURN jsonb_build_object('status','reserved','messageId',NULL,'outboundRequestId',p_outbound_request_id);
END$$;

CREATE OR REPLACE FUNCTION gridex_brp_changes.request_binding_v1(r public.outbound_requests,o gridex_brp_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 r.id IS NOT DISTINCT FROM o.outbound_request_id
  AND r.company_id IS NOT DISTINCT FROM o.company_id
  AND r.source_id::text IS NOT DISTINCT FROM o.intent_id::text
  AND r.source_type IS NOT DISTINCT FROM 'manual'
  AND r.payload->>'environment' IS NOT DISTINCT FROM o.basis->>'environment'
  AND r.request_type IS NOT DISTINCT FROM 'customer_masterdata'
  AND r.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND r.site_id IS NOT DISTINCT FROM (o.basis->>'siteId')::uuid
  AND r.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND r.operation_id IS NOT DISTINCT FROM o.event_id
  AND r.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid$$;

CREATE OR REPLACE FUNCTION gridex_brp_changes.message_binding_v1(m public.ediel_messages,o gridex_brp_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 m.id IS NOT DISTINCT FROM o.message_id
  AND m.intent_id IS NOT DISTINCT FROM o.intent_id
  AND m.company_id IS NOT DISTINCT FROM o.company_id
  AND m.environment IS NOT DISTINCT FROM o.basis->>'environment'
  AND m.direction IS NOT DISTINCT FROM 'outbound'
  AND m.message_family IS NOT DISTINCT FROM 'PRODAT'
  AND m.message_code IS NOT DISTINCT FROM 'Z09'
  AND m.source_operation_id IS NOT DISTINCT FROM o.event_id::text
  AND m.outbound_request_id IS NOT DISTINCT FROM o.outbound_request_id
  AND m.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND m.site_id IS NOT DISTINCT FROM (o.basis->>'siteId')::uuid
  AND m.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND m.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid
  AND m.route_profile_id IS NOT DISTINCT FROM (o.intent_binding->>'routeProfile')::uuid
  AND m.sender_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'sender'
  AND m.receiver_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'receiver'
  AND m.interchange_reference IS NOT DISTINCT FROM o.intent_binding->>'interchange'
  AND m.transaction_reference IS NOT DISTINCT FROM o.intent_binding->>'transaction'
  AND o.payload_hash IS NOT DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')$$;

CREATE OR REPLACE FUNCTION gridex_brp_changes.bind_message_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE o gridex_brp_changes.origins%rowtype;
b jsonb;
w jsonb;
r public.outbound_requests%rowtype;

BEGIN SELECT * INTO o FROM gridex_brp_changes.origins WHERE intent_id=NEW.intent_id
  OR message_id=NEW.id;
IF NOT FOUND THEN RETURN NEW;
END IF;

 IF o.message_id IS NOT NULL THEN IF gridex_brp_changes.message_binding_v1(NEW,o) IS NOT TRUE THEN RAISE EXCEPTION 'brp_bound_message_immutable';
END IF;
RETURN NEW;
END IF;

 b:=gridex_brp_changes.context_v1(o.company_id,o.event_id,o.actor_user_id);
SELECT * INTO STRICT o FROM gridex_brp_changes.origins WHERE intent_id=NEW.intent_id FOR UPDATE;

 IF o.message_id IS NOT NULL THEN IF gridex_brp_changes.message_binding_v1(NEW,o) IS NOT TRUE THEN RAISE EXCEPTION 'brp_bound_message_immutable';
END IF;
RETURN NEW;
END IF;

 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id
  AND company_id=o.company_id FOR SHARE;

 IF gridex_brp_changes.request_binding_v1(r,o) IS NOT TRUE THEN RAISE EXCEPTION 'brp_change_owned_request_changed';
END IF;

 w:=gridex_brp_changes.wire_v1(NEW.raw_payload);

 IF b IS DISTINCT FROM o.basis
  OR b->>'status' IS DISTINCT FROM 'authorized'
  OR NEW.company_id IS DISTINCT FROM o.company_id
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
  OR w->>'code' IS DISTINCT FROM 'Z09'
  OR w->>'application' IS DISTINCT FROM '23-DDQ-PRODAT'
  OR w->>'sender' IS DISTINCT FROM b->>'legalSenderId'
  OR w->>'receiver' IS DISTINCT FROM b->>'legalReceiverId'
  OR w#>>'{object,reason}' IS DISTINCT FROM 'Z27'
  OR w#>>'{object,point}' IS DISTINCT FROM b->>'pointId'
  OR w#>>'{object,agency}' IS DISTINCT FROM b->>'identityAgency'
  OR w#>>'{object,gridArea}' IS DISTINCT FROM b->>'gridArea'
  OR w#>>'{object,brp}' IS DISTINCT FROM b->>'brpEdielId'
  OR w#>>'{object,effective}' IS DISTINCT FROM to_char((b->>'effectiveAt')::timestamptz AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI')
  OR w#>>'{object,li}' IS DISTINCT FROM o.intent_binding->>'transaction'
  OR w->>'interchange' IS DISTINCT FROM o.intent_binding->>'interchange'
  OR w->>'message' IS DISTINCT FROM o.intent_binding->>'message'
  OR w->>'transportSender' IS DISTINCT FROM o.intent_binding->>'sender'
  OR w->>'transportReceiver' IS DISTINCT FROM o.intent_binding->>'receiver'
  OR w->>'senderSubaddress' IS DISTINCT FROM o.intent_binding->>'senderSubaddress'
  OR w->>'receiverSubaddress' IS DISTINCT FROM o.intent_binding->>'receiverSubaddress' THEN RAISE EXCEPTION 'brp_change_exact_wire_basis_required';
END IF;

 UPDATE gridex_brp_changes.origins SET message_id=NEW.id,payload_hash=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') WHERE event_id=o.event_id;

 INSERT INTO gridex_brp_changes.period_versions(event_id,company_id,environment,supply_period_id,effective_at,brp_actor_id,brp_ediel_id,source_message_id,source_payload_hash) VALUES(o.event_id,o.company_id,b->>'environment',(b->>'supplyPeriodId')::uuid,(b->>'effectiveAt')::timestamptz,(b->>'brpActorId')::uuid,b->>'brpEdielId',NEW.id,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'));

 RETURN NEW;
END$$;

DROP TRIGGER brp_bind_message ON public.ediel_messages;
CREATE TRIGGER brp_bind_message AFTER INSERT OR UPDATE OF intent_id,raw_payload,company_id,environment,direction,message_family,message_code,source_operation_id,outbound_request_id,customer_id,site_id,metering_point_id,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,interchange_reference,transaction_reference ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_brp_changes.bind_message_v1();

COMMIT;
