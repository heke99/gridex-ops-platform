DO $gridex_invoice_migration$
BEGIN

-- Evidence only. The existing signed PDF and finance purge producers keep
-- their original classes and operations.
CREATE FUNCTION public.ediel_read_grouped_invoice_retention_basis_v1(
  p_company_id uuid,p_actor_user_id uuid,p_invoice_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  own_draft gridex_invoice_groups.drafts%ROWTYPE;
  invoice public.customer_invoices%ROWTYPE;
  customer public.customers%ROWTYPE;
  receipt gridex_invoice_groups.issue_outcomes%ROWTYPE;
  approval gridex_invoice_groups.approvals%ROWTYPE;
  document gridex_invoice_groups.customer_documents%ROWTYPE;
  stored_source gridex_invoice_groups.sources%ROWTYPE;
  underlay public.billing_underlays%ROWTYPE;
  binding gridex_billing_source.underlay_bindings%ROWTYPE;
  supply public.customer_supply_periods%ROWTYPE;
  snapshots jsonb := '[]';
  sources jsonb := '[]';
  fence date;
  closed boolean;
  archived boolean;
  basis jsonb;
BEGIN
  -- Identical current actor and exact invoice class to invoice-file evidence.
  PERFORM gridex_ediel_retention.invoice_file_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.read');
  SELECT * INTO own_draft FROM gridex_invoice_groups.drafts g
    WHERE g.company_id=p_company_id AND g.invoice_id=p_invoice_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_retention_target_missing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO invoice FROM public.customer_invoices i
    WHERE i.company_id=p_company_id AND i.id=p_invoice_id AND i.customer_id=own_draft.customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_retention_target_missing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO customer FROM public.customers c WHERE c.company_id=p_company_id AND c.id=invoice.customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_retention_target_missing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO receipt FROM gridex_invoice_groups.issue_outcomes o
    WHERE o.company_id=p_company_id AND o.invoice_id=p_invoice_id AND o.outcome='issued' FOR SHARE;
  IF NOT FOUND OR receipt.number IS DISTINCT FROM invoice.invoice_number OR receipt.effective_at IS DISTINCT FROM invoice.issued_at
    OR receipt.review_hash IS DISTINCT FROM gridex_invoice_groups.review_hash(
       own_draft.company_id,own_draft.invoice_id,own_draft.billing_month,own_draft.provider,own_draft.environment,
       invoice.calculation_snapshot,own_draft.intent) THEN
    RAISE EXCEPTION 'invoice_group_retention_issue_binding_invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO approval FROM gridex_invoice_groups.approvals a WHERE a.company_id=p_company_id
    AND a.invoice_id=p_invoice_id FOR SHARE;
  IF NOT FOUND OR approval.review_hash IS DISTINCT FROM receipt.review_hash THEN
    RAISE EXCEPTION 'invoice_group_retention_issue_binding_invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO document FROM gridex_invoice_groups.customer_documents d WHERE d.company_id=p_company_id
    AND d.invoice_id=p_invoice_id AND d.customer_id=invoice.customer_id FOR SHARE;
  IF NOT FOUND OR document.body_sha256 IS DISTINCT FROM encode(sha256(document.body),'hex')
    OR invoice.calculation_snapshot_sha256 IS DISTINCT FROM encode(sha256(convert_to(invoice.calculation_snapshot::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'invoice_group_retention_document_binding_invalid' USING ERRCODE='23514';
  END IF;
  archived:=customer.status IS NOT DISTINCT FROM 'archived';
  closed:=archived AND invoice.status IN ('paid','credited');
  FOR stored_source IN SELECT * FROM gridex_invoice_groups.sources s WHERE s.company_id=p_company_id
      AND s.invoice_id=p_invoice_id ORDER BY s.billing_underlay_id FOR SHARE LOOP
    SELECT * INTO underlay FROM public.billing_underlays u WHERE u.company_id=p_company_id
      AND u.customer_id=invoice.customer_id AND u.id=stored_source.billing_underlay_id FOR SHARE;
    IF NOT FOUND OR stored_source.snapshot->>'periodStart' IS DISTINCT FROM underlay.billing_period_start::text
      OR stored_source.snapshot->>'periodEnd' IS DISTINCT FROM underlay.billing_period_end::text
      OR underlay.billing_period_start IS NULL OR underlay.billing_period_end IS NULL
      OR NOT isfinite(underlay.billing_period_start) OR NOT isfinite(underlay.billing_period_end)
      OR underlay.billing_period_end<=underlay.billing_period_start THEN
      RAISE EXCEPTION 'invoice_group_retention_underlay_scope_invalid' USING ERRCODE='23514';
    END IF;
    SELECT * INTO binding FROM gridex_billing_source.underlay_bindings b
      WHERE b.company_id=p_company_id AND b.underlay_id=underlay.id FOR SHARE;
    IF NOT FOUND OR binding.source_basis_hash IS DISTINCT FROM encode(sha256(convert_to(binding.source_basis::text,'UTF8')),'hex')
      OR binding.exact_total_kwh IS DISTINCT FROM underlay.total_kwh
      OR binding.exact_total_kwh IS DISTINCT FROM (stored_source.snapshot#>>'{calculation,total_kwh}')::numeric THEN
      RAISE EXCEPTION 'invoice_group_retention_source_binding_invalid' USING ERRCODE='23514';
    END IF;
    SELECT * INTO supply FROM public.customer_supply_periods sp WHERE sp.company_id=p_company_id AND sp.customer_id=invoice.customer_id
      AND sp.id=underlay.supply_period_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_retention_supply_scope_invalid' USING ERRCODE='23514'; END IF;
    fence:=greatest(fence,underlay.billing_period_end);
    closed:=closed AND coalesce(supply.status IN ('cancelled','rejected','terminated','ended','closed','inactive'),false)
      AND coalesce(coalesce(supply.actual_end_date,supply.end_date)<current_date,false);
    snapshots:=snapshots||jsonb_build_array(stored_source.snapshot);
    sources:=sources||jsonb_build_array(jsonb_build_object('underlayId',underlay.id,'sourceHash',binding.source_basis_hash,
      'periodStart',underlay.billing_period_start,'periodEnd',underlay.billing_period_end,'supplyPeriodId',supply.id,
      'supplyStatus',supply.status,'lastSupplyDate',coalesce(supply.actual_end_date,supply.end_date)));
  END LOOP;
  IF jsonb_array_length(sources)<2 OR snapshots IS DISTINCT FROM invoice.calculation_snapshot->'sources' THEN
    RAISE EXCEPTION 'invoice_group_retention_source_set_invalid' USING ERRCODE='23514';
  END IF;
  closed:=closed AND fence<=current_date
    AND NOT EXISTS(SELECT FROM public.customer_supply_periods s WHERE s.company_id=p_company_id AND s.customer_id=customer.id AND
      (s.status IS NULL OR s.status NOT IN ('cancelled','rejected','terminated','ended','closed','inactive') OR
       coalesce(s.actual_end_date,s.end_date) IS NULL OR coalesce(s.actual_end_date,s.end_date)>=current_date))
    AND NOT EXISTS(SELECT FROM public.customer_invoices i WHERE i.company_id=p_company_id AND i.customer_id=customer.id
      AND (i.status IS NULL OR i.status NOT IN ('paid','cancelled','credited')))
    AND NOT EXISTS(SELECT FROM public.invoice_export_items e WHERE e.company_id=p_company_id AND e.customer_id=customer.id
      AND (e.status IS NULL OR e.status NOT IN ('sent','credited','cancelled','rejected')))
    AND NOT EXISTS(SELECT FROM public.invoice_export_attempts a JOIN public.invoice_export_items e
      ON e.id=a.invoice_export_item_id AND e.company_id=a.company_id WHERE e.company_id=p_company_id AND e.customer_id=customer.id
      AND a.finished_at IS NULL);
  basis:=jsonb_build_object('companyId',p_company_id,'customerId',customer.id,'invoiceId',p_invoice_id,
    'invoiceNumber',receipt.number,'reviewHash',receipt.review_hash,'invoiceStatus',invoice.status,
    'documentSha256',document.body_sha256,'byteLength',octet_length(document.body),
    'sources',sources,'allIncludedScopesClosed',closed,'matchedSourceCount',jsonb_array_length(sources));
  RETURN basis||jsonb_build_object('scopeHash',encode(sha256(convert_to(basis::text,'UTF8')),'hex'),
    'complete',false,'authority','none');
END
$$;

REVOKE ALL ON FUNCTION public.ediel_read_grouped_invoice_retention_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_grouped_invoice_retention_basis_v1(uuid,uuid,uuid) TO authenticated;
END
$gridex_invoice_migration$;
