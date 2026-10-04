-- CLI forward. AT-Z06F's reading follow-up is independent of TM-METHOD40.
-- Only actual immutable applied structural owners can produce expectations;
-- only actual accepted/persisted whole UTILTS binding can observe them.
BEGIN;
CREATE SCHEMA gridex_received_reading_expectations;
REVOKE ALL ON SCHEMA gridex_received_reading_expectations FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_received_reading_expectations.expectations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),first_line_index integer NOT NULL,
 contract jsonb NOT NULL,contract_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,environment,source_message_id,first_line_index));
CREATE TABLE gridex_received_reading_expectations.observations(
 expectation_id uuid NOT NULL REFERENCES gridex_received_reading_expectations.expectations(id),company_id uuid NOT NULL,environment text NOT NULL,
 utilts_source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),transaction_id text NOT NULL,source_payload_hash text NOT NULL,
 receipt jsonb NOT NULL,receipt_hash text NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(expectation_id,utilts_source_message_id,transaction_id));
ALTER TABLE gridex_received_reading_expectations.expectations ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_reading_expectations.expectations FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_reading_expectations.observations ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_reading_expectations.observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_reading_expectations.expectations,gridex_received_reading_expectations.observations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_reading_expectations.expectations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_reading_expectations.expectations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_reading_expectations.observations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_reading_expectations.observations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE FUNCTION gridex_received_reading_expectations.source_contracts_v1(c uuid,env text,msg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;s gridex_received_sources.sources%rowtype;a gridex_received_sources.object_assessments%rowtype;f gridex_received_sources.prodat_ignored_field_facets%rowtype;
 own jsonb;assessed jsonb;business jsonb;wire jsonb;qualified jsonb;registers jsonb;expected jsonb;mode text;out jsonb:='[]';first_line integer;
BEGIN
 FOR r IN SELECT payload_hash,canonical_assessment_id,object_assessment_id,source_received_at,applied_at,objects FROM gridex_received_sources.structural_apply_receipts WHERE company_id=c AND environment=env AND source_message_id=msg
 UNION ALL SELECT payload_hash,canonical_assessment_id,object_assessment_id,source_received_at,applied_at,jsonb_build_array(effect) FROM gridex_received_sources.structural_object_apply_receipts WHERE company_id=c AND environment=env AND source_message_id=msg LOOP
  SELECT * INTO s FROM gridex_received_sources.sources WHERE company_id=c AND environment=env AND source_message_id=msg;
  SELECT * INTO a FROM gridex_received_sources.object_assessments WHERE id=r.object_assessment_id AND company_id=c AND environment=env AND source_message_id=msg;
  SELECT * INTO f FROM gridex_received_sources.prodat_ignored_field_facets WHERE canonical_assessment_id=r.canonical_assessment_id AND company_id=c AND environment=env AND source_message_id=msg;
  IF s.source_message_id IS NULL OR a.id IS NULL OR f.canonical_assessment_id IS NULL OR s.payload_hash IS DISTINCT FROM r.payload_hash
   OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') OR a.source_payload_hash IS DISTINCT FROM s.payload_hash
   OR a.canonical_assessment_id IS DISTINCT FROM r.canonical_assessment_id OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex')
   OR NOT EXISTS(SELECT FROM public.ediel_messages original WHERE original.id=msg AND original.company_id=c AND original.environment=env AND original.direction='inbound' AND original.message_family='PRODAT' AND original.message_code='Z06' AND original.raw_payload=s.raw_payload AND original.message_received_at=s.source_received_at)
   OR f.source_payload_hash IS DISTINCT FROM s.payload_hash OR f.fields_hash IS DISTINCT FROM encode(sha256(convert_to(f.fields_text,'UTF8')),'hex') THEN CONTINUE;END IF;
  FOR own IN SELECT value FROM jsonb_array_elements(r.objects) LOOP
   SELECT value INTO assessed FROM jsonb_array_elements(a.facts_text::jsonb->'objects') value WHERE value->'object'=own->'object';
   business:=assessed->'business';wire:=business->'wire';first_line:=(own#>>'{object,registers,0,segmentIndex}')::integer;
   IF assessed->>'disposition' IS DISTINCT FROM 'accepted' OR business->>'owner' IS DISTINCT FROM 'reviewed-received-structure-v1'
    OR wire IS DISTINCT FROM own->'wire' OR wire->>'messageCode' IS DISTINCT FROM 'Z06' OR wire->>'businessCase' IS DISTINCT FROM 'change_with_reading'
    OR business->>'companyId' IS DISTINCT FROM c::text OR business->>'environment' IS DISTINCT FROM env
    OR business->>'meteringPointId' IS DISTINCT FROM own->>'meteringPointId' OR business->>'siteId' IS DISTINCT FROM own->>'siteId'
    OR nullif(business->>'customerId','') IS NULL OR nullif(business->>'supplyPeriodId','') IS NULL OR first_line IS NULL
    OR wire#>>'{effectiveFrom,utc}' IS NULL OR (wire#>>'{effectiveFrom,utc}')::timestamptz IS DISTINCT FROM (own->>'effectiveAt')::timestamptz
    OR gridex_received_sources.structural_effect_matches_v1(c,env,msg,a.id,(business->>'customerId')::uuid,(business->>'siteId')::uuid,(business->>'meteringPointId')::uuid,(business->>'supplyPeriodId')::uuid,own#>>'{object,objectId}',own#>>'{object,identityAgency}',r.applied_at) IS NOT TRUE THEN CONTINUE;END IF;
   SELECT value INTO qualified FROM jsonb_array_elements(gridex_received_sources.applied_structural_method_objects_v1(c,msg)) value
    WHERE value->>'objectId'=own#>>'{object,objectId}' AND value->>'identityAgency'=own#>>'{object,identityAgency}' AND value->>'businessCase'='change_with_reading';
   IF qualified IS NULL OR qualified->>'companyId' IS DISTINCT FROM c::text OR qualified->>'environment' IS DISTINCT FROM env OR qualified->>'sourceMessageId' IS DISTINCT FROM msg::text OR qualified->>'sourcePayloadHash' IS DISTINCT FROM s.payload_hash OR qualified->>'customerId' IS DISTINCT FROM business->>'customerId' OR qualified->>'meteringPointId' IS DISTINCT FROM business->>'meteringPointId'
    OR qualified->>'measurementMethod' IS NULL THEN CONTINUE;END IF;
   -- Original field259 identifies promised meter readings. An ignored physical
   -- value never becomes an expected register. No incoming UTILTS fills gaps.
   registers:=wire->'registers';
   IF EXISTS(SELECT FROM jsonb_array_elements(f.fields_text::jsonb) ignored WHERE ignored->>'fieldNumber' IN('259','224')
    AND ignored#>>'{occurrence,objectId}'=own#>>'{object,objectId}' AND ignored#>>'{occurrence,identityAgency}'=own#>>'{object,identityAgency}') THEN registers:=NULL;END IF;
   SELECT jsonb_agg(value->'registerId' ORDER BY (value->>'position')::int) INTO expected FROM jsonb_array_elements(registers) value;
   mode:=CASE WHEN expected IS NOT NULL AND jsonb_array_length(expected)>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements(expected) value WHERE value='null'::jsonb OR value='""'::jsonb)
      AND (SELECT count(DISTINCT value) FROM jsonb_array_elements(expected))=jsonb_array_length(expected) AND nullif(wire->>'meterNumber','') IS NOT NULL THEN 'meter_reading'
     ELSE 'subsequent_values' END;
   out:=out||jsonb_build_array(jsonb_build_object('version',1,'owner','applied-z06f-reading-followup-v1','companyId',c,'environment',env,'sourceMessageId',msg,
    'sourcePayloadHash',s.payload_hash,'canonicalAssessmentId',r.canonical_assessment_id,'objectAssessmentId',a.id,'objectFactsHash',a.facts_hash,
    'firstLineIndex',first_line,'object',own->'object','wire',wire,'customerId',business->>'customerId','siteId',business->>'siteId','meteringPointId',business->>'meteringPointId',
    'supplyPeriodId',business->>'supplyPeriodId','coverage',business->'coverageWindow','replaces',business->'replaces','measurementMethod',qualified->>'measurementMethod',
    'effectiveAt',own->'effectiveAt','sourceReceivedAt',s.source_received_at,'appliedAt',r.applied_at,'mode',mode,'expectedRegisterIds',expected,
    'deadline',NULL,'automaticRequestAllowed',false));
  END LOOP;
 END LOOP;
 RETURN out;
END$$;
CREATE FUNCTION gridex_received_reading_expectations.capture_source_v1(c uuid,env text,msg uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE item jsonb;h text;prior gridex_received_reading_expectations.expectations%rowtype;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('z06f-reading:'||c::text||':'||env,0));
 FOR item IN SELECT value FROM jsonb_array_elements(gridex_received_reading_expectations.source_contracts_v1(c,env,msg)) LOOP
  h:=encode(sha256(convert_to(item::text,'UTF8')),'hex');
  SELECT * INTO prior FROM gridex_received_reading_expectations.expectations WHERE company_id=c AND environment=env AND source_message_id=msg AND first_line_index=(item->>'firstLineIndex')::int;
  IF FOUND THEN IF prior.contract IS DISTINCT FROM item OR prior.contract_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'z06f_reading_original_conflict';END IF;
  ELSE INSERT INTO gridex_received_reading_expectations.expectations(company_id,environment,source_message_id,first_line_index,contract,contract_hash) VALUES(c,env,msg,(item->>'firstLineIndex')::int,item,h);END IF;
 END LOOP;
END$$;
CREATE FUNCTION gridex_received_reading_expectations.applied_source_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_received_reading_expectations.capture_source_v1(NEW.company_id,NEW.environment,NEW.source_message_id);RETURN NEW;END$$;
CREATE TRIGGER reading_followup_actual_source AFTER INSERT ON gridex_received_sources.structural_apply_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_reading_expectations.applied_source_v1();
CREATE TRIGGER reading_followup_actual_object AFTER INSERT ON gridex_received_sources.structural_object_apply_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_reading_expectations.applied_source_v1();
CREATE FUNCTION gridex_received_reading_expectations.instant_v1(value text,format text,offset_minutes integer) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE v timestamp;BEGIN
 IF (format='102' AND value~'^[0-9]{8}$') THEN v:=make_timestamp(substring(value,1,4)::int,substring(value,5,2)::int,substring(value,7,2)::int,0,0,0);
 ELSIF format IN('203','204') AND value~'^[0-9]{12}([0-9]{2})?$' AND length(value)=(CASE format WHEN '203' THEN 12 ELSE 14 END) THEN
 v:=make_timestamp(substring(value,1,4)::int,substring(value,5,2)::int,substring(value,7,2)::int,substring(value,9,2)::int,substring(value,11,2)::int,CASE format WHEN '204' THEN substring(value,13,2)::int ELSE 0 END);
 ELSE RETURN NULL;END IF;RETURN(v-make_interval(mins=>offset_minutes)) AT TIME ZONE 'UTC';EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;END$$;
CREATE FUNCTION gridex_received_reading_expectations.consider_utilts_source_v1(c uuid,env text,msg uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;prior_source uuid;tokens jsonb;membership jsonb;tx text;stored jsonb;start_at int;stop_at int;first_seq int;zone jsonb;offset_minutes int;
 header jsonb;sender text;receiver text;point text;agency text;reading jsonb;sequence record;own jsonb;register_id text;meter_id text;previous_register text;current_meter text;at timestamptz;dates jsonb;qty jsonb;
 e gridex_received_reading_expectations.expectations%rowtype;candidate_ids uuid[];receipt jsonb;matched bool;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM pg_advisory_xact_lock(hashtextextended('z06f-reading:'||c::text||':'||env,0));
 SELECT * INTO m FROM public.ediel_messages WHERE id=msg AND company_id=c AND environment=env FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'UTILTS' OR(m.message_code IN('E30','E66','S07')) IS NOT TRUE THEN RETURN;END IF;
 SELECT r.membership INTO membership FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=msg AND r.company_id=c AND r.environment=env;
 IF jsonb_typeof(membership) IS DISTINCT FROM 'array' THEN RETURN;END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);IF tokens IS NULL THEN RETURN;END IF;
 -- Whole binding is checked independently for EACH actual accepted member;
 -- a legitimate reused immutable origin series remains legitimate.
 FOR tx IN SELECT value FROM jsonb_array_elements_text(membership) LOOP
  BEGIN stored:=gridex_utilts_binding.stored_contract_v1(c,msg,tx);EXCEPTION WHEN SQLSTATE 'P0U01' THEN CONTINUE;END;
  IF stored->>'companyId' IS DISTINCT FROM c::text OR stored->>'environment' IS DISTINCT FROM env OR stored->>'transactionId' IS DISTINCT FROM tx THEN CONTINUE;END IF;
  SELECT(t->>'index')::int INTO STRICT start_at FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='IDE' AND t#>>'{elements,1,0}'='24' AND t#>>'{elements,2,0}'=tx;
  SELECT min((t->>'index')::int) INTO stop_at FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::int>start_at AND t->>'tag' IN('IDE','UNT');
  SELECT coalesce(min((t->>'index')::int),stop_at) INTO first_seq FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='SEQ' AND(t->>'index')::int>start_at AND(t->>'index')::int<stop_at;
  SELECT jsonb_agg(t ORDER BY(t->>'index')::int) INTO header FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::int>start_at AND(t->>'index')::int<first_seq;
  IF(SELECT count(*) FROM jsonb_array_elements(header)t WHERE t->>'tag'='LOC' AND t#>>'{elements,1,0}'='172')<>1 THEN CONTINUE;END IF;
  SELECT t#>>'{elements,2,0}',t#>>'{elements,2,2}' INTO point,agency FROM jsonb_array_elements(header)t WHERE t->>'tag'='LOC' AND t#>>'{elements,1,0}'='172';
  IF(agency IN('9','89')) IS NOT TRUE THEN CONTINUE;END IF;
  SELECT jsonb_agg(t) INTO zone FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='DTM' AND(t->>'index')::int<start_at AND t#>>'{elements,1,0}'='735';
  IF jsonb_array_length(zone) IS DISTINCT FROM 1 OR zone#>>'{0,elements,1,2}' IS DISTINCT FROM '406' OR zone#>>'{0,elements,1,1}'!~'^[+-][0-9]{4}$' THEN CONTINUE;END IF;
  IF substring(zone#>>'{0,elements,1,1}',2,2)::int>14 OR substring(zone#>>'{0,elements,1,1}',4,2)::int>59 THEN CONTINUE;END IF;
  offset_minutes:=(substring(zone#>>'{0,elements,1,1}',2,2)::int*60+substring(zone#>>'{0,elements,1,1}',4,2)::int)*CASE left(zone#>>'{0,elements,1,1}',1) WHEN '-' THEN -1 ELSE 1 END;
  IF abs(offset_minutes)>840 THEN CONTINUE;END IF;
  sender:=NULL;receiver:=NULL;
  IF(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS' AND(t->>'index')::int<start_at)<>1 OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MR' AND(t->>'index')::int<start_at)<>1 THEN CONTINUE;END IF;
  SELECT t#>>'{elements,2,0}' INTO sender FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS' AND(t->>'index')::int<start_at AND t#>>'{elements,2,1}'='SVK' AND t#>>'{elements,2,2}'='260';
  SELECT t#>>'{elements,2,0}' INTO receiver FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MR' AND(t->>'index')::int<start_at AND t#>>'{elements,2,1}'='SVK' AND t#>>'{elements,2,2}'='260';
  IF sender IS NULL OR receiver IS NULL THEN CONTINUE;END IF;
  -- Replay actual earlier applied owners through the same constructor. This
  -- derives new follow-up records from authentic retained effects, without
  -- backfilling source approvals, changing old receipts or trusting parsed rows.
  FOR prior_source IN SELECT DISTINCT source_message_id FROM(
   SELECT source_message_id,objects FROM gridex_received_sources.structural_apply_receipts WHERE company_id=c AND environment=env
   UNION ALL SELECT source_message_id,jsonb_build_array(effect) FROM gridex_received_sources.structural_object_apply_receipts WHERE company_id=c AND environment=env
  )r WHERE EXISTS(SELECT FROM jsonb_array_elements(r.objects)o WHERE o#>>'{object,objectId}'=point AND o#>>'{object,identityAgency}'=agency AND o#>>'{wire,businessCase}'='change_with_reading') LOOP
   PERFORM gridex_received_reading_expectations.capture_source_v1(c,env,prior_source);
  END LOOP;
  reading:='[]';previous_register:=NULL;current_meter:=NULL;
  FOR sequence IN SELECT(t->>'index')::int n,coalesce(lead((t->>'index')::int) OVER(ORDER BY(t->>'index')::int),stop_at) next_n FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='SEQ' AND(t->>'index')::int>start_at AND(t->>'index')::int<stop_at LOOP
   SELECT jsonb_agg(t ORDER BY(t->>'index')::int) INTO own FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::int>sequence.n AND(t->>'index')::int<sequence.next_n;
   SELECT jsonb_agg(t) INTO qty FROM jsonb_array_elements(own)t WHERE t->>'tag'='QTY' AND t#>>'{elements,1,0}'='220';
   IF qty IS NULL THEN CONTINUE;END IF;
   IF jsonb_array_length(qty)<>1 THEN reading:=NULL;EXIT;END IF;
   IF qty#>>'{0,elements,1,1}' IS NULL OR qty#>>'{0,elements,1,1}'='NULL' THEN CONTINUE;END IF;
   IF(SELECT count(*) FROM jsonb_array_elements(own)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='AES' AND jsonb_array_length(t->'elements'->1)=2 AND(t->>'index')::int<(qty#>>'{0,index}')::int)<>1 THEN reading:=NULL;EXIT;END IF;
   SELECT t#>>'{elements,1,1}' INTO register_id FROM jsonb_array_elements(own)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='AES' AND(t->>'index')::int<(qty#>>'{0,index}')::int;
   IF previous_register IS DISTINCT FROM register_id THEN current_meter:=NULL;END IF;previous_register:=register_id;
   IF(SELECT count(*) FROM jsonb_array_elements(own)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='MG' AND(t->>'index')::int<(qty#>>'{0,index}')::int)>1 THEN reading:=NULL;EXIT;END IF;
   SELECT t#>>'{elements,1,1}' INTO meter_id FROM jsonb_array_elements(own)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='MG' AND jsonb_array_length(t->'elements'->1)=2 AND(t->>'index')::int<(qty#>>'{0,index}')::int;
   IF meter_id IS NOT NULL THEN current_meter:=meter_id;END IF;meter_id:=current_meter;
   IF meter_id IS NULL THEN reading:=NULL;EXIT;END IF;
   SELECT jsonb_agg(t) INTO dates FROM jsonb_array_elements(own)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='597' AND(t->>'index')::int>(qty#>>'{0,index}')::int;
   IF jsonb_array_length(dates) IS DISTINCT FROM 1 THEN reading:=NULL;EXIT;END IF;
   at:=gridex_received_reading_expectations.instant_v1(dates#>>'{0,elements,1,1}',dates#>>'{0,elements,1,2}',offset_minutes);
   IF at IS NULL THEN reading:=NULL;EXIT;END IF;
   reading:=reading||jsonb_build_array(jsonb_build_object('registerId',register_id,'meterNumber',meter_id,'readAt',at,'sourceQuantity',qty#>'{0,elements,1}'));
  END LOOP;
  candidate_ids:='{}';
  FOR e IN SELECT * FROM gridex_received_reading_expectations.expectations x WHERE x.company_id=c AND x.environment=env AND x.contract#>>'{object,objectId}'=point AND x.contract#>>'{object,identityAgency}'=agency AND x.contract#>>'{wire,legalSender}'=sender AND x.contract#>>'{wire,legalReceiver}'=receiver LOOP
   IF e.contract_hash IS DISTINCT FROM encode(sha256(convert_to(e.contract::text,'UTF8')),'hex') OR NOT EXISTS(SELECT FROM jsonb_array_elements(gridex_received_reading_expectations.source_contracts_v1(c,env,e.source_message_id))value WHERE value=e.contract) THEN CONTINUE;END IF;
   IF EXISTS(SELECT FROM gridex_received_reading_expectations.expectations correction WHERE correction.company_id=c AND correction.environment=env AND correction.contract#>>'{replaces,sourceMessageId}'=e.source_message_id::text AND correction.contract#>>'{object,objectId}'=point AND correction.contract#>>'{object,identityAgency}'=agency) THEN CONTINUE;END IF;
   matched:=false;
   IF e.contract->>'mode'='meter_reading' AND reading IS NOT NULL AND jsonb_array_length(reading)>0 THEN
    matched:=(SELECT jsonb_agg(value->'registerId' ORDER BY value->>'registerId') FROM jsonb_array_elements(reading) WHERE(value->>'readAt')::timestamptz=(e.contract->>'effectiveAt')::timestamptz)=(SELECT jsonb_agg(value ORDER BY value#>>'{}') FROM jsonb_array_elements(e.contract->'expectedRegisterIds'))
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(reading)value WHERE(value->>'readAt')::timestamptz=(e.contract->>'effectiveAt')::timestamptz AND value->>'meterNumber' IS DISTINCT FROM e.contract#>>'{wire,meterNumber}');
   ELSIF e.contract->>'mode'='subsequent_values' THEN
    -- Observe initial subsequent values only. No claim about all future periods,
    -- no invented boundary reading where original field259 was absent.
    matched:=stored#>>'{metering,customerId}'=e.contract->>'customerId' AND stored#>>'{metering,meteringPointId}'=e.contract->>'meteringPointId'
     AND EXISTS(SELECT FROM jsonb_array_elements(stored->'observations')v WHERE(v->>'periodStart')::timestamptz>=(e.contract->>'effectiveAt')::timestamptz
      AND(v->>'periodStart')::timestamptz>=(e.contract#>>'{coverage,validFrom}')::timestamptz AND(e.contract#>>'{coverage,validTo}' IS NULL OR(v->>'periodEnd')::timestamptz<=(e.contract#>>'{coverage,validTo}')::timestamptz)
      AND CASE e.contract->>'measurementMethod' WHEN 'Z04' THEN v->>'resolution'='PT15M' WHEN 'Z02' THEN v->>'resolution'='PT1H' WHEN 'Z01' THEN v->>'resolution' IN('P1M','P1Y') ELSE false END
      AND NOT EXISTS(SELECT FROM gridex_received_reading_expectations.expectations later WHERE later.company_id=c AND later.environment=env AND later.contract#>>'{object,objectId}'=point AND later.contract#>>'{object,identityAgency}'=agency AND later.contract#>>'{wire,legalSender}'=sender AND later.contract#>>'{wire,legalReceiver}'=receiver AND(later.contract->>'effectiveAt')::timestamptz>(e.contract->>'effectiveAt')::timestamptz AND(later.contract->>'effectiveAt')::timestamptz<=(v->>'periodStart')::timestamptz));
   END IF;
   IF matched IS TRUE THEN candidate_ids:=array_append(candidate_ids,e.id);END IF;
  END LOOP;
  -- A reading cannot be borrowed by two indistinguishable structural originals.
  IF cardinality(candidate_ids)=1 THEN
   receipt:=jsonb_build_object('version',1,'utiltsSourceId',msg,'transactionId',tx,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
     'storedContractHash',encode(sha256(convert_to(stored::text,'UTF8')),'hex'),'reading',reading,'observation','actual_accepted_persisted_member');
   INSERT INTO gridex_received_reading_expectations.observations(expectation_id,company_id,environment,utilts_source_message_id,transaction_id,source_payload_hash,receipt,receipt_hash)
    VALUES(candidate_ids[1],c,env,msg,tx,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),receipt,encode(sha256(convert_to(receipt::text,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
END$$;
-- Receipt order is independent of valid time. A genuine already-stored
-- reading can arrive before its Z06 source has been reviewed/applied; recheck
-- that actual accepted binding after the source effect exists, never seed it.
CREATE OR REPLACE FUNCTION gridex_received_reading_expectations.applied_source_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE prior_source uuid;BEGIN
 PERFORM gridex_received_reading_expectations.capture_source_v1(NEW.company_id,NEW.environment,NEW.source_message_id);
 IF jsonb_array_length(gridex_received_reading_expectations.source_contracts_v1(NEW.company_id,NEW.environment,NEW.source_message_id))>0 THEN
  FOR prior_source IN SELECT r.source_message_id FROM gridex_utilts_binding.receipts r WHERE r.company_id=NEW.company_id AND r.environment=NEW.environment ORDER BY r.source_message_id LOOP
   PERFORM gridex_received_reading_expectations.consider_utilts_source_v1(NEW.company_id,NEW.environment,prior_source);
  END LOOP;
 END IF;RETURN NEW;END$$;
CREATE FUNCTION public.ediel_read_z06f_reading_followup_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_source_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'z06f_reading_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=p_actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR gridex_requested_changes.scoped_permission_v1(p_company_id,p_actor_user_id,'communication.read') IS NOT TRUE OR gridex_requested_changes.scoped_permission_v1(p_company_id,p_actor_user_id,'customers.read') IS NOT TRUE
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read') IS NOT TRUE OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.read') IS NOT TRUE THEN RAISE EXCEPTION 'z06f_reading_reader_forbidden' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('version',1,'criterion','AT-Z06F-SUPPLIER','sourceMessageId',p_source_message_id,'expectations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sourceMessageId',e.source_message_id,'firstLineIndex',e.first_line_index,'mode',e.contract->'mode','effectiveAt',e.contract->'effectiveAt','deadline',NULL,
  'status',CASE WHEN EXISTS(SELECT FROM gridex_received_reading_expectations.observations o WHERE o.expectation_id=e.id) THEN CASE WHEN e.contract->>'mode'='meter_reading' THEN 'reading_observed' ELSE 'initial_values_observed' END ELSE 'pending' END,'automaticRequestAllowed',false) ORDER BY e.first_line_index),'[]') FROM gridex_received_reading_expectations.expectations e WHERE e.company_id=p_company_id AND e.environment=p_environment AND e.source_message_id=p_source_message_id));
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_received_reading_expectations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_read_z06f_reading_followup_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.ediel_read_z06f_reading_followup_v1(uuid,text,uuid,uuid) TO service_role;
COMMENT ON TABLE gridex_received_reading_expectations.expectations IS 'Actual applied Z06F source-derived reading/value follow-up, independent of TM-METHOD40. No caller agreement, fulfilled flag, automatic request, reading period/deadline invention or masterplan approval.';
COMMIT;
