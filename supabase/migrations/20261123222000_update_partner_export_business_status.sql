DO $migration$
BEGIN
  CREATE FUNCTION public.gridex_update_partner_export_business_v1(
    p_export_id uuid, p_company_id uuid, p_customer_id uuid, p_actor_id uuid,
    p_original_status text, p_changes jsonb
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $function$
  DECLARE
    next_status text := p_changes->>'status';
    changed_at timestamptz := clock_timestamp();
    updated_export public.partner_exports;
  BEGIN
    IF p_export_id IS NULL OR p_company_id IS NULL OR p_customer_id IS NULL OR p_actor_id IS NULL
      OR (p_original_status IN ('queued','sent','acknowledged','failed','cancelled')) IS NOT TRUE
      OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
      OR p_changes = '{}'::jsonb
      OR p_changes - ARRAY['status','external_reference','failure_reason','admin_note'] <> '{}'::jsonb
      OR (p_changes ? 'status' AND
        (next_status IN ('queued','sent','acknowledged','failed','cancelled')
          AND next_status <> p_original_status) IS NOT TRUE)
      OR EXISTS (
        SELECT FROM jsonb_each(p_changes - 'status') AS field(key,value)
        WHERE jsonb_typeof(field.value) NOT IN ('string','null')
      ) THEN
      RAISE EXCEPTION 'Ogiltig ändring av partnerexport.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.partner_exports AS export
    SET status = coalesce(next_status, export.status),
        external_reference = CASE WHEN p_changes ? 'external_reference' THEN p_changes->>'external_reference' ELSE export.external_reference END,
        failure_reason = CASE WHEN p_changes ? 'failure_reason' THEN p_changes->>'failure_reason' ELSE export.failure_reason END,
        response_payload = CASE WHEN p_changes ? 'admin_note'
          THEN jsonb_set(export.response_payload, '{admin_note}', p_changes->'admin_note', true)
          ELSE export.response_payload END,
        sent_at = CASE WHEN next_status = 'sent' THEN changed_at ELSE export.sent_at END,
        acknowledged_at = CASE WHEN next_status = 'acknowledged' THEN changed_at ELSE export.acknowledged_at END,
        failed_at = CASE WHEN next_status = 'failed' THEN changed_at ELSE export.failed_at END,
        last_partner_response_at = CASE WHEN next_status IS NOT NULL THEN changed_at ELSE export.last_partner_response_at END,
        updated_by = p_actor_id
    WHERE export.id = p_export_id AND export.company_id = p_company_id AND export.customer_id = p_customer_id
      AND (next_status IS NULL OR export.status = p_original_status)
      AND (NOT p_changes ? 'admin_note' OR jsonb_typeof(export.response_payload) = 'object')
    RETURNING export.* INTO updated_export;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Partnerexporten har ändrats eller är inte tillgänglig. Ladda om sidan.' USING ERRCODE = 'P0002';
    END IF;
    RETURN to_jsonb(updated_export);
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.gridex_update_partner_export_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_update_partner_export_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    TO service_role;
  -- Confirm the pinned implementation before replacing the two provider result
  -- assignments. Provider history continues to retain the full original reply.
  IF (
    SELECT encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex')
    FROM pg_proc AS f
    WHERE f.oid = to_regprocedure('public.gridex_apply_billing_export_partner_result(uuid,uuid,uuid[],jsonb,jsonb,uuid)')
  ) IS DISTINCT FROM 'fda075c192c422b23a710ae2bd12982c3d54cc5bcd7ca75cc69b46cc00c1b6d1' THEN
    RAISE EXCEPTION 'billing_export_partner_result_predecessor_changed';
  END IF;

  CREATE OR REPLACE FUNCTION public.gridex_apply_billing_export_partner_result(p_company_id uuid, p_export_run_id uuid, p_accepted_ids uuid[] DEFAULT '{}'::uuid[], p_rejected jsonb DEFAULT '[]'::jsonb, p_response jsonb DEFAULT '{}'::jsonb, p_actor_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'public', 'extensions', 'pg_temp'
      AS $provider$
  declare v_target_count integer; v_accounted_count integer; v_unknown_count integer; v_rejected_count integer;
  begin
    if jsonb_typeof(coalesce(p_rejected,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='rejected_rows_must_be_array'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_export_run_id::text||':partner-result',0));
    perform 1 from public.billing_export_runs where id=p_export_run_id and company_id=p_company_id for update;
    if not found then raise exception using errcode='P0002',message='billing_export_run_not_found'; end if;
    select count(*) into v_target_count from public.billing_export_run_items
     where company_id=p_company_id and billing_export_run_id=p_export_run_id and status in ('ready','ready_for_retry') and export_status='queued';
    select count(distinct id) into v_accounted_count from (
      select unnest(coalesce(p_accepted_ids,'{}'::uuid[])) id
      union all
      select nullif(x->>'id','')::uuid from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x
    ) q;
    select count(*) into v_unknown_count from (
      select unnest(coalesce(p_accepted_ids,'{}'::uuid[])) id
      union all select nullif(x->>'id','')::uuid from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x
    ) q where q.id is null or not exists(select 1 from public.billing_export_run_items i where i.id=q.id and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id and i.status in ('ready','ready_for_retry') and i.export_status='queued');
    if v_unknown_count>0 or v_accounted_count<>v_target_count then raise exception using errcode='23514',message='partner_row_acknowledgement_incomplete_or_unknown'; end if;
    if exists(select 1 from unnest(coalesce(p_accepted_ids,'{}'::uuid[])) a join jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x on nullif(x->>'id','')::uuid=a) then
      raise exception using errcode='23514',message='partner_row_both_accepted_and_rejected';
    end if;
    update public.billing_export_run_items set export_status='sent',partner_result_type='accepted',sent_at=now(),failed_at=null,last_error=null,sent_by=p_actor_user_id,
      partner_response_log=coalesce(partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now()
    where company_id=p_company_id and billing_export_run_id=p_export_run_id and export_status='queued' and id=any(coalesce(p_accepted_ids,'{}'::uuid[]));
    update public.partner_exports p set status='sent',sent_at=now(),failure_reason=null,response_payload=CASE WHEN jsonb_typeof(p_response) = 'object'
        THEN (p_response - 'admin_note') || CASE WHEN p.response_payload ? 'admin_note'
          THEN jsonb_build_object('admin_note',p.response_payload->'admin_note') ELSE '{}'::jsonb END
        ELSE p_response END,
      partner_response_log=coalesce(p.partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now(),updated_by=p_actor_user_id
    from public.billing_export_run_items i where i.partner_export_id=p.id and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id and i.id=any(coalesce(p_accepted_ids,'{}'::uuid[]));
    with rejected as (select nullif(x->>'id','')::uuid id,coalesce(nullif(x->>'error',''),'Fakturapartnern avvisade raden.') error from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x)
    update public.billing_export_run_items i set export_status='failed',status='ready_for_retry',
      partner_result_type=case when nullif(p_response->>'error','') is null then 'rejected' else 'transport_failed' end,
      failed_at=now(),last_error=r.error,
      partner_response_log=coalesce(i.partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now()
    from rejected r where i.id=r.id and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id and i.export_status='queued';
    with rejected as (select nullif(x->>'id','')::uuid id,coalesce(nullif(x->>'error',''),'Fakturapartnern avvisade raden.') error from jsonb_array_elements(coalesce(p_rejected,'[]'::jsonb)) x)
    update public.partner_exports p set status='failed',failed_at=now(),failure_reason=r.error,response_payload=CASE WHEN jsonb_typeof(p_response) = 'object'
        THEN (p_response - 'admin_note') || CASE WHEN p.response_payload ? 'admin_note'
          THEN jsonb_build_object('admin_note',p.response_payload->'admin_note') ELSE '{}'::jsonb END
        ELSE p_response END,
      partner_response_log=coalesce(p.partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),retry_count=p.retry_count+1,updated_at=now(),updated_by=p_actor_user_id
    from rejected r, public.billing_export_run_items i
    where i.id=r.id and i.partner_export_id=p.id
      and i.company_id=p_company_id and i.billing_export_run_id=p_export_run_id;
    select jsonb_array_length(coalesce(p_rejected,'[]'::jsonb)) into v_rejected_count;
    update public.billing_export_runs set partner_response_log=coalesce(partner_response_log,'[]'::jsonb)||jsonb_build_array(p_response),last_partner_response_at=now(),updated_at=now() where id=p_export_run_id and company_id=p_company_id;
    perform public.gridex_refresh_billing_export_run(p_company_id,p_export_run_id);
    return jsonb_build_object('accepted',coalesce(cardinality(p_accepted_ids),0),'rejected',v_rejected_count);
  end $provider$;
END
$migration$;
