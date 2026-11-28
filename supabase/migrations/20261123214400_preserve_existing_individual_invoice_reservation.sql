DO $migration$
BEGIN
DO $replace_body$
DECLARE p record; updated text;
 old_1 constant text := $old_1$  v_invoice_id uuid;
begin$old_1$;
 new_1 constant text := $new_1$  v_invoice_id uuid;
  v_existing_item_id uuid;
  v_existing_snapshot_matches boolean;
  v_requested_item jsonb;
begin$new_1$;
 old_2 constant text := $old_2$  PERFORM gridex_locked_pricing_evidence.assert_draft(p_company_id,p_items,p_enrichment);

  v_result := public.gridex_create_invoice_export_graph_v1(p_run, p_items, p_invoices);$old_2$;
 new_2 constant text := $new_2$  PERFORM gridex_locked_pricing_evidence.assert_draft(p_company_id,p_items,p_enrichment);

  v_result := public.gridex_create_invoice_export_graph_v1(p_run, p_items, p_invoices);

  IF (v_result->>'existing')::boolean IS TRUE THEN
    SELECT value INTO v_requested_item
    FROM jsonb_array_elements(p_items)
    WHERE value->>'id' = v_item_id::text;

    SELECT invoice.id, item.id,
      invoice.calculation_snapshot_sha256 IS NOT NULL
      AND invoice.calculation_snapshot_sha256 IS NOT DISTINCT FROM nullif(p_enrichment->>'calculation_snapshot_sha256', '')
      AND invoice.calculation_snapshot IS NOT DISTINCT FROM p_enrichment->'calculation_snapshot'
      AND invoice.price_plan_version_id IS NOT DISTINCT FROM nullif(p_enrichment->>'price_plan_version_id', '')::uuid
      AND invoice.price_area_code IS NOT DISTINCT FROM nullif(p_enrichment->>'price_area_code', '')
      AND invoice.consumption_kwh IS NOT DISTINCT FROM nullif(p_enrichment->>'consumption_kwh', '')::numeric
      AND invoice.vat_rate IS NOT DISTINCT FROM nullif(p_enrichment->>'vat_rate', '')::numeric
      INTO v_invoice_id, v_existing_item_id, v_existing_snapshot_matches
    FROM public.invoice_export_items item
    JOIN public.customer_invoices invoice ON invoice.company_id = item.company_id
      AND invoice.invoice_export_item_id = item.id
    WHERE item.company_id = p_company_id
      AND item.export_run_id = (v_result->>'run_id')::uuid
      AND item.idempotency_key = nullif(v_requested_item->>'idempotency_key', '')
      AND item.billing_underlay_id = nullif(v_requested_item->>'billing_underlay_id', '')::uuid
      AND item.pricing_run_id = nullif(v_requested_item->>'pricing_run_id', '')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING errcode = 'P0002', message = 'invoice_review_draft_existing_invoice_missing';
    END IF;
    IF v_existing_snapshot_matches IS NOT TRUE THEN
      RAISE EXCEPTION USING errcode = '23505', message = 'invoice_review_draft_existing_snapshot_mismatch';
    END IF;
    RETURN v_result || jsonb_build_object('invoice_id', v_invoice_id, 'item_id', v_existing_item_id);
  END IF;$new_2$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_create_invoice_review_draft_v1(uuid,jsonb,jsonb,jsonb,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'1ad92aae797479e032d2c56e68e25dcd1aa2f6b18e8281c6012c2588def750cd'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_predecessor_changed'; END IF;
 updated:=replace(replace(p.prosrc,old_1,new_1),old_2,new_2);
 EXECUTE replace(p.definition,p.prosrc,updated);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'fd2a8763b0b0a60936129e885d8101082d5aa5870d1321dbedb1473095cadbe5'
 THEN RAISE EXCEPTION 'invoice_withdrawal_source_metadata_changed'; END IF;
END
$replace_body$;
END
$migration$;
