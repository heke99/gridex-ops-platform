DO $migration$
DECLARE p record; next_body text;
 old_fragment constant text := $before$  if not found then raise exception using errcode='P0002',message='billing_underlay_not_found_for_tenant'; end if;$before$;
 new_fragment constant text := $after$  if not found then raise exception using errcode='P0002',message='billing_underlay_not_found_for_tenant'; end if;
  -- The withdrawal command takes the contract before updating the underlay.
  -- Refuse an in-flight contract transition rather than waiting in reverse order.
  PERFORM FROM public.customer_contracts c
    WHERE c.company_id=p_company_id AND c.customer_id=v_underlay.customer_id
      AND c.id IN (v_underlay.contract_id,v_underlay.customer_contract_id)
    ORDER BY c.id FOR SHARE NOWAIT;
  IF EXISTS (
    SELECT FROM public.customer_cases work
    WHERE work.company_id=p_company_id AND work.customer_id=v_underlay.customer_id
      AND work.customer_contract_id IN (v_underlay.contract_id,v_underlay.customer_contract_id)
      AND work.status='billing_blocked' AND work.billing_blocked
      AND work.metadata->>'scopeType'='contract'
      AND work.metadata->>'scopeId'=work.customer_contract_id::text
  ) THEN
    IF v_underlay.contract_id IS NOT NULL AND v_underlay.customer_contract_id IS NOT NULL
      AND v_underlay.contract_id<>v_underlay.customer_contract_id THEN
      RAISE EXCEPTION 'billing_underlay_contract_case_ambiguous' USING ERRCODE='23514';
    END IF;
    RAISE EXCEPTION 'billing_underlay_contract_case_hold' USING ERRCODE='23514';
  END IF;$after$;
BEGIN
 SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata,proowner,prosecdef
 INTO STRICT p FROM pg_proc proc WHERE oid=to_regprocedure('public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)');
 IF p.proowner IS DISTINCT FROM current_user::regrole OR p.prosecdef IS DISTINCT FROM TRUE
  OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>'2c865218e959eca902e7c0ad54e73915537b1845679ff432c91b4f2cfd01882a'
 THEN RAISE EXCEPTION 'contract_withdrawal_pricing_predecessor_changed'; END IF;
 next_body:=replace(p.prosrc,old_fragment,new_fragment);
 EXECUTE replace(p.definition,p.prosrc,next_body);
 IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=p.oid) IS DISTINCT FROM p.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=p.oid)<>'0ccb70e24872cc30cbf6e3f22bdc09ebd5eb552caf6393c2376d14cc5ad436c7'
 THEN RAISE EXCEPTION 'contract_withdrawal_pricing_metadata_changed'; END IF;
END
$migration$;
