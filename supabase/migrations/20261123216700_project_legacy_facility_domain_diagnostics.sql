DO $migration$
DECLARE
  timeline_oid CONSTANT oid := 'public.customer_ops_timeline_v'::regclass;
  timeline_preimage CONSTANT text := '1fba2599150ef1219684a5f53102356ae78254d4f4ff8689584c35746e67551a';
  old_metadata CONSTANT text := 'e.payload AS metadata';
  new_metadata CONSTANT text := 'public.gridex_facility_domain_diagnostic_payload_v1(e.source, e.event_type, e.payload) AS metadata';
  old_search_path CONSTANT text := current_setting('search_path');
  timeline_before record;
  timeline_definition text;
BEGIN
  SELECT c.relowner, c.relacl, c.reloptions INTO STRICT timeline_before
  FROM pg_catalog.pg_class c
  WHERE c.oid = timeline_oid AND c.relkind = 'v'
    AND c.reloptions = ARRAY['security_invoker=true'];

  PERFORM set_config('search_path','pg_catalog,pg_temp',true);
  timeline_definition := pg_get_viewdef(timeline_oid,false);
  IF encode(sha256(convert_to(timeline_definition,'UTF8')),'hex') <> timeline_preimage
    OR (length(timeline_definition)-length(replace(timeline_definition,old_metadata,''))) / length(old_metadata) <> 1 THEN
    RAISE EXCEPTION 'legacy_facility_diagnostics_timeline_predecessor_required';
  END IF;

  CREATE FUNCTION public.gridex_facility_domain_diagnostic_payload_v1(
    p_source text, p_event_type text, p_payload jsonb
  )
  RETURNS jsonb
  LANGUAGE sql IMMUTABLE SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $project$
    SELECT CASE WHEN (p_source,p_event_type) = ('facility_lookup_edifact_dispatch','facility_lookup.edifact_blocked')
      AND jsonb_typeof(p_payload) = 'object'
      THEN p_payload - ARRAY['technicalMessage','details']
      ELSE p_payload
    END
  $project$;
  REVOKE ALL ON FUNCTION public.gridex_facility_domain_diagnostic_payload_v1(text,text,jsonb)
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_facility_domain_diagnostic_payload_v1(text,text,jsonb) TO service_role;

  -- RLS cannot replace an individual field. Keep raw records under the canonical
  -- platform scope, and give ordinary staff a narrowed, read-only projection.
  CREATE POLICY legacy_facility_domain_diagnostics_platform_read ON public.domain_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (source,event_type) IS DISTINCT FROM ('facility_lookup_edifact_dispatch','facility_lookup.edifact_blocked')
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR NOT (payload ?| ARRAY['technicalMessage','details'])
    OR (SELECT public.gridex_user_is_platform_admin())
  );

  CREATE FUNCTION public.gridex_list_legacy_facility_domain_events_v1(
    p_company_id uuid, p_customer_id uuid, p_limit integer DEFAULT 50
  )
  RETURNS TABLE(
    id uuid, company_id uuid, subject_customer_id uuid, event_type text, event_version integer,
    source text, payload jsonb, occurred_at timestamptz, created_at timestamptz
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO pg_catalog
  AS $list$
  BEGIN
    IF current_setting('role', true) IS DISTINCT FROM 'authenticated'
      OR auth.role() IS DISTINCT FROM 'authenticated'
      OR public.gridex_is_current_session_allowed() IS NOT TRUE THEN
      RAISE EXCEPTION 'legacy_facility_domain_diagnostics_session_required' USING ERRCODE='42501';
    END IF;
    IF p_company_id IS NULL OR p_customer_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'legacy_facility_domain_diagnostics_scope_invalid' USING ERRCODE='22023';
    END IF;
    IF public.gridex_user_is_platform_admin() IS NOT TRUE AND NOT EXISTS (
      SELECT FROM public.gridex_user_company_ids() AS scope(company_id)
      WHERE scope.company_id = p_company_id AND public.gridex_can_read_company(p_company_id)
    ) THEN
      RAISE EXCEPTION 'legacy_facility_domain_diagnostics_company_required' USING ERRCODE='42501';
    END IF;
    IF gridex_correction_process.customer_retention_tombstoned_v1(p_company_id,p_customer_id) THEN
      RETURN;
    END IF;

    RETURN QUERY
    SELECT e.id,e.company_id,e.subject_customer_id,e.event_type,e.event_version,e.source,
      public.gridex_facility_domain_diagnostic_payload_v1(e.source,e.event_type,e.payload),e.occurred_at,e.created_at
    FROM public.domain_events e
    WHERE e.company_id = p_company_id AND e.subject_customer_id = p_customer_id
      AND e.source = 'facility_lookup_edifact_dispatch' AND e.event_type = 'facility_lookup.edifact_blocked'
      AND jsonb_typeof(e.payload) = 'object' AND e.payload ?| ARRAY['technicalMessage','details']
    ORDER BY e.occurred_at DESC,e.id DESC
    LIMIT p_limit;
  END
  $list$;
  REVOKE ALL ON FUNCTION public.gridex_list_legacy_facility_domain_events_v1(uuid,uuid,integer)
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_list_legacy_facility_domain_events_v1(uuid,uuid,integer) TO authenticated;

  EXECUTE 'CREATE OR REPLACE VIEW public.customer_ops_timeline_v WITH (security_invoker=true) AS '
    || replace(timeline_definition,old_metadata,new_metadata);
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_class c
    WHERE c.oid = timeline_oid AND c.relowner = timeline_before.relowner
      AND c.relacl IS NOT DISTINCT FROM timeline_before.relacl AND c.reloptions = timeline_before.reloptions
  ) THEN
    RAISE EXCEPTION 'legacy_facility_diagnostics_timeline_metadata_changed';
  END IF;
  PERFORM set_config('search_path',old_search_path,true);
END
$migration$;
