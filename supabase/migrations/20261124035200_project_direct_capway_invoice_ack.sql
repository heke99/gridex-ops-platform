DO $migration$
BEGIN
CREATE TABLE gridex_capway_dispatch.direct_invoice_projection (
  entry_id uuid PRIMARY KEY REFERENCES gridex_capway_dispatch.entries(entry_id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  run_id uuid NOT NULL,
  issued_at timestamptz NOT NULL,
  due_date date NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  http_status smallint CHECK (http_status BETWEEN 200 AND 299),
  projection_at timestamptz,
  UNIQUE (company_id, item_id)
);
REVOKE ALL ON gridex_capway_dispatch.direct_invoice_projection FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_reserve_direct_capway_invoice_v1(
  p_company uuid,p_item uuid,p_invoice uuid,p_run uuid,p_actor uuid,p_lease uuid,p_environment text,
  p_updated_at timestamptz,p_review_hash text,p_external_reference text,p_provider_key text,
  p_request_hash text,p_wire_body text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s'
AS $function$
DECLARE
  entry uuid;
  issued timestamptz;
  due date;
  wire jsonb;
  request_document jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_wire_body IS NULL
    OR encode(sha256(convert_to(p_wire_body,'UTF8')),'hex') IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'capway_direct_invoice_wire_unverified' USING ERRCODE='23514';
  END IF;
  wire:=p_wire_body::jsonb;
  IF jsonb_typeof(wire) IS DISTINCT FROM 'array' OR jsonb_array_length(wire)<>1 THEN
    RAISE EXCEPTION 'capway_direct_invoice_wire_invalid' USING ERRCODE='22023';
  END IF;
  request_document:=wire->0;
  IF jsonb_typeof(request_document) IS DISTINCT FROM 'object'
    OR request_document->>'externalReferenceCode' IS DISTINCT FROM p_external_reference
    OR request_document->'purchasable' IS DISTINCT FROM '0'::jsonb
    OR jsonb_typeof(request_document->'debts') IS DISTINCT FROM 'array'
    OR jsonb_array_length(request_document->'debts')<>1
    OR request_document->>'invoiceDate' IS DISTINCT FROM request_document#>>'{debts,0,invoiceDate}'
    OR coalesce(request_document->>'invoiceDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR coalesce(request_document#>>'{debts,0,dueDate}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION 'capway_direct_invoice_request_invalid' USING ERRCODE='22023';
  END IF;
  issued:=(request_document->>'invoiceDate')::timestamptz;
  due:=left(request_document#>>'{debts,0,dueDate}',10)::date;
  IF due<=(issued AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'capway_direct_invoice_dates_invalid' USING ERRCODE='22023';
  END IF;

  -- The canonical producer validates actor, exact immutable graph, current finance
  -- source, signed-work hold, company/environment and the live transport lease.
  entry:=public.gridex_reserve_capway_dispatch_entry_v1(p_company,p_item,p_invoice,p_run,p_actor,p_lease,
    p_environment,'create',p_updated_at,p_review_hash,p_external_reference,p_provider_key,p_request_hash,NULL);
  IF NOT EXISTS (SELECT FROM public.invoice_export_runs r WHERE r.company_id=p_company AND r.id=p_run
    AND r.financing_mode IN ('invoice_service','manual')) THEN
    RAISE EXCEPTION 'capway_direct_invoice_financing_required' USING ERRCODE='23514';
  END IF;
  -- Use the existing invoice request storage rather than duplicate its personal data.
  UPDATE public.invoice_export_items SET request_payload=request_document
  WHERE company_id=p_company AND id=p_item;
  INSERT INTO gridex_capway_dispatch.direct_invoice_projection(entry_id,company_id,item_id,invoice_id,run_id,
    issued_at,due_date,request_digest)
  VALUES(entry,p_company,p_item,p_invoice,p_run,issued,due,encode(sha256(convert_to(request_document::text,'UTF8')),'hex'));
  RETURN entry;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_reserve_direct_capway_invoice_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_reserve_direct_capway_invoice_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text)
  TO service_role;

CREATE FUNCTION public.gridex_record_direct_capway_ack_v1(
  p_company uuid,p_item uuid,p_entry uuid,p_lease uuid,p_ack jsonb,p_http_status integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s'
AS $function$
DECLARE
  saved uuid;
  item public.invoice_export_items%ROWTYPE;
  intent gridex_capway_dispatch.direct_invoice_projection%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'capway_direct_invoice_service_required' USING ERRCODE='42501';
  END IF;
  IF (p_http_status BETWEEN 200 AND 299) IS NOT TRUE THEN
    RAISE EXCEPTION 'capway_direct_invoice_http_status_invalid' USING ERRCODE='22023';
  END IF;
  -- Same company -> item -> entry -> intent order as publication. Keep the
  -- original ACK body in its existing protected operator response column.
  PERFORM FROM public.companies WHERE id=p_company FOR UPDATE;
  SELECT * INTO STRICT item FROM public.invoice_export_items WHERE company_id=p_company AND id=p_item FOR UPDATE;
  saved:=public.gridex_record_capway_dispatch_ack_v1(p_company,p_item,p_entry,p_lease,p_ack);
  UPDATE gridex_capway_dispatch.direct_invoice_projection SET http_status=p_http_status
  WHERE entry_id=saved AND company_id=p_company AND item_id=p_item AND http_status IS NULL
  RETURNING * INTO intent;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT FROM gridex_capway_dispatch.direct_invoice_projection i
      WHERE i.entry_id=saved AND i.company_id=p_company AND i.item_id=p_item AND i.http_status=p_http_status) THEN
      RAISE EXCEPTION 'capway_direct_invoice_http_status_changed' USING ERRCODE='23514';
    END IF;
    RETURN saved;
  END IF;

  BEGIN
    PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,item.billing_underlay_id,intent.invoice_id,item.id);
    IF (item.response_payload ? 'create_invoice' AND item.response_payload->'create_invoice' IS DISTINCT FROM p_ack)
      OR item.response_payload ? 'automatic_purchase_reconciliation' THEN
      RAISE EXCEPTION 'capway_direct_invoice_ack_copy_changed' USING ERRCODE='23514';
    END IF;
    UPDATE public.invoice_export_items
    SET response_payload=coalesce(item.response_payload,'{}'::jsonb)||jsonb_build_object('create_invoice',p_ack)
    WHERE company_id=p_company AND id=p_item;
  EXCEPTION WHEN check_violation THEN
    -- The acknowledged fact remains durable without restoring a retained copy.
    IF SQLERRM<>'finance_copy_retention_tombstoned' THEN RAISE; END IF;
  END;
  RETURN saved;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_record_direct_capway_ack_v1(uuid,uuid,uuid,uuid,jsonb,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_record_direct_capway_ack_v1(uuid,uuid,uuid,uuid,jsonb,integer) TO service_role;

CREATE FUNCTION public.gridex_project_direct_capway_ack_v1(p_company uuid,p_item uuid,p_actor uuid,p_run uuid,p_environment text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s'
AS $function$
DECLARE
  item public.invoice_export_items%ROWTYPE;
  batch public.invoice_export_runs%ROWTYPE;
  invoice public.customer_invoices%ROWTYPE;
  receipt gridex_capway_dispatch.entries%ROWTYPE;
  intent gridex_capway_dispatch.direct_invoice_projection%ROWTYPE;
  cancellation_id uuid;
  event_id uuid;
  finished timestamptz;
  receipt_body jsonb;
  create_acknowledgement jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor IS NULL OR p_run IS NULL
    OR (p_environment IN ('production','test')) IS NOT TRUE THEN
    RAISE EXCEPTION 'capway_direct_invoice_scope_required' USING ERRCODE='42501';
  END IF;
  PERFORM FROM public.companies WHERE id=p_company FOR UPDATE;
  IF NOT FOUND OR public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.export') IS NOT TRUE
    OR NOT EXISTS (SELECT FROM auth.users u JOIN public.user_profiles p ON p.id=u.id
      WHERE u.id=p_actor AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
        AND u.email_confirmed_at IS NOT NULL AND p.user_status='active') THEN
    RAISE EXCEPTION 'capway_direct_invoice_actor_forbidden' USING ERRCODE='42501';
  END IF;

  SELECT * INTO STRICT item FROM public.invoice_export_items WHERE company_id=p_company AND id=p_item FOR UPDATE;
  SELECT * INTO STRICT batch FROM public.invoice_export_runs WHERE company_id=p_company AND id=p_run FOR UPDATE;
  IF item.export_run_id IS DISTINCT FROM batch.id OR item.provider IS DISTINCT FROM 'capway_aptic'
    OR batch.provider IS DISTINCT FROM item.provider OR batch.environment IS DISTINCT FROM item.environment
    OR item.environment IS DISTINCT FROM p_environment OR batch.financing_mode IS DISTINCT FROM item.financing_mode
    OR (item.financing_mode IN ('invoice_service','manual')) IS NOT TRUE THEN
    RAISE EXCEPTION 'capway_direct_invoice_scope_changed' USING ERRCODE='23514';
  END IF;
  SELECT * INTO STRICT invoice FROM public.customer_invoices
    WHERE company_id=p_company AND invoice_export_item_id=p_item FOR UPDATE;
  SELECT * INTO receipt FROM gridex_capway_dispatch.entries
    WHERE company_id=p_company AND item_id=p_item AND phase='create' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF receipt.provider_ack_sha256 IS NULL OR receipt.partner_ack_at IS NULL OR receipt.provider_invoice_guid IS NULL THEN
    RETURN jsonb_build_object('id',p_item,'status','needs_review','reason','provider_create_acceptance_unconfirmed');
  END IF;
  SELECT * INTO intent FROM gridex_capway_dispatch.direct_invoice_projection
    WHERE company_id=p_company AND item_id=p_item AND entry_id=receipt.entry_id FOR UPDATE;
  IF NOT FOUND OR intent.http_status IS NULL THEN
    RETURN jsonb_build_object('id',p_item,'status','needs_review','reason','provider_issue_dates_unverified');
  END IF;
  IF intent.invoice_id IS DISTINCT FROM invoice.id OR intent.run_id IS DISTINCT FROM batch.id
    OR invoice.customer_id IS DISTINCT FROM item.customer_id
    OR invoice.customer_contract_id IS DISTINCT FROM item.customer_contract_id
    OR invoice.billing_underlay_id IS DISTINCT FROM item.billing_underlay_id
    OR (SELECT producer.invoice_id FROM gridex_capway_dispatch.new_items producer
      WHERE producer.company_id=p_company AND producer.item_id=p_item AND producer.run_id=batch.id
        AND producer.underlay_id=item.billing_underlay_id AND producer.pricing_run_id=item.pricing_run_id
        AND producer.producer_version=1) IS DISTINCT FROM invoice.id THEN
    RAISE EXCEPTION 'capway_direct_invoice_graph_changed' USING ERRCODE='23514';
  END IF;
  IF intent.projection_at IS NOT NULL THEN
    RETURN jsonb_build_object('id',p_item,'status','sent','invoiceGuid',receipt.provider_invoice_guid);
  END IF;

  -- A signed cancellation may be queued or unmatched while the direct ACK is
  -- already recorded. Preserve the receipt and hold publication for decision.
  SELECT e.id INTO cancellation_id
  FROM public.invoice_provider_events e
  JOIN public.billing_provider_webhook_events w ON w.company_id=e.company_id
    AND w.provider=e.provider AND w.environment=e.environment AND w.idempotency_key=e.idempotency_hash
    AND w.external_event_id=e.provider_event_id AND w.event_type=e.event_type
    AND w.signature_valid IS TRUE AND w.payload=e.payload
  WHERE e.company_id=p_company AND e.provider=item.provider AND e.environment=item.environment
    AND e.provider_invoice_guid=receipt.provider_invoice_guid
    AND (e.matched_invoice_export_item_id IS NULL OR e.matched_invoice_export_item_id=p_item)
    AND lower(btrim(e.event_type)) IN ('invoice.cancelled','cancelled')
  ORDER BY e.received_at,e.id LIMIT 1;
  IF cancellation_id IS NOT NULL THEN
    RETURN jsonb_build_object('id',p_item,'status','needs_review','reason','signed_cancellation_before_direct_ack');
  END IF;
  PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,item.billing_underlay_id,invoice.id,item.id);
  create_acknowledgement:=item.response_payload->'create_invoice';
  IF item.status IS DISTINCT FROM 'pending' OR invoice.status IS DISTINCT FROM 'draft' OR invoice.issued_at IS NOT NULL
    OR (invoice.partner_invoice_reference IS NOT NULL
      AND invoice.partner_invoice_reference NOT IN ('pending:'||p_item::text,receipt.provider_invoice_guid))
    OR item.provider_invoice_guid IS NOT NULL OR item.provider_invoice_id IS NOT NULL OR item.export_file_id IS NOT NULL
    OR item.metadata#>>'{approval,status}' IS DISTINCT FROM 'approved'
    OR item.metadata->'approval' IS DISTINCT FROM invoice.metadata->'approval'
    OR item.metadata#>>'{approval,calculation_snapshot_sha256}' IS DISTINCT FROM invoice.calculation_snapshot_sha256
    OR encode(sha256(convert_to(item.request_payload::text,'UTF8')),'hex') IS DISTINCT FROM intent.request_digest
    OR encode(sha256(convert_to(create_acknowledgement::text,'UTF8')),'hex') IS DISTINCT FROM receipt.provider_ack_sha256 THEN
    RETURN jsonb_build_object('id',p_item,'status','needs_review','reason','provider_projection_context_changed');
  END IF;

  finished:=clock_timestamp();
  receipt_body:=jsonb_build_object('create_invoice',jsonb_build_object('invoiceGuids',jsonb_build_array(receipt.provider_invoice_guid)),
    'purchase',NULL);
  UPDATE public.invoice_export_items SET status='sent',provider_invoice_guid=receipt.provider_invoice_guid,
    provider_invoice_id=receipt.provider_invoice_guid,provider_idempotency_key=receipt.provider_key,
    provider_confirmed_at=receipt.partner_ack_at,provider_request_id=receipt.provider_key,
    response_payload=item.response_payload||jsonb_build_object('purchase',NULL),
    attempt_count=item.attempt_count+1,last_attempt_at=receipt.reserved_at,
    next_retry_at=NULL,error_code=NULL,error_payload='{}',sent_at=receipt.partner_ack_at,updated_at=finished
  WHERE company_id=p_company AND id=p_item;
  UPDATE public.customer_invoices SET status='sent',partner_invoice_reference=receipt.provider_invoice_guid,
    issued_at=intent.issued_at,due_date=intent.due_date,raw_payload=receipt_body,updated_at=finished
  WHERE company_id=p_company AND id=invoice.id;
  UPDATE public.invoice_export_runs r SET sent_items=done.count, status=CASE WHEN done.complete THEN 'sent' ELSE r.status END,
    failed_items=done.failed, total_ex_vat=done.amount_ex_vat, vat_amount=done.vat_amount,total_inc_vat=done.amount_inc_vat,
    started_at=coalesce(r.started_at,receipt.reserved_at), finished_at=CASE WHEN done.complete THEN finished ELSE r.finished_at END,
    updated_at=finished
  FROM (SELECT count(*) FILTER (WHERE status='sent') AS count,
    count(*) FILTER (WHERE status IN ('failed','rejected','configuration_error')) AS failed,
    bool_and(status='sent') AS complete, coalesce(sum(amount_ex_vat),0) AS amount_ex_vat,
    coalesce(sum(vat_amount),0) AS vat_amount, coalesce(sum(amount_inc_vat),0) AS amount_inc_vat
    FROM public.invoice_export_items WHERE company_id=p_company AND export_run_id=batch.id) done
  WHERE r.company_id=p_company AND r.id=batch.id;
  UPDATE public.billing_export_run_items SET status='sent',export_status='sent',sent_at=receipt.partner_ack_at,
    failed_at=NULL,last_error=NULL,updated_at=finished WHERE company_id=p_company AND id=p_item;
  UPDATE public.billing_export_runs r SET
    status=CASE WHEN done.complete AND r.status<>'acknowledged' THEN 'sent' ELSE r.status END,
    rows_exported=done.sent,rows_sent=done.sent,rows_failed=done.failed,updated_at=finished
  FROM (SELECT count(*) FILTER (WHERE export_status IN ('sent','acknowledged')) AS sent,
    count(*) FILTER (WHERE export_status IN ('failed','rejected')) AS failed,
    bool_and(export_status IN ('sent','acknowledged')) AS complete
    FROM public.billing_export_run_items WHERE company_id=p_company AND billing_export_run_id=batch.id) done
  WHERE r.company_id=p_company AND r.id=batch.id;
  INSERT INTO public.invoice_export_attempts(company_id,invoice_export_item_id,export_run_id,attempt_no,idempotency_key,
    request_hash,http_status,outcome,started_at,finished_at)
  VALUES(p_company,p_item,batch.id,item.attempt_count+1,receipt.provider_key,receipt.request_hash,intent.http_status,'sent',receipt.reserved_at,finished);
  INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,
    payload,idempotency_key)
  VALUES(p_company,'invoice.sent','invoice_export_item',p_item::text,item.customer_id,receipt.actor_id,'invoice_approved_dispatch_v1',
    jsonb_build_object('invoice_guid',receipt.provider_invoice_guid,'billing_month',batch.billing_month,
      'amount_inc_vat',item.amount_inc_vat,'due_date',intent.due_date),
    'invoice-sent:'||p_item::text||':'||receipt.provider_invoice_guid)
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox(company_id,domain_event_id,destination_type,destination_key,status,max_attempts,payload)
  VALUES(p_company,event_id,'webhook','webhook_fanout_v1','queued',12,
    jsonb_build_object('event_type','invoice.sent','aggregate_type','invoice_export_item','aggregate_id',p_item::text));
  UPDATE gridex_capway_dispatch.direct_invoice_projection SET projection_at=finished WHERE entry_id=receipt.entry_id;
  RETURN jsonb_build_object('id',p_item,'status','sent','invoiceGuid',receipt.provider_invoice_guid);
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_project_direct_capway_ack_v1(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_project_direct_capway_ack_v1(uuid,uuid,uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
END
$migration$;
