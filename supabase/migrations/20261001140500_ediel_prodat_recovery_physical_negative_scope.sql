-- TR05/P09/P-APERAK34: the committed inbound physical ACK owner selects
-- exact own failed objects, including genuinely absent LI for ERC41/226.
-- Acceptance contracts remain proof requirements; no fake LI or caller grant.
BEGIN;
DO $patch$
DECLARE fn regprocedure:='gridex_received_sources.assess_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure;body text;needle text:=$old$
    IF correlation.ack_scope IS DISTINCT FROM 'object' OR jsonb_typeof(correlation.scope_outcomes) IS DISTINCT FROM 'array' OR jsonb_array_length(correlation.scope_outcomes)=0
     OR EXISTS(SELECT FROM jsonb_array_elements(correlation.scope_outcomes) result WHERE (result->>'outcome' IN ('positive','negative')) IS NOT TRUE OR nullif(result->>'reference','') IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') own WHERE own->>'li'=result->>'reference')) THEN RETURN jsonb_build_object('status','held','reason','source_supported_negative_aperak_scope_required');END IF;
    SELECT coalesce(jsonb_agg(own ORDER BY own::text),'[]') INTO allowed_objects FROM jsonb_array_elements(original->'objects') own WHERE EXISTS(SELECT FROM jsonb_array_elements(correlation.scope_outcomes) result WHERE result->>'reference'=own->>'li' AND result->>'outcome'='negative');
$old$;replacement text:=$new$
    allowed_objects:=gridex_ack_authority.prodat_correction_objects_v1(m.company_id,m.environment,ack.id,m.id);
    IF allowed_objects IS NULL THEN
    IF correlation.ack_scope IS DISTINCT FROM 'object' OR jsonb_typeof(correlation.scope_outcomes) IS DISTINCT FROM 'array' OR jsonb_array_length(correlation.scope_outcomes)=0
     OR EXISTS(SELECT FROM jsonb_array_elements(correlation.scope_outcomes) result WHERE (result->>'outcome' IN ('positive','negative')) IS NOT TRUE OR nullif(result->>'reference','') IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') own WHERE own->>'li'=result->>'reference')) THEN RETURN jsonb_build_object('status','held','reason','source_supported_negative_aperak_scope_required');END IF;
    SELECT coalesce(jsonb_agg(own ORDER BY own::text),'[]') INTO allowed_objects FROM jsonb_array_elements(original->'objects') own WHERE EXISTS(SELECT FROM jsonb_array_elements(correlation.scope_outcomes) result WHERE result->>'reference'=own->>'li' AND result->>'outcome'='negative');
    ELSE
     IF correlation.ack_scope IS DISTINCT FROM 'object' OR jsonb_typeof(allowed_objects) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('status','held','reason','source_supported_negative_aperak_scope_required');END IF;
     SELECT coalesce(jsonb_agg(own ORDER BY own::text),'[]'::jsonb) INTO allowed_objects FROM jsonb_array_elements(allowed_objects) own;
    END IF;
$new$;
BEGIN
 body:=pg_get_functiondef(fn);
 IF strpos(body,needle)=0 OR strpos(body,'corrected_exact_failed_scope_required')=0 THEN RAISE EXCEPTION 'prodat_recovery_physical_scope_source_shape_changed';END IF;
 -- Replace only scope selection in the source qualifier. Existing canonical
 -- assessment, captured correlation/hash, fresh BGM, party/tuple checks and
 -- whole corrected subset comparison remain the shared source authority.
 EXECUTE replace(body,needle,replacement);
END$patch$;
COMMIT;
