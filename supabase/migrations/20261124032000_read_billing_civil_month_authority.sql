-- Apply a different month end only to a currently qualified normal supply and the exact sent civil request.
CREATE FUNCTION public.gridex_read_billing_civil_month_authority_v1(
  p_company_id uuid, p_month date, p_period_ids uuid[]
) RETURNS TABLE(period_id uuid, source_message_id uuid, market_start_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET TimeZone='UTC' SET lock_timeout='250ms'
AS $function$
DECLARE
  supply record;
  request public.grid_owner_data_requests%rowtype;
  request_ids uuid[];
  original_ids uuid[];
  original_wire jsonb;
  basis jsonb;
  local_start timestamptz;
  local_end timestamptz;
  month_key text;
  sent_range tstzrange;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'billing_civil_month_authority_service_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_month IS NULL OR NOT isfinite(p_month)
    OR p_month NOT BETWEEN '2000-01-01'::date AND '2200-12-01'::date OR extract(day FROM p_month)<>1
    OR coalesce(cardinality(p_period_ids),0) NOT BETWEEN 1 AND 32 OR array_position(p_period_ids,NULL) IS NOT NULL
    OR cardinality(p_period_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_period_ids) id) THEN
    RAISE EXCEPTION 'billing_civil_month_authority_scope_invalid' USING ERRCODE='22023';
  END IF;
  local_start:=p_month::timestamp AT TIME ZONE 'Europe/Stockholm';
  local_end:=(p_month::timestamp+interval '1 month') AT TIME ZONE 'Europe/Stockholm';
  month_key:=to_char(p_month,'YYYY-MM');

  FOR supply IN
    SELECT p.id,p.source_message_id,p.market_start_at,p.market_state_version,p.customer_id,p.metering_point_id,
      z.environment,c.confirmed_switch,c.legal_context
    FROM public.customer_supply_periods p
    JOIN gridex_received_sources.normal_switch_confirmations c
      ON (c.company_id,c.period_id,c.source_message_id,c.market_start_at)=(p.company_id,p.id,p.source_message_id,p.market_start_at)
    JOIN public.ediel_messages z ON (z.company_id,z.id)=(p.company_id,p.source_message_id)
      AND z.direction='inbound' AND z.message_family='PRODAT' AND z.message_code='Z04' AND z.message_standard='edifact'
    WHERE p.company_id=p_company_id AND p.id=ANY(p_period_ids) AND p.source='ediel_qualified_source'
      AND p.status IN ('active','confirmed_by_grid_owner') AND p.end_date IS NULL AND p.actual_end_date IS NULL
      AND p.market_end_at IS NULL AND p.source_end_message_id IS NULL AND isfinite(p.market_start_at) AND p.market_start_at<local_end
    ORDER BY p.id
  LOOP
    SELECT array_agg(q.id) INTO request_ids FROM (
      SELECT r.id FROM public.grid_owner_data_requests r
      WHERE r.company_id=p_company_id AND r.status IN ('sent','received')
        AND r.automation_key='meter-values:'||p_company_id::text||':'||supply.metering_point_id::text||':'||month_key
      ORDER BY r.id LIMIT 2
    ) q;
    IF cardinality(request_ids) IS DISTINCT FROM 1 THEN CONTINUE; END IF;
    basis:=gridex_received_sources.supply_period_source_basis_v1(
      p_company_id,supply.id,greatest(local_start,supply.market_start_at),local_end
    );
    IF basis->>'qualified' IS DISTINCT FROM 'true' OR basis->>'initialSourceMessageId' IS DISTINCT FROM supply.source_message_id::text
      OR basis->>'marketStateVersion' IS DISTINCT FROM supply.market_state_version::text
      OR (basis->>'marketStartAt')::timestamptz IS DISTINCT FROM supply.market_start_at
      OR nullif(basis->>'dsoEdielId','') IS NULL THEN CONTINUE; END IF;

    SELECT * INTO request FROM public.grid_owner_data_requests r
    WHERE (r.company_id,r.id,r.customer_id,r.metering_point_id)=(p_company_id,request_ids[1],supply.customer_id,supply.metering_point_id)
      AND r.site_id::text IS NOT DISTINCT FROM coalesce(supply.confirmed_switch->>'site_id',supply.confirmed_switch->>'customer_site_id')
      AND r.request_scope='meter_values' AND r.status IN ('sent','received')
      AND r.automation_origin IN ('staff_bulk_metering_v1','metering_market_data_autopilot_v1')
      AND r.automation_key='meter-values:'||p_company_id::text||':'||supply.metering_point_id::text||':'||month_key
      AND r.request_payload->>'billing_month'=month_key AND r.request_payload->>'time_zone'='Europe/Stockholm'
      AND (r.request_payload->>'ediel_environment'=supply.environment OR
        (r.automation_origin='metering_market_data_autopilot_v1' AND r.request_payload->>'ediel_environment' IS NULL)) FOR SHARE;
    IF NOT FOUND THEN CONTINUE; END IF;
    sent_range:=gridex_utilts_binding.e73_sent_request_range_v1(p_company_id,request.id,supply.environment);
    IF sent_range IS DISTINCT FROM tstzrange(local_start,local_end,'[)') THEN CONTINUE; END IF;
    original_ids:=gridex_utilts_binding.e73_request_candidate_ids_v1(p_company_id,request.id,supply.environment);
    IF cardinality(original_ids) IS DISTINCT FROM 1 THEN CONTINUE; END IF;
    SELECT gridex_ack_authority.wire_v1(m.raw_payload) INTO original_wire FROM public.ediel_messages m
    WHERE (m.company_id,m.id,m.environment,m.site_id)=(p_company_id,original_ids[1],supply.environment,request.site_id)
      AND m.grid_owner_id IS NOT DISTINCT FROM request.grid_owner_id;
    IF NOT FOUND OR original_wire->>'legalSender' IS DISTINCT FROM supply.legal_context->>'legalEdielId'
      OR original_wire->>'legalReceiver' IS DISTINCT FROM basis->>'dsoEdielId' THEN CONTINUE; END IF;

    period_id:=supply.id;
    source_message_id:=supply.source_message_id;
    market_start_at:=supply.market_start_at;
    RETURN NEXT;
  END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_read_billing_civil_month_authority_v1(uuid,date,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_billing_civil_month_authority_v1(uuid,date,uuid[]) TO service_role;
