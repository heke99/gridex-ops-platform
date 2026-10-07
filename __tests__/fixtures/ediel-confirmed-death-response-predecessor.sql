-- Test-only migration prefix: exact four predecessor CREATE FUNCTION statements.
-- Qualified official capture: source 4508d8ea335ad9998d6816e214e90c852a955c6f,
-- tree c205073433be8014b6ccb291e63cabad02c6364d, 1091 SQL files.
-- GitHub run 37541468839, artifact 11449441444, ZIP SHA256
-- 588ae505cb92083c60d0d59b7eb031f7610476a77bbc6021d34c1a107a9a25f5.
-- Capture receipt SHA256
-- 1ee01aa35fa33e60b4018f411632ada3659870f71fe81ecae6e6fbfcd7c2de4d.
-- Raw schema SHA256
-- 628305e9a1b6de48291d418785724ae4e7431f91d29104ca4678217dc59c0573.
-- Capture flags native/browser/type-comparison/upgrade-parity are NOT_RUN.
-- These are predecessor function bodies, not current production authority.
-- All other tables/readers/validators/public materializer use current capture.
-- Replay immutable 231000 then 235000 exactly once in the disposable database.
-- Metadata checks prove preservation within that finite database only.
-- DDL gridex_received_sources.prodat_structural_response_v1 SHA256 34183d4c93cb282ea4dbce3695ee2ea406a0fc0bf000e63ca3fb068167a489a8
-- DDL gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1 SHA256 d20e77abaff2cf01c54e3ad6290f0e17601acbc6f7dfe3ee5962847bbea5a9bc
-- DDL gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1 SHA256 b0c7d33fd53d146fe38afeaae84f54f222733b540097df6cc18a3e066fa76f5b
-- DDL gridex_received_sources.require_domain_response_at_birth_v1 SHA256 c0314a60b7d03d29792db0710dd11c86ef00f67247d9a52d0b63c518057f5867

