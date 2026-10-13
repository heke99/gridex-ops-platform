-- Refuse a different grid before any Z02 business write and derive its Z01
-- projection from the already qualified immutable original. No CHECK/auth,
-- signature, ACL, trigger or applied migration changes.
BEGIN;
DO $migration$
DECLARE
  v_signature constant text := 'gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid)';
  v_old_hash constant text := 'aefd46d0c8e38ae7a2451da307f430f9379bcccc20e7da48c1df1ad7b94ed27a';
  v_new_hash constant text := 'b0f3c17dd3fc013bdad0c1ab5d8f67a71bdd2fbbd4cfc502a1b0c051e4d9de74';
  v_grid_anchor constant text := $patch$  IF nullif(v_grid_area,'') IS NULL THEN RETURN jsonb_build_object('ok',false,'code','z02_source_grid_area_missing');END IF;$patch$;
  v_grid_patch constant text := $patch$  IF nullif(v_grid_area,'') IS NULL THEN RETURN jsonb_build_object('ok',false,'code','z02_source_grid_area_missing');END IF;
  -- The sealed originating Z01 owns the requested grid, even when another
  -- known area shares its price area. Missing original grid stays discovery.
  IF nullif(btrim(v_original_object->>'gridArea'),'') IS NOT NULL
     AND upper(btrim(v_original_object->>'gridArea')) IS DISTINCT FROM upper(btrim(v_grid_area)) THEN
    RETURN jsonb_build_object('ok',false,'code','z02_original_grid_area_conflict',
      'gridAreaCode',v_grid_area,'originalGridAreaCode',v_original_object->>'gridArea');
  END IF;$patch$;
  v_link_anchor constant text := $patch$  update public.ediel_messages
  set customer_id = p_customer_id,$patch$;
  v_link_patch constant text := $patch$  update public.ediel_messages
  set related_message_id = v_original.id,
      customer_id = p_customer_id,$patch$;
  v_oid oid;
  v_proc pg_catalog.pg_proc%ROWTYPE;
  v_metadata jsonb;
  v_comment text;
  v_definition text;
  v_body text;
  v_hash text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(v_signature);
  SELECT p.* INTO v_proc FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
  IF NOT FOUND OR v_proc.prosecdef IS DISTINCT FROM true
     OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR v_proc.prokind IS DISTINCT FROM 'f' OR v_proc.pronargs IS DISTINCT FROM 7
     OR v_proc.prorettype IS DISTINCT FROM 'pg_catalog.jsonb'::pg_catalog.regtype
     OR v_proc.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') THEN
    RAISE EXCEPTION 'z02_original_grid_forward_prerequisite';
  END IF;
  -- Never manufacture an ACL: preserve the installed private-delegate boundary.
  IF pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'z02_original_grid_forward_prerequisite';
  END IF;
  v_metadata:=pg_catalog.to_jsonb(v_proc)-'prosrc';
  v_comment:=pg_catalog.obj_description(v_oid,'pg_proc');
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc,'UTF8')),'hex');
  IF v_hash=v_old_hash THEN
    v_body:=pg_catalog.replace(pg_catalog.replace(v_proc.prosrc,v_grid_anchor,v_grid_patch),v_link_anchor,v_link_patch);
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_body,'UTF8')),'hex') IS DISTINCT FROM v_new_hash THEN
      RAISE EXCEPTION 'z02_original_grid_forward_unreviewed_body';
    END IF;
    v_definition:=pg_catalog.pg_get_functiondef(v_oid);
    IF (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_proc.prosrc,'')))
       IS DISTINCT FROM pg_catalog.length(v_proc.prosrc) THEN
      RAISE EXCEPTION 'z02_original_grid_forward_unreviewed_definition';
    END IF;
    EXECUTE pg_catalog.replace(v_definition,v_proc.prosrc,v_body);
  ELSIF v_hash IS DISTINCT FROM v_new_hash THEN
    RAISE EXCEPTION 'z02_original_grid_forward_unreviewed_body';
  END IF;
  SELECT p.* INTO v_proc FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
  IF NOT FOUND OR pg_catalog.to_regprocedure(v_signature) IS DISTINCT FROM v_oid
     OR (pg_catalog.to_jsonb(v_proc)-'prosrc') IS DISTINCT FROM v_metadata
     OR pg_catalog.obj_description(v_oid,'pg_proc') IS DISTINCT FROM v_comment
     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc,'UTF8')),'hex') IS DISTINCT FROM v_new_hash THEN
    RAISE EXCEPTION 'z02_original_grid_forward_postcondition';
  END IF;
END
$migration$;
COMMIT;
