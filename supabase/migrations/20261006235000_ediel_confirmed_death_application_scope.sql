-- Canonical APP owns the full physical partition for a confirmed generic death.
-- A modern customer-life-event function receipt is a separate optional owner;
-- any present receipt must still pass its unchanged strict reader.
BEGIN;
DO $confirmed_death_application_scope$
DECLARE
 sig regprocedure := 'gridex_received_sources.confirmed_death_response_v1(uuid,uuid,integer[])'::regprocedure;
 definition text;before_metadata jsonb;after_metadata jsonb;needle text;replacement text;
BEGIN
 SELECT to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) INTO before_metadata,definition FROM pg_proc p WHERE p.oid=sig;
 needle := 'w_xmin numeric;';
 replacement := 'w_xmin numeric;modern_function jsonb;';
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'confirmed_death_application_declaration_contract_changed';END IF;
 definition := replace(definition,needle,replacement);
 needle := 'function_facet:=gridex_received_sources.require_prodat_source_function_objects_v1(c,m.id);';
 replacement := 'function_facet:=gridex_received_sources.require_prodat_application_objects_v1(c,m.id);';
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'confirmed_death_application_reader_contract_changed';END IF;
 definition := replace(definition,needle,replacement);
 needle := $old$OR function_facet#>>'{objects,0,functionalDecision}' IS DISTINCT FROM 'accepted' THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_canonical_scope_required';END IF;
 scope:=(function_facet->'objects'->0)-'functionalDecision'-'reasonCodes';$old$;
 replacement := $new$OR function_facet->>'headerDecision' IS DISTINCT FROM 'accepted'
  OR function_facet#>>'{objects,0,applicationDecision}' IS DISTINCT FROM 'accepted'
  OR function_facet#>'{objects,0,reasonCodes}' IS DISTINCT FROM '[]'::jsonb THEN
  RAISE EXCEPTION 'prodat_confirmed_death_response_canonical_scope_required';END IF;
 scope:=(function_facet->'objects'->0)-'applicationDecision'-'reasonCodes';
 -- Do not filter a malformed or foreign modern row into the absence branch.
 -- Its own strict reader must qualify it; failure never falls back to APP.
 IF EXISTS(SELECT FROM gridex_received_sources.prodat_source_function_facets WHERE assessment_id=v.canonical_assessment_id) THEN
  modern_function:=gridex_received_sources.require_prodat_source_function_objects_v1(c,m.id);
  IF modern_function->>'assessmentId' IS DISTINCT FROM v.canonical_assessment_id::text
   OR jsonb_typeof(modern_function->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(modern_function->'objects')<>1
   OR modern_function#>>'{objects,0,functionalDecision}' IS DISTINCT FROM 'accepted'
   OR modern_function#>'{objects,0,reasonCodes}' IS DISTINCT FROM '[]'::jsonb
   OR (modern_function->'objects'->0)-'functionalDecision'-'reasonCodes' IS DISTINCT FROM scope THEN
   RAISE EXCEPTION 'prodat_confirmed_death_response_canonical_scope_required';END IF;
 END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'confirmed_death_application_scope_contract_changed';END IF;
 EXECUTE replace(definition,needle,replacement);
 SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE p.oid=sig;
 IF before_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'confirmed_death_application_function_metadata_changed';END IF;
END $confirmed_death_application_scope$;
COMMIT;
