-- P09 prospective customer life events. No authentic event, legal decision,
-- bilateral mandate or historical customer/source proof is seeded here.
BEGIN;
CREATE SCHEMA gridex_customer_life_events;
REVOKE ALL ON SCHEMA gridex_customer_life_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_customer_life_events.events(
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 customer_id uuid NOT NULL REFERENCES public.customers(id),classification text NOT NULL CHECK(classification IN('death','bankruptcy','other_masterdata')),
 legal_actor_id uuid NOT NULL,legal_sender_id text NOT NULL,legal_receiver_id text NOT NULL,
 source_reference text NOT NULL CHECK(length(btrim(source_reference))>0),source_version text NOT NULL CHECK(length(btrim(source_version))>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),
 legal_decision_reference text NOT NULL CHECK(length(btrim(legal_decision_reference))>0),bilateral_agreement_id uuid REFERENCES public.tenant_bilateral_agreements(id),bilateral_capability_code text,bilateral_source_reference text,bilateral_terms_sha256 text,
 approved_raw_payload text NOT NULL,approved_payload_hash text NOT NULL CHECK(approved_payload_hash=encode(sha256(convert_to(approved_raw_payload,'UTF8')),'hex')),
 approved_scope jsonb NOT NULL CHECK(jsonb_typeof(approved_scope)='array' AND jsonb_array_length(approved_scope)>0),
 allowed_customer_fields text[] NOT NULL CHECK(allowed_customer_fields<@ARRAY['227','228','229','231','232','310','316']::text[]),
 information_known_at timestamptz NOT NULL,approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,
 CHECK(information_known_at<=approved_at),CHECK(classification='death' OR (bilateral_agreement_id IS NOT NULL AND length(btrim(bilateral_capability_code))>0 AND length(btrim(bilateral_source_reference))>0 AND bilateral_terms_sha256~'^[a-f0-9]{64}$')));
