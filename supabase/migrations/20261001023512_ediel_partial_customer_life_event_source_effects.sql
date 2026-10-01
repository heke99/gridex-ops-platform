-- SAME canonical own application + source-specific actual customer effects.
-- Rejected/held physical objects remain in a complete immutable partition.
BEGIN;
-- Independent classified original/decision support remains unseeded. A legal
-- DSO sender and a literal E34/Z41 alone never classify a customer as deceased.
CREATE TABLE gridex_customer_life_events.inbound_classifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),source_payload_hash text NOT NULL CHECK(source_payload_hash~'^[a-f0-9]{64}$'),classification text NOT NULL CHECK(classification IN('death','bankruptcy','other_masterdata')),approved_scope jsonb NOT NULL CHECK(jsonb_typeof(approved_scope)='array' AND jsonb_array_length(approved_scope)>0),allowed_customer_fields text[] NOT NULL CHECK(allowed_customer_fields<@ARRAY['227','228','229','231','232','310','316']::text[]),source_reference text NOT NULL CHECK(length(btrim(source_reference))>0),source_version text NOT NULL CHECK(length(btrim(source_version))>0),source_original bytea NOT NULL CHECK(octet_length(source_original) BETWEEN 1 AND 10485760),source_sha256 text NOT NULL CHECK(source_sha256=encode(sha256(source_original),'hex')),classification_original bytea NOT NULL CHECK(octet_length(classification_original) BETWEEN 1 AND 10485760),classification_sha256 text NOT NULL CHECK(classification_sha256=encode(sha256(classification_original),'hex')),owner_decision_reference text NOT NULL CHECK(length(btrim(owner_decision_reference))>0),approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,source_message_id,source_reference,source_version));
CREATE TABLE gridex_customer_life_events.classification_revocations(classification_id uuid PRIMARY KEY REFERENCES gridex_customer_life_events.inbound_classifications(id),source_reference text NOT NULL CHECK(length(btrim(source_reference))>0),source_original bytea NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256=encode(sha256(source_original),'hex')),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['inbound_classifications','classification_revocations'] LOOP
 EXECUTE format('ALTER TABLE gridex_customer_life_events.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_customer_life_events.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_customer_life_events.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER customer_event_classification_immutable BEFORE UPDATE OR DELETE ON gridex_customer_life_events.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);EXECUTE format('CREATE TRIGGER customer_event_classification_no_truncate BEFORE TRUNCATE ON gridex_customer_life_events.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
END LOOP;END$$;
CREATE FUNCTION gridex_customer_life_events.classification_scope_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE source uuid;BEGIN
 IF TG_TABLE_NAME='classification_revocations' THEN SELECT source_message_id INTO source FROM gridex_customer_life_events.inbound_classifications WHERE id=NEW.classification_id;ELSE source:=NEW.source_message_id;END IF;
 PERFORM id FROM public.ediel_messages WHERE id=source FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_event_classification_source_required';END IF;RETURN NEW;END$$;
CREATE TRIGGER customer_event_classification_scope BEFORE INSERT ON gridex_customer_life_events.inbound_classifications FOR EACH ROW EXECUTE FUNCTION gridex_customer_life_events.classification_scope_v1();
CREATE TRIGGER customer_event_classification_revocation_scope BEFORE INSERT ON gridex_customer_life_events.classification_revocations FOR EACH ROW EXECUTE FUNCTION gridex_customer_life_events.classification_scope_v1();
CREATE TABLE gridex_customer_life_events.inbound_context_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),payload_hash text NOT NULL,context_facts jsonb NOT NULL,context_facts_hash text NOT NULL CHECK(context_facts_hash=encode(sha256(convert_to(context_facts::text,'UTF8')),'hex')),actor_user_id uuid NOT NULL REFERENCES auth.users(id),recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,source_message_id,payload_hash,context_facts_hash));
ALTER TABLE gridex_customer_life_events.inbound_context_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_customer_life_events.inbound_context_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_customer_life_events.inbound_context_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER customer_event_context_immutable BEFORE UPDATE OR DELETE ON gridex_customer_life_events.inbound_context_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER customer_event_context_no_truncate BEFORE TRUNCATE ON gridex_customer_life_events.inbound_context_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TABLE gridex_customer_life_events.partition_receipts(source_message_id uuid PRIMARY KEY REFERENCES gridex_customer_life_events.transitions(source_message_id),company_id uuid NOT NULL,environment text NOT NULL,payload_hash text NOT NULL,canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_customer_life_events.partition_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_customer_life_events.partition_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_customer_life_events.partition_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER customer_event_partition_immutable BEFORE UPDATE OR DELETE ON gridex_customer_life_events.partition_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER customer_event_partition_no_truncate BEFORE TRUNCATE ON gridex_customer_life_events.partition_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_customer_life_events.wire_partition_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE w jsonb:='{}';tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);t jsonb;e jsonb;obj jsonb;objects jsonb:='[]';characteristic text;common boolean:=false;seen text[]:=ARRAY[]::text[];key text;physical jsonb:='[]';minute text;instant timestamptz;first_fragment jsonb;field text;BEGIN
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM')<>1 THEN RETURN NULL;END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x LOOP
  IF t->>'tag'='UNH' THEN w:=w||jsonb_build_object('family',t#>>'{elements,2,0}','unh',t#>>'{elements,1,0}');END IF;
  IF t->>'tag'='BGM' THEN w:=w||jsonb_build_object('code',t#>>'{elements,1,0}');END IF;
  EXIT WHEN t->>'tag'='LIN';
  IF t->>'tag'='NAD' AND t#>>'{elements,1,0}' IN('FR','DO') THEN field:=CASE t#>>'{elements,1,0}' WHEN 'FR' THEN 'legalSender' ELSE 'legalReceiver' END;IF w ? field THEN RETURN NULL;END IF;w:=w||jsonb_build_object(field,t#>>'{elements,2,0}');END IF;
 END LOOP;
 IF w->>'family' IS DISTINCT FROM 'PRODAT' OR (w->>'code' IN('Z06','Z09')) IS NOT TRUE THEN RETURN NULL;END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(tokens) ORDER BY (value->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='LIN' THEN
   IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
   obj:=jsonb_build_object('point',e#>>'{3,0}','identityAgency',e#>>'{3,3}','line',e#>>'{1,0}','firstLineIndex',t->'index','lineIndexes',jsonb_build_array(t->'index'),'body','[]'::jsonb);characteristic:=NULL;common:=true;
  ELSIF obj IS NOT NULL AND t->>'tag' NOT IN('UNT','UNZ') THEN
   obj:=jsonb_set(obj,'{body}',obj->'body'||jsonb_build_array(t-'index'-'raw'));
   IF t->>'tag' IN('RFF','NAD','DTM') THEN common:=false;END IF;
   IF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' AND characteristic='Z13' THEN IF obj ? 'reason' THEN obj:=obj||'{"projectionHeld":true}';END IF;obj:=obj||jsonb_build_object('reason',e#>>'{1,0}');
   ELSIF t->>'tag'='CAV' AND characteristic='Z17' AND common THEN IF obj ? 'customerStatus' THEN obj:=obj||'{"projectionHeld":true}';END IF;obj:=obj||jsonb_build_object('customerStatus',e#>>'{1,0}');
   ELSIF t->>'tag'='RFF' AND e#>>'{1,0}' IN('LI','Z05') THEN
    IF obj ? (CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' ELSE 'gridArea' END) THEN obj:=obj||'{"projectionHeld":true}';END IF;
    obj:=obj||jsonb_build_object(CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' ELSE 'gridArea' END,e#>>'{1,1}');
   ELSIF t->>'tag'='DTM' AND e#>>'{1,0}'='157' THEN
    IF obj ? 'effectiveAt' OR e#>>'{1,2}' IS DISTINCT FROM '203' THEN obj:=obj||'{"projectionHeld":true}';CONTINUE;END IF;
    minute:=e#>>'{1,1}';IF minute IS NULL OR minute !~ '^[0-9]{12}$' THEN obj:=obj||'{"projectionHeld":true}';CONTINUE;END IF;
    -- 216 is a physical EDIFACT minute; national P time is fixed UTC+1.
    -- No DATE, receipt clock or local midnight is substituted for it.
    BEGIN instant:=make_timestamp(substring(minute,1,4)::int,substring(minute,5,2)::int,substring(minute,7,2)::int,substring(minute,9,2)::int,substring(minute,11,2)::int,0) AT TIME ZONE 'Etc/GMT-1';
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN obj:=obj||'{"projectionHeld":true}';CONTINUE;END;
    obj:=obj||jsonb_build_object('effectiveAt',instant,'validityMinute',minute);
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN
    IF obj ? 'customerParty' THEN obj:=obj||'{"projectionHeld":true}';END IF;
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
    IF obj ? field AND obj->field IS DISTINCT FROM first_fragment->field THEN first_fragment:=first_fragment||'{"projectionHeld":true}';END IF;
   END LOOP;
   first_fragment:=first_fragment||jsonb_build_object('lineIndexes',first_fragment->'lineIndexes'||obj->'lineIndexes','body',first_fragment->'body'||obj->'body');
   IF obj->>'projectionHeld'='true' THEN first_fragment:=first_fragment||'{"projectionHeld":true}';END IF;
   SELECT jsonb_agg(CASE WHEN item->>'firstLineIndex'=first_fragment->>'firstLineIndex' THEN first_fragment ELSE item END ORDER BY ord) INTO physical FROM jsonb_array_elements(physical) WITH ORDINALITY x(item,ord);
  ELSE seen:=array_append(seen,key);physical:=physical||jsonb_build_array(obj);END IF;
 END LOOP;objects:=physical;
 IF jsonb_array_length(objects)=0 THEN RETURN NULL;END IF;
 RETURN w||jsonb_build_object('objects',objects);
END $$;
CREATE OR REPLACE FUNCTION gridex_customer_life_events.wire_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE w jsonb:=gridex_customer_life_events.wire_partition_v1(raw);BEGIN
 IF w IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(w->'objects')x WHERE x->>'projectionHeld'='true' OR x->>'reason' IS DISTINCT FROM 'E34' OR nullif(x->>'point','') IS NULL OR(x->>'identityAgency' IN('9','89')) IS NOT TRUE OR nullif(x->>'li','') IS NULL OR x->>'effectiveAt' IS NULL OR(x#>>'{customerParty,1}' IN('SE1','SE2')) IS NOT TRUE OR x#>>'{customerParty,2}' IS DISTINCT FROM '260') THEN RETURN NULL;END IF;RETURN w;END$$;
CREATE OR REPLACE FUNCTION gridex_customer_life_events.inbound_basis_v1(c uuid,mid uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;g gridex_customer_life_events.inbound_grounds%rowtype;ba public.tenant_bilateral_agreements%rowtype;
 classification_record gridex_customer_life_events.inbound_classifications%rowtype;classification_scope jsonb;local_legal jsonb;wire jsonb;own jsonb;scope jsonb;basis jsonb;scopes jsonb:='[]';facts jsonb:='[]';plans jsonb:='[]';ids uuid[];periods uuid[];period_manifest jsonb;classes text[]:=ARRAY[]::text[];
 held_objects jsonb:='[]';missing text;point public.metering_points%rowtype;period public.customer_supply_periods%rowtype;kind text;fields text[];matches uuid[];
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06' THEN RETURN NULL;END IF;
 wire:=gridex_customer_life_events.wire_partition_v1(m.raw_payload);
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
  UNION SELECT proof.source_message_id FROM gridex_received_sources.normal_switch_confirmations proof WHERE proof.company_id=c AND proof.period_id=ANY(periods)
  UNION SELECT proof.original_message_id FROM gridex_received_sources.normal_switch_confirmations proof WHERE proof.company_id=c AND proof.period_id=ANY(periods)
 ) sources;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=c AND z.id=ANY(ids) ORDER BY z.id FOR UPDATE;
 PERFORM p.id FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(periods) ORDER BY p.id FOR SHARE;
 IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.customer_supply_periods p WHERE p.company_id=c AND p.id=ANY(periods)) IS DISTINCT FROM period_manifest THEN RAISE EXCEPTION 'customer_life_event_source_discovery_changed' USING ERRCODE='40001';END IF;
 FOR own IN SELECT value FROM jsonb_array_elements(wire->'objects') ORDER BY value->>'point' LOOP
  IF own->>'projectionHeld'='true' OR own->>'reason' IS DISTINCT FROM 'E34' OR nullif(own->>'point','') IS NULL OR(own->>'identityAgency' IN('9','89')) IS NOT TRUE OR nullif(own->>'li','') IS NULL OR own->>'effectiveAt' IS NULL OR(own#>>'{customerParty,1}' IN('SE1','SE2')) IS NOT TRUE OR own#>>'{customerParty,2}' IS DISTINCT FROM '260' THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['own_complete_customer_event_projection']));CONTINUE;END IF;
  matches:=ARRAY[]::uuid[];
  FOR period IN SELECT p.* FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=c WHERE p.company_id=c AND p.id=ANY(periods) AND coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,''))=own->>'point' AND mp.grid_area_code=own->>'gridArea' ORDER BY p.id LOOP
   basis:=gridex_received_sources.supply_period_source_at_v1(c,period.id,(own->>'effectiveAt')::timestamptz);
   IF basis->>'qualified'='true' AND basis->>'legalActorId'=local_legal->>'legalActorId' AND basis->>'dsoEdielId'=wire->>'legalSender' AND EXISTS(SELECT FROM jsonb_array_elements(basis->'sourceObjects') o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'gridArea'=own->>'gridArea') THEN matches:=array_append(matches,period.id);END IF;
  END LOOP;
  IF cardinality(matches)<>1 THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['unique_current_owned_source_period']));CONTINUE;END IF;
  basis:=gridex_received_sources.supply_period_source_at_v1(c,matches[1],(own->>'effectiveAt')::timestamptz);
  scope:=NULL;classification_scope:=NULL;classification_record:=NULL;
  IF (SELECT count(*) FROM gridex_customer_life_events.inbound_classifications q WHERE q.company_id=c AND q.source_message_id=mid AND q.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND q.approved_at<=statement_timestamp() AND NOT EXISTS(SELECT FROM gridex_customer_life_events.classification_revocations r WHERE r.classification_id=q.id) AND EXISTS(SELECT FROM jsonb_array_elements(q.approved_scope)sc WHERE sc->>'pointId'=own->>'point' AND sc->>'identityAgency'=own->>'identityAgency'))<>1 THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['independent_original_customer_event_classification']));CONTINUE;END IF;
  SELECT q.* INTO classification_record FROM gridex_customer_life_events.inbound_classifications q WHERE q.company_id=c AND q.source_message_id=mid AND q.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND q.approved_at<=statement_timestamp() AND NOT EXISTS(SELECT FROM gridex_customer_life_events.classification_revocations r WHERE r.classification_id=q.id) AND EXISTS(SELECT FROM jsonb_array_elements(q.approved_scope)sc WHERE sc->>'pointId'=own->>'point' AND sc->>'identityAgency'=own->>'identityAgency') FOR SHARE;
  IF (SELECT count(*) FROM jsonb_array_elements(classification_record.approved_scope)sc WHERE sc->>'pointId'=own->>'point' AND sc->>'identityAgency'=own->>'identityAgency')<>1 THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['unique_independent_classified_object_scope']));CONTINUE;END IF;
  SELECT sc INTO classification_scope FROM jsonb_array_elements(classification_record.approved_scope)sc WHERE sc->>'pointId'=own->>'point' AND sc->>'identityAgency'=own->>'identityAgency';
  IF classification_scope->>'customerId' IS DISTINCT FROM basis->>'customerId' OR classification_scope->>'siteId' IS DISTINCT FROM basis->>'siteId' OR classification_scope->>'meteringPointId' IS DISTINCT FROM basis->>'meteringPointId' OR classification_scope->>'periodId' IS DISTINCT FROM basis->>'periodId' OR classification_scope->>'sourceMessageId' IS DISTINCT FROM basis->>'sourceMessageId' OR classification_scope->>'sourcePayloadHash' IS DISTINCT FROM basis->>'payloadHash' OR classification_scope->>'marketStateVersion' IS DISTINCT FROM basis->>'marketStateVersion' OR classification_scope->>'effectiveAt' IS DISTINCT FROM own->>'effectiveAt' OR classification_scope->>'lineItemReference' IS DISTINCT FROM own->>'li' THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['independent_classification_same_owned_source_tuple']));CONTINUE;END IF;
  IF g.source_message_id IS NOT NULL THEN
   IF (SELECT count(*) FROM jsonb_array_elements(g.approved_scope) approved WHERE approved->>'pointId'=own->>'point' AND approved->>'identityAgency'=own->>'identityAgency')<>1 THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['own_bilateral_source_scope']));CONTINUE;END IF;
   SELECT approved INTO scope FROM jsonb_array_elements(g.approved_scope) approved WHERE approved->>'pointId'=own->>'point' AND approved->>'identityAgency'=own->>'identityAgency';
   IF scope->>'periodId' IS DISTINCT FROM basis->>'periodId' OR scope->>'customerId' IS DISTINCT FROM basis->>'customerId' OR scope->>'siteId' IS DISTINCT FROM basis->>'siteId' OR scope->>'meteringPointId' IS DISTINCT FROM basis->>'meteringPointId' OR scope->>'sourceMessageId' IS DISTINCT FROM basis->>'sourceMessageId' OR scope->>'sourcePayloadHash' IS DISTINCT FROM basis->>'payloadHash' OR scope->>'marketStateVersion' IS DISTINCT FROM basis->>'marketStateVersion' THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['own_bilateral_period_version']));CONTINUE;END IF;
   kind:=coalesce(scope->>'classification',g.classification);fields:=g.allowed_customer_fields;
   IF kind IS DISTINCT FROM classification_record.classification OR NOT(fields<@classification_record.allowed_customer_fields) THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['same_independent_bilateral_classification']));CONTINUE;END IF;
  ELSE kind:=classification_record.classification;fields:=classification_record.allowed_customer_fields;
   IF kind IS DISTINCT FROM 'death' OR NOT(fields<@ARRAY['228','229','231','232','310','316']::text[]) THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['separate_bilateral_non_death_ground']));CONTINUE;END IF;
  END IF;
  IF (kind IN('death','bankruptcy','other_masterdata')) IS NOT TRUE THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['independent_event_classification']));CONTINUE;END IF;
  IF NOT('227'=ANY(fields)) AND NOT EXISTS(SELECT FROM jsonb_array_elements(basis->'sourceObjects') o WHERE o->>'customerIdentity'=own#>>'{customerParty,0}') OR '227'=ANY(fields) AND (scope->>'targetCustomerIdentity' IS DISTINCT FROM own#>>'{customerParty,0}' OR scope->>'targetCustomerQualifier' IS DISTINCT FROM own#>>'{customerParty,1}') THEN held_objects:=held_objects||jsonb_build_array(jsonb_build_object('object',own,'missing',ARRAY['owned_end_user_identity']));CONTINUE;END IF;
  scope:=jsonb_build_object('periodId',basis->>'periodId','customerId',basis->>'customerId','siteId',basis->>'siteId','meteringPointId',basis->>'meteringPointId','pointId',own->>'point','identityAgency',own->>'identityAgency','gridArea',own->>'gridArea','sourceMessageId',basis->>'sourceMessageId','sourcePayloadHash',basis->>'payloadHash','marketStateVersion',basis->>'marketStateVersion','classification',kind,'classificationRecordId',classification_record.id,'classificationSourceHash',classification_record.classification_sha256,'allowedFields',to_jsonb(fields),'effectiveAt',own->>'effectiveAt');
  scopes:=scopes||jsonb_build_array(scope);plans:=plans||jsonb_build_array(jsonb_build_object('scope',scope,'object',own));classes:=array_append(classes,kind);
  facts:=facts||jsonb_build_array(jsonb_build_object('objectKey',scope->>'meteringPointId','installation',jsonb_build_object('id',own->>'point','agency',own->>'identityAgency'),
   'customer',jsonb_build_object('kind','domain_customer','key',scope->>'customerId','revision',scope->>'marketStateVersion','id',own#>>'{customerParty,0}','qualifier',own#>>'{customerParty,1}','agency',own#>>'{customerParty,2}'),
   'legalSupplier',jsonb_build_object('id',wire->>'legalReceiver','qualifier','160','agency','SVK'),'legalGridOwner',jsonb_build_object('id',wire->>'legalSender','qualifier','160','agency','SVK'),'process',jsonb_build_object('code','Z06','reason','E34'),
   'event',jsonb_build_object('key',m.id,'eventKey',m.id,'revision',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'reference',m.id),
   'assessment',jsonb_build_object('kind','known','value',CASE kind WHEN 'death' THEN 'death' ELSE 'not_death' END,'evidence',jsonb_build_object('key',coalesce(g.source_message_id,m.id),'eventKey',m.id,'revision',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'reference',classification_record.owner_decision_reference)),'lineItemReference',own->>'li'));
 END LOOP;
 IF jsonb_array_length(plans)=0 THEN RETURN jsonb_build_object('status','held','companyId',c,'environment',m.environment,'messageId',m.id,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'rawPayload',m.raw_payload,'heldObjects',held_objects,'missing',ARRAY['source_qualified_customer_event_object']);END IF;
 RETURN jsonb_build_object('status','authorized','companyId',c,'environment',m.environment,'messageId',m.id,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'rawPayload',m.raw_payload,'legalContext',local_legal,'classification',CASE WHEN (SELECT count(DISTINCT x) FROM unnest(classes) x)=1 THEN classes[1] ELSE 'other_masterdata' END,'bilateralCapabilityVerified',g.source_message_id IS NOT NULL,'scopes',scopes,'plans',plans,'physicalObjects',wire->'objects','heldObjects',held_objects,'selection',jsonb_build_object('source',jsonb_build_object('kind','caller_selection','reference',coalesce(g.source_reference,m.id::text)),'objects',facts));
END$$;
-- This receipt captures genuine source/function facts for the SAME subsequent
-- canonical invocation. It grants no business mutation or application result.
CREATE OR REPLACE FUNCTION public.ediel_customer_life_event_inbound_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;r gridex_customer_life_events.inbound_context_receipts%rowtype;digest text;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 b:=gridex_customer_life_events.inbound_basis_v1(p_company_id,p_message_id,p_actor_user_id);IF b IS NULL OR b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 digest:=encode(sha256(convert_to(b::text,'UTF8')),'hex');
 INSERT INTO gridex_customer_life_events.inbound_context_receipts(company_id,environment,source_message_id,payload_hash,context_facts,context_facts_hash,actor_user_id) VALUES(p_company_id,b->>'environment',p_message_id,b->>'sourcePayloadHash',b,digest,p_actor_user_id) ON CONFLICT DO NOTHING RETURNING * INTO r;
 IF r.id IS NULL THEN SELECT * INTO STRICT r FROM gridex_customer_life_events.inbound_context_receipts WHERE company_id=p_company_id AND source_message_id=p_message_id AND payload_hash=b->>'sourcePayloadHash' AND context_facts_hash=digest;END IF;
 RETURN b||jsonb_build_object('sourceContextReceiptId',r.id,'sourceContextFactsHash',digest);
END$$;
CREATE FUNCTION gridex_customer_life_events.inbound_context_object_is_qualified_v1(c uuid,source_id uuid,receipt_id uuid,object_scope jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_customer_life_events.inbound_context_receipts%rowtype;m public.ediel_messages%rowtype;own jsonb;BEGIN
 SELECT * INTO r FROM gridex_customer_life_events.inbound_context_receipts WHERE id=receipt_id AND company_id=c AND source_message_id=source_id;
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c;
 IF r.id IS NULL OR m.id IS NULL OR r.environment IS DISTINCT FROM m.environment OR r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR r.context_facts_hash IS DISTINCT FROM encode(sha256(convert_to(r.context_facts::text,'UTF8')),'hex') OR r.context_facts->>'rawPayload' IS DISTINCT FROM m.raw_payload OR r.context_facts#>>'{legalContext,actorRole}' IS DISTINCT FROM 'electricity_supplier' OR r.context_facts#>>'{legalContext,legalEdielId}' IS DISTINCT FROM gridex_customer_life_events.wire_partition_v1(m.raw_payload)->>'legalReceiver' OR object_scope->>'messageIndex' IS DISTINCT FROM '0' OR object_scope->>'messageReference' IS DISTINCT FROM gridex_customer_life_events.wire_partition_v1(m.raw_payload)->>'unh' THEN RETURN false;END IF;
 SELECT p->'object' INTO own FROM jsonb_array_elements(r.context_facts->'plans')p WHERE p#>>'{object,point}'=object_scope->>'objectId' AND p#>>'{object,identityAgency}'=object_scope->>'identityAgency' AND p#>>'{object,firstLineIndex}'=object_scope#>>'{registers,0,segmentIndex}';
 RETURN own IS NOT NULL AND(SELECT jsonb_agg((reg->>'segmentIndex')::integer ORDER BY(reg->>'segmentIndex')::integer) FROM jsonb_array_elements(object_scope->'registers')reg)=(SELECT jsonb_agg(value ORDER BY(value#>>'{}')::integer) FROM jsonb_array_elements(own->'lineIndexes')value);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END$$;
CREATE OR REPLACE FUNCTION public.ediel_apply_customer_life_event_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;prior gridex_customer_life_events.transitions%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;basis jsonb;plan jsonb;scope jsonb;own jsonb;cust public.customers%rowtype;
 before_state jsonb:='[]';after_state jsonb:='[]';fields text[];customer_ids uuid[];target_customer_id uuid;next_version bigint;task_id uuid;new_metadata jsonb;projection jsonb;new_name text;kind text;application jsonb;function_facet jsonb;context_receipt gridex_customer_life_events.inbound_context_receipts%rowtype;admitted_plan jsonb;entry jsonb;selected jsonb:='[]';manifest jsonb:='[]';objects jsonb;partition gridex_customer_life_events.partition_receipts%rowtype;seen int[]:=ARRAY[]::int[];first_line integer;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'customer_life_event_source_required';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'prepare');
 SELECT * INTO partition FROM gridex_customer_life_events.partition_receipts WHERE source_message_id=m.id;
 IF FOUND THEN IF partition.company_id IS DISTINCT FROM p_company_id OR partition.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'customer_life_event_committed_replay_conflict';END IF;RETURN partition.result||jsonb_build_object('idempotent',true);END IF;
 SELECT * INTO prior FROM gridex_customer_life_events.transitions WHERE source_message_id=m.id;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'customer_life_event_committed_replay_conflict';END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'sourceMessageId',m.id,'sourceObjects',prior.source_objects,'scopes',prior.approved_scope);END IF;
 basis:=gridex_customer_life_events.inbound_basis_v1(p_company_id,m.id,p_actor_user_id);IF basis IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','not_customer_life_event');END IF;
 IF basis->>'status'='held' THEN RETURN jsonb_build_object('applied',false,'reason','customer_life_event_source_held','heldObjects',basis->'heldObjects');END IF;
 PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 IF (SELECT count(*) FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.source_payload_hash=basis->>'sourcePayloadHash' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id))<>1 THEN RAISE EXCEPTION 'customer_life_event_canonical_leaf_required';END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.source_payload_hash=basis->>'sourcePayloadHash' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 application:=gridex_received_sources.require_prodat_application_objects_v1(p_company_id,m.id);
 function_facet:=gridex_received_sources.require_prodat_source_function_objects_v1(p_company_id,m.id);
 SELECT * INTO context_receipt FROM gridex_customer_life_events.inbound_context_receipts WHERE id=(function_facet->>'sourceContextReceiptId')::uuid AND company_id=p_company_id AND source_message_id=m.id;
 IF function_facet->>'assessmentId' IS DISTINCT FROM canonical.id::text OR context_receipt.id IS NULL OR context_receipt.payload_hash IS DISTINCT FROM basis->>'sourcePayloadHash' OR context_receipt.context_facts_hash IS DISTINCT FROM function_facet->>'sourceContextFactsHash' THEN RETURN jsonb_build_object('applied',false,'reason','customer_life_event_same_canonical_function_required');END IF;
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR application->>'assessmentId' IS DISTINCT FROM canonical.id::text OR application->>'headerDecision' IS DISTINCT FROM 'accepted' THEN RETURN jsonb_build_object('applied',false,'reason','customer_life_event_header_not_accepted');END IF;
 -- The exact complete physical partition is the SAME canonical application
 -- facet. Raw object extraction cannot qualify an application or omitted LIN.
 objects:=gridex_customer_life_events.wire_partition_v1(m.raw_payload)->'objects';
 FOR entry IN SELECT item FROM jsonb_array_elements(application->'objects')item LOOP
  first_line:=(entry#>>'{registers,0,segmentIndex}')::integer;
  SELECT item INTO own FROM jsonb_array_elements(objects)item WHERE(item->>'firstLineIndex')::integer=first_line AND item->>'point' IS NOT DISTINCT FROM entry->>'objectId' AND item->>'identityAgency' IS NOT DISTINCT FROM entry->>'identityAgency';
  IF own IS NULL OR (SELECT jsonb_agg((r->>'segmentIndex')::integer ORDER BY(r->>'segmentIndex')::integer) FROM jsonb_array_elements(entry->'registers')r) IS DISTINCT FROM(SELECT jsonb_agg(value ORDER BY(value#>>'{}')::integer) FROM jsonb_array_elements(own->'lineIndexes')value) THEN RAISE EXCEPTION 'customer_life_event_complete_physical_partition_required';END IF;
  seen:=array_append(seen,first_line);
  SELECT p INTO plan FROM jsonb_array_elements(basis->'plans')p WHERE p#>>'{object,firstLineIndex}'=first_line::text;
  SELECT p INTO admitted_plan FROM jsonb_array_elements(context_receipt.context_facts->'plans')p WHERE p#>>'{object,firstLineIndex}'=first_line::text;
  IF entry->>'applicationDecision'='accepted' AND gridex_received_sources.prodat_application_object_accepted_v1(p_company_id,m.id,canonical.id,entry-'applicationDecision'-'reasonCodes') IS TRUE AND plan IS NOT NULL AND admitted_plan IS NOT DISTINCT FROM plan AND gridex_received_sources.prodat_source_function_object_accepted_v1(p_company_id,m.id,canonical.id,entry-'applicationDecision'-'reasonCodes') IS TRUE THEN selected:=selected||jsonb_build_array(plan);manifest:=manifest||jsonb_build_array(jsonb_build_object('object',entry-'applicationDecision'-'reasonCodes','status','eligible'));
  ELSE manifest:=manifest||jsonb_build_array(jsonb_build_object('object',entry-'applicationDecision'-'reasonCodes','status',CASE WHEN entry->>'applicationDecision'='rejected' THEN 'rejected' ELSE 'held' END));END IF;
 END LOOP;
 IF cardinality(seen)<>jsonb_array_length(objects) OR EXISTS(SELECT FROM jsonb_array_elements(objects)item WHERE NOT(item->>'firstLineIndex')::integer=ANY(seen)) THEN RAISE EXCEPTION 'customer_life_event_complete_physical_partition_required';END IF;
 -- A conflicting same-customer/epoch group is held as a group, while an
 -- independent customer remains eligible. No first-object preference.
 SELECT coalesce(jsonb_agg(p),'[]') INTO selected FROM jsonb_array_elements(selected)p WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(selected)x WHERE x#>>'{scope,customerId}'=p#>>'{scope,customerId}' AND jsonb_build_array(x#>'{object,customerParty}',x#>'{object,name}',x#>'{object,street}',x#>'{object,city}',x#>'{object,postCode}',x#>'{object,country}',x#>'{scope,classification}',x#>'{scope,allowedFields}',x#>'{scope,effectiveAt}') IS DISTINCT FROM jsonb_build_array(p#>'{object,customerParty}',p#>'{object,name}',p#>'{object,street}',p#>'{object,city}',p#>'{object,postCode}',p#>'{object,country}',p#>'{scope,classification}',p#>'{scope,allowedFields}',p#>'{scope,effectiveAt}'));
 SELECT jsonb_agg(e||jsonb_build_object('status',CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(selected)p WHERE p#>>'{object,firstLineIndex}'=e#>>'{object,registers,0,segmentIndex}') THEN 'applied' WHEN e->>'status'='eligible' THEN 'held' ELSE e->>'status' END) ORDER BY(e#>>'{object,registers,0,segmentIndex}')::integer) INTO manifest FROM jsonb_array_elements(manifest)e;
 IF jsonb_array_length(selected)=0 THEN RETURN jsonb_build_object('applied',false,'reason','customer_life_event_no_qualified_object','manifest',manifest);END IF;
 SELECT jsonb_agg(p->'scope') INTO scope FROM jsonb_array_elements(selected)p;basis:=basis||jsonb_build_object('plans',selected,'scopes',scope);
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
  IF '227'=ANY(fields) AND (CASE WHEN cust.org_number IS NOT NULL THEN own#>>'{customerParty,1}'='SE1' WHEN cust.personal_number IS NOT NULL THEN own#>>'{customerParty,1}'='SE2' ELSE false END) IS NOT TRUE THEN
   SELECT coalesce(jsonb_agg(p),'[]') INTO selected FROM jsonb_array_elements(selected)p WHERE p#>>'{scope,customerId}'<>target_customer_id::text;
   SELECT jsonb_agg(e||jsonb_build_object('status',CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(basis->'plans')p WHERE p#>>'{scope,customerId}'=target_customer_id::text AND p#>>'{object,firstLineIndex}'=e#>>'{object,registers,0,segmentIndex}') THEN 'held' ELSE e->>'status' END)) INTO manifest FROM jsonb_array_elements(manifest)e;CONTINUE;
  END IF;
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
 IF jsonb_array_length(after_state)=0 THEN RETURN jsonb_build_object('applied',false,'reason','customer_life_event_no_qualified_object','manifest',manifest);END IF;
 SELECT jsonb_agg(p->'scope') INTO scope FROM jsonb_array_elements(selected)p;basis:=basis||jsonb_build_object('plans',selected,'scopes',scope);
 SELECT array_agg((item->>'id')::uuid ORDER BY(item->>'id')::uuid) INTO customer_ids FROM jsonb_array_elements(after_state)item;
 INSERT INTO gridex_customer_life_events.transitions(source_message_id,company_id,payload_hash,classification,previous_customers,resulting_customers,source_objects,approved_scope,legal_context,canonical_assessment_id,actor_user_id,observed_at)
 VALUES(m.id,p_company_id,basis->>'sourcePayloadHash',basis->>'classification',before_state,after_state,gridex_customer_life_events.wire_partition_v1(m.raw_payload)->'objects',basis->'scopes',basis->'legalContext',canonical.id,p_actor_user_id,(basis#>>'{legalContext,observedAt}')::timestamptz);
 FOR cust IN SELECT * FROM jsonb_populate_recordset(NULL::public.customers,after_state) LOOP
  INSERT INTO gridex_customer_life_events.customer_versions(company_id,customer_id,version,source_message_id,previous_customer,resulting_customer,effective_at,observed_at)
  SELECT p_company_id,cust.id,(cust.metadata#>>'{edielCustomerLifeEvent,version}')::bigint,m.id,b,to_jsonb(cust),(cust.metadata#>>'{edielCustomerLifeEvent,effectiveAt}')::timestamptz,(basis#>>'{legalContext,observedAt}')::timestamptz FROM jsonb_array_elements(before_state) b WHERE b->>'id'=cust.id::text;
 END LOOP;
 FOR target_customer_id IN SELECT unnest(customer_ids) LOOP
  INSERT INTO public.customer_operation_tasks(company_id,customer_id,task_type,status,priority,title,description,assigned_to,due_at,metadata,created_by,updated_by)
  VALUES(p_company_id,target_customer_id,'ediel_customer_life_event','open','normal','Bekräftad kundlivshändelse behöver handläggas','Källbunden kundversion och giltighetsdatum har registrerats. Dödsfall och konkurs handläggs separat.',p_actor_user_id,NULL,jsonb_build_object('sourceMessageId',m.id,'ruleId','TM-Z06-E','sourceKind','confirmed_customer_change','informationKnownAt',basis#>>'{legalContext,observedAt}'),p_actor_user_id,p_actor_user_id) RETURNING id INTO task_id;
  INSERT INTO gridex_customer_life_events.tasks(source_message_id,customer_id,operation_task_id,company_id,rule_id,information_known_at,responsible_user_id,source_kind) VALUES(m.id,target_customer_id,task_id,p_company_id,'TM-Z06-E',(basis#>>'{legalContext,observedAt}')::timestamptz,p_actor_user_id,'confirmed_customer_change');
 END LOOP;
 INSERT INTO gridex_customer_life_events.partition_receipts(source_message_id,company_id,environment,payload_hash,canonical_assessment_id,result) VALUES(m.id,p_company_id,m.environment,basis->>'sourcePayloadHash',canonical.id,jsonb_build_object('applied',true,'idempotent',false,'sourceMessageId',m.id,'sourceObjects',gridex_customer_life_events.wire_partition_v1(m.raw_payload)->'objects','scopes',basis->'scopes','manifest',manifest));
 RETURN jsonb_build_object('manifest',manifest,'applied',true,'idempotent',false,'sourceMessageId',m.id,'sourceObjects',gridex_customer_life_events.wire_partition_v1(m.raw_payload)->'objects','scopes',basis->'scopes');
END$$;
CREATE OR REPLACE FUNCTION gridex_customer_life_events.owner_proof_consistent_v1(party jsonb,business jsonb,mid uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  OR tr.legal_context->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR tr.legal_context->>'legalEdielId' IS DISTINCT FROM gridex_customer_life_events.wire_partition_v1(m.raw_payload)->>'legalReceiver'
  OR NOT EXISTS(SELECT FROM gridex_customer_life_events.inbound_classifications q WHERE q.company_id=tr.company_id AND q.source_message_id=mid AND q.id::text=scope->>'classificationRecordId' AND q.classification=scope->>'classification' AND q.classification_sha256=scope->>'classificationSourceHash' AND q.source_payload_hash=tr.payload_hash AND q.recorded_at<=tr.recorded_at)
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_customers) result WHERE result=version_row.resulting_customer) OR NOT EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) own WHERE own->>'point'=scope->>'pointId' AND own->>'identityAgency'=scope->>'identityAgency') THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END$$;
REVOKE ALL ON FUNCTION gridex_customer_life_events.wire_partition_v1(text),gridex_customer_life_events.wire_v1(text),gridex_customer_life_events.inbound_basis_v1(uuid,uuid,uuid),gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_customer_life_events.classification_scope_v1(),gridex_customer_life_events.inbound_context_object_is_qualified_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
