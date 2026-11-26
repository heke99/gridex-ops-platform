DO $migration$
DECLARE
  original record;
  revised text;
  signature constant regprocedure :=
    'gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz)'::regprocedure;
BEGIN
  SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT original FROM pg_proc p WHERE p.oid=signature;

  IF encode(sha256(convert_to(original.prosrc,'UTF8')),'hex')
     IS DISTINCT FROM '3749f975b13d98db77150f6d82a9f4ffb921667e468b8192406e09edddffd78a'
  THEN RAISE EXCEPTION 'planned_move_out_supply_exact_predecessor_required'; END IF;

  EXECUTE $helper$
  CREATE FUNCTION gridex_received_sources.planned_move_out_supply_window_v1(
    period public.customer_supply_periods, contract public.customer_contracts,
    start_at timestamptz, end_at timestamptz
  ) RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog
  AS $body$
    SELECT coalesce(
      period.status IN ('active','confirmed_by_grid_owner')
      AND period.source='ediel_qualified_source' AND period.source_process='supplier_switch_confirmation'
      AND period.source_message_id IS NOT NULL AND period.source_end_message_id IS NULL
      AND period.actual_end_date IS NULL AND isfinite(period.end_date)
      AND period.metadata->>'planned_end_source'='customer_lifecycle_close'
      AND period.metadata->>'planned_end_reason'='move_out'
      AND contract.id=coalesce(period.customer_contract_id,period.contract_id)
      AND (period.contract_id IS NULL OR period.contract_id=contract.id)
      AND (period.customer_contract_id IS NULL OR period.customer_contract_id=contract.id)
      AND contract.company_id=period.company_id AND contract.customer_id=period.customer_id
      AND contract.metering_point_id=period.metering_point_id
      AND contract.status='terminated' AND contract.termination_reason='move_out'
      AND isfinite(contract.ended_at)
      AND ((contract.ended_at AT TIME ZONE 'UTC')::date=period.end_date
        OR (contract.ended_at AT TIME ZONE 'Europe/Stockholm')::date=period.end_date)
      AND isfinite(start_at) AND isfinite(end_at) AND start_at<end_at
      AND isfinite(period.market_start_at) AND period.market_start_at<=start_at
      AND end_at<=((period.end_date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')
      AND (period.market_end_at IS NULL OR (isfinite(period.market_end_at) AND end_at<=period.market_end_at))
      AND EXISTS (
        SELECT FROM public.customers customer
        JOIN public.customer_lifecycle_events event
          ON event.company_id=customer.company_id AND event.customer_id=customer.id
          AND event.created_at=customer.lifecycle_closed_at AND event.created_by=customer.lifecycle_closed_by
        JOIN public.metering_points point
          ON point.company_id=customer.company_id AND point.customer_id=customer.id AND point.id=period.metering_point_id
          AND point.status='closed' AND point.end_date=period.end_date AND point.closed_at=event.created_at
        JOIN public.customer_sites site
          ON site.company_id=customer.company_id AND site.customer_id=customer.id
          AND site.id=coalesce(point.site_id,point.customer_site_id)
          AND site.id=coalesce(contract.site_id,contract.customer_site_id)
          AND (point.customer_site_id IS NULL OR point.customer_site_id=site.id)
          AND (contract.customer_site_id IS NULL OR contract.customer_site_id=site.id)
          AND site.status='closed' AND site.move_out_date=period.end_date AND site.closed_at=event.created_at
        JOIN gridex_received_sources.normal_switch_confirmations confirmation
          ON confirmation.company_id=period.company_id AND confirmation.period_id=period.id
          AND confirmation.contract_id=contract.id AND confirmation.source_message_id=period.source_message_id
          AND coalesce(confirmation.confirmed_switch->>'site_id',confirmation.confirmed_switch->>'customer_site_id')=site.id::text
        JOIN public.customer_contract_events termination
          ON termination.company_id=customer.company_id AND termination.customer_id=customer.id
          AND termination.customer_contract_id=contract.id AND termination.happened_at=event.created_at
          AND termination.actor_user_id=event.created_by AND termination.event_type='terminated'
          AND termination.metadata->>'source'='admin_customer_card'
          AND termination.metadata->>'termination_reason'='move_out'
          AND termination.metadata->>'ends_at'=period.end_date::text
        WHERE customer.company_id=period.company_id AND customer.id=period.customer_id
          AND customer.status='moved' AND customer.moved_out_at=period.end_date
          AND event.event_type='move_out' AND event.event_status='completed' AND event.effective_date=period.end_date
          AND event.payload->>'source'='admin_customer_card'
          AND event.created_at=CASE
            WHEN period.metadata->>'planned_end_recorded_at'
              ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?[+-][0-9]{2}:[0-9]{2}$'
              AND pg_input_is_valid(period.metadata->>'planned_end_recorded_at','timestamptz')
            THEN (period.metadata->>'planned_end_recorded_at')::timestamptz
          END
      ),false)
  $body$;
  $helper$;
  EXECUTE format('ALTER FUNCTION gridex_received_sources.planned_move_out_supply_window_v1(public.customer_supply_periods,public.customer_contracts,timestamptz,timestamptz) OWNER TO %I',
    pg_get_userbyid((original.metadata->>'proowner')::oid));
  REVOKE ALL ON FUNCTION gridex_received_sources.planned_move_out_supply_window_v1(
    public.customer_supply_periods,public.customer_contracts,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;

  revised:=replace(original.prosrc,
    $old$version bigint;source_id uuid;$old$,
    $new$version bigint;source_id uuid;planned_move_out boolean;$new$);
  revised:=replace(revised,
    $old$ SELECT * INTO c FROM public.customer_contracts WHERE id=proof.contract_id AND company_id=p_company_id FOR SHARE;
$old$, '');
  revised:=replace(revised,
    $old$ IF expected IS NULL OR baseline IS NULL OR m.direction$old$,
    $new$ SELECT * INTO c FROM public.customer_contracts WHERE id=proof.contract_id AND company_id=p_company_id FOR SHARE;
 planned_move_out:=CASE WHEN c.status='terminated' AND c.termination_reason='move_out'
   THEN gridex_received_sources.planned_move_out_supply_window_v1(p,c,p_start,p_end)
   ELSE false END;
 IF expected IS NULL OR baseline IS NULL OR m.direction$new$);
  revised:=replace(revised,
    $old$  OR (to_jsonb(p)-ARRAY['updated_at','status']) IS DISTINCT FROM (baseline-ARRAY['updated_at','status'])$old$,
    $new$  OR ((to_jsonb(p)-ARRAY['updated_at','status']) IS DISTINCT FROM (baseline-ARRAY['updated_at','status'])
   AND NOT (planned_move_out
    AND (baseline->>'end_date' IS NULL OR p.end_date<(baseline->>'end_date')::date)
    AND NOT (coalesce(nullif(baseline->'metadata','null'::jsonb),'{}'::jsonb)
      ?| ARRAY['planned_end_source','planned_end_reason','planned_end_recorded_at'])
    AND (to_jsonb(p)-ARRAY['updated_at','status','end_date','metadata'])
      IS NOT DISTINCT FROM (baseline-ARRAY['updated_at','status','end_date','metadata'])
    AND (p.metadata-ARRAY['planned_end_source','planned_end_reason','planned_end_recorded_at'])
      IS NOT DISTINCT FROM coalesce(nullif(baseline->'metadata','null'::jsonb),'{}'::jsonb)))$new$);
  revised:=replace(revised,
    $old$OR (c.status IN('signed','active') OR c.status='terminated'$old$,
    $new$OR (c.status IN('signed','active') OR planned_move_out OR c.status='terminated'$new$);
  IF revised=original.prosrc
    OR position('planned_move_out:=' in revised)=0
    OR position('AND NOT (planned_move_out' in revised)=0
    OR position('OR planned_move_out OR' in revised)=0
  THEN RAISE EXCEPTION 'planned_move_out_supply_exact_anchors_required'; END IF;
  EXECUTE replace(original.definition,original.prosrc,revised);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata
  THEN RAISE EXCEPTION 'planned_move_out_supply_owner_metadata_changed'; END IF;
END
$migration$;