CREATE TABLE gridex_customer_life_events.revocations(event_id uuid PRIMARY KEY REFERENCES gridex_customer_life_events.events(id),source_reference text NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),revoked_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_customer_life_events.origins(event_id uuid PRIMARY KEY REFERENCES gridex_customer_life_events.events(id),company_id uuid NOT NULL,intent_id uuid UNIQUE NOT NULL REFERENCES public.ediel_message_intents(id),outbound_request_id uuid UNIQUE NOT NULL REFERENCES public.outbound_requests(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_customer_life_events.originals(message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),event_id uuid UNIQUE NOT NULL REFERENCES gridex_customer_life_events.origins(event_id),company_id uuid NOT NULL,payload_hash text NOT NULL,source_snapshot jsonb NOT NULL,intent_binding jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_customer_life_events.desired_changes(event_id uuid PRIMARY KEY REFERENCES gridex_customer_life_events.events(id),company_id uuid NOT NULL,message_id uuid UNIQUE NOT NULL REFERENCES public.ediel_messages(id),classification text NOT NULL,source_scope jsonb NOT NULL,information_known_at timestamptz NOT NULL,actor_user_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_customer_life_events.inbound_grounds(source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,source_payload_hash text NOT NULL CHECK(source_payload_hash~'^[a-f0-9]{64}$'),classification text NOT NULL CHECK(classification IN('bankruptcy','other_masterdata')),bilateral_agreement_id uuid NOT NULL REFERENCES public.tenant_bilateral_agreements(id),bilateral_capability_code text NOT NULL,bilateral_source_reference text NOT NULL,bilateral_terms_sha256 text NOT NULL CHECK(bilateral_terms_sha256~'^[a-f0-9]{64}$'),legal_decision_reference text NOT NULL CHECK(length(btrim(legal_decision_reference))>0),source_reference text NOT NULL CHECK(length(btrim(source_reference))>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),approved_scope jsonb NOT NULL,allowed_customer_fields text[] NOT NULL CHECK(allowed_customer_fields<@ARRAY['227','228','229','231','232','316']::text[]),approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL);
CREATE TABLE gridex_customer_life_events.transitions(source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,payload_hash text NOT NULL,classification text NOT NULL,previous_customers jsonb NOT NULL,resulting_customers jsonb NOT NULL,source_objects jsonb NOT NULL,approved_scope jsonb NOT NULL,legal_context jsonb NOT NULL,canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),actor_user_id uuid NOT NULL,observed_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_customer_life_events.customer_versions(company_id uuid NOT NULL REFERENCES public.companies(id),customer_id uuid NOT NULL REFERENCES public.customers(id),version bigint NOT NULL CHECK(version>0),source_message_id uuid NOT NULL REFERENCES gridex_customer_life_events.transitions(source_message_id),previous_customer jsonb NOT NULL,resulting_customer jsonb NOT NULL,effective_at timestamptz NOT NULL,observed_at timestamptz NOT NULL,PRIMARY KEY(company_id,customer_id,version),UNIQUE(source_message_id,customer_id));
CREATE TABLE gridex_customer_life_events.tasks(source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),customer_id uuid NOT NULL REFERENCES public.customers(id),operation_task_id uuid UNIQUE NOT NULL REFERENCES public.customer_operation_tasks(id),company_id uuid NOT NULL,rule_id text NOT NULL CHECK(rule_id IN('TM-Z09-E','TM-Z06-E')),information_known_at timestamptz NOT NULL,responsible_user_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind IN('desired_customer_change','confirmed_customer_change')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(source_message_id,customer_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['events','revocations','origins','originals','desired_changes','inbound_grounds','transitions','customer_versions','tasks'] LOOP
 EXECUTE format('ALTER TABLE gridex_customer_life_events.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_customer_life_events.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_customer_life_events.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_customer_life_events.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_customer_life_events.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t);
END LOOP;END $$;

-- Neutral leaf projection from the shared lexical decoder. Canonical rule/
-- field/register admission remains the single application/functional owner.
CREATE FUNCTION gridex_customer_life_events.wire_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE w jsonb:=gridex_received_sources.prodat_recovery_wire_v1(raw);tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);t jsonb;e jsonb;obj jsonb;objects jsonb:='[]';characteristic text;common boolean:=false;seen text[]:=ARRAY[]::text[];key text;physical jsonb:='[]';minute text;instant timestamptz;first_fragment jsonb;field text;BEGIN
 IF w IS NULL OR w->>'family' IS DISTINCT FROM 'PRODAT' OR (w->>'code' IN('Z06','Z09')) IS NOT TRUE THEN RETURN NULL;END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(tokens) ORDER BY (value->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='LIN' THEN
   IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
   obj:=jsonb_build_object('point',e#>>'{3,0}','identityAgency',e#>>'{3,3}','line',e#>>'{1,0}','body','[]'::jsonb);characteristic:=NULL;common:=true;
  ELSIF obj IS NOT NULL AND t->>'tag' NOT IN('UNT','UNZ') THEN
   obj:=jsonb_set(obj,'{body}',obj->'body'||jsonb_build_array(t-'index'-'raw'));
   IF t->>'tag' IN('RFF','NAD','DTM') THEN common:=false;END IF;
   IF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' AND characteristic='Z13' THEN IF obj ? 'reason' THEN RETURN NULL;END IF;obj:=obj||jsonb_build_object('reason',e#>>'{1,0}');
   ELSIF t->>'tag'='CAV' AND characteristic='Z17' AND common THEN IF obj ? 'customerStatus' THEN RETURN NULL;END IF;obj:=obj||jsonb_build_object('customerStatus',e#>>'{1,0}');
   ELSIF t->>'tag'='RFF' AND e#>>'{1,0}' IN('LI','Z05') THEN
    IF obj ? (CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' ELSE 'gridArea' END) THEN RETURN NULL;END IF;
    obj:=obj||jsonb_build_object(CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' ELSE 'gridArea' END,e#>>'{1,1}');
   ELSIF t->>'tag'='DTM' AND e#>>'{1,0}'='157' THEN
    IF obj ? 'effectiveAt' OR e#>>'{1,2}' IS DISTINCT FROM '203' THEN RETURN NULL;END IF;
    minute:=e#>>'{1,1}';IF minute IS NULL OR minute !~ '^[0-9]{12}$' THEN RETURN NULL;END IF;
    -- 216 is a physical EDIFACT minute; national P time is fixed UTC+1.
    -- No DATE, receipt clock or local midnight is substituted for it.
    BEGIN instant:=make_timestamp(substring(minute,1,4)::int,substring(minute,5,2)::int,substring(minute,7,2)::int,substring(minute,9,2)::int,substring(minute,11,2)::int,0) AT TIME ZONE 'Etc/GMT-1';
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;END;
    obj:=obj||jsonb_build_object('effectiveAt',instant,'validityMinute',minute);
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN
    IF obj ? 'customerParty' THEN RETURN NULL;END IF;
    obj:=obj||jsonb_build_object('customerParty',e->2,'name',e->4,'street',e->5,'city',e#>>'{6,0}','postCode',e#>>'{8,0}','country',e#>>'{9,0}');
   END IF;
  END IF;
 END LOOP;
 IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
 FOR obj IN SELECT value FROM jsonb_array_elements(objects) LOOP
  key:=jsonb_build_array(obj->>'point',obj->>'identityAgency')::text;
  IF key=ANY(seen) THEN
   SELECT item INTO first_fragment FROM jsonb_array_elements(physical) item WHERE item->>'point'=obj->>'point' AND item->>'identityAgency'=obj->>'identityAgency';
   -- A register fragment may omit common fields. Repeated common values must
   -- be identical; it can never override or add a second customer/event tuple.
   FOREACH field IN ARRAY ARRAY['reason','customerStatus','li','gridArea','customerParty','name','street','city','postCode','country','effectiveAt','validityMinute'] LOOP
    IF obj ? field AND obj->field IS DISTINCT FROM first_fragment->field THEN RETURN NULL;END IF;
   END LOOP;
  ELSE seen:=array_append(seen,key);physical:=physical||jsonb_build_array(obj);END IF;
 END LOOP;objects:=physical;
 IF jsonb_array_length(objects)=0 OR EXISTS(SELECT FROM jsonb_array_elements(objects) x WHERE x->>'reason' IS DISTINCT FROM 'E34' OR nullif(x->>'point','') IS NULL OR (x->>'identityAgency' IN('9','89')) IS NOT TRUE OR nullif(x->>'li','') IS NULL OR x->>'effectiveAt' IS NULL OR (x#>>'{customerParty,1}' IN('SE1','SE2')) IS NOT TRUE OR x#>>'{customerParty,2}' IS DISTINCT FROM '260')
  OR (SELECT count(DISTINCT jsonb_build_array(x->>'point',x->>'identityAgency')) FROM jsonb_array_elements(objects)x)<>jsonb_array_length(objects) THEN RETURN NULL;END IF;
 RETURN w||jsonb_build_object('objects',objects);
END $$;

CREATE FUNCTION gridex_customer_life_events.require_actor_v1(c uuid,actor uuid,phase text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF (phase IN('prepare','send','read')) IS NOT TRUE OR c IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'customer_life_event_execution_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR NOT (CASE phase WHEN 'send' THEN coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false) WHEN 'read' THEN coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.read'),false) ELSE coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) END) THEN RAISE EXCEPTION 'customer_life_event_actor_forbidden' USING ERRCODE='42501';END IF;
END $$;

CREATE FUNCTION gridex_customer_life_events.source_v1(c uuid,event uuid,actor uuid,phase text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ev gridex_customer_life_events.events%rowtype;probe public.ediel_messages%rowtype;w jsonb;local_legal jsonb;scope jsonb;own jsonb;basis jsonb;objects jsonb:='[]';ids uuid[];period_ids uuid[];period_manifest jsonb;ba public.tenant_bilateral_agreements%rowtype;BEGIN
 PERFORM gridex_customer_life_events.require_actor_v1(c,actor,phase);
 SELECT * INTO ev FROM gridex_customer_life_events.events WHERE id=event AND company_id=c FOR UPDATE;
 IF ev.id IS NULL OR ev.approved_at>clock_timestamp() OR ev.information_known_at>clock_timestamp() OR EXISTS(SELECT FROM gridex_customer_life_events.revocations r WHERE r.event_id=ev.id) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_approved_customer_life_event']);END IF;
 w:=gridex_customer_life_events.wire_v1(ev.approved_raw_payload);
 IF w IS NULL OR w->>'code' IS DISTINCT FROM 'Z09' OR w->>'legalSender' IS DISTINCT FROM ev.legal_sender_id OR w->>'legalReceiver' IS DISTINCT FROM ev.legal_receiver_id OR ev.approved_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ev.approved_raw_payload,'UTF8')),'hex') OR jsonb_array_length(w->'objects') IS DISTINCT FROM jsonb_array_length(ev.approved_scope) OR (SELECT count(DISTINCT jsonb_build_array(sc->>'pointId',sc->>'identityAgency')) FROM jsonb_array_elements(ev.approved_scope) sc) IS DISTINCT FROM jsonb_array_length(ev.approved_scope)::bigint THEN RETURN jsonb_build_object('status','held','missing',ARRAY['whole_source_approved_customer_event_wire']);END IF;
 probe.company_id:=c;probe.environment:=ev.environment;probe.direction:='outbound';probe.message_standard:='edifact';probe.message_family:='PRODAT';probe.message_code:='Z09';probe.raw_payload:=ev.approved_raw_payload;
 local_legal:=gridex_ediel_inbound_context.derive(probe,clock_timestamp());
 IF local_legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR local_legal->>'legalActorId' IS DISTINCT FROM ev.legal_actor_id::text OR local_legal->>'legalEdielId' IS DISTINCT FROM ev.legal_sender_id THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_customer_event_same_legal_supplier']);END IF;
 -- Lock the complete source union before any owned point/period. Discovery
 -- is rechecked by the sole supply owner for every approved physical object.
 SELECT array_agg(DISTINCT source_id) INTO ids FROM (
  SELECT p.source_message_id source_id FROM public.customer_supply_periods p,jsonb_array_elements(ev.approved_scope)s WHERE p.company_id=c AND p.id=(s->>'periodId')::uuid
  UNION SELECT t.source_message_id FROM gridex_received_sources.supply_source_transitions t,public.customer_supply_periods p,jsonb_array_elements(ev.approved_scope)s WHERE p.company_id=c AND p.id=(s->>'periodId')::uuid AND t.company_id=c AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states)state WHERE state->>'id'=p.id::text AND (state->>'market_state_version')::bigint=p.market_state_version)
  UNION SELECT proof.original_message_id FROM gridex_received_sources.normal_switch_confirmations proof,jsonb_array_elements(ev.approved_scope)s WHERE proof.company_id=c AND proof.period_id=(s->>'periodId')::uuid
 ) all_sources;
 SELECT array_agg((sc->>'periodId')::uuid) INTO period_ids FROM jsonb_array_elements(ev.approved_scope) sc;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO period_manifest FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(period_ids);
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=c AND m.id=ANY(ids) ORDER BY m.id FOR UPDATE;
 PERFORM p.id FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(period_ids) ORDER BY p.id FOR SHARE;
 IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(period_ids)) IS DISTINCT FROM period_manifest THEN RAISE EXCEPTION 'customer_life_event_source_discovery_changed' USING ERRCODE='40001';END IF;
 IF ev.classification<>'death' THEN
  SELECT * INTO ba FROM public.tenant_bilateral_agreements WHERE id=ev.bilateral_agreement_id AND company_id=c AND environment=ev.environment FOR SHARE;
  PERFORM pi.id FROM public.platform_actor_identifiers pi WHERE pi.actor_id=ba.counterparty_actor_id FOR SHARE;
  IF ba.id IS NULL OR ba.is_enabled IS DISTINCT FROM true OR ba.valid_from IS NULL OR ba.valid_from>clock_timestamp() OR ba.valid_to IS NOT NULL AND ba.valid_to<clock_timestamp() OR ba.capability_code IS DISTINCT FROM ev.bilateral_capability_code OR ba.source_reference IS DISTINCT FROM ev.bilateral_source_reference OR encode(sha256(convert_to(ba.terms::text,'UTF8')),'hex') IS DISTINCT FROM ev.bilateral_terms_sha256 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_bilateral_customer_event_process']);END IF;
 END IF;
 FOR scope IN SELECT value FROM jsonb_array_elements(ev.approved_scope) ORDER BY value->>'periodId' LOOP
  SELECT x INTO own FROM jsonb_array_elements(w->'objects')x WHERE x->>'point'=scope->>'pointId' AND x->>'identityAgency'=scope->>'identityAgency';
  basis:=gridex_received_sources.supply_period_source_at_v1(c,(scope->>'periodId')::uuid,(own->>'effectiveAt')::timestamptz);
  IF own IS NULL OR basis IS NULL OR basis->>'qualified' IS DISTINCT FROM 'true' OR basis->>'companyId' IS DISTINCT FROM c::text OR basis->>'customerId' IS DISTINCT FROM ev.customer_id::text OR basis->>'customerId' IS DISTINCT FROM scope->>'customerId' OR basis->>'siteId' IS DISTINCT FROM scope->>'siteId' OR basis->>'meteringPointId' IS DISTINCT FROM scope->>'meteringPointId'
   OR basis->>'sourceMessageId' IS DISTINCT FROM scope->>'sourceMessageId' OR basis->>'payloadHash' IS DISTINCT FROM scope->>'sourcePayloadHash' OR basis->>'marketStateVersion' IS DISTINCT FROM scope->>'marketStateVersion' OR basis->>'legalActorId' IS DISTINCT FROM ev.legal_actor_id::text OR basis->>'dsoEdielId' IS DISTINCT FROM ev.legal_receiver_id
   OR own->>'gridArea' IS DISTINCT FROM scope->>'gridArea' OR NOT EXISTS(SELECT FROM jsonb_array_elements(basis->'sourceObjects') old WHERE old->>'point'=own->>'point' AND old->>'identityAgency'=own->>'identityAgency' AND old->>'gridArea'=own->>'gridArea')
   OR ev.classification='death' AND own->>'customerStatus' IS DISTINCT FROM 'Z41' OR ev.classification<>'death' AND own ? 'customerStatus'
   OR NOT('227'=ANY(ev.allowed_customer_fields)) AND NOT EXISTS(SELECT FROM jsonb_array_elements(basis->'sourceObjects') old WHERE old->>'customerIdentity'=own#>>'{customerParty,0}')
   THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_customer_event_current_source_object_scope']);END IF;
  IF ev.classification<>'death' AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers pi WHERE pi.actor_id=ba.counterparty_actor_id AND pi.identifier_type='EdielId' AND pi.identifier_value=ev.legal_receiver_id AND pi.is_verified AND (pi.valid_from IS NULL OR pi.valid_from<=current_date) AND (pi.valid_to IS NULL OR current_date<=pi.valid_to)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_bilateral_customer_event_counterparty']);END IF;
  objects:=objects||jsonb_build_array(jsonb_build_object('objectKey',scope->>'meteringPointId','installation',jsonb_build_object('id',own->>'point','agency',own->>'identityAgency'),
   'customer',jsonb_build_object('kind','domain_customer','key',ev.customer_id,'revision',ev.source_version,'id',own#>>'{customerParty,0}','qualifier',own#>>'{customerParty,1}','agency',own#>>'{customerParty,2}'),
   'legalSupplier',jsonb_build_object('id',ev.legal_sender_id,'qualifier','160','agency','SVK'),'legalGridOwner',jsonb_build_object('id',ev.legal_receiver_id,'qualifier','160','agency','SVK'),'process',jsonb_build_object('code','Z09','reason','E34'),
   'event',jsonb_build_object('key',ev.id,'eventKey',ev.id,'revision',ev.source_version,'reference',ev.source_reference),'assessment',jsonb_build_object('kind','known','value',CASE ev.classification WHEN 'death' THEN 'death' ELSE 'not_death' END,'evidence',jsonb_build_object('key',ev.id,'eventKey',ev.id,'revision',ev.source_version,'reference',ev.legal_decision_reference)),'lineItemReference',own->>'li'));
 END LOOP;
 RETURN jsonb_build_object('status','authorized','companyId',c,'environment',ev.environment,'eventId',ev.id,'sourceVersion',ev.source_version,'sourceDigest',ev.source_sha256,'sourceReference',ev.source_reference,'classification',ev.classification,'bilateralCapabilityVerified',ev.classification<>'death','legalActorId',ev.legal_actor_id,'legalSenderId',ev.legal_sender_id,'legalReceiverId',ev.legal_receiver_id,
  'customerId',ev.customer_id,'siteId',CASE WHEN jsonb_array_length(ev.approved_scope)=1 THEN ev.approved_scope#>>'{0,siteId}' END,'meteringPointId',CASE WHEN jsonb_array_length(ev.approved_scope)=1 THEN ev.approved_scope#>>'{0,meteringPointId}' END,'pointId',CASE WHEN jsonb_array_length(ev.approved_scope)=1 THEN ev.approved_scope#>>'{0,pointId}' END,'gridArea',CASE WHEN jsonb_array_length(ev.approved_scope)=1 THEN ev.approved_scope#>>'{0,gridArea}' END,'rawPayload',ev.approved_raw_payload,'selection',jsonb_build_object('source',jsonb_build_object('kind','caller_selection','reference',ev.source_reference),'objects',objects),
  'interchangeReference',w->>'interchange','messageReference',w->>'messageReference','documentReference',w->>'bgmId','transactionReference',w#>>'{objects,0,li}','informationKnownAt',ev.information_known_at);
END $$;

CREATE FUNCTION public.ediel_customer_life_event_source_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_customer_life_events.source_v1(p_company_id,p_event_id,p_actor_user_id,'prepare');END $$;

CREATE FUNCTION public.ediel_reserve_customer_life_event_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;o gridex_customer_life_events.origins%rowtype;original gridex_customer_life_events.originals%rowtype;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 b:=gridex_customer_life_events.source_v1(p_company_id,p_event_id,p_actor_user_id,'prepare');IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO o FROM gridex_customer_life_events.origins WHERE event_id=p_event_id AND company_id=p_company_id;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=coalesce(o.outbound_request_id,p_outbound_request_id) AND company_id=p_company_id FOR SHARE;
 IF i.id IS NULL OR r.id IS NULL OR i.environment IS DISTINCT FROM b->>'environment' OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z09' OR i.direction IS DISTINCT FROM 'outbound' OR i.communication_route_id IS NULL OR i.route_profile_id IS NULL OR i.operation_id IS DISTINCT FROM p_event_id OR i.validation_status IS DISTINCT FROM 'validated'
  OR i.customer_id::text IS DISTINCT FROM b->>'customerId' OR i.customer_site_id::text IS DISTINCT FROM b->>'siteId' OR i.metering_point_id IS DISTINCT FROM b->>'pointId'
  OR i.interchange_reference IS DISTINCT FROM b->>'interchangeReference' OR i.message_reference IS DISTINCT FROM b->>'messageReference' OR i.transaction_reference IS DISTINCT FROM b->>'transactionReference'
  OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id OR r.operation_id IS DISTINCT FROM p_event_id OR r.payload->>'environment' IS DISTINCT FROM b->>'environment' OR r.request_type IS DISTINCT FROM 'customer_masterdata' OR r.customer_id::text IS DISTINCT FROM b->>'customerId' OR r.site_id::text IS DISTINCT FROM b->>'siteId' OR r.metering_point_id::text IS DISTINCT FROM b->>'meteringPointId' THEN RAISE EXCEPTION 'customer_life_event_owned_intent_request_required';END IF;
 IF o.event_id IS NOT NULL AND o.intent_id IS DISTINCT FROM i.id THEN RAISE EXCEPTION 'customer_life_event_original_reservation_conflict';END IF;
 INSERT INTO gridex_customer_life_events.origins(event_id,company_id,intent_id,outbound_request_id,actor_user_id) VALUES(p_event_id,p_company_id,i.id,r.id,p_actor_user_id) ON CONFLICT(event_id) DO NOTHING;
 SELECT * INTO original FROM gridex_customer_life_events.originals WHERE event_id=p_event_id AND company_id=p_company_id;
 RETURN jsonb_build_object('status','reserved','messageId',original.message_id,'outboundRequestId',r.id);
END $$;

CREATE FUNCTION gridex_customer_life_events.bind_original_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_customer_life_events.origins%rowtype;b jsonb;i public.ediel_message_intents%rowtype;reservation jsonb;task_id uuid;BEGIN
 SELECT * INTO o FROM gridex_customer_life_events.origins WHERE company_id=NEW.company_id AND intent_id=NEW.intent_id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 b:=gridex_customer_life_events.source_v1(o.company_id,o.event_id,o.actor_user_id,'prepare');
 reservation:=public.ediel_reserve_customer_life_event_v1(o.company_id,o.event_id,o.actor_user_id,o.intent_id,o.outbound_request_id);
 IF reservation->>'status' IS DISTINCT FROM 'reserved' OR reservation->>'outboundRequestId' IS DISTINCT FROM o.outbound_request_id::text THEN RAISE EXCEPTION 'customer_life_event_first_current_intent_request_required';END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id AND company_id=o.company_id FOR SHARE;
 IF b->>'status' IS DISTINCT FROM 'authorized' OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_standard IS DISTINCT FROM 'edifact' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.message_code IS DISTINCT FROM 'Z09' OR NEW.environment IS DISTINCT FROM b->>'environment' OR NEW.source_operation_id IS DISTINCT FROM o.event_id::text OR NEW.raw_payload IS DISTINCT FROM b->>'rawPayload' OR NEW.outbound_request_id IS DISTINCT FROM o.outbound_request_id
  OR NEW.customer_id::text IS DISTINCT FROM b->>'customerId' OR NEW.site_id::text IS DISTINCT FROM b->>'siteId' OR NEW.metering_point_id::text IS DISTINCT FROM b->>'meteringPointId' OR NEW.communication_route_id IS DISTINCT FROM i.communication_route_id OR NEW.route_profile_id IS DISTINCT FROM i.route_profile_id OR NEW.status IS DISTINCT FROM 'draft' OR NEW.immutable_rendered_at IS NULL OR NEW.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') OR i.validation_status IS DISTINCT FROM 'validated' THEN RAISE EXCEPTION 'customer_life_event_original_source_binding_required';END IF;
 INSERT INTO gridex_customer_life_events.originals(message_id,event_id,company_id,payload_hash,source_snapshot,intent_binding) VALUES(NEW.id,o.event_id,o.company_id,NEW.immutable_payload_hash,b,jsonb_build_object('intentId',i.id,'operationId',i.operation_id,'requestId',o.outbound_request_id,'routeId',i.communication_route_id,'routeProfileId',i.route_profile_id));
 INSERT INTO gridex_customer_life_events.desired_changes(event_id,company_id,message_id,classification,source_scope,information_known_at,actor_user_id) SELECT o.event_id,o.company_id,NEW.id,e.classification,e.approved_scope,e.information_known_at,o.actor_user_id FROM gridex_customer_life_events.events e WHERE e.id=o.event_id;
 INSERT INTO public.customer_operation_tasks(company_id,customer_id,site_id,metering_point_id,task_type,status,priority,title,description,assigned_to,due_at,metadata,created_by,updated_by)
 VALUES(o.company_id,(b->>'customerId')::uuid,(b->>'siteId')::uuid,(b->>'meteringPointId')::uuid,'ediel_customer_life_event','open','normal','Anmäld kundlivshändelse behöver följas upp','Önskad förändring har registrerats. Mottagen Z06 får en egen källbunden kundversion.',o.actor_user_id,NULL,jsonb_build_object('sourceMessageId',NEW.id,'ruleId','TM-Z09-E','sourceKind','desired_customer_change','informationKnownAt',b->>'informationKnownAt','classification',b->>'classification'),o.actor_user_id,o.actor_user_id) RETURNING id INTO task_id;
 INSERT INTO gridex_customer_life_events.tasks(source_message_id,customer_id,operation_task_id,company_id,rule_id,information_known_at,responsible_user_id,source_kind) VALUES(NEW.id,(b->>'customerId')::uuid,task_id,o.company_id,'TM-Z09-E',(b->>'informationKnownAt')::timestamptz,o.actor_user_id,'desired_customer_change');
 RETURN NEW;
END $$;
CREATE TRIGGER bind_customer_life_event_original AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_customer_life_events.bind_original_v1();

CREATE FUNCTION gridex_customer_life_events.recovery_basis_v1(c uuid,operation uuid,actor uuid,phase text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;op gridex_received_sources.prodat_recovery_operations%rowtype;original gridex_customer_life_events.originals%rowtype;m public.ediel_messages%rowtype;b jsonb;corrected jsonb;source_wire jsonb;obj jsonb;facts jsonb:='[]';BEGIN
 q:=public.ediel_prodat_recovery_operation_basis_v1(c,operation,actor);IF q IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=operation AND company_id=c;
 SELECT * INTO original FROM gridex_customer_life_events.originals WHERE message_id=op.original_message_id AND company_id=c;
 IF original.message_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=original.message_id AND company_id=c FOR SHARE;
 -- Current source qualification stays separate from original provider truth.
 b:=gridex_customer_life_events.require_current_v1(c,m.id,actor,phase)->'basis';
 corrected:=gridex_customer_life_events.wire_v1(op.corrected_raw_payload);source_wire:=gridex_customer_life_events.wire_v1(m.raw_payload);
 IF b->>'status' IS DISTINCT FROM 'authorized' OR corrected IS NULL OR source_wire IS NULL OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(op.corrected_raw_payload,'UTF8')),'hex')
  OR q->>'correctedPayloadHash' IS DISTINCT FROM op.corrected_payload_hash OR corrected->>'code' IS DISTINCT FROM 'Z09' OR corrected->>'legalSender' IS DISTINCT FROM source_wire->>'legalSender' OR corrected->>'legalReceiver' IS DISTINCT FROM source_wire->>'legalReceiver' THEN RAISE EXCEPTION 'customer_life_event_recovery_current_source_required';END IF;
 FOR obj IN SELECT value FROM jsonb_array_elements(corrected->'objects') LOOP
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(source_wire->'objects') own WHERE own=obj) THEN RAISE EXCEPTION 'customer_life_event_recovery_approved_tuple_changed';END IF;
  facts:=facts||(SELECT coalesce(jsonb_agg(f),'[]') FROM jsonb_array_elements(b#>'{selection,objects}') f WHERE f#>>'{installation,id}'=obj->>'point' AND f#>>'{installation,agency}'=obj->>'identityAgency' AND f->>'lineItemReference'=obj->>'li');
 END LOOP;
 IF jsonb_array_length(facts) IS DISTINCT FROM jsonb_array_length(corrected->'objects') THEN RAISE EXCEPTION 'customer_life_event_recovery_whole_scope_required';END IF;
 RETURN b||jsonb_build_object('rawPayload',op.corrected_raw_payload,'recoveryOperationId',op.id,'originalMessageId',m.id,'selection',jsonb_set(b->'selection','{objects}',facts));
END$$;
CREATE FUNCTION public.ediel_customer_life_event_recovery_basis_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_customer_life_events.recovery_basis_v1(p_company_id,p_operation_id,p_actor_user_id,CASE WHEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) THEN 'send' ELSE 'prepare' END);
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_life_event_recovery_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_recovery_basis_v1(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_customer_life_events.require_current_v1(c uuid,mid uuid,actor uuid,phase text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_customer_life_events.originals%rowtype;origin gridex_customer_life_events.origins%rowtype;b jsonb;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;w jsonb;q jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;IF m.id IS NULL THEN RAISE EXCEPTION 'customer_life_event_message_scope_required';END IF;
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z09' THEN RETURN NULL;END IF;
 w:=gridex_customer_life_events.wire_v1(m.raw_payload);SELECT * INTO o FROM gridex_customer_life_events.originals WHERE message_id=m.id AND company_id=c;
 IF NOT FOUND THEN
  q:=public.ediel_prodat_recovery_original_basis_v1(c,m.id,actor);
  IF q IS NOT NULL THEN
   b:=gridex_customer_life_events.recovery_basis_v1(c,(q->>'operationId')::uuid,actor,phase);
   IF b IS NOT NULL THEN
    IF m.raw_payload IS DISTINCT FROM b->>'rawPayload' OR m.original_message_id::text IS DISTINCT FROM b->>'originalMessageId' OR m.source_operation_id IS DISTINCT FROM q->>'operationId' OR m.immutable_payload_hash IS DISTINCT FROM q->>'correctedPayloadHash' OR m.immutable_rendered_at IS NULL OR m.environment IS DISTINCT FROM b->>'environment' OR m.customer_id::text IS DISTINCT FROM b->>'customerId' THEN RAISE EXCEPTION 'customer_life_event_recovery_original_alias_changed';END IF;
    PERFORM gridex_ediel_transport.require_message_intent_v1(m);RETURN jsonb_build_object('basis',b,'intentId',m.intent_id);
   END IF;
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.prodat_recovery_wire_v1(m.raw_payload)->'objects') own WHERE own->>'reason'='E34') THEN RAISE EXCEPTION 'customer_life_event_historical_source_unavailable';END IF;RETURN NULL;
 END IF;
 b:=gridex_customer_life_events.source_v1(c,o.event_id,actor,phase);SELECT * INTO origin FROM gridex_customer_life_events.origins WHERE event_id=o.event_id AND company_id=c;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=origin.intent_id AND company_id=c FOR SHARE;SELECT * INTO r FROM public.outbound_requests WHERE id=origin.outbound_request_id AND company_id=c FOR SHARE;
 IF b->>'status' IS DISTINCT FROM 'authorized' OR m.raw_payload IS DISTINCT FROM b->>'rawPayload' OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR m.immutable_rendered_at IS NULL
  OR m.intent_id IS DISTINCT FROM origin.intent_id OR m.outbound_request_id IS DISTINCT FROM origin.outbound_request_id OR m.source_operation_id IS DISTINCT FROM o.event_id::text OR m.environment IS DISTINCT FROM b->>'environment' OR m.customer_id::text IS DISTINCT FROM b->>'customerId' OR m.site_id::text IS DISTINCT FROM b->>'siteId' OR m.metering_point_id::text IS DISTINCT FROM b->>'meteringPointId'
  OR i.id IS NULL OR i.ediel_message_id IS DISTINCT FROM m.id OR i.operation_id IS DISTINCT FROM o.event_id OR i.validation_status IS DISTINCT FROM 'validated' OR i.outbound_request_id IS DISTINCT FROM r.id OR i.communication_route_id::text IS DISTINCT FROM o.intent_binding->>'routeId' OR i.route_profile_id::text IS DISTINCT FROM o.intent_binding->>'routeProfileId'
  OR r.id IS NULL OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id OR r.operation_id IS DISTINCT FROM o.event_id OR r.payload->>'environment' IS DISTINCT FROM m.environment OR r.customer_id IS DISTINCT FROM m.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM m.metering_point_id THEN RAISE EXCEPTION 'customer_life_event_current_original_scope_changed';END IF;
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);RETURN jsonb_build_object('basis',b,'intentId',i.id);
END $$;
CREATE FUNCTION public.ediel_customer_life_event_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_customer_life_events.require_current_v1(p_company_id,p_message_id,p_actor_user_id,CASE WHEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) THEN 'send' ELSE 'prepare' END);END $$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_customer_life_event_source_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=gridex_ediel_transport.mutate_before_customer_life_event_source_v1(input);
 IF (input->>'action' IN('prepare','enter')) IS NOT TRUE OR result->>'proceed' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 PERFORM gridex_customer_life_events.require_current_v1((input->>'companyId')::uuid,(input->>'messageId')::uuid,(input->>'actorUserId')::uuid,'send');RETURN result;END $$;

-- Before canonical admission this port supplies independent source classification
-- only. It writes no customer and never turns a raw E34/310 into a legal mandate.
CREATE FUNCTION gridex_customer_life_events.inbound_basis_v1(c uuid,mid uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;g gridex_customer_life_events.inbound_grounds%rowtype;ba public.tenant_bilateral_agreements%rowtype;
 local_legal jsonb;wire jsonb;own jsonb;scope jsonb;basis jsonb;scopes jsonb:='[]';facts jsonb:='[]';plans jsonb:='[]';ids uuid[];periods uuid[];period_manifest jsonb;classes text[]:=ARRAY[]::text[];
 point public.metering_points%rowtype;period public.customer_supply_periods%rowtype;kind text;fields text[];matches uuid[];
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06' THEN RETURN NULL;END IF;
 wire:=gridex_customer_life_events.wire_v1(m.raw_payload);
 IF wire IS NULL THEN RETURN NULL;END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(c,actor,'prepare');
 local_legal:=gridex_ediel_inbound_context.require_v1(c,mid);
 IF local_legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR local_legal->>'legalEdielId' IS DISTINCT FROM wire->>'legalReceiver' OR local_legal->>'family' IS DISTINCT FROM 'PRODAT' OR local_legal->>'code' IS DISTINCT FROM 'Z06' THEN RAISE EXCEPTION 'customer_life_event_frozen_receiver_required';END IF;
 SELECT * INTO g FROM gridex_customer_life_events.inbound_grounds WHERE source_message_id=mid AND company_id=c FOR SHARE;
 IF g.source_message_id IS NOT NULL THEN
  IF g.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR g.approved_at>clock_timestamp() OR jsonb_typeof(g.approved_scope) IS DISTINCT FROM 'array' OR jsonb_array_length(g.approved_scope) IS DISTINCT FROM jsonb_array_length(wire->'objects') THEN RAISE EXCEPTION 'customer_life_event_exact_bilateral_source_scope_required';END IF;
  SELECT * INTO ba FROM public.tenant_bilateral_agreements WHERE id=g.bilateral_agreement_id AND company_id=c AND environment=m.environment FOR SHARE;
  PERFORM pi.id FROM public.platform_actor_identifiers pi WHERE pi.actor_id=ba.counterparty_actor_id FOR SHARE;
  IF ba.id IS NULL OR ba.is_enabled IS DISTINCT FROM true OR ba.valid_from IS NULL OR ba.valid_from>clock_timestamp() OR ba.valid_to IS NOT NULL AND ba.valid_to<clock_timestamp()
   OR ba.capability_code IS DISTINCT FROM g.bilateral_capability_code OR ba.source_reference IS DISTINCT FROM g.bilateral_source_reference OR encode(sha256(convert_to(ba.terms::text,'UTF8')),'hex') IS DISTINCT FROM g.bilateral_terms_sha256
   OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers pi WHERE pi.actor_id=ba.counterparty_actor_id AND pi.identifier_type='EdielId' AND pi.identifier_value=wire->>'legalSender' AND pi.is_verified AND (pi.valid_from IS NULL OR pi.valid_from<=current_date) AND (pi.valid_to IS NULL OR current_date<=pi.valid_to)) THEN RAISE EXCEPTION 'customer_life_event_current_bilateral_source_required';END IF;
 END IF;
 -- Discover every own source before locking any point/period/customer. All
 -- selectors are subsequently requalified by the single immutable supply owner.
 SELECT array_agg(DISTINCT p.id) INTO periods FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=c
 WHERE p.company_id=c AND mp.grid_owner_ediel_id=wire->>'legalSender' AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,''))=o->>'point' AND mp.grid_area_code=o->>'gridArea');
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO period_manifest FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(periods);
 SELECT array_agg(DISTINCT source_id) INTO ids FROM (
  SELECT p.source_message_id source_id FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(periods)
  UNION SELECT tr.source_message_id FROM gridex_received_sources.supply_source_transitions tr,public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(periods) AND tr.company_id=c AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND state->>'market_state_version'=p.market_state_version::text)
  UNION SELECT proof.original_message_id FROM gridex_received_sources.normal_switch_confirmations proof WHERE proof.company_id=c AND proof.period_id=ANY(periods)
 ) sources;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=c AND z.id=ANY(ids) ORDER BY z.id FOR UPDATE;
 PERFORM p.id FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(periods) ORDER BY p.id FOR SHARE;
 IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(periods)) IS DISTINCT FROM period_manifest THEN RAISE EXCEPTION 'customer_life_event_source_discovery_changed' USING ERRCODE='40001';END IF;
 FOR own IN SELECT value FROM jsonb_array_elements(wire->'objects') ORDER BY value->>'point' LOOP
  matches:=ARRAY[]::uuid[];
  FOR period IN SELECT p.* FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=c WHERE p.company_id=c AND p.id=ANY(periods) AND coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,''))=own->>'point' AND mp.grid_area_code=own->>'gridArea' ORDER BY p.id LOOP
   basis:=gridex_received_sources.supply_period_source_at_v1(c,period.id,(own->>'effectiveAt')::timestamptz);
   IF basis->>'qualified'='true' AND basis->>'legalActorId'=local_legal->>'legalActorId' AND basis->>'dsoEdielId'=wire->>'legalSender' AND EXISTS(SELECT FROM jsonb_array_elements(basis->'sourceObjects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'gridArea'=own->>'gridArea') THEN matches:=array_append(matches,period.id);END IF;
  END LOOP;
  IF cardinality(matches)<>1 THEN RAISE EXCEPTION 'customer_life_event_unique_current_owned_source_period_required';END IF;
  basis:=gridex_received_sources.supply_period_source_at_v1(c,matches[1],(own->>'effectiveAt')::timestamptz);
  scope:=NULL;
  IF g.source_message_id IS NOT NULL THEN
   IF (SELECT count(*) FROM jsonb_array_elements(g.approved_scope) approved WHERE approved->>'pointId'=own->>'point' AND approved->>'identityAgency'=own->>'identityAgency')<>1 THEN RAISE EXCEPTION 'customer_life_event_whole_bilateral_scope_required';END IF;
   SELECT approved INTO scope FROM jsonb_array_elements(g.approved_scope) approved WHERE approved->>'pointId'=own->>'point' AND approved->>'identityAgency'=own->>'identityAgency';
   IF scope->>'periodId' IS DISTINCT FROM basis->>'periodId' OR scope->>'customerId' IS DISTINCT FROM basis->>'customerId' OR scope->>'siteId' IS DISTINCT FROM basis->>'siteId' OR scope->>'meteringPointId' IS DISTINCT FROM basis->>'meteringPointId' OR scope->>'sourceMessageId' IS DISTINCT FROM basis->>'sourceMessageId' OR scope->>'sourcePayloadHash' IS DISTINCT FROM basis->>'payloadHash' OR scope->>'marketStateVersion' IS DISTINCT FROM basis->>'marketStateVersion' THEN RAISE EXCEPTION 'customer_life_event_bilateral_own_period_version_changed';END IF;
   kind:=coalesce(scope->>'classification',g.classification);fields:=g.allowed_customer_fields;
  ELSE kind:='death';fields:=ARRAY['228','229','231','232','310','316'];END IF;
  IF (kind IN('death','bankruptcy','other_masterdata')) IS NOT TRUE OR kind='death' AND own->>'customerStatus' IS DISTINCT FROM 'Z41' THEN RAISE EXCEPTION 'customer_life_event_independent_classification_required';END IF;
  IF NOT('227'=ANY(fields)) AND NOT EXISTS(SELECT FROM jsonb_array_elements(basis->'sourceObjects') o WHERE o->>'customerIdentity'=own#>>'{customerParty,0}') OR '227'=ANY(fields) AND (scope->>'targetCustomerIdentity' IS DISTINCT FROM own#>>'{customerParty,0}' OR scope->>'targetCustomerQualifier' IS DISTINCT FROM own#>>'{customerParty,1}') THEN RAISE EXCEPTION 'customer_life_event_owned_end_user_identity_required';END IF;
  scope:=jsonb_build_object('periodId',basis->>'periodId','customerId',basis->>'customerId','siteId',basis->>'siteId','meteringPointId',basis->>'meteringPointId','pointId',own->>'point','identityAgency',own->>'identityAgency','gridArea',own->>'gridArea','sourceMessageId',basis->>'sourceMessageId','sourcePayloadHash',basis->>'payloadHash','marketStateVersion',basis->>'marketStateVersion','classification',kind,'allowedFields',to_jsonb(fields),'effectiveAt',own->>'effectiveAt');
  scopes:=scopes||jsonb_build_array(scope);plans:=plans||jsonb_build_array(jsonb_build_object('scope',scope,'object',own));classes:=array_append(classes,kind);
  facts:=facts||jsonb_build_array(jsonb_build_object('objectKey',scope->>'meteringPointId','installation',jsonb_build_object('id',own->>'point','agency',own->>'identityAgency'),
   'customer',jsonb_build_object('kind','domain_customer','key',scope->>'customerId','revision',scope->>'marketStateVersion','id',own#>>'{customerParty,0}','qualifier',own#>>'{customerParty,1}','agency',own#>>'{customerParty,2}'),
   'legalSupplier',jsonb_build_object('id',wire->>'legalReceiver','qualifier','160','agency','SVK'),'legalGridOwner',jsonb_build_object('id',wire->>'legalSender','qualifier','160','agency','SVK'),'process',jsonb_build_object('code','Z06','reason','E34'),
   'event',jsonb_build_object('key',m.id,'eventKey',m.id,'revision',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'reference',m.id),
   'assessment',jsonb_build_object('kind','known','value',CASE kind WHEN 'death' THEN 'death' ELSE 'not_death' END,'evidence',jsonb_build_object('key',coalesce(g.source_message_id,m.id),'eventKey',m.id,'revision',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'reference',coalesce(g.legal_decision_reference,m.id::text))),'lineItemReference',own->>'li'));
 END LOOP;
 RETURN jsonb_build_object('status','authorized','companyId',c,'environment',m.environment,'messageId',m.id,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'rawPayload',m.raw_payload,'legalContext',local_legal,'classification',CASE WHEN (SELECT count(DISTINCT x) FROM unnest(classes) x)=1 THEN classes[1] ELSE 'other_masterdata' END,'bilateralCapabilityVerified',g.source_message_id IS NOT NULL,'scopes',scopes,'plans',plans,'selection',jsonb_build_object('source',jsonb_build_object('kind','caller_selection','reference',coalesce(g.source_reference,m.id::text)),'objects',facts));
END$$;
CREATE FUNCTION public.ediel_customer_life_event_inbound_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_customer_life_events.inbound_basis_v1(p_company_id,p_message_id,p_actor_user_id);
END$$;

CREATE FUNCTION public.ediel_apply_customer_life_event_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;prior gridex_customer_life_events.transitions%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;basis jsonb;plan jsonb;scope jsonb;own jsonb;cust public.customers%rowtype;
 before_state jsonb:='[]';after_state jsonb:='[]';fields text[];customer_ids uuid[];target_customer_id uuid;next_version bigint;task_id uuid;new_metadata jsonb;projection jsonb;new_name text;kind text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'customer_life_event_source_required';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'prepare');
 SELECT * INTO prior FROM gridex_customer_life_events.transitions WHERE source_message_id=m.id;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'customer_life_event_committed_replay_conflict';END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'sourceMessageId',m.id,'sourceObjects',prior.source_objects,'scopes',prior.approved_scope);END IF;
 basis:=gridex_customer_life_events.inbound_basis_v1(p_company_id,m.id,p_actor_user_id);IF basis IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','not_customer_life_event');END IF;
 PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 IF (SELECT count(*) FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.source_payload_hash=basis->>'sourcePayloadHash' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id))<>1 THEN RAISE EXCEPTION 'customer_life_event_canonical_leaf_required';END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.source_payload_hash=basis->>'sourcePayloadHash' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb#>>'{registerValidation,owner}' IS DISTINCT FROM 'validateProdatRegisterPolicy' OR canonical.facts_text::jsonb#>>'{registerValidation,coverage}' IS DISTINCT FROM 'canonical_register_only' OR jsonb_typeof(canonical.facts_text::jsonb#>'{registerValidation,objects}') IS DISTINCT FROM 'array' OR jsonb_array_length(canonical.facts_text::jsonb#>'{registerValidation,objects}') IS DISTINCT FROM jsonb_array_length(basis->'plans') THEN RAISE EXCEPTION 'customer_life_event_whole_canonical_acceptance_required';END IF;
 FOR plan IN SELECT value FROM jsonb_array_elements(basis->'plans') LOOP scope:=plan->'scope';own:=plan->'object';
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(canonical.facts_text::jsonb#>'{registerValidation,objects}') o WHERE o->>'disposition'='accepted' AND o->>'messageIndex'='0' AND o->>'objectId'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency') THEN RAISE EXCEPTION 'customer_life_event_own_register_scope_required';END IF;
 END LOOP;
 SELECT array_agg(DISTINCT (s->>'customerId')::uuid ORDER BY (s->>'customerId')::uuid) INTO customer_ids FROM jsonb_array_elements(basis->'scopes') s;
 PERFORM cu.id FROM public.customers cu WHERE cu.company_id=p_company_id AND cu.id=ANY(customer_ids) ORDER BY cu.id FOR UPDATE;
 FOR target_customer_id IN SELECT unnest(customer_ids) LOOP
  SELECT * INTO cust FROM public.customers WHERE id=target_customer_id AND company_id=p_company_id;
  IF cust.id IS NULL THEN RAISE EXCEPTION 'customer_life_event_customer_tenant_scope_required';END IF;
  -- Multiple physical objects for the same customer must agree on every
  -- consumed field. No first-object preference or partial object mutation.
  IF (SELECT count(DISTINCT jsonb_build_array(p#>'{object,customerParty}',p#>'{object,name}',p#>'{object,street}',p#>'{object,city}',p#>'{object,postCode}',p#>'{object,country}',p#>'{scope,classification}',p#>'{scope,allowedFields}',p#>'{scope,effectiveAt}')) FROM jsonb_array_elements(basis->'plans') p WHERE p#>>'{scope,customerId}'=target_customer_id::text)<>1 THEN RAISE EXCEPTION 'customer_life_event_customer_object_values_ambiguous';END IF;
  SELECT p INTO plan FROM jsonb_array_elements(basis->'plans') p WHERE p#>>'{scope,customerId}'=target_customer_id::text LIMIT 1;
  own:=plan->'object';scope:=plan->'scope';kind:=scope->>'classification';SELECT array_agg(f) INTO fields FROM jsonb_array_elements_text(scope->'allowedFields') f;
  IF '227'=ANY(fields) AND (CASE WHEN cust.org_number IS NOT NULL THEN own#>>'{customerParty,1}'='SE1' WHEN cust.personal_number IS NOT NULL THEN own#>>'{customerParty,1}'='SE2' ELSE false END) IS NOT TRUE THEN RAISE EXCEPTION 'customer_life_event_legal_identity_kind_change_requires_separate_ground';END IF;
  before_state:=before_state||jsonb_build_array(to_jsonb(cust));new_metadata:=coalesce(cust.metadata,'{}');projection:=coalesce(new_metadata->'edielEndUserMasterdata','{}');
  IF '229'=ANY(fields) AND jsonb_typeof(own->'street')='array' THEN projection:=projection||jsonb_build_object('street',own->'street');END IF;
  IF '231'=ANY(fields) AND own->>'postCode' IS NOT NULL THEN projection:=projection||jsonb_build_object('postCode',own->>'postCode');END IF;
  IF '232'=ANY(fields) AND own->>'city' IS NOT NULL THEN projection:=projection||jsonb_build_object('city',own->>'city');END IF;
  IF '316'=ANY(fields) AND own->>'country' IS NOT NULL THEN projection:=projection||jsonb_build_object('country',own->>'country');END IF;
  IF '228'=ANY(fields) AND jsonb_typeof(own->'name')='array' THEN projection:=projection||jsonb_build_object('name',own->'name');SELECT string_agg(part,' ' ORDER BY ord) INTO new_name FROM jsonb_array_elements_text(own->'name') WITH ORDINALITY x(part,ord);ELSE new_name:=NULL;END IF;
  SELECT coalesce(max(v.version),0)+1 INTO next_version FROM gridex_customer_life_events.customer_versions v WHERE v.company_id=p_company_id AND v.customer_id=target_customer_id;
  new_metadata:=new_metadata||jsonb_build_object('edielEndUserMasterdata',projection,'edielCustomerLifeEvent',jsonb_build_object('classification',kind,'sourceMessageId',m.id,'version',next_version,'observedAt',basis#>>'{legalContext,observedAt}','effectiveAt',scope->>'effectiveAt'));
  -- UD is the end user, never the invoicee: retain its source address separately
  -- from billing_* columns. Bankruptcy never sets death or changes supply state.
  cust:=jsonb_populate_record(cust,jsonb_build_object('name',coalesce(new_name,cust.name),'full_name',coalesce(new_name,cust.full_name),
   'company_name',CASE WHEN own#>>'{customerParty,1}'='SE1' AND new_name IS NOT NULL THEN new_name ELSE cust.company_name END,
   'org_number',CASE WHEN '227'=ANY(fields) AND own#>>'{customerParty,1}'='SE1' THEN own#>>'{customerParty,0}' ELSE cust.org_number END,
   'personal_number',CASE WHEN '227'=ANY(fields) AND own#>>'{customerParty,1}'='SE2' THEN own#>>'{customerParty,0}' ELSE cust.personal_number END,
   'metadata',new_metadata,'updated_by',p_actor_user_id,'updated_at',clock_timestamp()));
  IF (scope->>'effectiveAt')::timestamptz<=clock_timestamp() THEN
   UPDATE public.customers SET name=cust.name,full_name=cust.full_name,company_name=cust.company_name,org_number=cust.org_number,personal_number=cust.personal_number,metadata=cust.metadata,updated_by=p_actor_user_id,updated_at=cust.updated_at WHERE id=target_customer_id AND company_id=p_company_id;
  END IF;
  after_state:=after_state||jsonb_build_array(to_jsonb(cust));
 END LOOP;
 INSERT INTO gridex_customer_life_events.transitions(source_message_id,company_id,payload_hash,classification,previous_customers,resulting_customers,source_objects,approved_scope,legal_context,canonical_assessment_id,actor_user_id,observed_at)
 VALUES(m.id,p_company_id,basis->>'sourcePayloadHash',basis->>'classification',before_state,after_state,gridex_customer_life_events.wire_v1(m.raw_payload)->'objects',basis->'scopes',basis->'legalContext',canonical.id,p_actor_user_id,(basis#>>'{legalContext,observedAt}')::timestamptz);
 FOR cust IN SELECT * FROM jsonb_populate_recordset(NULL::public.customers,after_state) LOOP
  INSERT INTO gridex_customer_life_events.customer_versions(company_id,customer_id,version,source_message_id,previous_customer,resulting_customer,effective_at,observed_at)
  SELECT p_company_id,cust.id,(cust.metadata#>>'{edielCustomerLifeEvent,version}')::bigint,m.id,b,to_jsonb(cust),(cust.metadata#>>'{edielCustomerLifeEvent,effectiveAt}')::timestamptz,(basis#>>'{legalContext,observedAt}')::timestamptz FROM jsonb_array_elements(before_state) b WHERE b->>'id'=cust.id::text;
 END LOOP;
 FOR target_customer_id IN SELECT unnest(customer_ids) LOOP
  INSERT INTO public.customer_operation_tasks(company_id,customer_id,task_type,status,priority,title,description,assigned_to,due_at,metadata,created_by,updated_by)
  VALUES(p_company_id,target_customer_id,'ediel_customer_life_event','open','normal','Bekräftad kundlivshändelse behöver handläggas','Källbunden kundversion och giltighetsdatum har registrerats. Dödsfall och konkurs handläggs separat.',p_actor_user_id,NULL,jsonb_build_object('sourceMessageId',m.id,'ruleId','TM-Z06-E','sourceKind','confirmed_customer_change','informationKnownAt',basis#>>'{legalContext,observedAt}'),p_actor_user_id,p_actor_user_id) RETURNING id INTO task_id;
  INSERT INTO gridex_customer_life_events.tasks(source_message_id,customer_id,operation_task_id,company_id,rule_id,information_known_at,responsible_user_id,source_kind) VALUES(m.id,target_customer_id,task_id,p_company_id,'TM-Z06-E',(basis#>>'{legalContext,observedAt}')::timestamptz,p_actor_user_id,'confirmed_customer_change');
 END LOOP;
 RETURN jsonb_build_object('applied',true,'idempotent',false,'sourceMessageId',m.id,'sourceObjects',gridex_customer_life_events.wire_v1(m.raw_payload)->'objects','scopes',basis->'scopes');
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_life_event_inbound_basis_v1(uuid,uuid,uuid),public.ediel_apply_customer_life_event_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_inbound_basis_v1(uuid,uuid,uuid),public.ediel_apply_customer_life_event_source_v1(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_customer_life_events.owner_proof_consistent_v1(party jsonb,business jsonb,mid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tr gridex_customer_life_events.transitions%rowtype;m public.ediel_messages%rowtype;scope jsonb;version_row gridex_customer_life_events.customer_versions%rowtype;BEGIN
 SELECT * INTO tr FROM gridex_customer_life_events.transitions WHERE source_message_id=mid;
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=tr.company_id;
 SELECT s INTO scope FROM jsonb_array_elements(tr.approved_scope) s WHERE s->>'pointId'=business#>>'{object,objectId}' AND s->>'identityAgency'=business#>>'{object,identityAgency}';
 SELECT * INTO version_row FROM gridex_customer_life_events.customer_versions WHERE source_message_id=mid AND company_id=tr.company_id AND customer_id=(scope->>'customerId')::uuid;
 IF tr.source_message_id IS NULL OR m.id IS NULL OR scope IS NULL OR version_row.customer_id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06' OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR business->>'owner' IS DISTINCT FROM 'inbound-customer-life-event-v1' OR business->>'businessDisposition' IS DISTINCT FROM 'committed' OR business->>'coverage' IS DISTINCT FROM 'committed_customer_version_only' OR business->>'graphNamespace' IS DISTINCT FROM 'source_bound_customer_history' OR business->>'sourceDisposition' IS DISTINCT FROM 'not_established'
  OR business->>'companyId' IS DISTINCT FROM tr.company_id::text OR business->>'environment' IS DISTINCT FROM m.environment OR business->>'sourceMessageId' IS DISTINCT FROM mid::text OR business->>'sourcePayloadHash' IS DISTINCT FROM tr.payload_hash OR business->>'customerId' IS DISTINCT FROM scope->>'customerId' OR business->>'siteId' IS DISTINCT FROM scope->>'siteId' OR business->>'meteringPointId' IS DISTINCT FROM scope->>'meteringPointId' OR business->>'classification' IS DISTINCT FROM scope->>'classification' OR business->>'customerVersion' IS DISTINCT FROM version_row.version::text OR (business->>'effectiveAt')::timestamptz IS DISTINCT FROM version_row.effective_at OR (scope->>'effectiveAt')::timestamptz IS DISTINCT FROM version_row.effective_at
  OR party->'frozenLegalContext' IS DISTINCT FROM tr.legal_context OR party->'object' IS DISTINCT FROM business->'object' OR party->>'owner' IS DISTINCT FROM 'received-source-party-binding-v1' OR party->>'ruleVersion' IS DISTINCT FROM '1' OR party->>'disposition' IS DISTINCT FROM 'accepted' OR party->'reasons' IS DISTINCT FROM '[]'::jsonb
  OR party#>>'{source,companyId}' IS DISTINCT FROM tr.company_id::text OR party#>>'{source,environment}' IS DISTINCT FROM m.environment OR party#>>'{source,sourceMessageId}' IS DISTINCT FROM mid::text OR party#>>'{source,sourcePayloadHash}' IS DISTINCT FROM tr.payload_hash
  OR tr.legal_context->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR tr.legal_context->>'legalEdielId' IS DISTINCT FROM gridex_customer_life_events.wire_v1(m.raw_payload)->>'legalReceiver'
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_customers) result WHERE result=version_row.resulting_customer) OR NOT EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) own WHERE own->>'point'=scope->>'pointId' AND own->>'identityAgency'=scope->>'identityAgency') THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END$$;
CREATE FUNCTION public.ediel_customer_life_event_committed_source_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tr gridex_customer_life_events.transitions%rowtype;m public.ediel_messages%rowtype;sc jsonb;versions jsonb;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'prepare');
 SELECT * INTO tr FROM gridex_customer_life_events.transitions WHERE source_message_id=p_message_id AND company_id=p_company_id;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;
 IF tr.source_message_id IS NULL OR m.id IS NULL OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN NULL;END IF;
 SELECT jsonb_agg(jsonb_build_object('customerId',v.customer_id,'version',v.version,'effectiveAt',v.effective_at)) INTO versions FROM gridex_customer_life_events.customer_versions v WHERE v.source_message_id=m.id AND v.company_id=p_company_id;
 RETURN jsonb_build_object('version',1,'sourceMessageId',m.id,'sourcePayloadHash',tr.payload_hash,'companyId',p_company_id,'environment',m.environment,'rawPayload',m.raw_payload,'legalContext',tr.legal_context,'sourceObjects',tr.source_objects,'scopes',tr.approved_scope,'customerVersions',versions,'canonicalAssessmentId',tr.canonical_assessment_id,'observedAt',tr.observed_at);
END$$;
-- Read source-approved end-user fields through the same committed primary
-- owner and its actual availability witness. No mutable customer metadata can
-- qualify a life event; a pending or superseded owner leaf keeps export held.
CREATE FUNCTION public.ediel_customer_life_event_export_projection_v1(p_company_id uuid,p_customer_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v gridex_customer_life_events.customer_versions%rowtype;tr gridex_customer_life_events.transitions%rowtype;a gridex_received_sources.object_assessments%rowtype;sc jsonb;entry jsonb;own jsonb;
 patch jsonb:='{}';address jsonb:='{}';fields text[];n text;phase text;version_count integer:=0;last_source uuid;last_version bigint;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT FROM gridex_customer_life_events.customer_versions WHERE company_id=p_company_id AND customer_id=p_customer_id) THEN RETURN jsonb_build_object('status','not_applicable');END IF;
 phase:=CASE WHEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read'),false) THEN 'read' WHEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) THEN 'prepare' ELSE 'send' END;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,phase);
 IF NOT EXISTS(SELECT FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'customer_life_event_projection_tenant_scope_required';END IF;
 FOR v IN SELECT * FROM gridex_customer_life_events.customer_versions WHERE company_id=p_company_id AND customer_id=p_customer_id AND effective_at<=clock_timestamp() ORDER BY effective_at,version LOOP
  SELECT * INTO tr FROM gridex_customer_life_events.transitions WHERE source_message_id=v.source_message_id AND company_id=p_company_id;
  IF (SELECT count(*) FROM gridex_received_sources.object_assessments oa WHERE oa.source_message_id=v.source_message_id AND oa.company_id=p_company_id AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=oa.id))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_primary_customer_event_owner']);END IF;
  SELECT oa.* INTO a FROM gridex_received_sources.object_assessments oa JOIN gridex_received_sources.object_availability_witnesses aw ON aw.assessment_id=oa.id AND aw.company_id=oa.company_id AND aw.environment=oa.environment AND aw.source_message_id=oa.source_message_id AND aw.facts_hash=oa.facts_hash
   WHERE oa.source_message_id=v.source_message_id AND oa.company_id=p_company_id AND oa.source_payload_hash=tr.payload_hash AND oa.facts_hash=encode(sha256(convert_to(oa.facts_text,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=oa.id);
  IF a.id IS NULL OR jsonb_typeof(a.facts_text::jsonb->'objects') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['committed_primary_customer_event_availability']);END IF;
  FOR sc IN SELECT value FROM jsonb_array_elements(tr.approved_scope) WHERE value->>'customerId'=p_customer_id::text LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(a.facts_text::jsonb->'objects') obj WHERE obj#>>'{object,objectId}'=sc->>'pointId' AND obj#>>'{object,identityAgency}'=sc->>'identityAgency')<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['whole_customer_event_primary_scope']);END IF;
   SELECT obj INTO entry FROM jsonb_array_elements(a.facts_text::jsonb->'objects') obj WHERE obj#>>'{object,objectId}'=sc->>'pointId' AND obj#>>'{object,identityAgency}'=sc->>'identityAgency';
   IF entry->>'disposition' IS DISTINCT FROM 'accepted' OR gridex_customer_life_events.owner_proof_consistent_v1(entry->'party',entry->'business',v.source_message_id) IS DISTINCT FROM true THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_qualified_customer_event_projection']);END IF;
  END LOOP;
  SELECT scope INTO sc FROM jsonb_array_elements(tr.approved_scope) scope WHERE scope->>'customerId'=p_customer_id::text LIMIT 1;
  SELECT obj INTO own FROM jsonb_array_elements(tr.source_objects) obj WHERE obj->>'point'=sc->>'pointId' AND obj->>'identityAgency'=sc->>'identityAgency';
  SELECT array_agg(f) INTO fields FROM jsonb_array_elements_text(sc->'allowedFields') f;
  IF '228'=ANY(fields) AND jsonb_typeof(own->'name')='array' THEN SELECT string_agg(part,' ' ORDER BY ord) INTO n FROM jsonb_array_elements_text(own->'name') WITH ORDINALITY x(part,ord);patch:=patch||jsonb_build_object('name',n,'full_name',n);IF own#>>'{customerParty,1}'='SE1' THEN patch:=patch||jsonb_build_object('company_name',n);END IF;address:=address||jsonb_build_object('name',own->'name');END IF;
  IF '227'=ANY(fields) THEN patch:=patch||jsonb_build_object(CASE own#>>'{customerParty,1}' WHEN 'SE1' THEN 'org_number' ELSE 'personal_number' END,own#>>'{customerParty,0}');END IF;
  IF '229'=ANY(fields) AND jsonb_typeof(own->'street')='array' THEN address:=address||jsonb_build_object('street',own->'street');END IF;
  IF '231'=ANY(fields) AND own->>'postCode' IS NOT NULL THEN address:=address||jsonb_build_object('postCode',own->>'postCode');END IF;
  IF '232'=ANY(fields) AND own->>'city' IS NOT NULL THEN address:=address||jsonb_build_object('city',own->>'city');END IF;
  IF '316'=ANY(fields) AND own->>'country' IS NOT NULL THEN address:=address||jsonb_build_object('country',own->>'country');END IF;
  version_count:=version_count+1;last_source:=v.source_message_id;last_version:=v.version;
 END LOOP;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'customerId',p_customer_id,'sourceMessageId',last_source,'customerVersion',last_version,'effectiveVersionCount',version_count,'customerFields',patch,'endUserMasterdata',address);
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_life_event_export_projection_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_export_projection_v1(uuid,uuid,uuid) TO service_role;

-- Same primary assessment ledger, with an explicit source-specific business
-- proof branch. Existing Z04/structure/closure owners retain their exact checks.
DO $$DECLARE body text;old text;new text;BEGIN
 SELECT pg_get_functiondef('gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text)'::regprocedure) INTO body;
 old:=$old$IF entry->>'disposition'='accepted' THEN
   IF register_fact$old$;
 new:=$new$IF entry->>'disposition'='accepted' THEN
   IF business->>'owner'='inbound-customer-life-event-v1' THEN
    IF register_fact->>'disposition' IS DISTINCT FROM 'accepted' OR original->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR original->>'applicationDecision' IS DISTINCT FROM 'accepted' OR original->>'functionalDecision' IS DISTINCT FROM 'accepted' OR business->'version' IS DISTINCT FROM '1'::jsonb OR party->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'source_object_customer_event_acceptance_unproven' USING ERRCODE='23514';END IF;
    SELECT pg_current_snapshot()::text,gridex_customer_life_events.owner_proof_consistent_v1(party,business,src.source_message_id) INTO snapshot_text,valid_owners;
   ELSE
   IF register_fact$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'customer_life_event_primary_owner_contract_changed';END IF;body:=replace(body,old,new);
 old:=$old$   IF valid_owners IS DISTINCT FROM true THEN RAISE EXCEPTION 'source_object_owner_snapshot_changed'$old$;
 new:=$new$   END IF;
   IF valid_owners IS DISTINCT FROM true THEN RAISE EXCEPTION 'source_object_owner_snapshot_changed'$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'customer_life_event_primary_owner_contract_changed';END IF;EXECUTE replace(body,old,new);
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_life_event_committed_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_committed_source_v1(uuid,uuid,uuid) TO service_role;

DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_customer_life_events' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_customer_life_event_source_v1(jsonb),public.ediel_customer_life_event_source_v1(uuid,uuid,uuid),public.ediel_reserve_customer_life_event_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_customer_life_event_message_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_source_v1(uuid,uuid,uuid),public.ediel_reserve_customer_life_event_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_customer_life_event_message_basis_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
