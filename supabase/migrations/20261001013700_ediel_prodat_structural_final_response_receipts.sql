-- A first own structural effect, not an initial ACK/application facet, supplies
-- a positive final response. Original national negatives and other held objects
-- retain their exact tuples. Every persisted ACK freezes its actual own plan.
BEGIN;
CREATE TABLE gridex_ediel_ack_guide.prodat_structural_response_bindings(
 witness_id uuid PRIMARY KEY REFERENCES gridex_ediel_outbound_owner.witnesses(id),source_message_id uuid NOT NULL,company_id uuid NOT NULL,environment text NOT NULL,
 ack_hash text NOT NULL,facet_text text NOT NULL,facet_hash text NOT NULL CHECK(facet_hash=encode(sha256(convert_to(facet_text,'UTF8')),'hex')));
ALTER TABLE gridex_ediel_ack_guide.prodat_structural_response_bindings ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_ack_guide.prodat_structural_response_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_ack_guide.prodat_structural_response_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_ediel_ack_guide.prodat_structural_response_bindings FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_ack_guide.prodat_structural_response_bindings FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION gridex_received_sources.prodat_structural_response_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;r gridex_received_sources.structural_object_apply_receipts%rowtype;a gridex_received_sources.object_assessments%rowtype;
 original jsonb;facet jsonb;initial jsonb;own jsonb;business jsonb;planned jsonb;projection jsonb;binding gridex_ediel_ack_guide.source_bindings%rowtype;positive_text text;owned jsonb:='[]';n integer;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z06','Z10')) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_structural_response_source_required';END IF;
 IF requested IS NOT NULL AND(cardinality(requested) NOT BETWEEN 1 AND 8192 OR EXISTS(SELECT FROM unnest(requested)x WHERE x IS NULL OR x<0) OR cardinality(requested)<>(SELECT count(DISTINCT x) FROM unnest(requested)x)) THEN RAISE EXCEPTION 'prodat_structural_response_scope_required';END IF;
 SELECT * INTO binding FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=source_id AND kind='national' FOR SHARE;
 IF binding.source_message_id IS NULL OR binding.company_id IS DISTINCT FROM c OR binding.environment IS DISTINCT FROM m.environment OR binding.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_structural_response_original_guide_unavailable';END IF;
 projection:=gridex_ediel_ack_guide.projection_for_original_v1(binding.source_version);positive_text:=projection#>>'{constraints,common,positiveText}';
 IF positive_text IS NULL OR NOT(projection#>'{constraints,PRODAT,allowedErc}'@>'["100"]'::jsonb) THEN RAISE EXCEPTION 'prodat_structural_response_original_guide_unavailable';END IF;
 FOR r IN SELECT * FROM gridex_received_sources.structural_object_apply_receipts e WHERE e.company_id=c AND e.source_message_id=source_id AND e.environment=m.environment AND(requested IS NULL OR e.first_line_index=ANY(requested))
  AND e.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) ORDER BY e.first_line_index LOOP
  IF r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR r.source_received_at IS DISTINCT FROM m.message_received_at THEN RAISE EXCEPTION 'prodat_structural_response_original_changed';END IF;
  SELECT * INTO a FROM gridex_received_sources.object_assessments WHERE id=r.object_assessment_id AND source_message_id=m.id AND company_id=c AND environment=m.environment AND source_payload_hash=r.payload_hash AND canonical_assessment_id=r.canonical_assessment_id;
  IF a.id IS NULL OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_structural_response_own_effect_unavailable';END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(a.facts_text::jsonb->'objects')e WHERE e->'object'=r.object_scope;
  SELECT e INTO own FROM jsonb_array_elements(a.facts_text::jsonb->'objects')e WHERE e->'object'=r.object_scope;business:=own->'business';
  IF n<>1 OR own->>'disposition' IS DISTINCT FROM 'accepted' OR business->>'owner' IS DISTINCT FROM 'reviewed-received-structure-v1'
   OR business->>'companyId' IS DISTINCT FROM c::text OR business->>'environment' IS DISTINCT FROM m.environment OR business->>'sourceMessageId' IS DISTINCT FROM m.id::text OR business->>'sourcePayloadHash' IS DISTINCT FROM r.payload_hash
   OR r.effect->'object' IS DISTINCT FROM own->'object' OR r.effect->'wire' IS DISTINCT FROM business->'wire' OR r.effect->>'meteringPointId' IS DISTINCT FROM business->>'meteringPointId' OR r.effect->>'siteId' IS DISTINCT FROM business->>'siteId'
   OR r.first_line_index IS DISTINCT FROM(own#>>'{object,registers,0,segmentIndex}')::integer THEN RAISE EXCEPTION 'prodat_structural_response_own_effect_unavailable';END IF;
  initial:=gridex_received_sources.read_prodat_response_assessment_v1(c,m.id,r.canonical_assessment_id);
  IF facet IS NULL THEN facet:=initial;END IF;
  SELECT e INTO planned FROM jsonb_array_elements(initial->'objects')e WHERE e->'lineIndex'=to_jsonb(r.first_line_index);
  IF planned IS NULL OR planned->>'outcome'='negative' OR planned->'id' IS DISTINCT FROM own#>'{object,objectId}' OR nullif(planned->>'li','') IS NULL
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(facet->'objects')e WHERE e-'outcome'=planned-'outcome') THEN RAISE EXCEPTION 'prodat_structural_response_own_plan_unavailable';END IF;
  owned:=owned||jsonb_build_array(jsonb_build_object('lineIndex',r.first_line_index,'canonicalAssessmentId',r.canonical_assessment_id,'objectAssessmentId',r.object_assessment_id,'appliedAt',r.applied_at));
  SELECT jsonb_agg(CASE WHEN e->'lineIndex'=to_jsonb(r.first_line_index) THEN e||jsonb_build_object('outcome','positive') ELSE e END ORDER BY ord) INTO original FROM jsonb_array_elements(facet->'objects') WITH ORDINALITY v(e,ord);
  facet:=jsonb_set(facet,'{objects}',original);
  SELECT coalesce(jsonb_agg(e ORDER BY ord),'[]') INTO original FROM jsonb_array_elements(facet->'responses') WITH ORDINALITY v(e,ord) WHERE e->'lineIndex' IS DISTINCT FROM to_jsonb(r.first_line_index);
  facet:=jsonb_set(facet,'{responses}',original||jsonb_build_array(jsonb_build_object('scope','object','lineIndex',r.first_line_index,'ercCode','100','fieldCode',NULL,'text',positive_text,'id',planned->'id','li',planned->'li')));
 END LOOP;
 IF requested IS NOT NULL AND cardinality(requested)<>jsonb_array_length(owned) THEN RAISE EXCEPTION 'prodat_structural_response_own_effect_unavailable';END IF;
 IF facet IS NULL THEN RETURN NULL;END IF;
 RETURN facet||jsonb_build_object('effectScopes',owned);
