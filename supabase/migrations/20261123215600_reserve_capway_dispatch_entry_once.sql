DO $migration$
BEGIN

CREATE SCHEMA gridex_capway_dispatch;
REVOKE ALL ON SCHEMA gridex_capway_dispatch FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_capway_dispatch.new_items (
  company_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.invoice_export_items(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  underlay_id uuid NOT NULL,
  pricing_run_id uuid NOT NULL,
  PRIMARY KEY (company_id,item_id)
);

CREATE TABLE gridex_capway_dispatch.entries (
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('create','purchase')),
  entry_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  lease_token uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  provider_key text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  target_guid text,
  provider_ack_sha256 text CHECK (provider_ack_sha256 ~ '^[0-9a-f]{64}$'),
  provider_invoice_guid text,
  partner_ack_at timestamptz,
  PRIMARY KEY (company_id,item_id,phase),
  FOREIGN KEY (company_id,item_id) REFERENCES gridex_capway_dispatch.new_items(company_id,item_id) ON DELETE CASCADE,
  CHECK ((phase='purchase')=(target_guid IS NOT NULL)),
  CHECK ((provider_ack_sha256 IS NULL)=(partner_ack_at IS NULL)),
  CHECK ((provider_invoice_guid IS NOT NULL)=(phase='create' AND partner_ack_at IS NOT NULL))
);
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_capway_dispatch FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_capway_dispatch.mark_new_item_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  -- The application cannot backfill evidence for an older possibly attempted
  -- export. Only a newly inserted, canonical approval-flow item can qualify.
  IF NEW.provider='capway_aptic' AND NEW.status='pending' AND NEW.export_file_id IS NULL
     AND NEW.billing_underlay_id IS NOT NULL AND NEW.pricing_run_id IS NOT NULL
     AND NEW.attempt_count=0 AND NEW.provider_invoice_guid IS NULL AND NEW.provider_invoice_id IS NULL
     AND EXISTS (
       SELECT FROM public.invoice_export_runs r WHERE r.id=NEW.export_run_id AND r.company_id=NEW.company_id
         AND r.provider=NEW.provider AND r.environment=NEW.environment
         AND r.metadata->>'source'='invoice_review_v1'
     ) THEN
    INSERT INTO gridex_capway_dispatch.new_items(company_id,item_id,run_id,underlay_id,pricing_run_id)
      VALUES(NEW.company_id,NEW.id,NEW.export_run_id,NEW.billing_underlay_id,NEW.pricing_run_id);
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION gridex_capway_dispatch.mark_new_item_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER gridex_capway_dispatch_new_item
  AFTER INSERT ON public.invoice_export_items FOR EACH ROW
  WHEN (NEW.provider='capway_aptic') EXECUTE FUNCTION gridex_capway_dispatch.mark_new_item_v1();

