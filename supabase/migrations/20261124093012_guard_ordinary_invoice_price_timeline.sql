DO $migration$
DECLARE
  target constant regprocedure := 'gridex_billing_source.guard_price_timeline_invoice_hold_v1()'::regprocedure;
  definition text := pg_get_functiondef(target);
  original_declaration constant text := $old$ DECLARE held_underlay uuid; reason constant text := 'price_timeline_invoice_review_required';$old$;
  revised_declaration constant text := $new$ DECLARE
  held_underlay uuid;
  reason constant text := 'price_timeline_invoice_review_required';
  price_timeline jsonb;
  basis_contract uuid;
  basis_price uuid;
  basis_start timestamptz;
  basis_end timestamptz;$new$;
  original_return constant text := $old$  ) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='billing_underlays' THEN$old$;
  revised_return constant text := $new$  ) THEN
   IF TG_TABLE_NAME='invoice_export_items' AND TG_OP='INSERT' THEN
    -- A previously validated underlay can predate the newest applicable price.
    -- Only ordinary managed timelines have this proof. Existing invoice links
    -- keep their frozen source for approval, export and historical replay.
    SELECT u.payload#>'{contract_price_timeline}',
      (b.source_basis->>'contractId')::uuid,(b.source_basis#>>'{price,id}')::uuid,
      (b.source_basis->>'start')::timestamptz,(b.source_basis->>'end')::timestamptz
    INTO price_timeline,basis_contract,basis_price,basis_start,basis_end
    FROM public.billing_underlays u
    JOIN gridex_billing_source.underlay_bindings b ON b.underlay_id=u.id AND b.company_id=u.company_id
    WHERE u.id=held_underlay AND u.company_id=NEW.company_id
      AND u.payload#>'{contract_price_timeline}' IS NOT NULL;
    IF FOUND THEN
     IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
      RAISE EXCEPTION 'invoice_price_timeline_read_committed_required' USING ERRCODE='25001';
     END IF;
     -- Snapshot inserts take KEY SHARE through their company/contract FK.
     -- The underlay is already locked, so do not wait on the inverse order.
     PERFORM 1 FROM public.customer_contracts c
     WHERE c.company_id=NEW.company_id AND c.id=basis_contract FOR UPDATE NOWAIT;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE=reason; END IF;
     BEGIN
      PERFORM gridex_billing_source.require_contract_price_timeline_v1(
       NEW.company_id,basis_contract,basis_price,basis_start,basis_end,price_timeline);
     EXCEPTION WHEN SQLSTATE 'PT409' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE=reason;
     END;
    END IF;
   END IF;
   RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='billing_underlays' THEN$new$;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '8b086cde11f8180eed17b16ec4c52bd7'
     OR (length(definition)-length(replace(definition,original_declaration,'')))/length(original_declaration)<>1
     OR (length(definition)-length(replace(definition,original_return,'')))/length(original_return)<>1
  THEN
    RAISE EXCEPTION 'billing_price_timeline_invoice_guard_predecessor_changed';
  END IF;
  EXECUTE replace(replace(definition,original_declaration,revised_declaration),original_return,revised_return);
END
$migration$;
