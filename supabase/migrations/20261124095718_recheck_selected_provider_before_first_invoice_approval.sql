DO $migration$
DECLARE
  target constant regprocedure := 'public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)'::regprocedure;
  previous record;
  next_body text;
  anchor constant text := $old$  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,v_underlay.id);
  PERFORM gridex_billing_source.require_current_invoice_price_timeline_v1(p_company_id,v_underlay.id);$old$;
  replacement constant text := $new$  -- Recheck the selected path under the existing company and item locks.
  -- A historical approval is returned before this check.
  IF v_item.provider IS DISTINCT FROM v_company.invoice_export_target_system
     OR v_item.environment IS DISTINCT FROM v_company.billing_provider_environment THEN
    RAISE EXCEPTION 'invoice_approval_provider_scope_changed' USING ERRCODE='23514';
  END IF;
  PERFORM FROM public.invoice_export_runs r
    WHERE r.company_id=p_company_id AND r.id=v_item.export_run_id
      AND r.provider=v_item.provider AND r.environment=v_item.environment
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_approval_provider_scope_changed' USING ERRCODE='23514';
  END IF;

  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,v_underlay.id);
  PERFORM gridex_billing_source.require_current_invoice_price_timeline_v1(p_company_id,v_underlay.id);$new$;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(target) AS definition,to_jsonb(p)-'prosrc' AS metadata
    INTO STRICT previous FROM pg_proc p WHERE p.oid=target;
  IF md5(previous.prosrc) IS DISTINCT FROM '1ba5add531ffc534c16e78f8649220c6'
     OR (length(previous.prosrc)-length(replace(previous.prosrc,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'invoice_approval_provider_scope_predecessor_changed';
  END IF;

  next_body:=replace(previous.prosrc,anchor,replacement);
  EXECUTE replace(previous.definition,previous.prosrc,next_body);
  IF NOT EXISTS (
    SELECT FROM pg_proc p WHERE p.oid=target AND p.prosrc=next_body
      AND (to_jsonb(p)-'prosrc')=previous.metadata
  ) THEN
    RAISE EXCEPTION 'invoice_approval_provider_scope_metadata_changed';
  END IF;
END
$migration$;