CREATE FUNCTION gridex_received_sources.prodat_structural_response_v1(c uuid, source_id uuid, requested integer[] DEFAULT NULL::integer[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE m public.ediel_messages%rowtype;effects jsonb;effect jsonb;scope jsonb;initial jsonb;facet jsonb;planned jsonb;
 binding gridex_ediel_ack_guide.source_bindings%rowtype;projection jsonb;positive_text text;owned jsonb:='[]';changed jsonb;
 first_line integer;indices jsonb;expected_kind text;own_count integer;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'prodat_domain_response_source_required';END IF;
 IF m.message_code IN('Z06','Z10') THEN RETURN gridex_received_sources.prodat_response_before_domain_effects_v1(c,source_id,requested);END IF;
 IF m.message_code NOT IN('Z04','Z05','Z14','Z15') THEN RAISE EXCEPTION 'prodat_domain_response_source_required';END IF;
 IF requested IS NOT NULL AND(cardinality(requested) NOT BETWEEN 1 AND 8192 OR EXISTS(SELECT FROM unnest(requested)x WHERE x IS NULL OR x<0)
  OR cardinality(requested)<>(SELECT count(DISTINCT x) FROM unnest(requested)x)) THEN RAISE EXCEPTION 'prodat_domain_response_scope_required';END IF;
 -- These private getters qualify the stored effect's source/hash/full APP and
 -- admitted FUNCTION, its independent business proof, and real committed xmin.
 IF m.message_code IN('Z04','Z05') THEN
  expected_kind:='supply';effects:=gridex_received_sources.committed_supply_effects_v1(c,source_id,requested);
 ELSE
  expected_kind:='metering_permission';effects:=gridex_received_sources.committed_permission_effects_v1(c,source_id,requested);
 END IF;
 -- A legacy source without an authentic own-effect partition has no positive
 -- capability. Its already qualified own negatives remain renderable.
 IF effects IS NULL THEN
  IF requested IS NOT NULL THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_unavailable';END IF;RETURN NULL;
 END IF;
 IF jsonb_typeof(effects) IS DISTINCT FROM 'array' OR jsonb_array_length(effects)>8192 THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_unavailable';END IF;
 IF jsonb_array_length(effects)=0 THEN
  IF requested IS NOT NULL THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_unavailable';END IF;RETURN NULL;
 END IF;
 SELECT * INTO binding FROM gridex_ediel_ack_guide.source_bindings WHERE source_message_id=m.id AND kind='national' FOR SHARE;
 IF binding.source_message_id IS NULL OR binding.company_id IS DISTINCT FROM c OR binding.environment IS DISTINCT FROM m.environment
  OR binding.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_domain_response_original_guide_unavailable';END IF;
 projection:=gridex_ediel_ack_guide.projection_for_original_v1(binding.source_version);positive_text:=projection#>>'{constraints,common,positiveText}';
 IF positive_text IS NULL OR NOT(projection#>'{constraints,PRODAT,allowedErc}'@>'["100"]'::jsonb) THEN RAISE EXCEPTION 'prodat_domain_response_original_guide_unavailable';END IF;
 FOR effect IN SELECT e FROM jsonb_array_elements(effects)e ORDER BY(e#>>'{objectScope,registers,0,segmentIndex}')::integer LOOP
  IF jsonb_typeof(effect) IS DISTINCT FROM 'object'
   OR(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(effect)k) IS DISTINCT FROM ARRAY['appliedAt','canonicalAssessmentId','effectFactsHash','effectKind','objectScope','receiptId','sourcePayloadHash']::text[]
   OR effect->>'effectKind' IS DISTINCT FROM expected_kind OR effect->>'sourcePayloadHash' IS DISTINCT FROM binding.payload_sha256
   OR effect->>'effectFactsHash' IS NULL OR effect->>'effectFactsHash'!~'^[a-f0-9]{64}$' OR effect->>'receiptId' IS NULL OR effect->>'canonicalAssessmentId' IS NULL
   OR effect->>'appliedAt' IS NULL THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_unavailable';END IF;
  PERFORM(effect->>'receiptId')::uuid,(effect->>'canonicalAssessmentId')::uuid;
  IF NOT isfinite((effect->>'appliedAt')::timestamptz) THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_unavailable';END IF;
  scope:=effect->'objectScope';first_line:=(scope#>>'{registers,0,segmentIndex}')::integer;
  SELECT jsonb_agg(r->'segmentIndex' ORDER BY ord) INTO indices FROM jsonb_array_elements(scope->'registers') WITH ORDINALITY v(r,ord);
  initial:=gridex_received_sources.read_prodat_response_assessment_v1(c,m.id,(effect->>'canonicalAssessmentId')::uuid);
  IF facet IS NULL THEN
   -- National APP-positive siblings are not business effects. Keep only their
   -- already qualified negatives; a positive appears below for a real receipt.
   SELECT jsonb_agg(CASE WHEN e->>'outcome'='positive' THEN e||jsonb_build_object('outcome','held') ELSE e END ORDER BY ord)
    INTO changed FROM jsonb_array_elements(initial->'objects') WITH ORDINALITY v(e,ord);
   facet:=jsonb_set(initial,'{objects}',changed);
   SELECT coalesce(jsonb_agg(e ORDER BY ord),'[]') INTO changed FROM jsonb_array_elements(initial->'responses') WITH ORDINALITY v(e,ord) WHERE e->>'ercCode'<>'100';
   facet:=jsonb_set(facet,'{responses}',changed);
  END IF;
  SELECT count(*) INTO own_count FROM jsonb_array_elements(initial->'objects')e WHERE e->'lineIndex'=to_jsonb(first_line);
  SELECT e INTO planned FROM jsonb_array_elements(initial->'objects')e WHERE e->'lineIndex'=to_jsonb(first_line);
  IF own_count<>1 OR first_line IS NULL OR planned->>'outcome'='negative' OR nullif(planned->>'li','') IS NULL
   OR planned->'id' IS DISTINCT FROM scope->'objectId' OR planned->'registerLineIndices' IS DISTINCT FROM indices
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(facet->'objects')e WHERE e-'outcome'=planned-'outcome' AND e->>'outcome'<>'negative')
   OR EXISTS(SELECT FROM jsonb_array_elements(owned)e WHERE e->'lineIndex'=to_jsonb(first_line))
   OR(requested IS NOT NULL AND NOT(first_line=ANY(requested))) THEN RAISE EXCEPTION 'prodat_domain_response_own_plan_unavailable';END IF;
  owned:=owned||jsonb_build_array(jsonb_build_object('lineIndex',first_line,'canonicalAssessmentId',effect->'canonicalAssessmentId',
   'objectAssessmentId',NULL,'effectReceiptId',effect->'receiptId','effectFactsHash',effect->'effectFactsHash','appliedAt',effect->'appliedAt','effectKind',expected_kind));
  SELECT jsonb_agg(CASE WHEN e->'lineIndex'=to_jsonb(first_line) THEN e||jsonb_build_object('outcome','positive') ELSE e END ORDER BY ord) INTO changed FROM jsonb_array_elements(facet->'objects') WITH ORDINALITY v(e,ord);
  facet:=jsonb_set(facet,'{objects}',changed);
  SELECT coalesce(jsonb_agg(e ORDER BY ord),'[]') INTO changed FROM jsonb_array_elements(facet->'responses') WITH ORDINALITY v(e,ord) WHERE e->'lineIndex' IS DISTINCT FROM to_jsonb(first_line);
  facet:=jsonb_set(facet,'{responses}',changed||jsonb_build_array(jsonb_build_object('scope','object','lineIndex',first_line,'ercCode','100','fieldCode',NULL,'text',positive_text,'id',planned->'id','li',planned->'li')));
 END LOOP;
 IF requested IS NOT NULL AND cardinality(requested)<>jsonb_array_length(owned) THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_unavailable';END IF;
 RETURN facet||jsonb_build_object('effectScopes',owned);
END $_$;

CREATE FUNCTION gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1(m public.ediel_messages, s public.ediel_messages) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE b gridex_ediel_ack_guide.prodat_structural_response_bindings%rowtype;facet jsonb;actual jsonb;positive_indices integer[];BEGIN
 SELECT binding.* INTO b FROM gridex_ediel_ack_guide.prodat_structural_response_bindings binding JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=binding.witness_id WHERE c.source_message_id=m.id;
 IF b.witness_id IS NULL AND m.execution_context_snapshot->>'outboundOwnerWitnessId' IS NOT NULL THEN SELECT * INTO b FROM gridex_ediel_ack_guide.prodat_structural_response_bindings WHERE witness_id=(m.execution_context_snapshot->>'outboundOwnerWitnessId')::uuid;END IF;
 IF b.witness_id IS NULL THEN
  -- The real owner invokes the national checker before the new seal exists.
  -- A draft can read committed primary receipts, but cannot provide a final
  -- verdict. Persisted ACKs require their original immutable binding instead.
  IF m.id IS NULL AND s.message_code IN('Z06','Z10') AND (EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=s.id)) THEN
   facet:=gridex_received_sources.prodat_structural_response_v1(m.company_id,s.id,NULL);
   actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(m.raw_payload,facet->'objects');
   SELECT array_agg((x->>'lineIndex')::integer ORDER BY(x->>'lineIndex')::integer) INTO positive_indices FROM jsonb_array_elements(actual)x WHERE x->>'ercCode'='100';
   IF positive_indices IS NOT NULL AND (EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=s.id AND r.first_line_index=ANY(positive_indices)) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=s.id AND r.first_line_index=ANY(positive_indices))) THEN
    RETURN gridex_received_sources.prodat_structural_response_v1(m.company_id,s.id,positive_indices);
   END IF;
  END IF;
  RETURN gridex_ediel_ack_guide.bound_prodat_response_before_structural_v1(m,s);
 END IF;
 IF b.source_message_id IS DISTINCT FROM s.id OR b.company_id IS DISTINCT FROM m.company_id OR b.environment IS DISTINCT FROM m.environment OR b.ack_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR b.facet_hash IS DISTINCT FROM encode(sha256(convert_to(b.facet_text,'UTF8')),'hex') OR b.facet_text::jsonb->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_structural_response_frozen_binding_changed';END IF;
 RETURN b.facet_text::jsonb;
END $$;

CREATE FUNCTION gridex_ediel_outbound_owner.prepare_before_fresh_ack_envelope_v1(i jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE a jsonb;facet jsonb;result jsonb;source public.ediel_messages%rowtype;f gridex_received_sources.prodat_response_facets%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;final_facet jsonb;positive_indices integer[];actual jsonb;
BEGIN
 a:=gridex_ack_authority.wire_v1(i->>'rawPayload');
 IF a->>'family'='APERAK' AND a#>>'{type,2}'='96A' AND a#>>'{type,4}'='E2SE6A' THEN
  PERFORM src.source_message_id FROM gridex_received_sources.sources src WHERE src.source_message_id=(i->>'relatedMessageId')::uuid AND src.company_id=(i->>'companyId')::uuid AND src.environment=i->>'environment' FOR UPDATE;
  SELECT * INTO source FROM public.ediel_messages WHERE id=(i->>'relatedMessageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='inbound' AND message_family='PRODAT' FOR SHARE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'prodat_response_original_owner_unavailable';END IF;
  IF source.message_code IN('Z04','Z05','Z14','Z15') THEN facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,NULL);
  ELSE IF source.message_code IN('Z06','Z10') AND (EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=source.id)) THEN facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,NULL);END IF; END IF;
  IF facet IS NULL THEN facet:=gridex_received_sources.require_prodat_responses_v1(source.company_id,source.id);END IF;
  actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(i->>'rawPayload',facet->'objects');
  SELECT array_agg((x->>'lineIndex')::integer ORDER BY(x->>'lineIndex')::integer) INTO positive_indices FROM jsonb_array_elements(actual)x WHERE x->>'ercCode'='100';
  IF positive_indices IS NOT NULL AND source.message_code IN('Z04','Z05','Z14','Z15') THEN
   final_facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,positive_indices);
   IF final_facet IS NULL THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_required';END IF;
  ELSE IF positive_indices IS NOT NULL AND (EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices)) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices))) THEN final_facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,positive_indices);END IF; END IF;
 END IF;
 result:=gridex_ediel_outbound_owner.prepare_before_prodat_response_plan_v1(i);
 IF facet IS NOT NULL THEN
  SELECT * INTO f FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=(facet->>'assessmentId')::uuid;
  SELECT * INTO w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(result->>'witnessId')::uuid;
  IF w.id IS NULL OR w.company_id IS DISTINCT FROM source.company_id OR w.environment IS DISTINCT FROM source.environment OR w.related_message_id IS DISTINCT FROM source.id OR w.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(i->>'rawPayload','UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_response_original_owner_unavailable';END IF;
  INSERT INTO gridex_ediel_ack_guide.prodat_response_owner_bindings VALUES(w.id,f.assessment_id,source.id,w.company_id,w.environment,w.payload_sha256,f.response_facts_hash);
  IF final_facet IS NOT NULL THEN INSERT INTO gridex_ediel_ack_guide.prodat_structural_response_bindings VALUES(w.id,source.id,w.company_id,w.environment,w.payload_sha256,final_facet::text,encode(sha256(convert_to(final_facet::text,'UTF8')),'hex'));END IF;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION gridex_received_sources.require_domain_response_at_birth_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE s public.ediel_messages%rowtype;initial jsonb;actual jsonb;final_facet jsonb;positive_indices integer[];w gridex_ediel_outbound_owner.witnesses%rowtype;
 existing gridex_ediel_ack_guide.prodat_structural_response_bindings%rowtype;facet_text text;facet_hash text;
BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'APERAK' OR NEW.raw_payload IS NULL
  OR(TG_OP='UPDATE' AND OLD.raw_payload IS NOT NULL) THEN RETURN NEW;END IF;
 SELECT * INTO s FROM public.ediel_messages WHERE id=NEW.related_message_id AND company_id=NEW.company_id AND environment=NEW.environment
  AND direction='inbound' AND message_family='PRODAT' FOR SHARE;
 IF s.message_code NOT IN('Z04','Z05','Z14','Z15') OR s.id IS NULL THEN RETURN NEW;END IF;
 PERFORM src.source_message_id FROM gridex_received_sources.sources src WHERE src.source_message_id=s.id AND src.company_id=s.company_id AND src.environment=s.environment FOR UPDATE;
 SELECT * INTO w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(NEW.execution_context_snapshot->>'outboundOwnerWitnessId')::uuid FOR SHARE;
 IF w.id IS NULL OR w.company_id IS DISTINCT FROM NEW.company_id OR w.environment IS DISTINCT FROM NEW.environment OR w.related_message_id IS DISTINCT FROM s.id
  OR w.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_domain_response_frozen_owner_required';END IF;
 SELECT * INTO existing FROM gridex_ediel_ack_guide.prodat_structural_response_bindings WHERE witness_id=w.id;
 IF existing.witness_id IS NOT NULL THEN
  IF existing.source_message_id IS DISTINCT FROM s.id OR existing.company_id IS DISTINCT FROM NEW.company_id OR existing.environment IS DISTINCT FROM NEW.environment
   OR existing.ack_hash IS DISTINCT FROM w.payload_sha256 OR existing.facet_hash IS DISTINCT FROM encode(sha256(convert_to(existing.facet_text,'UTF8')),'hex')
   OR existing.facet_text::jsonb->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_domain_response_frozen_owner_changed';END IF;
  -- The actual prepare already froze committed effects. Do not reselect a
  -- newer canonical leaf or independent role when consuming that same seal.
  RETURN NEW;
 END IF;
 initial:=gridex_received_sources.require_prodat_responses_v1(NEW.company_id,s.id);
 actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(NEW.raw_payload,initial->'objects');
 SELECT array_agg(DISTINCT(x->>'lineIndex')::integer ORDER BY(x->>'lineIndex')::integer) INTO positive_indices FROM jsonb_array_elements(actual)x WHERE x->>'ercCode'='100';
 IF positive_indices IS NULL THEN RETURN NEW;END IF;
 final_facet:=gridex_received_sources.prodat_structural_response_v1(NEW.company_id,s.id,positive_indices);
 IF final_facet IS NULL THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_required';END IF;
 facet_text:=final_facet::text;facet_hash:=encode(sha256(convert_to(facet_text,'UTF8')),'hex');
 INSERT INTO gridex_ediel_ack_guide.prodat_structural_response_bindings VALUES(w.id,s.id,NEW.company_id,NEW.environment,w.payload_sha256,facet_text,facet_hash);
 RETURN NEW;
END $$;
