-- Private Batch2C design and proof. Both existing task writers must adopt this command.
CREATE FUNCTION public.gridex_ensure_billing_export_blocker_task_v1(
  p_company_id uuid,
  p_item_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
SET lock_timeout TO '5s'
AS $$
DECLARE
  item record;
  task record;
  run_id uuid;
  run_status text;
  candidate_ids uuid[];
  task_id uuid;
  item_key text;
  automation_key text;
  outcome text;
  hold_reason text;
  linked boolean:=false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'billing_export_blocker_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_item_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'billing_export_blocker_command_invalid' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.companies
  WHERE id=p_company_id AND is_active IS DISTINCT FROM false AND is_paused IS NOT TRUE
    AND coalesce(status,'active') NOT IN
      ('paused','suspended','inactive','closed','archived','pending_deletion','deleted','deleted_test_only')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_export_blocker_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;
  IF (
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export')
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'cases.write')
  ) IS DISTINCT FROM true THEN
    IF (
      public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write')
      OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'customers.write')
    ) IS TRUE THEN
      RETURN jsonb_build_object('itemId',p_item_id,'outcome','held','taskId',null,
        'taskCreated',false,'linked',false,'reason','capability_required');
    END IF;
    RAISE EXCEPTION 'billing_export_blocker_actor_or_company_forbidden' USING ERRCODE='42501';
  END IF;

  -- The run is locked before the item, like the existing export/result writers.
  SELECT i.billing_export_run_id INTO run_id FROM public.billing_export_run_items i
  WHERE i.company_id=p_company_id AND i.id=p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_export_blocker_item_not_found' USING ERRCODE='P0002';
  END IF;
  SELECT r.status INTO run_status FROM public.billing_export_runs r
  WHERE r.company_id=p_company_id AND r.id=run_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_export_blocker_run_scope_changed' USING ERRCODE='23514';
  END IF;
  SELECT * INTO item FROM public.billing_export_run_items
  WHERE company_id=p_company_id AND id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_export_blocker_item_not_found' USING ERRCODE='P0002';
  END IF;
  IF item.billing_export_run_id IS DISTINCT FROM run_id
    OR (item.export_run_id IS NOT NULL AND item.export_run_id<>run_id) THEN
    RAISE EXCEPTION 'billing_export_blocker_run_scope_changed' USING ERRCODE='23514';
  END IF;

  IF item.status<>'blocked' OR item.export_status IN ('queued','sent','acknowledged')
    OR item.partner_result_type='accepted' OR run_status='cancelled' THEN
    hold_reason:='not_blocked';
  ELSIF item.customer_id IS NULL THEN
    hold_reason:='customer_unbound';
  END IF;
  IF hold_reason IS NOT NULL THEN
    RETURN jsonb_build_object('itemId',p_item_id,'outcome','held','taskId',null,
      'taskCreated',false,'linked',false,'reason',hold_reason);
  END IF;

  -- A customer-level blocker can legitimately lack a site, meter or contract.
  IF NOT EXISTS (SELECT FROM public.customers c
      WHERE c.company_id=item.company_id AND c.id=item.customer_id)
    OR (item.site_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.customer_sites s
      WHERE s.company_id=item.company_id AND s.id=item.site_id AND s.customer_id=item.customer_id))
    OR (item.metering_point_id IS NOT NULL AND NOT EXISTS (
      SELECT FROM public.metering_points m
      LEFT JOIN public.customer_sites s ON s.id=coalesce(m.customer_site_id,m.site_id)
        AND s.company_id=m.company_id
      WHERE m.company_id=item.company_id AND m.id=item.metering_point_id
        AND (m.customer_id IS NOT NULL OR s.customer_id IS NOT NULL)
        AND (m.customer_id IS NULL OR m.customer_id=item.customer_id)
        AND (coalesce(m.customer_site_id,m.site_id) IS NULL OR s.customer_id=item.customer_id)
        AND (m.site_id IS NULL OR m.customer_site_id IS NULL OR m.site_id=m.customer_site_id)
        AND (item.site_id IS NULL OR coalesce(m.customer_site_id,m.site_id)=item.site_id)))
    OR (item.contract_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.customer_contracts c
      WHERE c.company_id=item.company_id AND c.id=item.contract_id AND c.customer_id=item.customer_id))
    OR (item.billing_underlay_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.billing_underlays u
      WHERE u.company_id=item.company_id AND u.id=item.billing_underlay_id AND u.customer_id=item.customer_id)) THEN
    RAISE EXCEPTION 'billing_export_blocker_item_scope_changed' USING ERRCODE='23514';
  END IF;

  item_key:=item.id::text;
  automation_key:='billing-export-blocker:'||item_key;
  SELECT array_agg(matched.id) INTO candidate_ids FROM (
    SELECT t.id FROM public.customer_operation_tasks t
    WHERE t.company_id=item.company_id AND t.customer_id=item.customer_id
      AND t.task_type='billing_export_blocker'
      AND (t.metadata->>'exportRunItemId'=item_key OR t.metadata->>'billingExportRunItemId'=item_key
        OR t.metadata->>'automationKey'=automation_key)
    ORDER BY t.id LIMIT 2 FOR UPDATE
  ) matched;
  IF coalesce(cardinality(candidate_ids),0)>1 THEN
    RAISE EXCEPTION 'billing_export_blocker_task_ambiguous' USING ERRCODE='23514';
  END IF;
  task_id:=coalesce(item.blocker_case_id,candidate_ids[1]);
  IF task_id IS NOT NULL THEN
    SELECT * INTO task FROM public.customer_operation_tasks
    WHERE company_id=item.company_id AND id=task_id FOR UPDATE;
    IF NOT FOUND OR task.id IS DISTINCT FROM candidate_ids[1] OR task.customer_id IS DISTINCT FROM item.customer_id
      OR task.site_id IS DISTINCT FROM item.site_id OR task.metering_point_id IS DISTINCT FROM item.metering_point_id
      OR task.task_type IS DISTINCT FROM 'billing_export_blocker'
      OR (task.metadata->>'source' IS NOT DISTINCT FROM 'billing_export_blocker'
        AND (task.metadata->>'exportRunItemId',task.metadata->>'exportRunId') IS DISTINCT FROM (item_key,run_id::text))
      OR (task.metadata->>'source' IS NOT DISTINCT FROM 'batch_2b_operations'
        AND (task.metadata->>'billingExportRunItemId',task.metadata->>'automationKey') IS DISTINCT FROM (item_key,automation_key))
      OR (coalesce(task.metadata->>'source','') NOT IN ('billing_export_blocker','batch_2b_operations'))
      OR (task.metadata ? 'billingExportRunItemId' AND task.metadata->>'billingExportRunItemId' IS DISTINCT FROM item_key)
      OR (task.metadata ? 'exportRunItemId' AND task.metadata->>'exportRunItemId' IS DISTINCT FROM item_key)
      OR (task.metadata ? 'automationKey' AND task.metadata->>'automationKey' IS DISTINCT FROM automation_key)
      OR (task.metadata ? 'exportRunId' AND task.metadata->>'exportRunId' IS DISTINCT FROM run_id::text)
      OR (task.metadata ? 'billingUnderlayId' AND task.metadata->>'billingUnderlayId' IS DISTINCT FROM item.billing_underlay_id::text)
      OR (task.metadata ? 'contractId' AND task.metadata->>'contractId' IS DISTINCT FROM item.contract_id::text) THEN
      RAISE EXCEPTION 'billing_export_blocker_task_scope_changed' USING ERRCODE='23514';
    END IF;
    IF task.status NOT IN ('open','in_progress','blocked') THEN
      RETURN jsonb_build_object('itemId',p_item_id,'outcome','held','taskId',task_id,
        'taskCreated',false,'linked',false,'reason','task_terminal');
    END IF;
    outcome:='reused';
  ELSE
    INSERT INTO public.customer_operation_tasks
      (company_id,customer_id,site_id,metering_point_id,task_type,status,priority,title,description,
       metadata,created_by,updated_by)
    VALUES (item.company_id,item.customer_id,item.site_id,item.metering_point_id,'billing_export_blocker','open','high',
      'Faktureringsrad blockerad','Faktureringsunderlaget behöver granskas innan den här raden kan exporteras.',
      jsonb_build_object('reasonCategory','billing_export_blocker','billingBlocked',true,'billingManualReview',true,
        'nextAction','Granska blockeraren i faktureringsunderlaget och kör om den berörda raden.',
        'source','billing_export_blocker','contractId',item.contract_id,'exportRunId',run_id,
        'exportRunItemId',item.id,'billingExportRunItemId',item.id,'billingUnderlayId',item.billing_underlay_id,
        'automationKey',automation_key),
      p_actor_user_id,p_actor_user_id)
    RETURNING id INTO task_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'billing_export_blocker_task_insert_missing' USING ERRCODE='23514';
    END IF;
    outcome:='created';
  END IF;
  IF item.blocker_case_id IS NULL THEN
    UPDATE public.billing_export_run_items SET blocker_case_id=task_id,updated_at=clock_timestamp()
    WHERE company_id=item.company_id AND id=item.id AND blocker_case_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'billing_export_blocker_task_link_missing' USING ERRCODE='23514';
    END IF;
    linked:=true;
  END IF;
  RETURN jsonb_build_object('itemId',p_item_id,'outcome',outcome,'taskId',task_id,
    'taskCreated',outcome='created','linked',linked,'reason',null);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_ensure_billing_export_blocker_task_v1(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ensure_billing_export_blocker_task_v1(uuid,uuid,uuid) TO service_role;