END $$;

CREATE FUNCTION public.ediel_read_prodat_structural_final_response_v1(p_company_id uuid,p_source_message_id uuid,p_object_line_indices integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;facet jsonb;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'received_evidence_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR SHARE;
 facet:=gridex_received_sources.prodat_structural_response_v1(p_company_id,p_source_message_id,p_object_line_indices);
 IF facet IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(m),'responseFacet',facet);
END $$;

-- Read each ACK's already bound final effect plan before the national initial
-- plan. Earlier initial/historical bindings and every non-structure path retain
-- their own authority; a caller cannot supply a final positive JSON verdict.
ALTER FUNCTION gridex_ediel_ack_guide.bound_prodat_response_v1(public.ediel_messages,public.ediel_messages) RENAME TO bound_prodat_response_before_structural_v1;
CREATE FUNCTION gridex_ediel_ack_guide.bound_prodat_response_v1(m public.ediel_messages,s public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b gridex_ediel_ack_guide.prodat_structural_response_bindings%rowtype;facet jsonb;actual jsonb;positive_indices integer[];BEGIN
 SELECT binding.* INTO b FROM gridex_ediel_ack_guide.prodat_structural_response_bindings binding JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=binding.witness_id WHERE c.source_message_id=m.id;
 IF b.witness_id IS NULL AND m.execution_context_snapshot->>'outboundOwnerWitnessId' IS NOT NULL THEN SELECT * INTO b FROM gridex_ediel_ack_guide.prodat_structural_response_bindings WHERE witness_id=(m.execution_context_snapshot->>'outboundOwnerWitnessId')::uuid;END IF;
 IF b.witness_id IS NULL THEN
  -- The real owner invokes the national checker before the new seal exists.
  -- A draft can read committed primary receipts, but cannot provide a final
  -- verdict. Persisted ACKs require their original immutable binding instead.
  IF m.id IS NULL AND s.message_code IN('Z06','Z10') AND EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id) THEN
   facet:=gridex_received_sources.prodat_structural_response_v1(m.company_id,s.id,NULL);
   actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(m.raw_payload,facet->'objects');
   SELECT array_agg((x->>'lineIndex')::integer ORDER BY(x->>'lineIndex')::integer) INTO positive_indices FROM jsonb_array_elements(actual)x WHERE x->>'ercCode'='100';
   IF positive_indices IS NOT NULL AND EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id AND r.first_line_index=ANY(positive_indices)) THEN
    RETURN gridex_received_sources.prodat_structural_response_v1(m.company_id,s.id,positive_indices);
   END IF;
  END IF;
  RETURN gridex_ediel_ack_guide.bound_prodat_response_before_structural_v1(m,s);
 END IF;
 IF b.source_message_id IS DISTINCT FROM s.id OR b.company_id IS DISTINCT FROM m.company_id OR b.environment IS DISTINCT FROM m.environment OR b.ack_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR b.facet_hash IS DISTINCT FROM encode(sha256(convert_to(b.facet_text,'UTF8')),'hex') OR b.facet_text::jsonb->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_structural_response_frozen_binding_changed';END IF;
 RETURN b.facet_text::jsonb;
