-- Actual Supabase CLI forward. Genuine P plans qualify first responses; partial
-- own-object ACKs and multi-register objects use their immutable original owner.
BEGIN;
CREATE TABLE gridex_ediel_ack_guide.established_prodat_acks(ack_message_id uuid PRIMARY KEY,source_message_id uuid NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,ack_hash text NOT NULL,source_hash text NOT NULL);
ALTER TABLE gridex_ediel_ack_guide.established_prodat_acks ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_ack_guide.established_prodat_acks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_ack_guide.established_prodat_acks FROM PUBLIC,anon,authenticated,service_role;
-- Retain only actual already consumed, sealed originals. This derives existing
-- immutable evidence; it fabricates no reception, assessment or delivery state.
INSERT INTO gridex_ediel_ack_guide.established_prodat_acks
 SELECT m.id,s.id,c.company_id,c.environment,c.payload_sha256,encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')
 FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id
 JOIN public.ediel_messages m ON m.id=c.source_message_id JOIN public.ediel_messages s ON s.id=w.related_message_id
 WHERE w.family='APERAK' AND gridex_ack_authority.wire_v1(m.raw_payload)#>>'{type,2}'='96A' AND s.message_family='PRODAT' AND s.direction='inbound'
  AND m.company_id=c.company_id AND m.environment=c.environment AND m.direction='outbound' AND m.message_family='APERAK' AND m.related_message_id=s.id
  AND w.company_id=c.company_id AND w.environment=c.environment AND w.payload_sha256=c.payload_sha256 AND c.payload_sha256=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND s.company_id=c.company_id AND s.environment=c.environment;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_ediel_ack_guide.established_prodat_acks FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_ack_guide.established_prodat_acks FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TABLE gridex_ediel_ack_guide.prodat_response_owner_bindings(witness_id uuid PRIMARY KEY REFERENCES gridex_ediel_outbound_owner.witnesses(id),assessment_id uuid NOT NULL REFERENCES gridex_received_sources.prodat_response_facets(assessment_id),source_message_id uuid NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,ack_hash text NOT NULL,facet_hash text NOT NULL);
ALTER TABLE gridex_ediel_ack_guide.prodat_response_owner_bindings ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_ack_guide.prodat_response_owner_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_ack_guide.prodat_response_owner_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_ediel_ack_guide.prodat_response_owner_bindings FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_ack_guide.prodat_response_owner_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
DO $original$ DECLARE definition text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_received_sources.require_prodat_responses_v1(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'require_prodat_responses_v1(p_company uuid, p_source uuid)','read_prodat_response_assessment_v1(p_company uuid, p_source uuid, p_assessment uuid)');
 needle:='AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)';
 IF position('read_prodat_response_assessment_v1' IN definition)=0 OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'prodat_response_bound_reader_derivation_mismatch';END IF;
 EXECUTE replace(definition,needle,'AND v.id=p_assessment');
