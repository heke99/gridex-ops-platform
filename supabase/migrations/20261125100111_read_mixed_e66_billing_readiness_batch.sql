CREATE FUNCTION public.gridex_read_mixed_e66_billing_readiness_batch_v1(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_raw_underlay_id uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 8
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
  scope record;
  members jsonb;
  total integer;
  batch jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE
    OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.write') IS NOT TRUE
  THEN RAISE EXCEPTION 'mixed_e66_billing_readiness_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_user_id);

  IF p_raw_underlay_id IS NULL OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 16
  THEN RAISE EXCEPTION 'mixed_e66_billing_readiness_invalid_window' USING ERRCODE='22023'; END IF;

  SELECT raw.metering_point_id,raw.customer_id,coverage.evidence
  INTO scope
  FROM gridex_e66_intake.mixed_e73_billing_projections projection
  JOIN gridex_e66_intake.mixed_e73_billing_coverage coverage
    ON (coverage.company_id,coverage.environment,coverage.request_id,coverage.evidence_sha256)
       =(projection.company_id,projection.environment,projection.request_id,projection.coverage_sha256)
  JOIN public.billing_underlays raw ON (raw.company_id,raw.id)=(projection.company_id,projection.primary_underlay_id)
  JOIN public.grid_owner_data_requests q ON (q.company_id,q.id)=(projection.company_id,projection.request_id)
  WHERE (projection.company_id,projection.environment,projection.primary_underlay_id)=(p_company_id,'test',p_raw_underlay_id)
    AND raw.source_request_id=projection.request_id
    AND (raw.status,raw.readiness_status,raw.billing_block_reason)=('received','blocked','mixed_e66_multisource_pricing_unqualified')
    AND raw.contract_id IS NULL AND raw.pricing_snapshot_id IS NULL AND raw.contract_price_snapshot_id IS NULL
    AND (q.customer_id,q.site_id,q.metering_point_id)=(raw.customer_id,raw.site_id,raw.metering_point_id)
    AND q.request_scope='billing_underlay' AND q.status IN ('sent','received');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mixed_e66_billing_readiness_projection_missing' USING ERRCODE='P0002';
  END IF;

  members:=scope.evidence->'members';
  total:=jsonb_array_length(members);
  IF p_offset>=total OR total IS DISTINCT FROM (scope.evidence->>'contributionCount')::integer
  THEN RAISE EXCEPTION 'mixed_e66_billing_readiness_invalid_window' USING ERRCODE='22023'; END IF;

  WITH wanted AS MATERIALIZED (
    SELECT member,position
    FROM jsonb_array_elements(members) WITH ORDINALITY AS receipt(member,position)
    ORDER BY position OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_agg(jsonb_build_object('normalizedId',n.id,'sourceId',s.source_message_id,
    'meterValue',jsonb_build_object('id',m.id,'company_id',m.company_id,'metering_point_id',m.metering_point_id,
      'period_start',m.period_start,'period_end',m.period_end,'source_ediel_message_id',m.source_ediel_message_id,
      'canonical_dedupe_key',m.canonical_dedupe_key,'source_transaction_reference',m.source_transaction_reference,
      'source_system',m.source_system)) ORDER BY wanted.position)
  INTO batch
  FROM wanted
  JOIN gridex_utilts_binding.metering_application_receipts receipt
    ON (receipt.company_id,receipt.environment,receipt.source_message_id,receipt.transaction_id,receipt.observation_ordinal)
      =(p_company_id,'test',(wanted.member->>'sourceId')::uuid,wanted.member->>'transactionId',(wanted.member->>'ordinal')::integer)
  JOIN gridex_received_sources.sources s
    ON (s.company_id,s.environment,s.source_message_id)=(receipt.company_id,receipt.environment,receipt.source_message_id)
  JOIN public.meter_reading_series serie
    ON (serie.company_id,serie.source_ediel_message_id,serie.id)=(receipt.company_id,receipt.source_message_id,(wanted.member->>'seriesId')::uuid)
    AND serie.is_current
  JOIN public.metering_values m ON (m.company_id,m.id)=(receipt.company_id,receipt.value_id)
  JOIN public.normalized_metering_values n
    ON (n.company_id,n.id,n.source_metering_value_id,n.source_message_id)
     =(receipt.company_id,receipt.normalized_id,receipt.value_id,receipt.source_message_id)
  JOIN public.metering_value_sources link
    ON (link.company_id,link.id,link.metering_value_id,link.normalized_metering_value_id,link.source_ediel_message_id,link.source_transaction_reference)
      =(receipt.company_id,receipt.source_link_id,receipt.value_id,receipt.normalized_id,receipt.source_message_id,receipt.transaction_id)
  WHERE (receipt.value_id,receipt.normalized_id,receipt.source_link_id)=(
    (wanted.member->>'meteringId')::uuid,(wanted.member->>'normalizedId')::uuid,(wanted.member->>'sourceLinkId')::uuid)
    AND (receipt.contract_hash,receipt.value_hash,receipt.normalized_hash)=(
      decode(wanted.member->>'contractSha256','hex'),decode(wanted.member->>'meteringHash','hex'),decode(wanted.member->>'normalizedHash','hex'))
    AND s.payload_hash=wanted.member->>'sourceSha256' AND s.message_code='E66'
    AND s.retention_purged_at IS NULL AND s.raw_payload IS NOT NULL
    AND m.is_current AND m.revision_status='current' AND n.revision_status='current'
    AND (m.customer_id,m.metering_point_id)=(scope.customer_id,scope.metering_point_id)
    AND (n.customer_id,n.metering_point_id)=(scope.customer_id,scope.metering_point_id)
    AND (m.period_start,m.period_end)=(n.period_start,n.period_end)
    AND (n.period_start,n.period_end)=((wanted.member->>'periodStart')::timestamptz,(wanted.member->>'periodEnd')::timestamptz)
    AND receipt.value_hash=gridex_utilts_binding.application_value_hash_v1(m)
    AND receipt.normalized_hash=gridex_utilts_binding.application_normalized_hash_v1(n);

  IF jsonb_array_length(batch) IS DISTINCT FROM least(p_limit,total-p_offset) THEN
    RAISE EXCEPTION 'mixed_e66_billing_readiness_current_receipt_required' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('offset',p_offset,'total',total,'members',batch);
END
$$;

REVOKE ALL ON FUNCTION public.gridex_read_mixed_e66_billing_readiness_batch_v1(uuid,uuid,uuid,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_mixed_e66_billing_readiness_batch_v1(uuid,uuid,uuid,integer,integer)
  TO service_role;
