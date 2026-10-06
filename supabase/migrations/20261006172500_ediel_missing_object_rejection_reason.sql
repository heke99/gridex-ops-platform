-- Retain the genuine missing-209 register reason in the rejected full facet.
-- Neither its absent identity nor its diagnostic is usable accepted authority.
BEGIN;
DO $repair$
DECLARE definition text;old_block text;new_block text;
BEGIN
 SELECT pg_get_functiondef('public.gridex_record_prodat_object_validation_v1(uuid,text,uuid,text,uuid,text)'::regprocedure) INTO definition;
 old_block:=$old$  IF EXISTS(SELECT FROM jsonb_array_elements(own->'reasons') r WHERE r#>>'{}'<>'shared_source_not_qualified' AND NOT c.facts_text::jsonb->'reasonCodes' @> jsonb_build_array(r)) THEN RAISE EXCEPTION 'prodat_full_object_reason_changed';END IF;$old$;
 new_block:=$new$  IF EXISTS(SELECT FROM jsonb_array_elements(own->'reasons') r
   WHERE r#>>'{}'<>'shared_source_not_qualified' AND NOT c.facts_text::jsonb->'reasonCodes' @> jsonb_build_array(r)
   AND NOT coalesce((r#>>'{}'='REGISTER_SCOPE_UNAVAILABLE'
    AND c.facts_text::jsonb->>'syntaxDecision'='accepted' AND c.facts_text::jsonb->>'applicationDecision'='rejected'
    AND facts->'sharedAccepted'='true'::jsonb
    AND own->>'disposition'='unavailable' AND scope->>'disposition'='unavailable'
    AND own->'negativeFields'='["209"]'::jsonb
    AND jsonb_array_length(own->'reasons')=2 AND own->'reasons' @> '["REGISTER_SCOPE_UNAVAILABLE","FIELD_MATRIX_REQUIRED_FIELD_MISSING"]'::jsonb
    AND scope->'reasons'='["REGISTER_SCOPE_UNAVAILABLE"]'::jsonb
    AND c.facts_text::jsonb->'reasonCodes'='["FIELD_MATRIX_REQUIRED_FIELD_MISSING"]'::jsonb
    AND own->'objectId'='null'::jsonb AND own->'identityAgency'='null'::jsonb
    AND scope->'objectId'='null'::jsonb AND scope->'identityAgency'='null'::jsonb
    AND jsonb_array_length(facet->'objects')=1 AND jsonb_array_length(scope->'registers')=1
    AND scope->'messageIndex'='0'::jsonb
    AND (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN')=1
    AND (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')=1
    AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN'
     AND t->'index'=scope#>'{registers,0,segmentIndex}'
     AND t#>>'{elements,1,0}'=scope#>>'{registers,0,lineNumber}'
     AND (SELECT count(*) FROM jsonb_array_elements(tokens)prior WHERE prior->>'tag'='LIN' AND (prior->>'index')::int<(t->>'index')::int)=(scope#>>'{registers,0,lineIndex}')::int
     AND jsonb_typeof(t#>'{elements,3}')='array'
     AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(t#>'{elements,3}')part WHERE part<>'')
     AND EXISTS(SELECT FROM jsonb_array_elements(tokens)header WHERE header->>'tag'='UNH'
      AND header#>>'{elements,1,0}'=scope->>'messageReference' AND coalesce(header#>>'{elements,1,0}','')<>''))),false))
   THEN RAISE EXCEPTION 'prodat_full_object_reason_changed';END IF;$new$;
 IF length(definition)-length(replace(definition,old_block,''))<>length(old_block) THEN
  RAISE EXCEPTION 'missing_object_rejection_original_owner_changed';
 END IF;
 EXECUTE replace(definition,old_block,new_block);
END
$repair$;
COMMIT;
