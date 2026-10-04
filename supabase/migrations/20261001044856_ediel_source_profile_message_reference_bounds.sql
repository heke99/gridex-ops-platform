-- Actual CLI forward. The same decoded UNH/UNT0062 source bounds guard fresh
-- originals and fresh effects only. Fixed source/transport results stay first.
BEGIN;
-- BEGIN CANONICAL MESSAGE REFERENCE PROJECTION
-- {"sourceVersion":"b0ae65d4fb0520eebe06ac0a5d38f67ec8c4f8694fa0bf8d459eef7115c86b16","inputManifest":{"lib/ediel/core/edifactReferenceConstraints.ts":"1470d9a87f43fdc7d13de65e03b71e2b03c67e2d185313ab9892dc01c18e23a1","docs/ediel/masterplan-v2/registers/source_manifest.json":"ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d","scripts/generate-ediel-message-reference-projection.cjs":"ef61ac29db8d7091a67be5d126ce6e71036b96e42bad4f500381a702c794cca5"},"projection":{"version":1,"field":"0062","maximumDecodedLength":14,"profiles":[{"technicalProfile":["PRODAT","D","97A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[41,84]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[97,105]}},{"technicalProfile":["PRODAT","D","97A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[41,84]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[97,105]}},{"technicalProfile":["UTILTS","D","02B","UN","E5SE5A"],"source":{"id":"U","filename":"260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","pages":[71,100]}},{"technicalProfile":["APERAK","D","04A","UN","E5SE5A"],"source":{"id":"U","filename":"260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","pages":[112,120]}}]}}
-- END CANONICAL MESSAGE REFERENCE PROJECTION
CREATE FUNCTION gridex_ediel_ack_guide.message_reference_profile_violation_v1(p_raw text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE cfg jsonb:='{"version":1,"field":"0062","maximumDecodedLength":14,"profiles":[{"technicalProfile":["PRODAT","D","97A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[41,84]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[97,105]}},{"technicalProfile":["PRODAT","D","97A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[41,84]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[97,105]}},{"technicalProfile":["UTILTS","D","02B","UN","E5SE5A"],"source":{"id":"U","filename":"260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","pages":[71,100]}},{"technicalProfile":["APERAK","D","04A","UN","E5SE5A"],"source":{"id":"U","filename":"260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf","sha256":"0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be","pages":[112,120]}}]}'::jsonb;tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);token jsonb;profile jsonb;maximum integer;reference jsonb;
BEGIN
 IF tokens IS NULL THEN RETURN false;END IF; -- Existing syntax owner handles unreadable wire.
 FOR token IN SELECT t FROM jsonb_array_elements(tokens)t LOOP
  IF token->>'tag'='UNH' THEN
   maximum:=NULL;
   FOR profile IN SELECT p FROM jsonb_array_elements(cfg->'profiles')p LOOP
    IF NOT EXISTS(SELECT FROM jsonb_array_elements_text(profile->'technicalProfile')WITH ORDINALITY part(value,position)
     WHERE token#>>ARRAY['elements','2',(part.position-1)::text] IS DISTINCT FROM part.value) THEN maximum:=(cfg->>'maximumDecodedLength')::integer;EXIT;END IF;
   END LOOP;
   reference:=token#>'{elements,1}';
  ELSIF token->>'tag'='UNT' THEN reference:=token#>'{elements,2}';
  ELSE CONTINUE;END IF;
  IF maximum IS NOT NULL AND EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(reference,'[]'::jsonb))part WHERE char_length(part)>maximum) THEN RETURN true;END IF;
  IF token->>'tag'='UNT' THEN maximum:=NULL;END IF;
 END LOOP;
 RETURN false;
