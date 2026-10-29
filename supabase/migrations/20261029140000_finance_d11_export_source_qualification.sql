-- Qualified existing D11 event proof at its export write boundary; no metered/private/snapshot guard changes.
BEGIN;
DO $finance_d11_0$
DECLARE target regprocedure:='public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure;original text;definition text;metadata jsonb;
 old_hash constant text:='cf8435c33a20b7dfb5d1bfe31c19524b2760b0663eec662ce53a33ee671d8ffe';new_hash constant text:='f474d34866258127b7aeaf8fdc4ef1d8aad44246b3c138d11f71c016a6dd303d';
 replacement constant text:=$newbody$
DECLARE item jsonb;company uuid;u public.billing_underlays%rowtype;qualified boolean;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 company:=(p_run->>'company_id')::uuid;
 IF company IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'billing_export_source_scope_required'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF item->>'status'='ready' THEN
   SELECT * INTO u FROM public.billing_underlays WHERE company_id=company AND id=(item->>'billing_underlay_id')::uuid FOR SHARE;
   IF u.payload->>'charge_kind' IN ('break_fee','break_fee_credit') THEN
    -- Event-only D11 proof retains the same retained-source-copy gate; metered proof remains below.
    PERFORM public.ediel_require_invoice_source_copies_available_v1(company,u.id);
    qualified:=false;
    IF u.total_kwh=0 AND (
      (u.payload->>'charge_kind'='break_fee' AND u.source_system='break_fee_review' AND u.energy_direction='consumption' AND u.settlement_type='invoice')
      OR (u.payload->>'charge_kind'='break_fee_credit' AND u.source_system='break_fee_credit' AND u.energy_direction='consumption_correction' AND u.settlement_type='credit_invoice')
    ) THEN
     SELECT (b->>'qualified')::boolean INTO qualified FROM jsonb_array_elements(public.gridex_read_billing_underlay_source_basis_v1(company,ARRAY[u.id])) b WHERE b->>'id'=u.id::text;
    END IF;
    IF qualified IS TRUE THEN
     IF u.payload->>'charge_kind'='break_fee' THEN
      qualified:=EXISTS(SELECT FROM public.break_fee_charges ch WHERE ch.company_id=company AND ch.billing_underlay_id=u.id
       AND ch.id::text=u.payload->>'break_fee_charge_id' AND ch.customer_id=u.customer_id
       AND ch.customer_contract_id=u.customer_contract_id AND ch.customer_contract_id=u.contract_id AND ch.currency=u.currency);
     ELSE
      qualified:=EXISTS(SELECT FROM public.break_fee_credits cr
       JOIN public.break_fee_charges ch ON ch.id=cr.break_fee_charge_id AND ch.company_id=cr.company_id
       JOIN public.billing_underlays original ON original.id=cr.original_billing_underlay_id AND original.company_id=cr.company_id
       JOIN public.customer_invoices inv ON inv.id=cr.original_invoice_id AND inv.company_id=cr.company_id
       JOIN public.billing_adjustment_cases ac ON ac.id=cr.adjustment_case_id AND ac.company_id=cr.company_id
       WHERE cr.company_id=company AND cr.credit_underlay_id=u.id AND cr.id::text=u.payload->>'break_fee_credit_id'
       AND cr.break_fee_charge_id::text=u.payload->>'break_fee_charge_id' AND cr.original_invoice_id::text=u.payload->>'original_invoice_id'
       AND cr.original_billing_underlay_id::text=u.payload->>'original_billing_underlay_id' AND cr.adjustment_case_id::text=u.payload->>'adjustment_case_id'
       AND ch.invoice_id=cr.original_invoice_id AND ch.billing_underlay_id=cr.original_billing_underlay_id
       AND inv.billing_underlay_id=original.id AND inv.customer_id=u.customer_id AND original.customer_id=u.customer_id
       AND ch.customer_id=u.customer_id AND ch.customer_contract_id=u.customer_contract_id AND ch.customer_contract_id=u.contract_id
       AND original.contract_id=u.contract_id AND original.customer_contract_id=u.customer_contract_id
       AND cr.currency=u.currency AND ch.currency=u.currency AND original.currency=u.currency
       AND ac.original_invoice_id=cr.original_invoice_id AND ac.original_billing_underlay_id=cr.original_billing_underlay_id
       AND ac.corrected_billing_underlay_id=u.id);
     END IF;
    END IF;
    IF qualified IS DISTINCT FROM true THEN RAISE EXCEPTION 'billing_finalized_source_basis_required' USING ERRCODE='23514'; END IF;
   ELSE
    PERFORM gridex_billing_source.require_underlay_v1(company,(item->>'billing_underlay_id')::uuid);
   END IF;
  END IF;
 END LOOP;
 RETURN gridex_billing_source.gridex_create_billing_export_run_before_source_v2(p_run,p_items);
