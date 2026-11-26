CREATE FUNCTION public.gridex_reconcile_partner_export_case_v1(
  p_company_id uuid,
  p_export_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $$
DECLARE
  export_row public.partner_exports%rowtype;
  follow_up public.customer_cases%rowtype;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'partner_export_case_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_export_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'partner_export_case_command_invalid' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.companies
  WHERE id=p_company_id AND is_active IS DISTINCT FROM false
    AND coalesce(status,'active') NOT IN
      ('paused','suspended','inactive','closed','archived','pending_deletion','deleted','deleted_test_only')
  FOR SHARE;
  IF NOT FOUND OR (
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'cases.write')
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write')
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export')
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'partner_export_case_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;

  SELECT * INTO export_row FROM public.partner_exports
  WHERE company_id=p_company_id AND id=p_export_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_export_case_source_not_found' USING ERRCODE='P0002';
  END IF;
  IF export_row.status NOT IN ('queued','failed') OR export_row.customer_id IS NULL THEN
    RETURN jsonb_build_object('outcome','held','partnerExportId',export_row.id,
      'customerCaseId',null,'caseCreated',false);
  END IF;

  PERFORM 1 FROM public.customers
  WHERE id=export_row.customer_id AND company_id=p_company_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_export_case_customer_scope_invalid' USING ERRCODE='23514';
  END IF;
  IF export_row.site_id IS NOT NULL THEN
    PERFORM 1 FROM public.customer_sites WHERE id=export_row.site_id
      AND company_id=p_company_id AND customer_id=export_row.customer_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'partner_export_case_site_scope_invalid' USING ERRCODE='23514';
    END IF;
  END IF;
  IF export_row.metering_point_id IS NOT NULL THEN
    PERFORM 1 FROM public.metering_points m
    JOIN public.customer_sites s ON s.id=m.site_id AND s.company_id=m.company_id
    WHERE m.id=export_row.metering_point_id AND m.company_id=p_company_id
      AND s.customer_id=export_row.customer_id
      AND (export_row.site_id IS NULL OR s.id=export_row.site_id)
    FOR SHARE OF m,s;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'partner_export_case_meter_scope_invalid' USING ERRCODE='23514';
    END IF;
  END IF;

  IF export_row.customer_case_id IS NOT NULL THEN
    SELECT * INTO follow_up FROM public.customer_cases
    WHERE id=export_row.customer_case_id AND company_id=p_company_id
      AND customer_id=export_row.customer_id
      AND site_id IS NOT DISTINCT FROM export_row.site_id
      AND metering_point_id IS NOT DISTINCT FROM export_row.metering_point_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'partner_export_case_existing_link_invalid' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('outcome','linked','partnerExportId',export_row.id,
      'customerCaseId',follow_up.id,'caseCreated',false);
  END IF;

  INSERT INTO public.customer_cases(
    company_id,customer_id,site_id,metering_point_id,case_type,status,priority,title,description,
    reason_category,next_action,source,metadata,created_by,updated_by
  ) VALUES (
    p_company_id,export_row.customer_id,export_row.site_id,export_row.metering_point_id,
    'technical_blocker','action_required',
    CASE WHEN export_row.status='failed' THEN 'high' ELSE 'normal' END,
    'Partnerexport kräver uppföljning','Partnerexporten behöver följas upp i exportflödet.',
    'partner_export','Granska exportens status och kvittens i partnerexporten.',
    'batch_2c_operations',jsonb_build_object('partner_export_id',export_row.id),
    p_actor_user_id,p_actor_user_id
  ) RETURNING * INTO follow_up;

  INSERT INTO public.customer_case_events(
    company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by
  ) VALUES (
    p_company_id,follow_up.id,export_row.customer_id,'created','info',
    'Driftuppgift för partnerexport registrerad.',
    jsonb_build_object('partner_export_id',export_row.id),p_actor_user_id
  );

  INSERT INTO public.audit_logs(
    company_id,actor_user_id,actor_type,entity_type,entity_id,resource_type,resource_id,action,new_values,metadata
  ) VALUES (
    p_company_id,p_actor_user_id,'user','customer_case',follow_up.id::text,'customer_case',follow_up.id::text,
    'customer_case_registered',jsonb_build_object('case_type',follow_up.case_type,'status',follow_up.status),
    jsonb_build_object('customer_id',export_row.customer_id,'partner_export_id',export_row.id)
  );

  UPDATE public.partner_exports SET customer_case_id=follow_up.id
  WHERE company_id=p_company_id AND id=export_row.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_export_case_attachment_not_saved' USING ERRCODE='23514';
  END IF;

  RETURN jsonb_build_object('outcome','linked','partnerExportId',export_row.id,
    'customerCaseId',follow_up.id,'caseCreated',true);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_reconcile_partner_export_case_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_reconcile_partner_export_case_v1(uuid,uuid,uuid) TO service_role;
