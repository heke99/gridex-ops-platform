-- Give a complete single-source E66 receipt bounded time without changing the
-- generic receipt writer, its atomic persistence or its existing replay.
CREATE FUNCTION public.gridex_store_e66_underlay_generation_receipt_v1(
  p_company_id uuid, p_actor_user_id uuid, p_intent_key text, p_scope jsonb,
  p_source_rows integer, p_before jsonb, p_commands jsonb, p_command_results jsonb, p_after jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '30s'
AS $function$
DECLARE
  prior jsonb;
  underlay jsonb;
  items jsonb;
  value_ids uuid[];
  item_count integer;
  matched integer;
  distinct_values integer;
  distinct_sources integer;
  gaps integer;
  first_start timestamptz;
  last_end timestamptz;
BEGIN
  PERFORM gridex_underlay_generation.require_request_v1(p_company_id,p_actor_user_id,p_intent_key,p_scope);
  IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'manual_e66_underlay_permission_denied' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));
  prior := public.gridex_read_underlay_generation_receipt_v1(p_company_id,p_actor_user_id,p_intent_key,p_scope);
  IF prior IS NOT NULL THEN RETURN prior; END IF;

  IF jsonb_typeof(p_commands) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'manual_e66_underlay_scope_unsupported' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_commands) <> 1 THEN
    RAISE EXCEPTION 'manual_e66_underlay_scope_unsupported' USING ERRCODE='22023';
  END IF;
  underlay := p_commands#>'{0,underlay}';
  items := p_commands#>'{0,items}';
  IF jsonb_typeof(items) IS DISTINCT FROM 'array'
    OR underlay->>'status' IS DISTINCT FROM 'validated'
    OR underlay->>'readiness_status' IS DISTINCT FROM 'ready'
    OR underlay->>'source_system' IS DISTINCT FROM 'normalized_metering_values'
    OR underlay->>'underlay_year' IS DISTINCT FROM split_part(p_scope->>'billingMonth','-',1)
    OR lpad(underlay->>'underlay_month',2,'0') IS DISTINCT FROM split_part(p_scope->>'billingMonth','-',2) THEN
    RAISE EXCEPTION 'manual_e66_underlay_scope_unsupported' USING ERRCODE='22023';
  END IF;
  item_count := jsonb_array_length(items);
  IF item_count < 1 OR item_count > 3000 THEN
    RAISE EXCEPTION 'manual_e66_underlay_scope_unsupported' USING ERRCODE='22023';
  END IF;

  SELECT array_agg((item->>'source_normalized_metering_value_id')::uuid ORDER BY item->>'source_normalized_metering_value_id')
  INTO value_ids FROM jsonb_array_elements(items) AS entries(item);
  IF array_position(value_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'manual_e66_underlay_scope_unsupported' USING ERRCODE='22023';
  END IF;
  PERFORM gridex_billing_source.lock_values_v1(p_company_id,value_ids,(underlay->>'supply_period_id')::uuid);

  SELECT count(*), count(DISTINCT id), count(DISTINCT source_message_id),
    count(*) FILTER(WHERE prior_end IS NOT NULL AND period_start<>prior_end),
    min(period_start), max(period_end)
  INTO matched,distinct_values,distinct_sources,gaps,first_start,last_end
  FROM (
    SELECT n.id,n.source_message_id,n.period_start,n.period_end,
      lag(n.period_end) OVER (ORDER BY n.period_start,n.period_end,n.id) AS prior_end
    FROM unnest(value_ids) AS requested(id)
    JOIN public.normalized_metering_values n ON n.id=requested.id AND n.company_id=p_company_id
    JOIN public.ediel_messages s ON s.id=n.source_message_id AND s.company_id=n.company_id
    WHERE s.direction='inbound' AND s.message_family='UTILTS' AND s.message_code='E66'
      AND n.revision_status='current' AND n.billing_status='billable' AND n.billing_gate_status='eligible'
      AND n.customer_id=(underlay->>'customer_id')::uuid
      AND n.metering_point_id=(underlay->>'metering_point_id')::uuid
      AND n.supply_period_id=(underlay->>'supply_period_id')::uuid
  ) AS source_intervals;
  IF matched<>item_count OR distinct_values<>item_count OR distinct_sources<>1 OR gaps<>0
    OR first_start IS DISTINCT FROM (underlay->>'billing_period_start')::timestamptz
    OR last_end IS DISTINCT FROM (underlay->>'billing_period_end')::timestamptz THEN
    RAISE EXCEPTION 'manual_e66_underlay_scope_unsupported' USING ERRCODE='22023';
  END IF;

  RETURN public.gridex_store_underlay_generation_receipt_v1(
    p_company_id,p_actor_user_id,p_intent_key,p_scope,p_source_rows,p_before,p_commands,p_command_results,p_after
  );
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_store_e66_underlay_generation_receipt_v1(uuid,uuid,text,jsonb,integer,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_store_e66_underlay_generation_receipt_v1(uuid,uuid,text,jsonb,integer,jsonb,jsonb,jsonb,jsonb)
  TO service_role;
