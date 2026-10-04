-- Actual CLI forward. Full authentic P pp40–41/96–97 marks UNH0068/S010
-- unused. P119 preserves received PRODAT extra X without negative APERAK.
-- Generic EDIFACT syntax, old original/committed source outcomes stay unchanged.
BEGIN;
-- BEGIN CANONICAL UNUSED UNH PROJECTION
-- {"sourceVersion":"94b716c00c0626a9a6e91099fa6ebf8a54956f5d2823e147166590529cfbc415","inputManifest":{"lib/ediel/core/edifactHeaderConstraints.ts":"961e1a2b05f86d8c14cb0c400019d36235cff7d8b8933939a68285cbfbf3bef5","lib/ediel/core/edifactReferenceConstraints.ts":"1470d9a87f43fdc7d13de65e03b71e2b03c67e2d185313ab9892dc01c18e23a1","docs/ediel/masterplan-v2/registers/source_manifest.json":"ae5561799f6c81d78a139e4f5f82e74228bb765369fc6876668ae99ac338892d","scripts/generate-ediel-unused-unh-projection.cjs":"28f279cc7438916a30bab22d6dc3a88ea1d53ce12c5e71d9e1c553c89cce9208"},"projection":{"version":1,"segment":"UNH","unusedElements":[{"elementIndex":3,"field":"0068"},{"elementIndex":4,"field":"S010"}],"ignoredIncomingMessageType":"PRODAT","diagnosticCode":"EDIEL_UNH_UNUSED_ELEMENT","profiles":[{"technicalProfile":["PRODAT","D","97A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[40,41,119]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[96,97]}},{"technicalProfile":["PRODAT","D","97A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[40,41,119]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[96,97]}}]}}
-- END CANONICAL UNUSED UNH PROJECTION
CREATE FUNCTION gridex_ediel_ack_guide.unused_unh_violation_v1(p_raw text,p_direction text DEFAULT 'outbound') RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE cfg jsonb:='{"version":1,"segment":"UNH","unusedElements":[{"elementIndex":3,"field":"0068"},{"elementIndex":4,"field":"S010"}],"ignoredIncomingMessageType":"PRODAT","diagnosticCode":"EDIEL_UNH_UNUSED_ELEMENT","profiles":[{"technicalProfile":["PRODAT","D","97A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[40,41,119]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6A"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[96,97]}},{"technicalProfile":["PRODAT","D","97A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[40,41,119]}},{"technicalProfile":["APERAK","D","96A","UN","E2SE6B"],"source":{"id":"P","filename":"260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf","sha256":"83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95","pages":[96,97]}}]}'::jsonb;tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);token jsonb;profile jsonb;field jsonb;matches boolean;
BEGIN
 IF tokens IS NULL THEN RETURN false;END IF; -- Existing syntax owner handles unreadable wire.
 FOR token IN SELECT t FROM jsonb_array_elements(tokens)t WHERE t->>'tag'=cfg->>'segment' LOOP
  matches:=false;
  FOR profile IN SELECT p FROM jsonb_array_elements(cfg->'profiles')p LOOP
   IF NOT EXISTS(SELECT FROM jsonb_array_elements_text(profile->'technicalProfile')WITH ORDINALITY part(value,position)
    WHERE token#>>ARRAY['elements','2',(part.position-1)::text] IS DISTINCT FROM part.value) THEN matches:=true;EXIT;END IF;
  END LOOP;
  IF NOT matches OR(p_direction='inbound' AND token#>>'{elements,2,0}'=cfg->>'ignoredIncomingMessageType') THEN CONTINUE;END IF;
  FOR field IN SELECT f FROM jsonb_array_elements(cfg->'unusedElements')f LOOP
   IF EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(token#>ARRAY['elements',field->>'elementIndex'],'[]'::jsonb))part WHERE char_length(part)>0) THEN RETURN true;END IF;
  END LOOP;
 END LOOP;RETURN false;
END$$;
CREATE FUNCTION gridex_ediel_ack_guide.require_unused_unh_v1(p_raw text,p_direction text DEFAULT 'outbound',p_qualification jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$BEGIN
 IF NOT gridex_ediel_ack_guide.unused_unh_violation_v1(p_raw,p_direction) THEN RETURN;END IF;
 IF p_direction='outbound' AND p_qualification->>'kind'='source_qualified_negative_fixture' AND p_qualification->>'expectedOutcome'='negative'
  AND p_qualification->>'authorizesBusinessEffect'='false' AND p_qualification->'expectedDiagnosticCodes' ? 'EDIEL_UNH_UNUSED_ELEMENT' THEN RETURN;END IF;
 RAISE EXCEPTION 'ediel_unh_unused_element';END$$;
ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_unused_unh_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF gridex_ediel_ack_guide.unused_unh_violation_v1(i->>'rawPayload') THEN
  PERFORM gridex_ediel_ack_guide.require_unused_unh_v1(i->>'rawPayload','outbound',gridex_ediel_ack_guide.prepared_reference_fixture_v1(i));END IF;
 RETURN gridex_ediel_outbound_owner.prepare_before_unused_unh_v1(i);END $$;
CREATE FUNCTION gridex_ediel_ack_guide.require_unused_unh_before_birth_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q jsonb;actor uuid;BEGIN
 IF NEW.direction='outbound' AND NEW.raw_payload IS NOT NULL AND(TG_OP='INSERT' OR OLD.raw_payload IS NULL)
  AND gridex_ediel_ack_guide.unused_unh_violation_v1(NEW.raw_payload) THEN
  IF NEW.environment='test' AND NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL
   AND NEW.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN
   SELECT actor_user_id INTO actor FROM gridex_negative_fixtures.negative_prepared_witnesses WHERE id=(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId')::uuid AND company_id=NEW.company_id FOR SHARE;
   q:=gridex_negative_fixtures.prepared_negative_fixture_v1(NEW.company_id,(NEW.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId')::uuid,NEW.raw_payload,actor);
  END IF;PERFORM gridex_ediel_ack_guide.require_unused_unh_v1(NEW.raw_payload,'outbound',q);
 END IF;RETURN NEW;END $$;
CREATE TRIGGER ediel_00_unused_unh_guide BEFORE INSERT OR UPDATE OF raw_payload ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_ack_guide.require_unused_unh_before_birth_v1();
CREATE FUNCTION gridex_ediel_ack_guide.require_unused_unh_current_message_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q jsonb;BEGIN
 IF NOT gridex_ediel_ack_guide.unused_unh_violation_v1(m.raw_payload) THEN RETURN;END IF;
 IF m.environment='test' AND m.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId' IS NOT NULL
  AND m.execution_context_snapshot->>'sourceQualifiedPositiveFixtureWitnessId' IS NULL THEN q:=gridex_negative_fixtures.require_negative_message_v1(m.company_id,m.id,m.message_code);END IF;
 PERFORM gridex_ediel_ack_guide.require_unused_unh_v1(m.raw_payload,'outbound',q);END $$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_unused_unh_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;m public.ediel_messages%rowtype;BEGIN
 result:=gridex_ediel_transport.mutate_before_unused_unh_v1(i);
 IF(i->>'action' IN('prepare','enter')) IS TRUE AND result->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_unused_unh_current_message_v1(m);END IF;RETURN result;END $$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_unused_unh_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;m public.ediel_messages%rowtype;BEGIN
 result:=gridex_outbound_dispatch.mutate_before_unused_unh_v1(i);
 IF(i->>'action' IN('prepare','enter')) IS TRUE AND result->>'scoped'='true' AND result->>'proceed'='true' THEN
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(i->>'messageId')::uuid AND company_id=(i->>'companyId')::uuid AND environment=i->>'environment' AND direction='outbound' FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_unused_unh_current_message_v1(m);END IF;RETURN result;END $$;
-- Only a NEW accepted national-guide assessment is fenced. Syntax-rejected
-- and guide-rejected evidence remain recordable; received PRODAT extra X is
-- ignored according to P119 by this SAME direction-aware predicate.
ALTER FUNCTION gridex_received_sources.append_validation(uuid,text,uuid,text,text) RENAME TO append_validation_before_unused_unh_v1;
CREATE FUNCTION gridex_received_sources.append_validation(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;result jsonb;BEGIN
 -- Preserve the existing source-ledger -> actual-message lock order. A new
 -- invalid assessment and its delegate writes roll back in this same RPC.
 result:=gridex_received_sources.append_validation_before_unused_unh_v1(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_facts_text);
 IF p_facts_text::jsonb->>'syntaxDecision'='accepted' AND p_facts_text::jsonb->>'applicationDecision'='accepted' THEN
  -- The protected delegate has already verified the tenant-bound retained
  -- source/hash. A physical technical source may retain company_id NULL;
  -- this check observes those exact same bytes without assigning a tenant.
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_source_message_id AND (company_id=p_company_id OR company_id IS NULL) AND environment=p_environment AND direction='inbound'
   AND encode(sha256(convert_to(raw_payload,'UTF8')),'hex')=p_source_payload_hash FOR SHARE;
  PERFORM gridex_ediel_ack_guide.require_unused_unh_v1(m.raw_payload,'inbound');END IF;
 RETURN result;END $$;
ALTER FUNCTION gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) RENAME TO apply_before_unused_unh_v1;
CREATE FUNCTION gridex_ack_authority.apply_v1(c uuid,e text,aid uuid,o uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE prior jsonb;m public.ediel_messages%rowtype;BEGIN
 prior:=gridex_ack_authority.read_committed_v1(c,e,aid,actor);IF prior IS NOT NULL THEN RETURN gridex_ack_authority.apply_before_unused_unh_v1(c,e,aid,o,actor);END IF;
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 prior:=gridex_ack_authority.read_committed_v1(c,e,aid,actor);IF prior IS NOT NULL THEN RETURN gridex_ack_authority.apply_before_unused_unh_v1(c,e,aid,o,actor);END IF;
 PERFORM s.id FROM public.ediel_messages s WHERE s.id=o AND s.company_id=c AND s.environment=e AND direction='outbound' FOR UPDATE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=aid AND company_id=c AND environment=e AND direction='inbound' FOR UPDATE;
 PERFORM gridex_ediel_ack_guide.require_unused_unh_v1(m.raw_payload,'inbound');
 RETURN gridex_ack_authority.apply_before_unused_unh_v1(c,e,aid,o,actor);END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.unused_unh_violation_v1(text,text),gridex_ediel_ack_guide.require_unused_unh_v1(text,text,jsonb),gridex_ediel_ack_guide.require_unused_unh_before_birth_v1(),gridex_ediel_ack_guide.require_unused_unh_current_message_v1(public.ediel_messages),gridex_ediel_outbound_owner.prepare_before_unused_unh_v1(jsonb),gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_before_unused_unh_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_before_unused_unh_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),gridex_received_sources.append_validation_before_unused_unh_v1(uuid,text,uuid,text,text),gridex_received_sources.append_validation(uuid,text,uuid,text,text),gridex_ack_authority.apply_before_unused_unh_v1(uuid,text,uuid,uuid,uuid),gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),gridex_received_sources.append_validation(uuid,text,uuid,text,text),gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid) TO service_role;
COMMIT;