END $newbody$;
BEGIN
 IF current_user<>session_user OR current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'finance_d11_owner_session_required' USING ERRCODE='42501';END IF;
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT original,metadata FROM pg_proc p WHERE oid=target;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')=new_hash THEN RETURN;END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM old_hash THEN RAISE EXCEPTION 'finance_d11_exact_source_required' USING ERRCODE='55000';END IF;
 definition:=pg_get_functiondef(target);
 IF cardinality(string_to_array(definition,original))<>2 THEN RAISE EXCEPTION 'finance_d11_definition_required' USING ERRCODE='55000';END IF;
 EXECUTE replace(definition,original,replacement);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target) IS DISTINCT FROM new_hash THEN RAISE EXCEPTION 'finance_d11_postcondition_failed' USING ERRCODE='55000';END IF;
END;
$finance_d11_0$;
DO $finance_d11_1$
DECLARE target regprocedure:='public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure;original text;definition text;metadata jsonb;
 old_hash constant text:='d57405ca3d3c37f955c7f7d0c7eb99008fb2a237370ae422a5c4441d0e28ef7d';new_hash constant text:='bf7b946d1e6f82931dd24526eae5ad376240ce9fc9016ca8274dee7727f36171';
 replacement constant text:=$newbody$
DECLARE result jsonb:='[]';u public.billing_underlays%rowtype;b gridex_billing_source.underlay_bindings%rowtype;qualified boolean;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_company_id IS NULL OR p_underlay_ids IS NULL OR cardinality(p_underlay_ids)>1000 OR array_position(p_underlay_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'billing_underlay_read_scope_required'; END IF;
 FOR u IN SELECT * FROM public.billing_underlays WHERE company_id=p_company_id AND id=ANY(p_underlay_ids) ORDER BY id LOOP
  SELECT * INTO b FROM gridex_billing_source.underlay_bindings WHERE underlay_id=u.id AND company_id=p_company_id;
  qualified:=true;
  -- D11 (20261025120000): a break-fee underlay is backed by its own approved charge, not by metering values.
  -- D11-G1 (20261026120000): a break-fee credit underlay is backed by its own credit row.
  IF u.payload->>'charge_kind'='break_fee_credit' THEN
   qualified:=EXISTS(SELECT FROM public.break_fee_credits cr WHERE cr.company_id=p_company_id AND cr.credit_underlay_id=u.id
     AND cr.id::text=u.payload->>'break_fee_credit_id' AND cr.status IN ('underlaid','invoiced'));
  ELSIF u.payload->>'charge_kind'='break_fee' THEN
   qualified:=EXISTS(SELECT FROM public.break_fee_charges ch WHERE ch.company_id=p_company_id AND ch.billing_underlay_id=u.id
     AND ch.id::text=u.payload->>'break_fee_charge_id' AND ch.status IN ('underlaid','invoiced','partially_credited','credited'));
  ELSE
  BEGIN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,u.id);
  EXCEPTION WHEN check_violation THEN qualified:=false; END;
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('id',u.id,'qualified',qualified,'totalKwh',gridex_utilts_binding.canonical_decimal_v2(u.total_kwh::text),'sourceBasisHash',b.source_basis_hash,'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)));
 END LOOP;
 RETURN result;
END $newbody$;
BEGIN
 IF current_user<>session_user OR current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'finance_d11_owner_session_required' USING ERRCODE='42501';END IF;
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT original,metadata FROM pg_proc p WHERE oid=target;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')=new_hash THEN RETURN;END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM old_hash THEN RAISE EXCEPTION 'finance_d11_exact_source_required' USING ERRCODE='55000';END IF;
 definition:=pg_get_functiondef(target);
 IF cardinality(string_to_array(definition,original))<>2 THEN RAISE EXCEPTION 'finance_d11_definition_required' USING ERRCODE='55000';END IF;
 EXECUTE replace(definition,original,replacement);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target) IS DISTINCT FROM new_hash THEN RAISE EXCEPTION 'finance_d11_postcondition_failed' USING ERRCODE='55000';END IF;
END;
$finance_d11_1$;
COMMIT;
