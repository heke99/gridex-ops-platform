CREATE FUNCTION public.gridex_scan_metering_period_points_v2(
  p_company_id uuid,
  p_month_starts date[],
  p_include_unlinked boolean,
  p_after_point_id uuid DEFAULT NULL
) RETURNS TABLE (
  point_id uuid,
  site_id uuid,
  customer_id uuid,
  grid_owner_id uuid,
  meter_point_id text,
  facility_id text,
  missing_months date[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO pg_catalog
AS $$
BEGIN
  IF p_company_id IS NULL OR p_include_unlinked IS NULL
    OR coalesce(cardinality(p_month_starts), 0) NOT BETWEEN 1 AND 36
    OR EXISTS (
      SELECT FROM unnest(p_month_starts) AS months(month_start)
      WHERE month_start IS NULL OR NOT isfinite(month_start)
        OR extract(day FROM month_start) IS DISTINCT FROM 1::numeric
        OR month_start < DATE '0001-01-01' OR month_start >= DATE '9999-12-01'
    )
  THEN
    RAISE EXCEPTION 'Ogiltigt periodurval.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT point.id AS point_id, site.id AS site_id, site.customer_id,
           coalesce(point.grid_owner_id, site.grid_owner_id) AS grid_owner_id,
           point.meter_point_id, site.facility_id
    FROM public.metering_points AS point
    LEFT JOIN public.customer_sites AS site
      ON site.id = point.site_id AND site.company_id = point.company_id
    WHERE point.company_id = p_company_id
      AND (p_include_unlinked OR site.id IS NOT NULL)
      AND (p_after_point_id IS NULL OR point.id > p_after_point_id)
    ORDER BY point.id
    LIMIT 200
  )
  SELECT page.point_id, page.site_id, page.customer_id, page.grid_owner_id,
         page.meter_point_id::text, page.facility_id::text,
         ARRAY(
           SELECT DISTINCT month_start
           FROM unnest(p_month_starts) AS months(month_start)
           WHERE (p_include_unlinked OR page.customer_id IS NOT NULL)
             AND NOT EXISTS (
               SELECT FROM public.metering_values AS value
               WHERE value.company_id = p_company_id
                 AND value.metering_point_id = page.point_id
                 AND value.period_start >= (month_start::timestamp AT TIME ZONE 'UTC')
                 AND value.period_start < ((month_start + INTERVAL '1 month') AT TIME ZONE 'UTC')
             )
           ORDER BY month_start
         )
  FROM page
  ORDER BY page.point_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gridex_scan_metering_period_points_v2(uuid,date[],boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_scan_metering_period_points_v2(uuid,date[],boolean,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gridex_scan_metering_period_gaps_v1(
  p_company_id uuid,
  p_month_starts date[],
  p_after_point_id uuid DEFAULT NULL
) RETURNS TABLE (
  point_id uuid,
  site_id uuid,
  customer_id uuid,
  grid_owner_id uuid,
  meter_point_id text,
  facility_id text,
  missing_months date[]
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO pg_catalog
AS $$
  SELECT * FROM public.gridex_scan_metering_period_points_v2(
    p_company_id, p_month_starts, false, p_after_point_id
  );
$$;

-- Local forward candidate extending the frozen 20261126020344 routine.
DO $migration$
DECLARE
  old_function record;
  signature constant text := 'public.gridex_reconcile_metering_period_gap_v1(uuid,uuid,uuid,text)';
BEGIN
  SELECT p.oid, to_jsonb(p)-'prosrc' AS metadata, encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256
  INTO old_function
  FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
  IF NOT FOUND OR old_function.body_sha256 IS DISTINCT FROM '23b39193fda5919a02f8c96ee24f60c81cb9ef2c6eb4d8a590724196325907e8'
    OR has_function_privilege('anon',old_function.oid,'EXECUTE')
    OR has_function_privilege('authenticated',old_function.oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',old_function.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'period_gap_predecessor_changed';
  END IF;
  EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.gridex_reconcile_metering_period_gap_v1(
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
  gap record;
  request record;
  follow_up record;
  configured_grid_owner uuid;
  external_point text;
  request_key text;
  legacy_request_key text;
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
     OR p_mode IS NULL OR p_mode NOT IN ('motor','case_only','request_only') THEN
    RAISE EXCEPTION 'period_gap_command_invalid' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.companies
  WHERE id=p_company_id AND is_active IS DISTINCT FROM false
    AND coalesce(status,'active') NOT IN
      ('paused','suspended','inactive','closed','archived','pending_deletion','deleted','deleted_test_only')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'period_gap_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_mode='request_only' AND
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS DISTINCT FROM true THEN
    IF (
      public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.write')
      OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export')
      OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'cases.write')
    ) IS TRUE THEN
      RETURN jsonb_build_object('outcome','held','gapId',p_gap_id,'status',null,
        'outboundRequestId',null,'customerCaseId',null,'requestCreated',false,'caseCreated',false,
        'gapChanged',false,'caseRequestLinked',false,'reason','capability_required');
    END IF;
    RAISE EXCEPTION 'period_gap_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;
  IF (
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
     OR (p_mode IN ('motor','request_only') AND gap.status NOT IN ('open','request_queued')) THEN
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
  IF p_mode IN ('motor','request_only') AND EXISTS (
    SELECT 1 FROM public.metering_values v
    WHERE v.company_id=gap.company_id AND v.metering_point_id=gap.metering_point_id
      AND v.period_start >= (gap.period_start::timestamp AT TIME ZONE 'UTC')
      AND v.period_start < (gap.period_end::timestamp AT TIME ZONE 'UTC')
  ) THEN
    RETURN held_result;
  END IF;

  request_key:='batch2c:meter-values:'||gap.metering_point_id::text||':'||gap.period_month;
  legacy_request_key:='missing-meter-values:'||gap.metering_point_id::text||':'||gap.period_month;
  SELECT array_agg(match.id) INTO candidate_ids FROM (
    SELECT r.id FROM public.outbound_requests r
    WHERE r.company_id=gap.company_id
      AND (r.automation_key IN (request_key,legacy_request_key) OR r.id=gap.outbound_request_id
        OR (r.source_type='bulk_generation' AND r.source_id=gap.id AND r.request_type='meter_values'))
    ORDER BY r.id LIMIT 2 FOR UPDATE
  ) match;
  IF coalesce(cardinality(candidate_ids),0)>1 THEN
    RAISE EXCEPTION 'period_gap_request_ambiguous' USING ERRCODE='23514';
  END IF;
  SELECT * INTO request FROM public.outbound_requests
  WHERE company_id=gap.company_id AND id=candidate_ids[1];
  IF gap.outbound_request_id IS NOT NULL OR candidate_ids IS NOT NULL THEN
    IF NOT FOUND OR (gap.outbound_request_id IS NOT NULL AND request.id<>gap.outbound_request_id)
       OR request.customer_id IS DISTINCT FROM gap.customer_id
       OR request.site_id IS DISTINCT FROM gap.site_id OR request.metering_point_id IS DISTINCT FROM gap.metering_point_id
       OR request.grid_owner_id IS DISTINCT FROM configured_grid_owner
       OR request.request_type IS DISTINCT FROM 'meter_values'
       OR request.source_type IS DISTINCT FROM 'bulk_generation'
       OR (
         (request.automation_key=request_key AND request.automation_origin='batch_2c_period_motor'
           AND (request.source_id IS NULL OR request.source_id=gap.id))
         OR (request.automation_key=legacy_request_key AND request.automation_origin='batch_2b_operations'
           AND request.source_id IS NULL)
       ) IS DISTINCT FROM true
       OR request.period_start IS DISTINCT FROM gap.period_start OR request.period_end IS DISTINCT FROM gap.period_end THEN
      RAISE EXCEPTION 'period_gap_request_scope_changed' USING ERRCODE='23514';
    END IF;
    IF p_mode IN ('motor','request_only') AND request.status IN ('failed','cancelled') THEN
      RETURN held_result || jsonb_build_object('reason','request_terminal');
    END IF;
  END IF;
  IF p_mode IN ('motor','request_only') AND gap.status='request_queued' AND request.id IS NULL THEN
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
  SELECT * INTO follow_up FROM public.customer_cases
  WHERE company_id=gap.company_id AND id=candidate_ids[1] FOR UPDATE;
  IF candidate_ids IS NOT NULL THEN
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

  IF p_mode IN ('motor','request_only') AND request.id IS NULL THEN
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

  IF p_mode='request_only' THEN
    gap_changed:=gap.outbound_request_id IS NULL OR gap.status='open';
    IF gap_changed THEN
      UPDATE public.metering_period_gaps SET outbound_request_id=request.id,status='request_queued',updated_at=now()
      WHERE company_id=gap.company_id AND id=gap.id RETURNING * INTO gap;
    END IF;
    RETURN jsonb_build_object('outcome','linked','gapId',gap.id,'status',gap.status,
      'outboundRequestId',request.id,'customerCaseId',follow_up.id,'requestCreated',request_created,
      'caseCreated',false,'gapChanged',gap_changed,'caseRequestLinked',false);
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
$ddl$;
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=old_function.oid) IS DISTINCT FROM old_function.metadata THEN
    RAISE EXCEPTION 'period_gap_function_metadata_changed';
  END IF;
END
$migration$;

-- Private successor of the qualified request_only owner.
DO $migration$
DECLARE
  target constant regprocedure := to_regprocedure('public.gridex_reconcile_metering_period_gap_v1(uuid,uuid,uuid,text)');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.prosecdef
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=
        'd81b8471bec765a6320c3b9fc82a5fc320c976f09d12fe9969951d3193d8872b'
  ) OR NOT pg_catalog.has_function_privilege('service_role',target,'EXECUTE')
    OR pg_catalog.has_function_privilege('anon',target,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',target,'EXECUTE') THEN
    RAISE EXCEPTION 'batch2b_metering_reconciler_predecessor_changed';
  END IF;
END
$migration$;

CREATE FUNCTION public.gridex_prepare_batch2b_metering_request_v1(
  p_company_id uuid,
  p_point_id uuid,
  p_month_start date,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $$
DECLARE
  scope record;
  period_month_key text;
  month_end date;
  held_result jsonb;
  gap_id uuid;
  gap_created boolean:=false;
  effect jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'batch2b_metering_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_point_id IS NULL OR p_month_start IS NULL
    OR NOT isfinite(p_month_start) OR extract(day FROM p_month_start) IS DISTINCT FROM 1::numeric
    OR p_month_start<DATE '0001-01-01' OR p_month_start>=DATE '9999-12-01' THEN
    RAISE EXCEPTION 'batch2b_metering_command_invalid' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.companies c WHERE c.id=p_company_id
    AND c.is_active IS DISTINCT FROM false AND c.is_paused IS NOT TRUE
    AND coalesce(c.status,'active') NOT IN
      ('paused','suspended','inactive','closed','archived','pending_deletion','deleted','deleted_test_only')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch2b_metering_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;

  period_month_key:=to_char(p_month_start,'YYYY-MM');
  month_end:=(p_month_start+interval '1 month')::date;
  held_result:=jsonb_build_object('pointId',p_point_id,'periodMonth',period_month_key,'outcome','held',
    'gapId',null,'status',null,'outboundRequestId',null,'customerCaseId',null,
    'gapCreated',false,'requestCreated',false,'caseCreated',false,'gapChanged',false,'caseRequestLinked',false);

  IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS DISTINCT FROM true THEN
    IF (
      public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.write')
      OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export')
      OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'cases.write')
    ) IS TRUE THEN
      RETURN held_result || jsonb_build_object('reason','capability_required');
    END IF;
    RAISE EXCEPTION 'batch2b_metering_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;

  -- The inner command acquires the point/site/customer locks after the gap.
  -- This initial scope read does not take those row locks in reverse order.
  SELECT s.id AS site_id,s.customer_id,coalesce(m.grid_owner_id,s.grid_owner_id) AS grid_owner_id,
    coalesce(m.meter_point_id,m.metering_point_id) AS external_point,s.facility_id
  INTO scope
  FROM public.metering_points m
  JOIN public.customer_sites s ON s.id=coalesce(m.customer_site_id,m.site_id) AND s.company_id=m.company_id
  JOIN public.customers c ON c.id=s.customer_id AND c.company_id=s.company_id
  WHERE m.company_id=p_company_id AND m.id=p_point_id
    AND (m.customer_id IS NULL OR m.customer_id=s.customer_id)
    AND (m.site_id IS NULL OR m.site_id=s.id)
    AND (m.customer_site_id IS NULL OR m.customer_site_id=s.id);
  IF NOT FOUND THEN
    RETURN held_result || jsonb_build_object('reason','metering_scope_unavailable');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.metering_values v
    WHERE v.company_id=p_company_id AND v.metering_point_id=p_point_id
      AND v.period_start >= (p_month_start::timestamp AT TIME ZONE 'UTC')
      AND v.period_start < (month_end::timestamp AT TIME ZONE 'UTC')
  ) THEN
    RETURN held_result || jsonb_build_object('reason','meter_already_present');
  END IF;

  BEGIN
    SELECT g.id INTO gap_id FROM public.metering_period_gaps g
    WHERE g.company_id=p_company_id AND g.metering_point_id=p_point_id AND g.period_month=period_month_key FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.metering_period_gaps(
        company_id,customer_id,site_id,metering_point_id,grid_owner_id,period_month,period_start,period_end,
        status,severity,metadata,created_by
      ) VALUES (
        p_company_id,scope.customer_id,scope.site_id,p_point_id,scope.grid_owner_id,period_month_key,p_month_start,month_end,
        'open','warning',jsonb_build_object('meterPointId',scope.external_point,'siteFacilityId',scope.facility_id,
          'detectedBy','batch_2b_operations'),p_actor_user_id
      ) ON CONFLICT (company_id,metering_point_id,period_month) DO NOTHING
      RETURNING id INTO gap_id;
      gap_created:=FOUND;
      IF NOT gap_created THEN
        SELECT g.id INTO gap_id FROM public.metering_period_gaps g
        WHERE g.company_id=p_company_id AND g.metering_point_id=p_point_id AND g.period_month=period_month_key FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'batch2b_metering_gap_lookup_changed' USING ERRCODE='40001';
        END IF;
      END IF;
    END IF;

    effect:=public.gridex_reconcile_metering_period_gap_v1(p_company_id,gap_id,p_actor_user_id,'request_only');
    IF gap_created AND effect->>'outcome'<>'linked' THEN
      -- Rolling back the private subtransaction also discards INSERT trigger effects.
      RAISE EXCEPTION 'batch2b_metering_discard_new_gap' USING ERRCODE='PZB01';
    END IF;
  EXCEPTION WHEN SQLSTATE 'PZB01' THEN
    IF NOT gap_created OR effect IS NULL OR effect->>'outcome'='linked' THEN RAISE; END IF;
    RETURN held_result || jsonb_build_object('reason',coalesce(effect->>'reason','not_actionable_after_insert'));
  END;

  RETURN effect || jsonb_build_object('pointId',p_point_id,'periodMonth',period_month_key,'gapCreated',gap_created);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_prepare_batch2b_metering_request_v1(uuid,uuid,date,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_batch2b_metering_request_v1(uuid,uuid,date,uuid) TO service_role;
