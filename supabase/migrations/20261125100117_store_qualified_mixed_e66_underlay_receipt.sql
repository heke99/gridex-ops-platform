-- Use the existing qualified E66 write budget only for a complete bound TEST projection.
CREATE FUNCTION public.gridex_store_mixed_e66_underlay_generation_receipt_v1(
  p_company_id uuid,p_actor_user_id uuid,p_intent_key text,p_scope jsonb,p_source_rows integer,
  p_before jsonb,p_commands jsonb,p_command_results jsonb,p_after jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' SET statement_timeout='30s'
AS $receipt$
DECLARE
  prior jsonb;
  underlay jsonb;
  items jsonb;
  item_count integer;
  value_ids uuid[];
  bound record;
  matched record;
  first_start timestamptz;
  last_end timestamptz;
BEGIN
  PERFORM gridex_underlay_generation.require_request_v1(p_company_id,p_actor_user_id,p_intent_key,p_scope);
  IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE
  THEN RAISE EXCEPTION 'manual_e66_underlay_permission_denied' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));
  prior:=public.gridex_read_underlay_generation_receipt_v1(p_company_id,p_actor_user_id,p_intent_key,p_scope);
  IF prior IS NOT NULL THEN RETURN prior; END IF;

  IF jsonb_typeof(p_commands) IS DISTINCT FROM 'array' OR jsonb_array_length(p_commands)<>1
  THEN RAISE EXCEPTION 'manual_mixed_e66_underlay_scope_unsupported' USING ERRCODE='22023'; END IF;
  underlay:=p_commands#>'{0,underlay}';
  items:=p_commands#>'{0,items}';
  IF jsonb_typeof(items) IS DISTINCT FROM 'array'
    OR (underlay->>'status',underlay->>'readiness_status',underlay->>'source_system',
        underlay->>'energy_direction',underlay->>'settlement_type')
      IS DISTINCT FROM ('validated','ready','normalized_metering_values','consumption','invoice')
    OR underlay->>'underlay_year' IS DISTINCT FROM split_part(p_scope->>'billingMonth','-',1)
    OR lpad(underlay->>'underlay_month',2,'0') IS DISTINCT FROM split_part(p_scope->>'billingMonth','-',2)
  THEN RAISE EXCEPTION 'manual_mixed_e66_underlay_scope_unsupported' USING ERRCODE='22023'; END IF;
  item_count:=jsonb_array_length(items);
  first_start:=(underlay->>'billing_period_start')::timestamptz;
  last_end:=(underlay->>'billing_period_end')::timestamptz;
  IF item_count<2 OR item_count>3000 OR item_count IS DISTINCT FROM p_source_rows
    OR first_start IS NULL OR last_end IS NULL OR last_end<=first_start
  THEN RAISE EXCEPTION 'manual_mixed_e66_underlay_scope_unsupported' USING ERRCODE='22023'; END IF;

  BEGIN
    SELECT raw.id,p.calendar_anchor_source_id,v.evidence INTO STRICT bound
    FROM gridex_e66_intake.mixed_e73_billing_projections p
    JOIN gridex_e66_intake.mixed_e73_billing_coverage v
      ON (v.company_id,v.environment,v.request_id,v.evidence_sha256)=(p.company_id,p.environment,p.request_id,p.coverage_sha256)
    JOIN public.billing_underlays raw ON (raw.company_id,raw.id,raw.source_request_id)=(p.company_id,p.primary_underlay_id,p.request_id)
    JOIN public.grid_owner_data_requests q ON (q.company_id,q.id)=(p.company_id,p.request_id)
    WHERE (p.company_id,p.environment)=(p_company_id,'test')
      AND (raw.status,raw.readiness_status,raw.billing_block_reason)=('received','blocked','mixed_e66_multisource_pricing_unqualified')
      AND raw.contract_id IS NULL AND raw.pricing_snapshot_id IS NULL AND raw.contract_price_snapshot_id IS NULL
      AND raw.customer_id=(underlay->>'customer_id')::uuid AND raw.site_id=(underlay->>'site_id')::uuid
      AND raw.metering_point_id=(underlay->>'metering_point_id')::uuid
      AND (raw.underlay_year,raw.underlay_month,raw.source_meter_value_count,raw.total_kwh)=
          ((underlay->>'underlay_year')::int,(underlay->>'underlay_month')::int,item_count,(underlay->>'total_kwh')::numeric)
      AND (q.customer_id,q.site_id,q.metering_point_id)=(raw.customer_id,raw.site_id,raw.metering_point_id)
      AND q.request_scope='billing_underlay' AND q.status IN ('sent','received')
      AND (v.evidence->>'requestedFrom')::timestamptz=first_start AND (v.evidence->>'requestedUntil')::timestamptz=last_end
      AND (v.evidence->>'contributionCount')::int=item_count AND (v.evidence->>'sourceCount')::int>1
    FOR SHARE OF raw,p,v;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'manual_mixed_e66_underlay_scope_unsupported' USING ERRCODE='22023';
  END;
  IF gridex_e66_intake.bound_underlay_fingerprint_v1(p_company_id,bound.calendar_anchor_source_id,bound.id) IS NULL
    OR jsonb_array_length(bound.evidence->'members') IS DISTINCT FROM item_count
  THEN RAISE EXCEPTION 'manual_mixed_e66_underlay_scope_unsupported' USING ERRCODE='22023'; END IF;

  SELECT array_agg(id ORDER BY id) INTO value_ids
  FROM (SELECT (j.value->>'source_normalized_metering_value_id')::uuid AS id FROM jsonb_array_elements(items) j) selected;
  IF array_position(value_ids,NULL) IS NOT NULL OR
    (SELECT count(DISTINCT id) FROM unnest(value_ids) id)<>item_count
  THEN RAISE EXCEPTION 'manual_mixed_e66_underlay_scope_unsupported' USING ERRCODE='22023'; END IF;
  PERFORM gridex_billing_source.lock_values_v1(p_company_id,value_ids,(underlay->>'supply_period_id')::uuid);

  WITH members AS MATERIALIZED (
    SELECT (v->>'normalizedId')::uuid AS normalized_id,(v->>'meteringId')::uuid AS metering_id,
      (v->>'sourceId')::uuid AS source_id,v->>'transactionId' AS ide,(v->>'ordinal')::int AS ordinal,
      (v->>'seriesId')::uuid AS series_id,(v->>'sourceLinkId')::uuid AS link_id,
      (v->>'periodStart')::timestamptz AS starts_at,(v->>'periodEnd')::timestamptz AS ends_at,
      v->>'sourceSha256' AS source_hash,decode(v->>'contractSha256','hex') AS contract_hash,
      decode(v->>'meteringHash','hex') AS meter_hash,decode(v->>'normalizedHash','hex') AS normalized_hash
    FROM jsonb_array_elements(bound.evidence->'members') v
  ), represented AS (
    SELECT n.id,k.source_id,k.ide,k.ordinal,n.period_start,n.period_end,n.quantity_kwh,
      lag(n.period_end) OVER (ORDER BY n.period_start,n.period_end,n.id) AS prior_end
    FROM members k
    JOIN gridex_utilts_binding.metering_application_receipts a
      ON (a.company_id,a.environment,a.source_message_id,a.transaction_id,a.observation_ordinal)
        =(p_company_id,'test',k.source_id,k.ide,k.ordinal)
      AND (a.normalized_id,a.value_id,a.source_link_id,a.contract_hash,a.value_hash,a.normalized_hash)
        =(k.normalized_id,k.metering_id,k.link_id,k.contract_hash,k.meter_hash,k.normalized_hash)
    JOIN gridex_received_sources.sources s
      ON (s.company_id,s.environment,s.source_message_id,s.payload_hash)=(p_company_id,'test',k.source_id,k.source_hash)
      AND s.message_code='E66' AND s.raw_payload IS NOT NULL AND s.retention_purged_at IS NULL
    JOIN public.meter_reading_series rs ON (rs.company_id,rs.id,rs.source_ediel_message_id)=(p_company_id,k.series_id,k.source_id)
      AND rs.is_current
    JOIN public.metering_value_sources l
      ON (l.company_id,l.id,l.metering_value_id,l.normalized_metering_value_id,l.source_ediel_message_id,l.source_transaction_reference)
        =(p_company_id,k.link_id,k.metering_id,k.normalized_id,k.source_id,k.ide)
    JOIN public.metering_values m ON (m.company_id,m.id)=(p_company_id,k.metering_id)
    JOIN public.normalized_metering_values n
      ON (n.company_id,n.id,n.source_metering_value_id,n.source_message_id)=(p_company_id,k.normalized_id,k.metering_id,k.source_id)
    WHERE n.id=ANY(value_ids) AND m.is_current AND m.revision_status='current' AND n.revision_status='current'
      AND n.billing_status='billable' AND n.billing_gate_status='eligible'
      AND (m.period_start,m.period_end,n.period_start,n.period_end)=(k.starts_at,k.ends_at,k.starts_at,k.ends_at)
      AND (n.customer_id,n.metering_point_id,n.supply_period_id)=((underlay->>'customer_id')::uuid,
           (underlay->>'metering_point_id')::uuid,(underlay->>'supply_period_id')::uuid)
      AND a.value_hash=gridex_e66_intake.mixed_e73_value_fingerprint_v1(m)
      AND a.normalized_hash=gridex_e66_intake.mixed_e73_normalized_fingerprint_v1(n)
  )
  SELECT count(*) AS total,count(DISTINCT id) AS normalized,count(DISTINCT (source_id,ide,ordinal)) AS lineage,
    count(DISTINCT source_id) AS sources,count(*) FILTER (WHERE prior_end IS NOT NULL AND period_start<>prior_end) AS gaps,
    min(period_start) AS starts_at,max(period_end) AS ends_at,sum(quantity_kwh) AS quantity
  INTO matched FROM represented;
  IF (matched.total,matched.normalized,matched.lineage,matched.sources,matched.gaps,matched.starts_at,matched.ends_at,matched.quantity)
    IS DISTINCT FROM (item_count::bigint,item_count::bigint,item_count::bigint,(bound.evidence->>'sourceCount')::bigint,
      0::bigint,first_start,last_end,(underlay->>'total_kwh')::numeric)
  THEN RAISE EXCEPTION 'manual_mixed_e66_underlay_scope_unsupported' USING ERRCODE='22023'; END IF;

  RETURN public.gridex_store_underlay_generation_receipt_v1(
    p_company_id,p_actor_user_id,p_intent_key,p_scope,p_source_rows,p_before,p_commands,p_command_results,p_after);
END
$receipt$;
REVOKE ALL ON FUNCTION public.gridex_store_mixed_e66_underlay_generation_receipt_v1(uuid,uuid,text,jsonb,integer,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_store_mixed_e66_underlay_generation_receipt_v1(uuid,uuid,text,jsonb,integer,jsonb,jsonb,jsonb,jsonb)
  TO service_role;
