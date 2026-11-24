-- Verify precisely the timeline selected by the ordinary billing generator.
-- A newly committed contract price snapshot forces a fresh period plan.
DO $gridex_price_timeline_migration$
DECLARE
 writer constant regprocedure := 'public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)'::regprocedure;
 previous_body text; next_body text; prior_meta jsonb;
 basis_line constant text := $basis$ basis_hash:=encode(extensions.digest(convert_to(source_basis::text,'UTF8'),'sha256'),'hex');$basis$;
 invoice_hold constant text := $hold$ IF jsonb_array_length(p_underlay#>'{payload,contract_price_timeline,snapshotIds}')>1 THEN
  source_basis:=source_basis||jsonb_build_object('invoiceReviewHold','price_timeline_invoice_review_required');
 END IF;
$hold$;
 return_line constant text := $ret$ RETURN stored_id;$ret$;
 readiness_hold constant text := $ready$ IF source_basis->>'invoiceReviewHold'='price_timeline_invoice_review_required' THEN
  UPDATE public.billing_underlays SET invoice_readiness_status='blocked' WHERE id=stored_id AND company_id=p_company_id;
 END IF;
$ready$;
 old constant text := $old$ SELECT * INTO ct FROM public.customer_contracts WHERE id=(p_underlay->>'contract_id')::uuid AND company_id=p_company_id FOR SHARE;$old$;
 new constant text := $new$ IF p_underlay#>'{payload,contract_price_timeline}' IS NULL THEN
  SELECT * INTO ct FROM public.customer_contracts WHERE id=(p_underlay->>'contract_id')::uuid AND company_id=p_company_id FOR SHARE;
 ELSE
  -- The snapshot's existing company/contract foreign key takes KEY SHARE
  -- on this row for inserts. Hold UPDATE while re-reading the immutable IDs.
  SELECT * INTO ct FROM public.customer_contracts WHERE id=(p_underlay->>'contract_id')::uuid AND company_id=p_company_id FOR UPDATE;
  PERFORM gridex_billing_source.require_contract_price_timeline_v1(
   p_company_id,ct.id,(p_underlay->>'contract_price_snapshot_id')::uuid,start_at,end_at,
   p_underlay#>'{payload,contract_price_timeline}');
 END IF;$new$;
BEGIN
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT previous_body,prior_meta FROM pg_proc p WHERE oid=writer;
 IF md5(previous_body) IS DISTINCT FROM 'ae724ce55f106da817c1f0a94dd7492b'
  OR (length(previous_body)-length(replace(previous_body,old,'')))/length(old)<>1
 THEN RAISE EXCEPTION 'billing_price_timeline_predecessor_changed'; END IF;

 CREATE FUNCTION gridex_billing_source.require_contract_price_timeline_v1(
  p_company uuid,p_contract uuid,p_selected uuid,p_start timestamptz,p_end timestamptz,p_timeline jsonb
 ) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $price_timeline$
 DECLARE v_start timestamptz; v_end timestamptz; v_ids jsonb; v_observed jsonb; v_start_date date; v_last_date date;
 BEGIN
  IF p_company IS NULL OR p_contract IS NULL OR p_selected IS NULL
   OR jsonb_typeof(p_timeline) IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_timeline->'snapshotIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_timeline->'from') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_timeline->'until') IS DISTINCT FROM 'string'
  THEN RAISE EXCEPTION 'billing_price_timeline_invalid' USING ERRCODE='22023'; END IF;
  v_start:=(p_timeline->>'from')::timestamptz;
  v_end:=(p_timeline->>'until')::timestamptz;
  v_ids:=p_timeline->'snapshotIds';
  IF NOT isfinite(v_start) OR NOT isfinite(v_end) OR v_start>p_start OR v_end<p_end OR v_end<=v_start
   OR jsonb_array_length(v_ids) NOT BETWEEN 1 AND 32 OR NOT v_ids @> jsonb_build_array(p_selected)
  THEN RAISE EXCEPTION 'billing_price_timeline_invalid' USING ERRCODE='22023'; END IF;
  v_start_date:=(v_start AT TIME ZONE 'Europe/Stockholm')::date;
  v_last_date:=((v_end-interval '1 microsecond') AT TIME ZONE 'Europe/Stockholm')::date;
  IF v_last_date-v_start_date>31
  THEN RAISE EXCEPTION 'billing_price_timeline_invalid' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(s.id ORDER BY s.valid_from,s.id),'[]'::jsonb) INTO v_observed
  FROM public.contract_price_snapshots s
  WHERE s.company_id=p_company AND s.contract_id=p_contract AND s.valid_from<=v_last_date
   AND (s.valid_to IS NULL OR s.valid_to>=v_start_date);
  IF v_observed IS DISTINCT FROM v_ids
  -- PT409 reaches the caller immediately. PostgREST internally retries 40001
  -- with the stale command, but this conflict needs a new application plan.
  THEN RAISE EXCEPTION 'billing_price_timeline_changed' USING ERRCODE='PT409'; END IF;
 END
 $price_timeline$;
 REVOKE ALL ON FUNCTION gridex_billing_source.require_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

 CREATE FUNCTION gridex_billing_source.guard_price_timeline_invoice_hold_v1()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $invoice_hold_guard$
 DECLARE held_underlay uuid; reason constant text := 'price_timeline_invoice_review_required';
 BEGIN
  IF TG_TABLE_NAME='partner_exports' THEN
   IF NEW.export_kind IS DISTINCT FROM 'billing_underlay' THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='billing_underlays' THEN
   held_underlay:=NEW.id;
  ELSE
   held_underlay:=NEW.billing_underlay_id;
   -- Serialize the invoice link with first source binding on the same underlay.
   PERFORM 1 FROM public.billing_underlays u
    WHERE u.id=held_underlay AND u.company_id=NEW.company_id FOR SHARE;
  END IF;
  IF held_underlay IS NULL OR NOT EXISTS(
   SELECT FROM gridex_billing_source.underlay_bindings basis
   WHERE basis.underlay_id=held_underlay AND basis.company_id=NEW.company_id
    AND basis.source_basis->>'invoiceReviewHold'=reason
  ) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='billing_underlays' THEN
   NEW.invoice_readiness_status:='blocked';
   NEW.invoice_readiness_issues:=jsonb_build_array(reason);
   RETURN NEW;
  END IF;
  RAISE EXCEPTION 'price_timeline_invoice_review_required' USING ERRCODE='23514';
 END
 $invoice_hold_guard$;
 REVOKE ALL ON FUNCTION gridex_billing_source.guard_price_timeline_invoice_hold_v1()
 FROM PUBLIC,anon,authenticated,service_role;

 CREATE TRIGGER price_timeline_invoice_readiness_hold
 BEFORE UPDATE OF invoice_readiness_status ON public.billing_underlays
 FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.guard_price_timeline_invoice_hold_v1();
 CREATE TRIGGER price_timeline_single_invoice_hold
 BEFORE INSERT OR UPDATE OF company_id,billing_underlay_id ON public.invoice_export_items
 FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.guard_price_timeline_invoice_hold_v1();
 CREATE TRIGGER price_timeline_group_invoice_hold
 BEFORE INSERT OR UPDATE OF company_id,billing_underlay_id ON gridex_invoice_groups.sources
 FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.guard_price_timeline_invoice_hold_v1();
 CREATE TRIGGER price_timeline_partner_invoice_hold
 BEFORE INSERT OR UPDATE OF company_id,billing_underlay_id,export_kind ON public.partner_exports
 FOR EACH ROW EXECUTE FUNCTION gridex_billing_source.guard_price_timeline_invoice_hold_v1();

 next_body:=replace(replace(replace(previous_body,old,new),basis_line,invoice_hold||basis_line),return_line,readiness_hold||return_line);
 EXECUTE replace(pg_get_functiondef(writer),previous_body,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=writer) IS DISTINCT FROM prior_meta
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=writer) IS DISTINCT FROM 'dbee9de486a55c54ee827bae5be416a8'
 THEN RAISE EXCEPTION 'billing_price_timeline_metadata_changed'; END IF;
END
$gridex_price_timeline_migration$;
