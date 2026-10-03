CREATE FUNCTION gridex_service_permission.context_v1(c uuid, aid uuid, actor uuid, expected_version bigint, code text, pid uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$DECLARE timing jsonb;basis jsonb;BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 IF code='Z13' THEN
  timing:=gridex_service_permission.current_request_timing_v1(c,aid,actor,expected_version,true);
  IF timing->>'status' IS DISTINCT FROM 'authorized' OR timing->>'permissionId' IS DISTINCT FROM pid::text THEN RETURN jsonb_build_object('status','held','missing',coalesce(timing->'missing','["immutable_service_request_permission_required"]'::jsonb));END IF;
 END IF;
 basis:=gridex_service_permission.context_before_source_timing_v1(c,aid,actor,expected_version,code,pid);
 IF basis->>'status'='authorized' AND code='Z13' THEN RETURN basis||jsonb_build_object('requestTiming',timing->'proof');END IF;
 RETURN basis;
END $$;