-- Apply this database owner and its migration receipt atomically.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN
CREATE FUNCTION public.gridex_record_inbound_overdue_task_v1(
  p_company_id uuid, p_request_id uuid, p_monitor text,
  p_checked_at timestamptz, p_deadline_minutes integer
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'pg_catalog'
AS $body$
DECLARE
  request public.outbound_requests%ROWTYPE;
  overdue_task_type text;
  task_title text;
  task_description text;
  source_time timestamptz;
  existing_task boolean;
BEGIN
  IF p_company_id IS NULL OR p_request_id IS NULL OR p_checked_at IS NULL
     OR p_deadline_minutes IS NULL OR p_deadline_minutes < 0
     OR p_monitor IS NULL OR p_monitor NOT IN ('ack_overdue','z04_overdue','z14_overdue') THEN
    RAISE EXCEPTION 'inbound_overdue_invalid_input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO request FROM public.outbound_requests r
    WHERE r.company_id = p_company_id AND r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_monitor = 'ack_overdue' THEN
    IF request.status NOT IN ('sent','prepared','queued') OR request.acknowledged_at IS NOT NULL THEN
      RETURN false;
    END IF;
    source_time := request.sent_at;
    overdue_task_type := 'ediel_ack_overdue';
    task_title := 'Ediel-kvittens saknas';
    task_description := format('Utskick %s har varit skickat längre än %s minuter utan säker inbound-kvittens.',request.id,p_deadline_minutes);
  ELSE
    IF request.status NOT IN ('syntax_accepted','application_accepted','acknowledged')
       OR request.message_code IS DISTINCT FROM (CASE p_monitor WHEN 'z04_overdue' THEN 'Z03' ELSE 'Z13' END) THEN
      RETURN false;
    END IF;
    source_time := request.acknowledged_at;
    IF p_monitor = 'z04_overdue' THEN
      overdue_task_type := 'ediel_z04_overdue';
      task_title := 'Z04-svar saknas';
      task_description := format('Leverantörsbyte %s har kvitterats tekniskt men saknar Z04 efter %s minuter.',request.id,p_deadline_minutes);
    ELSE
      overdue_task_type := 'ediel_z14_overdue';
      task_title := 'Z14-svar saknas';
      task_description := format('Mätvärdesåtkomst %s har kvitterats tekniskt men saknar Z14 efter %s minuter.',request.id,p_deadline_minutes);
    END IF;
  END IF;
  IF source_time IS NULL OR source_time >= p_checked_at - make_interval(mins => p_deadline_minutes) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (SELECT FROM public.customer_operation_tasks t
    WHERE t.company_id = request.company_id AND t.task_type = overdue_task_type
      AND t.status = 'open' AND t.metadata @> jsonb_build_object('sourceId',request.id)
  ) INTO existing_task;

  UPDATE public.outbound_requests r SET status = 'waiting_attention', updated_at = p_checked_at, failure_reason = task_title
    WHERE r.company_id = request.company_id AND r.id = request.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inbound_overdue_request_update_rejected';
  END IF;
  IF existing_task THEN RETURN true; END IF;

  INSERT INTO public.customer_operation_tasks (
    company_id,customer_id,site_id,metering_point_id,task_type,status,priority,title,description,metadata
  ) VALUES (
    request.company_id,request.customer_id,request.site_id,request.metering_point_id,overdue_task_type,'open','high',task_title,task_description,
    jsonb_build_object('monitor',p_monitor,'checkedAt',p_checked_at,'sourceId',request.id,
      'createdBy','batch_7a_overdue_monitor','outboundRequest',jsonb_build_object(
        'id',request.id,'company_id',request.company_id,'customer_id',request.customer_id,'site_id',request.site_id,
        'metering_point_id',request.metering_point_id,'grid_owner_id',request.grid_owner_id,'request_type',request.request_type,
        'message_family',request.message_family,'message_code',request.message_code,'sent_at',request.sent_at,
        'status',request.status,'external_reference',request.external_reference))
  );
  IF NOT FOUND THEN RAISE EXCEPTION 'inbound_overdue_task_insert_rejected'; END IF;
  RETURN true;
END;
$body$;
REVOKE ALL ON FUNCTION public.gridex_record_inbound_overdue_task_v1(uuid,uuid,text,timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_record_inbound_overdue_task_v1(uuid,uuid,text,timestamptz,integer) TO service_role;
END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
