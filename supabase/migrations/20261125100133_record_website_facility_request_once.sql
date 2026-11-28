DO $migration$
BEGIN
CREATE FUNCTION public.gridex_record_website_facility_request_v1(
  p_company_id uuid,
  p_application_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_next_step text,
  p_warnings jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog
AS $function$
DECLARE
  application public.website_customer_applications%ROWTYPE;
  request public.grid_owner_information_requests%ROWTYPE;
  occurrence timestamptz := statement_timestamp();
  request_event constant text := 'grid_owner_information_request_created';
  action_key constant text := 'facility_data_requested';
  action_source constant text := 'website_application_review';
  entity_kind constant text := 'grid_owner_data_request';
  unit_name constant text := 'facility_data_request';
  action_label constant text := 'Anläggningsuppgifter begärda från nätägare';
  original_actor uuid;
  history jsonb;
  application_audit jsonb;
  effect_metadata jsonb;
  advance_application boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT (
    public.canonical_actor_is_platform_admin(p_actor_user_id) IS TRUE
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.write') IS TRUE
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'switching.write') IS TRUE
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS TRUE
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'poa.write') IS TRUE
  ) THEN
    RAISE EXCEPTION 'website_facility_request_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_application_id IS NULL OR p_request_id IS NULL
     OR coalesce(length(btrim(p_next_step)),0) NOT BETWEEN 1 AND 1000
     OR jsonb_typeof(p_warnings) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'website_facility_request_invalid_arguments' USING ERRCODE='22023';
  END IF;

  -- All website reviewers sharing a physical request serialize here. A retry
  -- can repair missing usage even if the original request or audit committed.
  SELECT * INTO request
  FROM public.grid_owner_information_requests r
  WHERE r.company_id=p_company_id AND r.id=p_request_id AND r.request_type='facility_lookup'
    AND r.status IN ('draft','ready_to_send','sent','waiting_response','needs_review')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'website_facility_request_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO application
  FROM public.website_customer_applications a
  WHERE a.company_id=p_company_id AND a.id=p_application_id
  FOR UPDATE;
  IF NOT FOUND OR request.customer_id IS DISTINCT FROM application.customer_id
     OR request.customer_site_id IS DISTINCT FROM application.customer_site_id
     OR (request.customer_site_id IS NULL AND request.customer_application_id IS DISTINCT FROM application.id) THEN
    RAISE EXCEPTION 'website_facility_request_scope_mismatch' USING ERRCODE='23514';
  END IF;

  history := CASE WHEN jsonb_typeof(application.timeline)='array' THEN application.timeline ELSE '[]'::jsonb END;
  application_audit := CASE WHEN jsonb_typeof(application.audit_log)='array' THEN application.audit_log ELSE '[]'::jsonb END;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(history) event
    WHERE event->>'type'=request_event AND event#>>'{metadata,request_id}'=request.id::text) THEN
    history := history||jsonb_build_array(jsonb_build_object(
      'type',request_event,'label','Begäran om anläggningsuppgifter skapades','occurred_at',occurrence,
      'metadata',jsonb_build_object('request_id',request.id,'status',request.status)
    ));
  END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(application_audit) event
    WHERE event->>'action'=request_event AND event#>>'{new_values,request,requestId}'=request.id::text) THEN
    application_audit := application_audit||jsonb_build_array(jsonb_build_object(
      'action',request_event,'actor_user_id',p_actor_user_id,'created_at',occurrence,'old_values','{}'::jsonb,
      'new_values',jsonb_build_object('request',jsonb_build_object(
        'requestId',request.id,'status',request.status,'channel',request.channel,
        'nextStep',p_next_step,'warnings',p_warnings,
        'routeId',coalesce(request.communication_route_id,request.contact_route_id,request.actor_route_id),
        'communicationRouteId',request.communication_route_id,'edielRouteProfileId',request.ediel_route_profile_id,
        'outboundRequestId',request.outbound_request_id,'edielMessageId',request.ediel_message_id,
        'operationId',request.operation_id,'dispatchStatus',request.dispatch_status
      ))
    ));
  END IF;

  -- A replay may repair missing audit or usage without restarting the lifecycle.
  advance_application := application.grid_owner_information_request_id IS DISTINCT FROM request.id
    AND application.status IN ('application_received','received','customer_created','customer_matched',
      'linked_existing_customer','needs_address_resolution','address_resolved','grid_area_resolved',
      'needs_information','needs_facility_data','pending_review','manual_review','facility_data_invalid',
      'customer_information_mismatch','needs_customer_correction','needs_grid_owner_followup')
    OR (application.grid_owner_information_request_id=request.id
      AND application.status='needs_facility_data' AND request.status='ready_to_send');
  UPDATE public.website_customer_applications a
  SET grid_owner_information_request_id=CASE WHEN advance_application THEN request.id ELSE a.grid_owner_information_request_id END,
      status=CASE WHEN NOT advance_application THEN a.status
                  WHEN request.status='ready_to_send' THEN 'information_request_ready' ELSE 'needs_facility_data' END,
      response_payload=CASE WHEN advance_application
        THEN (CASE WHEN jsonb_typeof(a.response_payload)='object' THEN a.response_payload ELSE '{}'::jsonb END)
          ||jsonb_build_object('grid_owner_information_request_id',request.id,
            'grid_owner_information_request_status',request.status,'grid_owner_information_request_channel',request.channel)
        ELSE a.response_payload END,
      next_step=CASE WHEN advance_application THEN p_next_step ELSE a.next_step END,
      warnings=CASE WHEN advance_application THEN p_warnings ELSE a.warnings END,
      timeline=history,audit_log=application_audit,updated_at=occurrence
  WHERE a.company_id=p_company_id AND a.id=application.id
    AND (advance_application OR history IS DISTINCT FROM a.timeline OR application_audit IS DISTINCT FROM a.audit_log);

  effect_metadata := jsonb_build_object('application_id',application.id,'request_status',request.status,
    'channel',request.channel,'next_step',p_next_step,'action_label',action_label,'source',action_source,'billable',true);
  SELECT a.actor_user_id INTO original_actor FROM public.audit_logs a
  WHERE a.company_id=p_company_id AND a.entity_type=entity_kind AND a.entity_id=request.id::text
    AND a.action=action_key AND a.metadata->>'source'=action_source
  ORDER BY a.created_at,a.id LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,metadata)
    VALUES(p_company_id,p_actor_user_id,entity_kind,request.id::text,action_key,effect_metadata);
  END IF;

  IF NOT EXISTS(SELECT FROM public.platform_usage_events u
    WHERE u.company_id=p_company_id AND u.entity_type=entity_kind AND u.entity_id=request.id::text
      AND u.event_key=action_key AND u.source=action_source AND u.billing_unit=unit_name AND u.is_billable) THEN
    INSERT INTO public.platform_usage_events(company_id,actor_user_id,customer_id,entity_type,entity_id,
      event_key,action_label,source,billable_quantity,billing_unit,is_billable,metadata)
    VALUES(p_company_id,coalesce(original_actor,p_actor_user_id),application.customer_id,entity_kind,request.id::text,
      action_key,action_label,action_source,1,unit_name,true,effect_metadata);
  END IF;
  RETURN request.id;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_record_website_facility_request_v1(uuid,uuid,uuid,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_record_website_facility_request_v1(uuid,uuid,uuid,uuid,text,jsonb)
  TO service_role;
END
$migration$;
