DO $migration$
DECLARE
  link_owner constant regprocedure := 'gridex_billing_source.guard_price_timeline_invoice_hold_v1()'::regprocedure;
  approval_owner constant regprocedure := 'public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)'::regprocedure;
  link_definition text := pg_get_functiondef(link_owner);
  approval_definition text := pg_get_functiondef(approval_owner);
  previous_declaration constant text := $old$  price_timeline jsonb;
  basis_contract uuid;
  basis_price uuid;
  basis_start timestamptz;
  basis_end timestamptz;
$old$;
  next_link constant text := $new$   IF TG_TABLE_NAME='invoice_export_items' AND TG_OP='INSERT' THEN
    PERFORM gridex_billing_source.require_current_invoice_price_timeline_v1(NEW.company_id,held_underlay);
   END IF;
$new$;
  previous_link_begin constant text := $old$   IF TG_TABLE_NAME='invoice_export_items' AND TG_OP='INSERT' THEN
$old$;
  previous_link_end constant text := $old$   RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='billing_underlays' THEN$old$;
  previous_approval constant text := $old$    RETURN jsonb_build_object('approved_now',false,'approval',v_item.metadata->'approval');
  END IF;

  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,v_underlay.id);$old$;
  next_approval constant text := $new$    RETURN jsonb_build_object('approved_now',false,'approval',v_item.metadata->'approval');
  END IF;

  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company_id,v_underlay.id);
  PERFORM gridex_billing_source.require_current_invoice_price_timeline_v1(p_company_id,v_underlay.id);$new$;
  link_start integer := strpos(link_definition,previous_link_begin);
  link_finish integer := strpos(link_definition,previous_link_end);
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=link_owner) IS DISTINCT FROM '9610ad9433d6f50692db9eb5ef0cd3b1'
     OR link_start=0 OR link_finish<=link_start
     OR strpos(link_definition,previous_declaration)=0
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=approval_owner) IS DISTINCT FROM '28e66d3d8a63b0a0e9123e2be4127dae'
     OR (length(approval_definition)-length(replace(approval_definition,previous_approval,'')))/length(previous_approval)<>1
  THEN
    RAISE EXCEPTION 'billing_price_timeline_first_approval_predecessor_changed';
  END IF;
  -- Fresh ordinary invoice links and first approval use the same price authority.
  CREATE FUNCTION gridex_billing_source.require_current_invoice_price_timeline_v1(p_company uuid,p_underlay uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path=pg_catalog
  AS $guard$
  DECLARE
    reason constant text := 'price_timeline_invoice_review_required';
    price_timeline jsonb;
    basis_contract uuid;
    basis_price uuid;
    basis_start timestamptz;
    basis_end timestamptz;
  BEGIN
    -- Both callers already hold the exact underlay row. Older or controlled
    -- underlays without an ordinary timeline have their own source authority.
    SELECT u.payload#>'{contract_price_timeline}',
      (b.source_basis->>'contractId')::uuid,(b.source_basis#>>'{price,id}')::uuid,
      (b.source_basis->>'start')::timestamptz,(b.source_basis->>'end')::timestamptz
    INTO price_timeline,basis_contract,basis_price,basis_start,basis_end
    FROM public.billing_underlays u
    JOIN gridex_billing_source.underlay_bindings b ON b.underlay_id=u.id AND b.company_id=u.company_id
    WHERE u.id=p_underlay AND u.company_id=p_company
      AND u.payload#>'{contract_price_timeline}' IS NOT NULL;
    IF NOT FOUND THEN RETURN; END IF;

    IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
      RAISE EXCEPTION 'invoice_price_timeline_read_committed_required' USING ERRCODE='25001';
    END IF;
    -- Snapshot inserts take KEY SHARE through their company/contract FK.
    -- Fail promptly when another lifecycle writer already holds that row.
    BEGIN
      PERFORM 1 FROM public.customer_contracts c
      WHERE c.company_id=p_company AND c.id=basis_contract FOR UPDATE NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE=reason; END IF;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'invoice_price_timeline_lock_busy' USING ERRCODE='55P03';
    END;
    BEGIN
      PERFORM gridex_billing_source.require_contract_price_timeline_v1(
        p_company,basis_contract,basis_price,basis_start,basis_end,price_timeline);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE=reason;
    END;
  END
  $guard$;

  REVOKE ALL ON FUNCTION gridex_billing_source.require_current_invoice_price_timeline_v1(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

  EXECUTE replace(overlay(link_definition placing next_link from link_start for link_finish-link_start),previous_declaration,'');
  EXECUTE replace(approval_definition,previous_approval,next_approval);
END
$migration$;
