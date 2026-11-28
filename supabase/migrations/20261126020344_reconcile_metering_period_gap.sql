-- Private design/proof only. Both metering-gap ingress paths must adopt
-- this authority together. The existing unique gap producer stays insert-only.
CREATE FUNCTION public.gridex_reconcile_metering_period_gap_v1(
  p_company_id uuid,
  p_gap_id uuid,
  p_actor_user_id uuid,
  p_mode text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $$
DECLARE
  gap public.metering_period_gaps%rowtype;
  request public.outbound_requests%rowtype;
  follow_up public.customer_cases%rowtype;
  configured_grid_owner uuid;
  external_point text;
  request_key text;
  candidate_ids uuid[];
  request_created boolean:=false;
  case_created boolean:=false;
  case_request_linked boolean:=false;
  gap_changed boolean:=false;
  held_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'period_gap_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_gap_id IS NULL OR p_actor_user_id IS NULL
     OR p_mode IS NULL OR p_mode NOT IN ('motor','case_only') THEN
    RAISE EXCEPTION 'period_gap_command_invalid' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.companies
  WHERE id=p_company_id AND is_active IS DISTINCT FROM false
    AND coalesce(status,'active') NOT IN
      ('paused','suspended','inactive','closed','archived','pending_deletion','deleted','deleted_test_only')
  FOR SHARE;
  IF NOT FOUND OR (
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write')
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export')
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'cases.write')
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'period_gap_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;

  SELECT * INTO gap FROM public.metering_period_gaps
  WHERE company_id=p_company_id AND id=p_gap_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'period_gap_not_found' USING ERRCODE='P0002'; END IF;
  held_result:=jsonb_build_object('outcome','held','gapId',gap.id,'status',gap.status,
    'outboundRequestId',null,'customerCaseId',null,'requestCreated',false,'caseCreated',false,'gapChanged',false,'caseRequestLinked',false);
  IF gap.status IN ('resolved','ignored')
     OR (p_mode='motor' AND gap.status NOT IN ('open','request_queued')) THEN
    RETURN held_result;
  END IF;

  SELECT coalesce(m.grid_owner_id,s.grid_owner_id),coalesce(m.meter_point_id,m.metering_point_id)
    INTO configured_grid_owner,external_point
  FROM public.metering_points m
  JOIN public.customer_sites s ON s.id=gap.site_id AND s.company_id=m.company_id
  JOIN public.customers c ON c.id=s.customer_id AND c.company_id=s.company_id
  WHERE m.id=gap.metering_point_id AND m.company_id=gap.company_id
    AND s.customer_id=gap.customer_id AND (m.customer_id IS NULL OR m.customer_id=s.customer_id)
    AND (m.site_id IS NOT NULL OR m.customer_site_id IS NOT NULL)
    AND (m.site_id IS NULL OR m.site_id=s.id)
    AND (m.customer_site_id IS NULL OR m.customer_site_id=s.id)
  FOR SHARE OF m,s,c;
  IF NOT FOUND OR gap.period_month IS DISTINCT FROM to_char(gap.period_start,'YYYY-MM')
     OR gap.period_start IS DISTINCT FROM date_trunc('month',gap.period_start)::date
     OR gap.period_end IS DISTINCT FROM (gap.period_start+interval '1 month')::date THEN
    RAISE EXCEPTION 'period_gap_scope_changed' USING ERRCODE='23514';
  END IF;

  -- A completed value read after the gap lock supersedes the earlier scan's
  -- missing observation. Keep the same half-open UTC bounds as that scan.
  IF p_mode='motor' AND EXISTS (
    SELECT 1 FROM public.metering_values v
    WHERE v.company_id=gap.company_id AND v.metering_point_id=gap.metering_point_id
      AND v.period_start >= (gap.period_start::timestamp AT TIME ZONE 'UTC')
      AND v.period_start < (gap.period_end::timestamp AT TIME ZONE 'UTC')
  ) THEN
    RETURN held_result;
  END IF;

  request_key:='batch2c:meter-values:'||gap.metering_point_id::text||':'||gap.period_month;
  IF gap.outbound_request_id IS NULL THEN
    SELECT array_agg(id) INTO candidate_ids FROM (
      SELECT id FROM public.outbound_requests
      WHERE company_id=gap.company_id AND automation_key=request_key ORDER BY id LIMIT 2
    ) candidates;
    IF coalesce(cardinality(candidate_ids),0)>1 THEN
      RAISE EXCEPTION 'period_gap_request_ambiguous' USING ERRCODE='23514';
    END IF;
  ELSE
    candidate_ids:=ARRAY[gap.outbound_request_id];
  END IF;
  IF candidate_ids IS NOT NULL THEN
    SELECT * INTO request FROM public.outbound_requests
    WHERE company_id=gap.company_id AND id=candidate_ids[1] FOR UPDATE;
    IF NOT FOUND OR request.customer_id IS DISTINCT FROM gap.customer_id
       OR request.site_id IS DISTINCT FROM gap.site_id OR request.metering_point_id IS DISTINCT FROM gap.metering_point_id
       OR request.request_type IS DISTINCT FROM 'meter_values'
       OR request.source_type IS DISTINCT FROM 'bulk_generation'
       OR (request.source_id IS NOT NULL AND request.source_id<>gap.id)
       OR request.automation_origin IS DISTINCT FROM 'batch_2c_period_motor'
       OR request.automation_key IS DISTINCT FROM request_key
       OR request.period_start IS DISTINCT FROM gap.period_start OR request.period_end IS DISTINCT FROM gap.period_end THEN
      RAISE EXCEPTION 'period_gap_request_scope_changed' USING ERRCODE='23514';
    END IF;
  END IF;
  IF p_mode='motor' AND gap.status='request_queued' AND request.id IS NULL THEN
    RAISE EXCEPTION 'period_gap_queued_request_unavailable' USING ERRCODE='23514';
  END IF;

  IF gap.customer_case_id IS NULL THEN
    SELECT array_agg(id) INTO candidate_ids FROM (
      SELECT id FROM public.customer_cases
      WHERE company_id=gap.company_id AND source='batch_2c_operations'
        AND metadata->>'metering_period_gap_id'=gap.id::text ORDER BY id LIMIT 2
    ) candidates;
    IF coalesce(cardinality(candidate_ids),0)>1 THEN
      RAISE EXCEPTION 'period_gap_case_ambiguous' USING ERRCODE='23514';
    END IF;
  ELSE
    candidate_ids:=ARRAY[gap.customer_case_id];
  END IF;
  IF candidate_ids IS NOT NULL THEN
    SELECT * INTO follow_up FROM public.customer_cases
    WHERE company_id=gap.company_id AND id=candidate_ids[1] FOR UPDATE;
    IF NOT FOUND OR follow_up.customer_id IS DISTINCT FROM gap.customer_id
       OR follow_up.site_id IS DISTINCT FROM gap.site_id OR follow_up.metering_point_id IS DISTINCT FROM gap.metering_point_id
       OR follow_up.source IS DISTINCT FROM 'batch_2c_operations'
       OR follow_up.case_type IS DISTINCT FROM 'technical_blocker'
       OR follow_up.reason_category IS NULL OR follow_up.reason_category NOT IN ('missing_meter_values','metering_period_gap')
       OR (follow_up.metadata ? 'metering_period_gap_id' AND follow_up.metadata->>'metering_period_gap_id' IS DISTINCT FROM gap.id::text)
       OR (follow_up.outbound_request_id IS NOT NULL AND follow_up.outbound_request_id IS DISTINCT FROM request.id) THEN
      RAISE EXCEPTION 'period_gap_case_scope_changed' USING ERRCODE='23514';
    END IF;
    IF follow_up.status IN ('resolved','cancelled','closed') THEN
      RETURN held_result || jsonb_build_object('outcome','case_closed');
    END IF;
  END IF;

  IF request.customer_case_id IS NOT NULL AND request.customer_case_id IS DISTINCT FROM follow_up.id THEN
    RAISE EXCEPTION 'period_gap_request_case_scope_changed' USING ERRCODE='23514';
  END IF;

  IF p_mode='motor' AND request.id IS NULL THEN
    INSERT INTO public.outbound_requests(
      company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_type,source_type,source_id,
      status,channel_type,payload,period_start,period_end,automation_origin,automation_key,created_by,updated_by
    ) VALUES (
      gap.company_id,gap.customer_id,gap.site_id,gap.metering_point_id,configured_grid_owner,'meter_values','bulk_generation',gap.id,
      'queued','unresolved',jsonb_build_object('automation','batch_2c_period_motor','periodMonth',gap.period_month,
        'meterPointId',external_point,'periodStart',gap.period_start,'periodEnd',gap.period_end),
      gap.period_start,gap.period_end,'batch_2c_period_motor',request_key,p_actor_user_id,p_actor_user_id
    ) RETURNING * INTO request;
    request_created:=true;
  END IF;

  IF follow_up.id IS NULL THEN
    INSERT INTO public.customer_cases(
      company_id,customer_id,site_id,metering_point_id,outbound_request_id,case_type,status,priority,title,description,
      reason_category,billing_manual_review,next_action,source,metadata,created_by,updated_by
    ) VALUES (
      gap.company_id,gap.customer_id,gap.site_id,gap.metering_point_id,request.id,'technical_blocker','action_required','high',
      'Saknade mätvärden','Mätvärden saknas för '||gap.period_month||'.',
      'missing_meter_values',true,'Granska underlaget och komplettera saknade mätvärden.','batch_2c_operations',
      jsonb_build_object('metering_period_gap_id',gap.id,'periodMonth',gap.period_month,'meterPointId',external_point),
      p_actor_user_id,p_actor_user_id
    ) RETURNING * INTO follow_up;
    INSERT INTO public.customer_case_events(company_id,customer_case_id,customer_id,event_type,event_status,message,payload,created_by)
    VALUES (gap.company_id,follow_up.id,gap.customer_id,'created','info','Driftuppgift om saknade mätvärden registrerad.',
      jsonb_build_object('metering_period_gap_id',gap.id),p_actor_user_id);
    INSERT INTO public.audit_logs(company_id,actor_user_id,actor_type,entity_type,entity_id,resource_type,resource_id,action,new_values,metadata)
    VALUES (gap.company_id,p_actor_user_id,'user','customer_case',follow_up.id::text,'customer_case',follow_up.id::text,
      'customer_case_registered',jsonb_build_object('case_type',follow_up.case_type,'status',follow_up.status),
      jsonb_build_object('customer_id',gap.customer_id,'metering_period_gap_id',gap.id));
    case_created:=true;
  ELSIF follow_up.outbound_request_id IS NULL AND request.id IS NOT NULL THEN
    UPDATE public.customer_cases SET outbound_request_id=request.id,updated_by=p_actor_user_id,updated_at=now()
    WHERE company_id=gap.company_id AND id=follow_up.id;
    case_request_linked:=true;
  END IF;

  IF request.id IS NOT NULL AND request.customer_case_id IS NULL
     AND request.status='queued' AND request.channel_type='unresolved' THEN
    UPDATE public.outbound_requests SET customer_case_id=follow_up.id,updated_by=p_actor_user_id,updated_at=now()
    WHERE company_id=gap.company_id AND id=request.id;
  END IF;

  gap_changed:=gap.customer_case_id IS DISTINCT FROM follow_up.id
    OR (request.id IS NOT NULL AND gap.outbound_request_id IS NULL)
    OR (p_mode='motor' AND gap.status='open' AND request.id IS NOT NULL);
  IF gap_changed THEN
    UPDATE public.metering_period_gaps SET
      customer_case_id=follow_up.id,outbound_request_id=coalesce(gap.outbound_request_id,request.id),
      status=CASE WHEN p_mode='motor' AND gap.status='open' AND request.id IS NOT NULL THEN 'request_queued' ELSE gap.status END,
      updated_at=now()
    WHERE company_id=gap.company_id AND id=gap.id RETURNING * INTO gap;
  END IF;

  RETURN jsonb_build_object(
    'outcome','linked','gapId',gap.id,'status',gap.status,'outboundRequestId',request.id,'customerCaseId',follow_up.id,
    'requestCreated',request_created,'caseCreated',case_created,'gapChanged',gap_changed,'caseRequestLinked',case_request_linked);
END
$$;
REVOKE ALL ON FUNCTION public.gridex_reconcile_metering_period_gap_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_reconcile_metering_period_gap_v1(uuid,uuid,uuid,text) TO service_role;
