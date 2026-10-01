-- Actual CLI forward. The supply/permission owners retain their independent
-- business qualification. This port only materializes replies to their real
-- previously committed own effects; APP or an initial ACK is never a receipt.
BEGIN;

ALTER FUNCTION gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[])
 RENAME TO prodat_response_before_domain_effects_v1;
CREATE FUNCTION gridex_received_sources.prodat_structural_response_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
END $$;

-- Already frozen own ACK bindings retain their original plan before new
-- receipts are considered. Only a new, not-yet-persisted own positive consumes
-- the domain effect materializer. The same national guide checks its wire.
ALTER FUNCTION gridex_ediel_ack_guide.bound_prodat_response_v1(public.ediel_messages,public.ediel_messages)
 RENAME TO bound_prodat_response_before_domain_effects_v1;
CREATE FUNCTION gridex_ediel_ack_guide.bound_prodat_response_v1(m public.ediel_messages,s public.ediel_messages)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE initial jsonb;actual jsonb;positive_indices integer[];final_facet jsonb;
BEGIN
 IF m.id IS NULL AND s.message_code IN('Z04','Z05','Z14','Z15') THEN
  initial:=gridex_received_sources.require_prodat_responses_v1(m.company_id,s.id);
  actual:=gridex_ediel_ack_guide.prodat_wire_responses_v1(m.raw_payload,initial->'objects');
  SELECT array_agg(DISTINCT(x->>'lineIndex')::integer ORDER BY(x->>'lineIndex')::integer) INTO positive_indices FROM jsonb_array_elements(actual)x WHERE x->>'ercCode'='100';
  IF positive_indices IS NOT NULL THEN
   final_facet:=gridex_received_sources.prodat_structural_response_v1(m.company_id,s.id,positive_indices);
   IF final_facet IS NULL THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_required';END IF;RETURN final_facet;
  END IF;
 END IF;
 RETURN gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1(m,s);
END $$;

-- Extend the existing protected prepare port, preserving every other ACK and
-- source owner. Its immutable final binding is consumed by actual CREATE/SEND.
DO $prepare$ DECLARE definition text;signature regprocedure;needle text;replacement text;BEGIN
 SELECT p.oid::regprocedure INTO STRICT signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gridex_ediel_outbound_owner' AND strpos(p.prosrc,'final_facet:=gridex_received_sources.prodat_structural_response_v1')>0;
 SELECT pg_get_functiondef(signature) INTO definition;
 needle:=$old$IF source.message_code IN('Z06','Z10') AND (EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=source.id)) THEN facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,NULL);END IF;$old$;
 replacement:=$new$IF source.message_code IN('Z04','Z05','Z14','Z15') THEN facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,NULL);
  ELSE $new$||needle||$new$ END IF;$new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'prodat_domain_response_prepare_contract_changed';END IF;definition:=replace(definition,needle,replacement);
 needle:=$old$IF positive_indices IS NOT NULL AND (EXISTS(SELECT FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices)) OR EXISTS(SELECT FROM gridex_received_sources.customer_primary_response_receipts r WHERE r.source_message_id=source.id AND r.first_line_index=ANY(positive_indices))) THEN final_facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,positive_indices);END IF;$old$;
 replacement:=$new$IF positive_indices IS NOT NULL AND source.message_code IN('Z04','Z05','Z14','Z15') THEN
   final_facet:=gridex_received_sources.prodat_structural_response_v1(source.company_id,source.id,positive_indices);
   IF final_facet IS NULL THEN RAISE EXCEPTION 'prodat_domain_response_own_effect_required';END IF;
  ELSE $new$||needle||$new$ END IF;$new$;
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'prodat_domain_response_prepare_contract_changed';END IF;EXECUTE replace(definition,needle,replacement);
END $prepare$;

-- A seal prepared before this forward but not yet consumed is not a born ACK.
-- First INSERT/first raw UPDATE must bind actual own effects as well. Existing
-- born/fixed ACKs are neither rewritten nor given fabricated historical proof.
CREATE FUNCTION gridex_received_sources.require_domain_response_at_birth_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
CREATE TRIGGER domain_response_birth BEFORE INSERT OR UPDATE OF raw_payload ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.require_domain_response_at_birth_v1();

REVOKE ALL ON FUNCTION gridex_received_sources.prodat_response_before_domain_effects_v1(uuid,uuid,integer[]),
 gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[]),
 gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1(public.ediel_messages,public.ediel_messages),
 gridex_ediel_ack_guide.bound_prodat_response_v1(public.ediel_messages,public.ediel_messages),
 gridex_received_sources.require_domain_response_at_birth_v1() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