END $original$;
CREATE FUNCTION gridex_ediel_ack_guide.bound_prodat_response_v1(m public.ediel_messages,s public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b gridex_ediel_ack_guide.prodat_response_owner_bindings%rowtype;facet jsonb;f gridex_received_sources.prodat_response_facets%rowtype;
BEGIN
 SELECT binding.* INTO b FROM gridex_ediel_ack_guide.prodat_response_owner_bindings binding JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=binding.witness_id WHERE c.source_message_id=m.id;
 IF b.witness_id IS NULL AND m.execution_context_snapshot->>'outboundOwnerWitnessId' IS NOT NULL THEN SELECT * INTO b FROM gridex_ediel_ack_guide.prodat_response_owner_bindings WHERE witness_id=(m.execution_context_snapshot->>'outboundOwnerWitnessId')::uuid;END IF;
 IF b.witness_id IS NULL THEN
  IF m.id IS NOT NULL THEN RAISE EXCEPTION 'prodat_response_frozen_owner_binding_unavailable';END IF;
  RETURN gridex_received_sources.require_prodat_responses_v1(m.company_id,s.id);
 END IF;
 IF b.company_id IS DISTINCT FROM m.company_id OR b.environment IS DISTINCT FROM m.environment OR b.source_message_id IS DISTINCT FROM s.id OR b.ack_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_response_frozen_owner_binding_changed';END IF;
 SELECT * INTO f FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=b.assessment_id;
 IF f.response_facts_hash IS DISTINCT FROM b.facet_hash THEN RAISE EXCEPTION 'prodat_response_frozen_owner_binding_changed';END IF;
 RETURN gridex_received_sources.read_prodat_response_assessment_v1(m.company_id,s.id,b.assessment_id);
END $$;
-- Preserve the real source-generated national checker. Only the authenticated
-- object's grouping port and individual-ACK coverage scope change here.
DO $derive$ DECLARE definition text;start_pos integer;end_pos integer;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_ack_guide.validate_before_registered_responses_v1(text,text,jsonb)'::regprocedure);
 definition:=replace(definition,'validate_before_registered_responses_v1(p_raw text, p_source_raw text, p_projection jsonb)','validate_prodat_planned_v1(p_raw text, p_source_raw text, p_projection jsonb, p_source_objects jsonb)');
 IF position('validate_prodat_planned_v1' IN definition)=0 THEN RAISE EXCEPTION 'prodat_response_native_guide_derivation_mismatch';END IF;
 start_pos:=position('  SELECT coalesce(jsonb_agg(DISTINCT object)' IN definition);end_pos:=position(' END IF;'||chr(10)||' FOR t IN' IN substring(definition FROM start_pos));
 IF start_pos=0 OR end_pos=0 THEN RAISE EXCEPTION 'prodat_response_native_group_projection_mismatch';END IF;
 definition:=substring(definition FROM 1 FOR start_pos-1)||'  source_objects:=p_source_objects;'||chr(10)||substring(definition FROM start_pos+end_pos-1);
 needle:=' IF NOT is_utilts AND a->>''function''=''34'' AND EXISTS(SELECT FROM jsonb_array_elements(source_objects)x WHERE NOT(coalesce(x->>''id'','''')||''|''||coalesce(x->>''li'','''')=ANY(answered))) THEN RETURN false;END IF;';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'prodat_response_native_partial_scope_projection_mismatch';END IF;
 EXECUTE replace(definition,needle,' -- P original pp85-87 allows several APERAKs for one multi-object source. Own tuple completeness is checked by the protected response owner.');
END $derive$;
CREATE FUNCTION gridex_ediel_ack_guide.prodat_wire_responses_v1(raw text,objects jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);a jsonb:=gridex_ack_authority.wire_v1(raw);t jsonb;ftx jsonb;own_li text;own_id text;object jsonb;result jsonb:='[]';finish integer;n integer;scope text;
BEGIN
 IF a IS NULL OR a->>'family' IS DISTINCT FROM 'APERAK' OR a#>>'{type,2}' IS DISTINCT FROM '96A' OR a#>>'{type,4}' IS DISTINCT FROM 'E2SE6A' OR a->>'function' NOT IN('27','34') THEN RAISE EXCEPTION 'prodat_response_native_scope_invalid';END IF;
 scope:=CASE a->>'function' WHEN '27' THEN 'message' ELSE 'object' END;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='ERC' ORDER BY(x->>'index')::integer LOOP
  SELECT min((x->>'index')::integer) INTO finish FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::integer>(t->>'index')::integer AND x->>'tag' IN('ERC','UNT','UNZ');
  SELECT x INTO ftx FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='FTX' AND(x->>'index')::integer=(t->>'index')::integer+1;
  IF ftx IS NULL THEN RAISE EXCEPTION 'prodat_response_native_scope_invalid';END IF;
  SELECT count(*),min(x#>>'{elements,1,1}') INTO n,own_li FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND(x->>'index')::integer>(t->>'index')::integer AND(x->>'index')::integer<finish;
  IF n>1 THEN RAISE EXCEPTION 'prodat_response_native_scope_invalid';END IF;
  SELECT count(*),min(x#>>'{elements,1,1}') INTO n,own_id FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='Z07' AND(x->>'index')::integer>(t->>'index')::integer AND(x->>'index')::integer<finish;
  IF n>1 THEN RAISE EXCEPTION 'prodat_response_native_scope_invalid';END IF;object:=NULL;
  IF scope='object' THEN
   SELECT count(*) INTO n FROM jsonb_array_elements(objects)x WHERE CASE WHEN own_li IS NOT NULL THEN x->>'li'=own_li ELSE x->>'id'=own_id END AND(own_id IS NULL OR x->>'id'=own_id);
   SELECT x INTO object FROM jsonb_array_elements(objects)x WHERE CASE WHEN own_li IS NOT NULL THEN x->>'li'=own_li ELSE x->>'id'=own_id END AND(own_id IS NULL OR x->>'id'=own_id);
   IF n<>1 THEN RAISE EXCEPTION 'prodat_response_native_scope_invalid';END IF;
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('scope',scope,'lineIndex',CASE WHEN scope='object' THEN object->'lineIndex' ELSE 'null'::jsonb END,
   'ercCode',t#>>'{elements,1,0}','fieldCode',nullif(ftx#>>'{elements,3,0}',''),'text',ftx#>>'{elements,4,0}','id',own_id,'li',own_li));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION gridex_ediel_ack_guide.validate_response_for_message_v1(m public.ediel_messages,s public.ediel_messages,projection jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE facet jsonb;actual jsonb;expected jsonb;w gridex_ediel_outbound_owner.witnesses%rowtype;row_established gridex_ediel_ack_guide.established_prodat_acks%rowtype;
BEGIN
 IF m.message_family IS DISTINCT FROM 'APERAK' OR s.message_family IS DISTINCT FROM 'PRODAT' OR m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL THEN RETURN gridex_ediel_ack_guide.validate_v1(m.raw_payload,s.raw_payload,projection);END IF;
 SELECT * INTO row_established FROM gridex_ediel_ack_guide.established_prodat_acks WHERE ack_message_id=m.id;
 IF row_established.ack_message_id IS NOT NULL THEN
  IF row_established.source_message_id IS DISTINCT FROM s.id OR row_established.company_id IS DISTINCT FROM m.company_id OR row_established.environment IS DISTINCT FROM m.environment
   OR row_established.ack_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR row_established.source_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_response_established_original_changed';END IF;
  SELECT witness.* INTO w FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses witness ON witness.id=c.witness_id WHERE c.source_message_id=m.id AND c.company_id=m.company_id AND c.environment=m.environment AND c.payload_sha256=row_established.ack_hash;
  IF w.id IS NULL THEN RAISE EXCEPTION 'prodat_response_established_original_changed';END IF;PERFORM gridex_ediel_outbound_owner.assert_message_before_native_ack_guide_v1(m,w);RETURN true;
 END IF;
 facet:=gridex_ediel_ack_guide.bound_prodat_response_v1(m,s);
 IF NOT coalesce(gridex_ediel_ack_guide.validate_prodat_planned_v1(m.raw_payload,s.raw_payload,projection,facet->'objects'),false) THEN RETURN false;END IF;
 actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(m.raw_payload,facet->'objects');
 -- A per-object ACK must carry its actual planned own errors/confirmation;
 -- another object's response and an invented subset cannot supply its result.
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') INTO expected FROM jsonb_array_elements(facet->'responses')x WHERE EXISTS(SELECT FROM jsonb_array_elements(actual)a WHERE a->'scope'=x->'scope' AND a->'lineIndex'=x->'lineIndex');
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') INTO actual FROM jsonb_array_elements(actual)x;
 RETURN jsonb_array_length(actual)>0 AND actual=expected;
END $$;
-- Bind the actual new-entry checker. C, commonP202, U and ERR retain their
-- earlier own authorities; established transport outcomes still return first.
DO $wire$ DECLARE definition text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages)'::regprocedure);
 needle:='gridex_ediel_ack_guide.validate_v1(m.raw_payload,source.raw_payload,projection)';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'prodat_response_native_consumer_upgrade_mismatch';END IF;
 EXECUTE replace(definition,needle,'gridex_ediel_ack_guide.validate_response_for_message_v1(m,source,projection)');
END $wire$;
-- Freeze the actual committed response owner alongside the same actual seal.
-- Lock private original first, matching the canonical append owner lock order.
ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_prodat_response_plan_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;facet jsonb;result jsonb;source public.ediel_messages%rowtype;f gridex_received_sources.prodat_response_facets%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;
BEGIN
 a:=gridex_ack_authority.wire_v1(i->>'rawPayload');
 IF a->>'family'='APERAK' AND a#>>'{type,2}'='96A' AND a#>>'{type,4}'='E2SE6A' THEN
  PERFORM src.source_message_id FROM gridex_received_sources.sources src WHERE src.source_message_id=(i->>'relatedMessageId')::uuid AND src.company_id=(i->>'companyId')::uuid AND src.environment=i->>'environment' FOR UPDATE;
  SELECT * INTO source FROM public.ediel_messages WHERE id=(i->>'relatedMessageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='inbound' AND message_family='PRODAT' FOR SHARE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'prodat_response_original_owner_unavailable';END IF;
  facet:=gridex_received_sources.require_prodat_responses_v1(source.company_id,source.id);
 END IF;
 result:=gridex_ediel_outbound_owner.prepare_before_prodat_response_plan_v1(i);
 IF facet IS NOT NULL THEN
  SELECT * INTO f FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=(facet->>'assessmentId')::uuid;
  SELECT * INTO w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(result->>'witnessId')::uuid;
  IF w.id IS NULL OR w.company_id IS DISTINCT FROM source.company_id OR w.environment IS DISTINCT FROM source.environment OR w.related_message_id IS DISTINCT FROM source.id OR w.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(i->>'rawPayload','UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_response_original_owner_unavailable';END IF;
  INSERT INTO gridex_ediel_ack_guide.prodat_response_owner_bindings VALUES(w.id,f.assessment_id,source.id,w.company_id,w.environment,w.payload_sha256,f.response_facts_hash);
 END IF;
 RETURN result;
END $$;
-- Scope is the same physical object projection recorded by the original owner,
-- including all its registers. This projection chooses no field rule or code.
DO $groups$ DECLARE definition text;start_pos integer;end_pos integer;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_ack_guide.prodat_outcomes_v1(text,text)'::regprocedure);
 definition:=replace(definition,'prodat_outcomes_v1(raw text, source_raw text)','prodat_outcomes_v2(raw text, source_raw text, p_objects jsonb)');
 start_pos:=position(' SELECT coalesce(jsonb_agg(object)' IN definition);end_pos:=position(' FOR t IN SELECT x FROM jsonb_array_elements(tokens)x' IN substring(definition FROM start_pos));
 IF position('prodat_outcomes_v2' IN definition)=0 OR start_pos=0 OR end_pos=0 THEN RAISE EXCEPTION 'prodat_response_scope_group_derivation_mismatch';END IF;
 EXECUTE substring(definition FROM 1 FOR start_pos-1)||' SELECT coalesce(jsonb_agg(jsonb_build_object(''lineIndex'',x->''lineIndex'',''id'',x->''id'',''li'',x->''li'')),''[]'') INTO source_objects FROM jsonb_array_elements(p_objects)x;'||chr(10)||substring(definition FROM start_pos+end_pos-1);
END $groups$;
CREATE FUNCTION gridex_ediel_ack_guide.prodat_original_outcomes_v1(m public.ediel_messages,s public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE facet jsonb;
BEGIN
 IF m.execution_context_snapshot->>'prodatCommonHeaderNegativeWitnessId' IS NOT NULL OR EXISTS(SELECT FROM gridex_ediel_ack_guide.established_prodat_acks WHERE ack_message_id=m.id) THEN RETURN gridex_ediel_ack_guide.prodat_outcomes_v1(m.raw_payload,s.raw_payload);END IF;
 facet:=gridex_ediel_ack_guide.bound_prodat_response_v1(m,s);
 RETURN gridex_ediel_ack_guide.prodat_outcomes_v2(m.raw_payload,s.raw_payload,facet->'objects');
END $$;
DO $scopes$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_prodat_scope_v1(public.ediel_messages)'::regprocedure);
 IF position('gridex_ediel_ack_guide.prodat_outcomes_v1(m.raw_payload,source.raw_payload)' IN definition)=0 OR position('gridex_ediel_ack_guide.prodat_outcomes_v1(prior.raw_payload,source.raw_payload)' IN definition)=0 THEN RAISE EXCEPTION 'prodat_response_scope_consumer_upgrade_mismatch';END IF;
 EXECUTE replace(replace(definition,'gridex_ediel_ack_guide.prodat_outcomes_v1(m.raw_payload,source.raw_payload)','gridex_ediel_ack_guide.prodat_original_outcomes_v1(m,source)'), 'gridex_ediel_ack_guide.prodat_outcomes_v1(prior.raw_payload,source.raw_payload)','gridex_ediel_ack_guide.prodat_original_outcomes_v1(prior,source)');
END $scopes$;
REVOKE ALL ON FUNCTION gridex_received_sources.read_prodat_response_assessment_v1(uuid,uuid,uuid),gridex_ediel_ack_guide.bound_prodat_response_v1(public.ediel_messages,public.ediel_messages),gridex_ediel_outbound_owner.prepare_before_prodat_response_plan_v1(jsonb),gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_ack_guide.prodat_outcomes_v2(text,text,jsonb),gridex_ediel_ack_guide.prodat_original_outcomes_v1(public.ediel_messages,public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) TO service_role;
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.validate_prodat_planned_v1(text,text,jsonb,jsonb),gridex_ediel_ack_guide.prodat_wire_responses_v1(text,jsonb),gridex_ediel_ack_guide.validate_response_for_message_v1(public.ediel_messages,public.ediel_messages,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
