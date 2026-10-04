-- A prospective own application facet is usable only together with the SAME
-- immutable actual structural effect receipt. Register and ACK decisions do
-- not authorize business state. Historical whole-source approvals stay intact.
BEGIN;
DO $$
DECLARE definition text;old_clause text;new_clause text;occurrences integer;
BEGIN
 SELECT pg_get_functiondef('gridex_brp_sources.candidate_v1(jsonb,timestamptz,uuid,text,uuid,uuid,uuid,timestamptz,jsonb,uuid)'::regprocedure) INTO definition;
 old_clause:=$old$v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)$old$;
 new_clause:=$new$v.facts_text::jsonb->>'syntaxDecision'='accepted'
 AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)
 AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments other WHERE other.company_id=v.company_id AND other.environment=v.environment AND other.source_message_id=v.source_message_id AND other.source_payload_hash=v.source_payload_hash AND other.id<>v.id AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments next WHERE next.previous_assessment_id=other.id))
 AND (
  (v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted')
  OR EXISTS(SELECT FROM jsonb_array_elements(a.facts_text::jsonb->'objects') accepted_own
   WHERE accepted_own->>'disposition'='accepted' AND accepted_own->'business'=b->'business'
    AND accepted_own#>>'{object,objectId}'=own->>'point' AND accepted_own#>>'{object,identityAgency}'=own->>'identityAgency'
    AND CASE WHEN EXISTS(SELECT FROM gridex_received_sources.prodat_application_facets facet WHERE facet.assessment_id=v.id AND facet.company_id=c AND facet.environment=env AND facet.source_message_id=a.source_message_id AND facet.source_payload_hash=v.source_payload_hash)
      THEN coalesce(gridex_received_sources.prodat_application_object_accepted_v1(c,a.source_message_id,v.id,accepted_own->'object'),false) ELSE false END
    AND gridex_received_sources.structural_effect_matches_v1(c,env,a.source_message_id,a.id,customer,site,point,(supply->>'periodId')::uuid,own->>'point',own->>'identityAgency',cutoff) IS TRUE
  )
 )$new$;
 occurrences:=(length(definition)-length(replace(definition,old_clause,'')))/length(old_clause);
 IF occurrences<>1 THEN RAISE EXCEPTION 'brp_same_structural_application_owner_contract_changed';END IF;
 EXECUTE replace(definition,old_clause,new_clause);
END $$;
COMMIT;