END $$;

-- Extend the actual P owner wrapper in place by its exact protected port,
-- irrespective of later ERR wrappers' names. Original initial binding is kept.
DO $$DECLARE body text;signature regprocedure;old text;new text;BEGIN
 SELECT p.oid::regprocedure INTO STRICT signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_outbound_owner' AND strpos(p.prosrc,'facet:=gridex_received_sources.require_prodat_responses_v1(source.company_id,source.id);')>0;
 SELECT pg_get_functiondef(signature) INTO body;
 body:=replace(body,'w gridex_ediel_outbound_owner.witnesses%rowtype;','w gridex_ediel_outbound_owner.witnesses%rowtype;final_facet jsonb;positive_indices integer[];actual jsonb;');
 old:=$old$facet:=gridex_received_sources.require_prodat_responses_v1(source.company_id,source.id);$old$;
 new:=$new$IF source.message_code IN('Z06','Z10') AND EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id) THEN facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,NULL);END IF;
  IF facet IS NULL THEN facet:=gridex_received_sources.require_prodat_responses_v1(source.company_id,source.id);END IF;
  actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(i->>'rawPayload',facet->'objects');
  SELECT array_agg((x->>'lineIndex')::integer ORDER BY(x->>'lineIndex')::integer) INTO positive_indices FROM jsonb_array_elements(actual)x WHERE x->>'ercCode'='100';
  IF positive_indices IS NOT NULL AND EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices)) THEN final_facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,positive_indices);END IF;$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_structural_response_prepare_contract_changed';END IF;body:=replace(body,old,new);
 old:=$old$INSERT INTO gridex_ediel_ack_guide.prodat_response_owner_bindings VALUES(w.id,f.assessment_id,source.id,w.company_id,w.environment,w.payload_sha256,f.response_facts_hash);$old$;
 new:=$new$INSERT INTO gridex_ediel_ack_guide.prodat_response_owner_bindings VALUES(w.id,f.assessment_id,source.id,w.company_id,w.environment,w.payload_sha256,f.response_facts_hash);
  IF final_facet IS NOT NULL THEN INSERT INTO gridex_ediel_ack_guide.prodat_structural_response_bindings VALUES(w.id,source.id,w.company_id,w.environment,w.payload_sha256,final_facet::text,encode(sha256(convert_to(final_facet::text,'UTF8')),'hex'));END IF;$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_structural_response_prepare_contract_changed';END IF;EXECUTE replace(body,old,new);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[]),gridex_ediel_ack_guide.bound_prodat_response_before_structural_v1(public.ediel_messages,public.ediel_messages),gridex_ediel_ack_guide.bound_prodat_response_v1(public.ediel_messages,public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_read_prodat_structural_final_response_v1(uuid,uuid,integer[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_prodat_structural_final_response_v1(uuid,uuid,integer[]) TO service_role;
COMMIT;
