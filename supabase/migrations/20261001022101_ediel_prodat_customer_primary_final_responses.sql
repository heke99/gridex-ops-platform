-- Actual CLI-created forward. A customer-only own final response requires the
-- committed source customer-version owner. It cannot borrow a structural write,
-- a national ACK facet, a mutable graph row or a caller's businessCase label.
BEGIN;
CREATE FUNCTION gridex_received_sources.prodat_first_register_characteristic_v1(raw text,scope jsonb,qualifier text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);first_register jsonb:=scope#>'{registers,0}';lin jsonb;t jsonb;next_token jsonb;start_index integer;end_index integer;answer text;matches integer:=0;
BEGIN
 IF tokens IS NULL OR jsonb_typeof(scope->'registers') IS DISTINCT FROM 'array' OR jsonb_array_length(scope->'registers')=0 OR first_register->>'registerPosition' IS DISTINCT FROM '1' THEN RETURN NULL;END IF;
 start_index:=(first_register->>'segmentIndex')::integer;
 SELECT x INTO lin FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::integer=start_index;
 IF lin->>'tag' IS DISTINCT FROM 'LIN' OR lin#>>'{elements,3,0}' IS DISTINCT FROM scope->>'objectId' OR lin#>>'{elements,3,3}' IS DISTINCT FROM scope->>'identityAgency' OR lin#>>'{elements,1,0}' IS DISTINCT FROM first_register->>'lineNumber' THEN RETURN NULL;END IF;
 SELECT min((x->>'index')::integer) INTO end_index FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::integer>start_index AND x->>'tag' IN('LIN','UNT','UNZ','UNH');
 IF end_index IS NULL THEN RETURN NULL;END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::integer>start_index AND(x->>'index')::integer<end_index AND x->>'tag'='CCI' AND x#>>'{elements,2,0}'=qualifier LOOP
  matches:=matches+1;SELECT x INTO next_token FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::integer=(t->>'index')::integer+1;
  IF next_token->>'tag' IS DISTINCT FROM 'CAV' THEN RETURN NULL;END IF;answer:=next_token#>>'{elements,1,0}';
 END LOOP;
 RETURN CASE WHEN matches=1 THEN nullif(answer,'') ELSE NULL END;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END $$;

-- Extend the same actual reviewed business proof. This physical own source
-- predicate has no rule selection or national error-code projection.
ALTER FUNCTION gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid) RENAME TO review_business_proof_before_customer_kind_v1;
CREATE FUNCTION gridex_received_sources.review_business_proof_consistent(p_party jsonb,p_business jsonb,p_source_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s gridex_received_sources.sources%rowtype;reason text;BEGIN
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=p_source_id;
 IF s.message_code='Z06' THEN
  reason:=gridex_received_sources.prodat_first_register_characteristic_v1(s.raw_payload,p_business->'object','Z13');
  IF reason IS NULL OR reason='E34' THEN RETURN false;END IF;
 END IF;
 RETURN gridex_received_sources.review_business_proof_before_customer_kind_v1(p_party,p_business,p_source_id);
END $$;

CREATE TABLE gridex_received_sources.customer_primary_response_receipts(
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id),first_line_index integer NOT NULL CHECK(first_line_index>=0),
 company_id uuid NOT NULL,environment text NOT NULL CHECK(environment IN('test','production')),payload_hash text NOT NULL,
 canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),object_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.object_assessments(id),
 customer_id uuid NOT NULL,customer_version bigint NOT NULL CHECK(customer_version>0),effective_at timestamptz NOT NULL,applied_at timestamptz NOT NULL,
 object_scope jsonb NOT NULL,owner_fact jsonb NOT NULL,PRIMARY KEY(source_message_id,first_line_index));
