-- Capture genuinely rejected missing-field scopes without making them usable
-- accepted objects. The ordinary valid LIN-number binding stays unchanged.
BEGIN;
DO $repair$
DECLARE definition text;old_block text;new_block text;
BEGIN
 SELECT pg_get_functiondef('public.gridex_record_prodat_object_validation_v1(uuid,text,uuid,text,uuid,text)'::regprocedure) INTO definition;
 old_block:=$old$  SELECT t INTO lin FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,1,0}'=scope#>>'{registers,0,lineNumber}';
  IF lin IS NULL OR lin#>>'{elements,3,0}' IS DISTINCT FROM own->>'objectId' OR lin#>>'{elements,3,3}' IS DISTINCT FROM own->>'identityAgency' THEN RAISE EXCEPTION 'prodat_full_object_physical_scope_required';END IF;$old$;
 new_block:=$new$  SELECT t INTO lin FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,1,0}'=scope#>>'{registers,0,lineNumber}';
  physical:=NULL;
  -- A rejected single-LIN original has no accepted fallback. Bind its actual
  -- position twice, independently of the missing sequence or object scalar.
  IF c.facts_text::jsonb->>'applicationDecision'='rejected' AND own->>'disposition'='unavailable'
   AND own->'reasons' ? 'FIELD_MATRIX_REQUIRED_FIELD_MISSING'
   AND own->'negativeFields' ?| ARRAY['314','209']
   AND jsonb_array_length(scope->'registers')=1 AND own->'firstLineIndex'=scope#>'{registers,0,lineIndex}'
   AND scope->'messageIndex'='0'::jsonb
   AND (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN')=1
   AND (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')=1 THEN
   SELECT t INTO physical FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN'
    AND t->'index'=scope#>'{registers,0,segmentIndex}'
    AND (SELECT count(*) FROM jsonb_array_elements(tokens)prior WHERE prior->>'tag'='LIN' AND (prior->>'index')::int<(t->>'index')::int)=(scope#>>'{registers,0,lineIndex}')::int
    AND EXISTS(SELECT FROM jsonb_array_elements(tokens)header WHERE header->>'tag'='UNH' AND header#>>'{elements,1,0}'=scope->>'messageReference' AND coalesce(header#>>'{elements,1,0}','')<>'');
  END IF;
  IF lin IS NULL AND physical IS NOT NULL AND own->'negativeFields' ? '314'
   AND facts->'sharedAccepted'='false'::jsonb AND scope->>'disposition'='rejected'
   AND scope->'reasons' ? 'PRODAT_REGISTER_STRUCTURE_INVALID'
   AND scope#>'{registers,0,lineNumber}'='null'::jsonb AND nullif(physical#>>'{elements,1,0}','') IS NULL THEN
   lin:=physical;
  END IF;
  IF lin IS NULL OR ((lin#>>'{elements,3,0}' IS DISTINCT FROM own->>'objectId' OR lin#>>'{elements,3,3}' IS DISTINCT FROM own->>'identityAgency') AND NOT (
   physical IS NOT NULL AND lin->'index'=physical->'index' AND own->'negativeFields' ? '209'
   AND scope->>'disposition'='unavailable' AND scope->'reasons' ? 'REGISTER_SCOPE_UNAVAILABLE'
   AND own->'objectId'='null'::jsonb AND own->'identityAgency'='null'::jsonb
   AND scope->'objectId'='null'::jsonb AND scope->'identityAgency'='null'::jsonb
   AND jsonb_typeof(physical#>'{elements,3}')='array'
   AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(physical#>'{elements,3}')part WHERE part<>''))) THEN
   RAISE EXCEPTION 'prodat_full_object_physical_scope_required';
  END IF;$new$;
 IF length(definition)-length(replace(definition,old_block,''))<>length(old_block) THEN
  RAISE EXCEPTION 'rejected_permission_scope_original_owner_changed';
 END IF;
 EXECUTE replace(definition,old_block,new_block);
END
$repair$;
COMMIT;