END $$;
-- A registered negative original may carry this exact intentional error. The
-- qualification is always read from the existing private prepared/consumed port,
-- never from a caller JSON marker. It confers no business authority.
CREATE FUNCTION gridex_ediel_ack_guide.require_message_reference_profile_v1(p_raw text,p_qualification jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$BEGIN
 IF NOT gridex_ediel_ack_guide.message_reference_profile_violation_v1(p_raw) THEN RETURN;END IF;
 IF p_qualification->>'kind'='source_qualified_negative_fixture' AND p_qualification->>'expectedOutcome'='negative'
  AND p_qualification->>'authorizesBusinessEffect'='false' AND p_qualification->'expectedDiagnosticCodes' ? 'message_reference_length_invalid' THEN RETURN;END IF;
 RAISE EXCEPTION 'ediel_message_reference_length_invalid';END $$;
CREATE FUNCTION gridex_ediel_ack_guide.prepared_reference_fixture_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q jsonb;BEGIN
 IF i->>'environment'='test' AND i->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL
  AND i->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN
  q:=gridex_negative_fixtures.prepared_negative_fixture_v1((i->>'companyId')::uuid,(i->>'sourceQualifiedNegativeFixtureWitnessId')::uuid,i->>'rawPayload',(i->>'actorUserId')::uuid);
 END IF;RETURN q;END $$;
ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_reference_profile_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF gridex_ediel_ack_guide.message_reference_profile_violation_v1(i->>'rawPayload') THEN
  PERFORM gridex_ediel_ack_guide.require_message_reference_profile_v1(i->>'rawPayload',gridex_ediel_ack_guide.prepared_reference_fixture_v1(i));END IF;
 RETURN gridex_ediel_outbound_owner.prepare_before_reference_profile_v1(i);END $$;
CREATE FUNCTION gridex_ediel_ack_guide.require_reference_profile_before_birth_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q jsonb;actor uuid;BEGIN
 IF NEW.direction='outbound' AND NEW.raw_payload IS NOT NULL AND(TG_OP='INSERT' OR OLD.raw_payload IS NULL)
  AND gridex_ediel_ack_guide.message_reference_profile_violation_v1(NEW.raw_payload) THEN
  IF NEW.environment='test' AND NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL
   AND NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN
   SELECT actor_user_id INTO actor FROM gridex_negative_fixtures.negative_prepared_witnesses WHERE id=(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId')::uuid AND company_id=NEW.company_id FOR SHARE;
   q:=gridex_negative_fixtures.prepared_negative_fixture_v1(NEW.company_id,(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId')::uuid,NEW.raw_payload,actor);
  END IF;PERFORM gridex_ediel_ack_guide.require_message_reference_profile_v1(NEW.raw_payload,q);
 END IF;RETURN NEW;END $$;
CREATE TRIGGER ediel_00_reference_profile_bounds BEFORE INSERT OR UPDATE OF raw_payload ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_ack_guide.require_reference_profile_before_birth_v1();
CREATE FUNCTION gridex_ediel_ack_guide.require_reference_profile_current_message_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q jsonb;BEGIN
 IF NOT gridex_ediel_ack_guide.message_reference_profile_violation_v1(m.raw_payload) THEN RETURN;END IF;
 IF m.environment='test' AND m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL
  AND m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN q:=gridex_negative_fixtures.require_negative_message_v1(m.company_id,m.id,m.message_code);END IF;
 PERFORM gridex_ediel_ack_guide.require_message_reference_profile_v1(m.raw_payload,q);END $$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_reference_profile_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;m public.ediel_messages%rowtype;BEGIN
 result:=gridex_ediel_transport.mutate_before_reference_profile_v1(i);
 IF(i->>'action' IN('prepare','enter')) IS TRUE AND result->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_reference_profile_current_message_v1(m);END IF;RETURN result;END $$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_reference_profile_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;m public.ediel_messages%rowtype;BEGIN
 result:=gridex_outbound_dispatch.mutate_before_reference_profile_v1(i);
 IF(i->>'action' IN('prepare','enter')) IS TRUE AND result->>'scoped'='true' AND result->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_reference_profile_current_message_v1(m);END IF;RETURN result;END $$;
-- New syntaxaccepted source assessments cannot mint acceptance for an overlong
-- physical reference. Syntaxrejected observations remain recordable for CONTRL.
ALTER FUNCTION gridex_received_sources.append_validation(uuid,text,uuid,text,text) RENAME TO append_validation_before_reference_profile_v1;
CREATE FUNCTION gridex_received_sources.append_validation(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;result jsonb;BEGIN
 -- Preserve the existing source-ledger -> actual-message lock order. A new
 -- invalid assessment and its delegate writes roll back in this same RPC.
 result:=gridex_received_sources.append_validation_before_reference_profile_v1(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text);
 IF p_facts_text::jsonb->>'syntaxDecision'='accepted' THEN
  -- The protected delegate has already verified the tenant-bound retained
  -- source/hash. A physical technical source may retain company_id NULL;
  -- this check observes those exact same bytes without assigning a tenant.
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_source_message_id AND (company_id=p_company_id OR company_id IS NULL) AND environment=p_environment AND direction='inbound'
   AND encode(sha256(convert_to(raw_payload,'UTF8')),'hex')=p_source_payload_hash FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_message_reference_profile_v1(m.raw_payload);END IF;
 RETURN result;END $$;
ALTER FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) RENAME TO apply_before_reference_profile_v1;
CREATE FUNCTION gridex_ack_authority.apply_v1(c uuid,e text,aid uuid,o uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE prior jsonb;m public.ediel_messages%rowtype;BEGIN
 prior:=gridex_ack_authority.read_committed_v1(c,e,aid,actor);IF prior IS NOT NULL THEN RETURN gridex_ack_authority.apply_before_reference_profile_v1(c,e,aid,o,actor);END IF;
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 prior:=gridex_ack_authority.read_committed_v1(c,e,aid,actor);IF prior IS NOT NULL THEN RETURN gridex_ack_authority.apply_before_reference_profile_v1(c,e,aid,o,actor);END IF;
 PERFORM s.id FROM public.ediel_messages s WHERE s.id=o AND s.company_id=c AND s.environment=e AND direction='outbound' FOR UPDATE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=aid AND company_id=c AND environment=e AND direction='inbound' FOR UPDATE;
 PERFORM gridex_ediel_ack_guide.require_message_reference_profile_v1(m.raw_payload);
 RETURN gridex_ack_authority.apply_before_reference_profile_v1(c,e,aid,o,actor);END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.message_reference_profile_violation_v1(text),gridex_ediel_ack_guide.require_message_reference_profile_v1(text,jsonb),gridex_ediel_ack_guide.prepared_reference_fixture_v1(jsonb),gridex_ediel_ack_guide.require_reference_profile_before_birth_v1(),gridex_ediel_ack_guide.require_reference_profile_current_message_v1(public.ediel_messages),gridex_ediel_outbound_owner.prepare_before_reference_profile_v1(jsonb),gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_before_reference_profile_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_before_reference_profile_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text),gridex_received_sources.append_validation(uuid,text,uuid,text,text),gridex_ack_authority.apply_before_reference_profile_v1(uuid,text,uuid,uuid,uuid),gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),gridex_received_sources.append_validation(uuid,text,uuid,text,text),gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) TO service_role;
COMMIT;