ALTER TABLE gridex_received_sources.customer_primary_response_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.customer_primary_response_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.customer_primary_response_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.customer_primary_response_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.customer_primary_response_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION gridex_received_sources.capture_customer_primary_response_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;tr gridex_customer_life_events.transitions%rowtype;own jsonb;business jsonb;first_line integer;prior gridex_received_sources.customer_primary_response_receipts%rowtype;
BEGIN
 FOR own IN SELECT e FROM jsonb_array_elements(NEW.facts_text::jsonb->'objects')e WHERE e->>'disposition'='accepted' AND e#>>'{business,owner}'='inbound-customer-life-event-v1' LOOP
  SELECT * INTO m FROM public.ediel_messages WHERE id=NEW.source_message_id AND company_id=NEW.company_id FOR SHARE;
  SELECT * INTO tr FROM gridex_customer_life_events.transitions WHERE source_message_id=m.id AND company_id=NEW.company_id;
  business:=own->'business';first_line:=(own#>>'{object,registers,0,segmentIndex}')::integer;
  IF m.id IS NULL OR m.environment IS DISTINCT FROM NEW.environment OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06'
   OR NEW.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR NEW.facts_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.facts_text,'UTF8')),'hex')
   OR tr.source_message_id IS NULL OR tr.payload_hash IS DISTINCT FROM NEW.source_payload_hash OR tr.canonical_assessment_id IS DISTINCT FROM NEW.canonical_assessment_id
   OR tr.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)
   OR gridex_received_sources.prodat_first_register_characteristic_v1(m.raw_payload,own->'object','Z13') IS DISTINCT FROM 'E34'
   OR gridex_received_sources.prodat_application_object_accepted_v1(NEW.company_id,m.id,NEW.canonical_assessment_id,own->'object') IS NOT TRUE
   OR gridex_customer_life_events.owner_proof_consistent_v1(own->'party',business,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_customer_primary_response_own_effect_unavailable';END IF;
  SELECT * INTO prior FROM gridex_received_sources.customer_primary_response_receipts WHERE source_message_id=m.id AND first_line_index=first_line;
  IF FOUND THEN
   IF prior.company_id IS DISTINCT FROM NEW.company_id OR prior.environment IS DISTINCT FROM NEW.environment OR prior.payload_hash IS DISTINCT FROM NEW.source_payload_hash OR prior.canonical_assessment_id IS DISTINCT FROM NEW.canonical_assessment_id
    OR prior.customer_id::text IS DISTINCT FROM business->>'customerId' OR prior.customer_version::text IS DISTINCT FROM business->>'customerVersion' OR prior.effective_at IS DISTINCT FROM(business->>'effectiveAt')::timestamptz
    OR prior.object_scope IS DISTINCT FROM own->'object' OR prior.owner_fact IS DISTINCT FROM own THEN RAISE EXCEPTION 'prodat_customer_primary_response_original_conflict';END IF;
  ELSE
   INSERT INTO gridex_received_sources.customer_primary_response_receipts VALUES(m.id,first_line,NEW.company_id,NEW.environment,NEW.source_payload_hash,NEW.canonical_assessment_id,NEW.id,
    (business->>'customerId')::uuid,(business->>'customerVersion')::bigint,(business->>'effectiveAt')::timestamptz,tr.recorded_at,own->'object',own);
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_customer_primary_response AFTER INSERT ON gridex_received_sources.object_assessments FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.capture_customer_primary_response_v1();

ALTER FUNCTION gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[]) RENAME TO prodat_structural_response_before_customer_v1;
CREATE FUNCTION gridex_received_sources.prodat_structural_response_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;r gridex_received_sources.customer_primary_response_receipts%rowtype;a gridex_received_sources.object_assessments%rowtype;
 binding gridex_ediel_ack_guide.source_bindings%rowtype;facet jsonb;initial jsonb;planned jsonb;own jsonb;original jsonb;projection jsonb;positive_text text;owned jsonb:='[]';structural_indices integer[];reason text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z06','Z10')) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_structural_response_source_required';END IF;
 IF requested IS NOT NULL AND(cardinality(requested) NOT BETWEEN 1 AND 8192 OR EXISTS(SELECT FROM unnest(requested)x WHERE x IS NULL OR x<0) OR cardinality(requested)<>(SELECT count(DISTINCT x) FROM unnest(requested)x)) THEN RAISE EXCEPTION 'prodat_structural_response_scope_required';END IF;
 SELECT array_agg(first_line_index ORDER BY first_line_index) INTO structural_indices FROM gridex_received_sources.structural_object_apply_receipts e WHERE e.company_id=c AND e.environment=m.environment AND e.source_message_id=m.id AND(requested IS NULL OR e.first_line_index=ANY(requested));
 -- A new positive for E34 cannot borrow even a historical generic structure
 -- receipt. Its already sealed ACK remains governed by the earlier binding.
 IF m.message_code='Z06' AND EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts e WHERE e.company_id=c AND e.environment=m.environment AND e.source_message_id=m.id AND(requested IS NULL OR e.first_line_index=ANY(requested))
  AND gridex_received_sources.prodat_first_register_characteristic_v1(m.raw_payload,e.object_scope,'Z13') IS NOT DISTINCT FROM 'E34') THEN RAISE EXCEPTION 'prodat_customer_primary_response_own_effect_required';END IF;
 IF structural_indices IS NOT NULL THEN facet:=gridex_received_sources.prodat_structural_response_before_customer_v1(c,source_id,structural_indices);owned:=facet->'effectScopes';facet:=facet-'effectScopes';END IF;
 FOR r IN SELECT * FROM gridex_received_sources.customer_primary_response_receipts e WHERE e.company_id=c AND e.environment=m.environment AND e.source_message_id=m.id AND(requested IS NULL OR e.first_line_index=ANY(requested))
  AND e.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) ORDER BY e.first_line_index LOOP
  IF m.message_code IS DISTINCT FROM 'Z06' OR r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_customer_primary_response_original_changed';END IF;
  SELECT * INTO a FROM gridex_received_sources.object_assessments WHERE id=r.object_assessment_id AND source_message_id=m.id AND company_id=c AND environment=m.environment AND source_payload_hash=r.payload_hash AND canonical_assessment_id=r.canonical_assessment_id;
  IF a.id IS NULL OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') OR(SELECT count(*) FROM jsonb_array_elements(a.facts_text::jsonb->'objects')e WHERE e=r.owner_fact)<>1
   OR r.object_scope IS DISTINCT FROM r.owner_fact->'object' OR r.owner_fact->>'disposition' IS DISTINCT FROM 'accepted' OR r.owner_fact#>>'{business,owner}' IS DISTINCT FROM 'inbound-customer-life-event-v1'
   OR r.customer_id::text IS DISTINCT FROM r.owner_fact#>>'{business,customerId}' OR r.customer_version::text IS DISTINCT FROM r.owner_fact#>>'{business,customerVersion}' OR r.effective_at IS DISTINCT FROM(r.owner_fact#>>'{business,effectiveAt}')::timestamptz
   OR gridex_customer_life_events.owner_proof_consistent_v1(r.owner_fact->'party',r.owner_fact->'business',m.id) IS NOT TRUE
   OR gridex_received_sources.prodat_first_register_characteristic_v1(m.raw_payload,r.object_scope,'Z13') IS DISTINCT FROM 'E34' THEN RAISE EXCEPTION 'prodat_customer_primary_response_own_effect_unavailable';END IF;
  initial:=gridex_received_sources.read_prodat_response_assessment_v1(c,m.id,r.canonical_assessment_id);
  IF facet IS NULL THEN facet:=initial;END IF;
  SELECT e INTO planned FROM jsonb_array_elements(initial->'objects')e WHERE e->'lineIndex'=to_jsonb(r.first_line_index);
  IF planned IS NULL OR planned->>'outcome'='negative' OR planned->'id' IS DISTINCT FROM r.object_scope->'objectId' OR nullif(planned->>'li','') IS NULL
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(facet->'objects')e WHERE e-'outcome'=planned-'outcome' AND e->>'outcome'<>'negative')
   OR EXISTS(SELECT FROM jsonb_array_elements(owned)e WHERE e->'lineIndex'=to_jsonb(r.first_line_index)) THEN RAISE EXCEPTION 'prodat_customer_primary_response_own_plan_unavailable';END IF;
  IF positive_text IS NULL THEN
   SELECT * INTO binding FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=m.id AND kind='national' FOR SHARE;
   IF binding.source_message_id IS NULL OR binding.company_id IS DISTINCT FROM c OR binding.environment IS DISTINCT FROM m.environment OR binding.payload_sha256 IS DISTINCT FROM r.payload_hash THEN RAISE EXCEPTION 'prodat_structural_response_original_guide_unavailable';END IF;
   projection:=gridex_ediel_ack_guide.projection_for_original_v1(binding.source_version);positive_text:=projection#>>'{constraints,common,positiveText}';
   IF positive_text IS NULL OR NOT(projection#>'{constraints,PRODAT,allowedErc}'@>'["100"]'::jsonb) THEN RAISE EXCEPTION 'prodat_structural_response_original_guide_unavailable';END IF;
  END IF;
  owned:=owned||jsonb_build_array(jsonb_build_object('lineIndex',r.first_line_index,'canonicalAssessmentId',r.canonical_assessment_id,'objectAssessmentId',r.object_assessment_id,'appliedAt',r.applied_at,'effectKind','customer_version'));
  SELECT jsonb_agg(CASE WHEN e->'lineIndex'=to_jsonb(r.first_line_index) THEN e||jsonb_build_object('outcome','positive') ELSE e END ORDER BY ord) INTO original FROM jsonb_array_elements(facet->'objects') WITH ORDINALITY v(e,ord);facet:=jsonb_set(facet,'{objects}',original);
  SELECT coalesce(jsonb_agg(e ORDER BY ord),'[]') INTO original FROM jsonb_array_elements(facet->'responses') WITH ORDINALITY v(e,ord) WHERE e->'lineIndex' IS DISTINCT FROM to_jsonb(r.first_line_index);
  facet:=jsonb_set(facet,'{responses}',original||jsonb_build_array(jsonb_build_object('scope','object','lineIndex',r.first_line_index,'ercCode','100','fieldCode',NULL,'text',positive_text,'id',planned->'id','li',planned->'li')));
 END LOOP;
 IF requested IS NOT NULL AND cardinality(requested)<>jsonb_array_length(owned) THEN RAISE EXCEPTION 'prodat_structural_response_own_effect_unavailable';END IF;
 IF facet IS NULL THEN RETURN NULL;END IF;RETURN facet||jsonb_build_object('effectScopes',owned);
END $$;

-- Both pre-seal national validation and the actual one-use P owner ask the
-- same primary effect materializer. No caller JSON selects an E positive.
DO $$DECLARE body text;signature regprocedure;old text;new text;BEGIN
 SELECT p.oid::regprocedure INTO STRICT signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_outbound_owner' AND strpos(p.prosrc,'final_facet:=gridex_received_sources.prodat_structural_response_v1')>0;
 SELECT pg_get_functiondef(signature) INTO body;
 old:=$old$EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id)$old$;
 new:=$new$(EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=source.id))$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_customer_primary_prepare_contract_changed';END IF;body:=replace(body,old,new);
 old:=$old$EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices))$old$;
 new:=$new$(EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices)) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices)))$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_customer_primary_prepare_contract_changed';END IF;EXECUTE replace(body,old,new);
 SELECT pg_get_functiondef('gridex_ediel_ack_guide.bound_prodat_response_v1(public.ediel_messages,public.ediel_messages)'::regprocedure) INTO body;
 old:=$old$EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id)$old$;
 new:=$new$(EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=s.id))$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_customer_primary_bound_contract_changed';END IF;body:=replace(body,old,new);
 old:=$old$EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id AND r.first_line_index=ANY(positive_indices))$old$;
 new:=$new$(EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id AND r.first_line_index=ANY(positive_indices)) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=s.id AND r.first_line_index=ANY(positive_indices)))$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_customer_primary_bound_contract_changed';END IF;EXECUTE replace(body,old,new);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.prodat_first_register_characteristic_v1(text,jsonb,text),gridex_received_sources.review_business_proof_before_customer_kind_v1(jsonb,jsonb,uuid),gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid),gridex_received_sources.capture_customer_primary_response_v1(),gridex_received_sources.prodat_structural_response_before_customer_v1(uuid,uuid,integer[]),gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[]) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