CREATE FUNCTION public.gridex_reserve_capway_dispatch_entry_v1(
 p_company uuid,p_item uuid,p_invoice uuid,p_run uuid,p_actor uuid,p_lease uuid,p_environment text,
 p_phase text,p_updated_at timestamptz,p_review_hash text,p_external_reference text,p_provider_key text,
 p_request_hash text,p_target_guid text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s'
AS $function$
DECLARE
  company public.companies%ROWTYPE;
  item public.invoice_export_items%ROWTYPE;
  run public.invoice_export_runs%ROWTYPE;
  invoice public.customer_invoices%ROWTYPE;
  underlay public.billing_underlays%ROWTYPE;
  pricing public.pricing_runs%ROWTYPE;
  lease public.automation_locks%ROWTYPE;
  original gridex_capway_dispatch.entries%ROWTYPE;
  approval jsonb;
  checkpoint jsonb;
  reserved uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'capway_dispatch_service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company IS NULL OR p_item IS NULL OR p_invoice IS NULL OR p_run IS NULL OR p_actor IS NULL OR p_lease IS NULL
    OR p_environment IS NULL OR p_environment NOT IN ('test','production')
    OR p_phase IS NULL OR p_phase NOT IN ('create','purchase') OR p_updated_at IS NULL
    OR p_review_hash IS NULL OR p_review_hash !~ '^[0-9a-f]{64}$'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
    OR nullif(btrim(p_external_reference),'') IS NULL OR nullif(btrim(p_provider_key),'') IS NULL
    OR ((p_phase='purchase') IS DISTINCT FROM (nullif(btrim(p_target_guid),'') IS NOT NULL)) THEN
    RAISE EXCEPTION 'capway_dispatch_context_invalid' USING ERRCODE='22023';
  END IF;

  -- The canonical withdrawal owner takes the same company/customer/contract
  -- locks. A committed stop is visible before a new external right can exist.
  SELECT * INTO company FROM public.companies WHERE id=p_company FOR UPDATE;
  IF NOT FOUND OR company.is_active IS FALSE OR coalesce(company.status,'active') IN
    ('paused','suspended','closed','archived','pending_deletion','deleted_test_only')
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.export') IS NOT TRUE
    OR NOT EXISTS (
      SELECT FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id
      WHERE u.id=p_actor AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
        AND u.email_confirmed_at IS NOT NULL AND profile.user_status='active'
    ) THEN
    RAISE EXCEPTION 'capway_dispatch_actor_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT item FROM public.invoice_export_items
    WHERE id=p_item AND company_id=p_company AND export_run_id=p_run FOR UPDATE;
  SELECT * INTO STRICT run FROM public.invoice_export_runs
    WHERE id=p_run AND company_id=p_company FOR SHARE;
  SELECT * INTO STRICT invoice FROM public.customer_invoices
    WHERE id=p_invoice AND company_id=p_company AND invoice_export_item_id=item.id FOR UPDATE;
  IF item.customer_id IS NULL OR item.customer_contract_id IS NULL
     OR item.billing_underlay_id IS NULL OR item.pricing_run_id IS NULL
     OR invoice.customer_id IS DISTINCT FROM item.customer_id
     OR invoice.customer_contract_id IS DISTINCT FROM item.customer_contract_id
     OR invoice.billing_underlay_id IS DISTINCT FROM item.billing_underlay_id THEN
    RAISE EXCEPTION 'capway_dispatch_source_changed' USING ERRCODE='23514';
  END IF;
  PERFORM FROM public.customers WHERE id=item.customer_id AND company_id=p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'capway_dispatch_source_changed' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company::text||':'||item.customer_contract_id::text,0));
  PERFORM FROM public.customer_contracts WHERE id=item.customer_contract_id
    AND company_id=p_company AND customer_id=item.customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'capway_dispatch_source_changed' USING ERRCODE='23514'; END IF;
  SELECT * INTO STRICT underlay FROM public.billing_underlays
    WHERE id=item.billing_underlay_id AND company_id=p_company FOR SHARE;
  SELECT * INTO STRICT pricing FROM public.pricing_runs
    WHERE id=item.pricing_run_id AND company_id=p_company FOR SHARE;
  PERFORM gridex_case_confirmation.require_underlay_invoice_open_v1(p_company,underlay.id);
  PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,underlay.id,invoice.id,item.id);
  -- A new correction's nondeferrable foreign key also locks this exact source.
  -- Waiting behind another owner is unnecessary for an irreversible entry.
  PERFORM FROM gridex_billing_source.underlay_bindings b
    WHERE b.company_id=p_company AND b.underlay_id=underlay.id FOR UPDATE NOWAIT;
  PERFORM gridex_billing_source.require_underlay_v1(p_company,underlay.id);
  PERFORM gridex_locked_pricing_evidence.assert_draft(p_company,jsonb_build_array(to_jsonb(item)),
    jsonb_build_object('invoice_export_item_id',item.id,'calculation_snapshot',invoice.calculation_snapshot));

  approval:=item.metadata->'approval';
  IF company.invoice_export_enabled IS DISTINCT FROM true
    OR company.invoice_export_target_system IS DISTINCT FROM 'capway_aptic'
    OR company.billing_provider_environment IS DISTINCT FROM p_environment
    OR item.provider IS DISTINCT FROM 'capway_aptic' OR run.provider IS DISTINCT FROM item.provider
    OR item.environment IS DISTINCT FROM p_environment OR run.environment IS DISTINCT FROM item.environment
    OR item.financing_mode IS DISTINCT FROM run.financing_mode
    OR item.updated_at IS DISTINCT FROM p_updated_at OR item.export_file_id IS NOT NULL
    OR item.provider_invoice_guid IS NOT NULL OR item.provider_invoice_id IS NOT NULL
    OR underlay.customer_id IS DISTINCT FROM item.customer_id
    OR coalesce(underlay.customer_contract_id,underlay.contract_id) IS DISTINCT FROM item.customer_contract_id
    OR (underlay.contract_id IS NOT NULL AND underlay.customer_contract_id IS NOT NULL
         AND underlay.contract_id IS DISTINCT FROM underlay.customer_contract_id)
    OR underlay.status IS DISTINCT FROM 'validated' OR underlay.readiness_status IS DISTINCT FROM 'ready'
    OR coalesce(underlay.missing_values_count,0)>0
    OR pricing.billing_underlay_id IS DISTINCT FROM underlay.id
    OR pricing.id::text IS DISTINCT FROM p_external_reference
    OR pricing.status IS DISTINCT FROM 'locked' OR pricing.locked_at IS NULL
    OR underlay.total_kwh IS DISTINCT FROM item.total_kwh
    OR pricing.total_ex_vat IS DISTINCT FROM item.amount_ex_vat
    OR pricing.vat_amount IS DISTINCT FROM item.vat_amount
    OR pricing.total_inc_vat IS DISTINCT FROM item.amount_inc_vat
    OR invoice.amount_inc_vat IS DISTINCT FROM item.amount_inc_vat
    OR invoice.status IS DISTINCT FROM 'draft' OR invoice.issued_at IS NOT NULL
    OR (invoice.partner_invoice_reference IS NOT NULL AND invoice.partner_invoice_reference<>'pending:'||item.id::text)
    OR approval IS DISTINCT FROM invoice.metadata->'approval'
    OR approval->>'status' IS DISTINCT FROM 'approved'
    OR approval->>'review_hash' IS DISTINCT FROM p_review_hash
    OR invoice.calculation_snapshot_sha256 IS NULL
    OR approval->>'calculation_snapshot_sha256' IS DISTINCT FROM invoice.calculation_snapshot_sha256
    OR p_provider_key IS DISTINCT FROM coalesce(nullif(btrim(item.provider_idempotency_key),''),
      nullif(btrim(item.idempotency_key),''),'invoice:'||p_company::text||':'||p_item::text) THEN
    RAISE EXCEPTION 'capway_dispatch_source_changed' USING ERRCODE='23514';
  END IF;
  SELECT * INTO lease FROM public.automation_locks
    WHERE company_id=p_company AND lock_key='approved-invoice:'||p_company::text||':'||p_item::text FOR SHARE;
  IF lease.lock_token IS DISTINCT FROM p_lease OR lease.expires_at IS NULL OR lease.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'capway_dispatch_lease_changed' USING ERRCODE='55P03';
  END IF;
  IF NOT EXISTS (
    SELECT FROM gridex_capway_dispatch.new_items n WHERE n.company_id=p_company AND n.item_id=item.id
      AND n.run_id=item.export_run_id AND n.underlay_id=underlay.id AND n.pricing_run_id=pricing.id
  ) THEN
    RAISE EXCEPTION 'capway_dispatch_previous_effect_unresolved' USING ERRCODE='23514';
  END IF;

  IF p_phase='create' THEN
    IF item.status IS DISTINCT FROM 'pending' OR item.attempt_count<>0
      OR item.provider_request_id IS NOT NULL OR item.provider_confirmed_at IS NOT NULL
      OR item.response_payload ? 'automatic_purchase_reconciliation'
      OR item.response_payload ? 'manual_purchase_reconciliation'
      OR EXISTS (SELECT FROM public.invoice_export_attempts a WHERE a.company_id=p_company AND a.invoice_export_item_id=item.id) THEN
      RAISE EXCEPTION 'capway_dispatch_previous_effect_unresolved' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO original FROM gridex_capway_dispatch.entries
      WHERE company_id=p_company AND item_id=item.id AND phase='create';
    checkpoint:=item.response_payload->'automatic_purchase_reconciliation';
    IF item.status IS DISTINCT FROM 'needs_review'
      OR item.financing_mode NOT IN ('factoring_with_recourse','factoring_without_recourse')
      OR original.lease_token IS DISTINCT FROM p_lease OR original.provider_key IS DISTINCT FROM p_provider_key
      OR original.provider_invoice_guid IS DISTINCT FROM p_target_guid
      OR encode(sha256(convert_to((item.response_payload->'create_invoice')::text,'UTF8')),'hex')
        IS DISTINCT FROM original.provider_ack_sha256
      OR checkpoint->>'company_id' IS DISTINCT FROM p_company::text
      OR checkpoint->>'invoice_export_item_id' IS DISTINCT FROM item.id::text
      OR checkpoint->>'export_run_id' IS DISTINCT FROM item.export_run_id::text
      OR checkpoint->>'provider' IS DISTINCT FROM item.provider
      OR checkpoint->>'environment' IS DISTINCT FROM item.environment
      OR checkpoint->>'financing_mode' IS DISTINCT FROM item.financing_mode
      OR checkpoint->>'invoice_guid' IS DISTINCT FROM p_target_guid
      OR checkpoint->>'provider_idempotency_key' IS DISTINCT FROM p_provider_key
      OR checkpoint->'attempt_no' IS DISTINCT FROM to_jsonb(item.attempt_count)
      OR item.response_payload ? 'manual_purchase_reconciliation' THEN
      RAISE EXCEPTION 'capway_dispatch_purchase_checkpoint_changed' USING ERRCODE='23514';
    END IF;
  END IF;

  INSERT INTO gridex_capway_dispatch.entries(company_id,item_id,phase,lease_token,actor_id,request_hash,provider_key,target_guid)
    VALUES(p_company,p_item,p_phase,p_lease,p_actor,p_request_hash,p_provider_key,p_target_guid)
    ON CONFLICT (company_id,item_id,phase) DO NOTHING RETURNING entry_id INTO reserved;
  IF reserved IS NULL THEN
    RAISE EXCEPTION 'capway_dispatch_previous_effect_unresolved' USING ERRCODE='23514';
  END IF;
  RETURN reserved;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_reserve_capway_dispatch_entry_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_reserve_capway_dispatch_entry_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text)
  TO service_role;

END
$migration$;
