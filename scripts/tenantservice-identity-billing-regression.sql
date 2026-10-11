-- Tenantservice F12 + P3 native regression (clean replay only; synthetic data; rolled back).
-- F12: gridex_decide_customer_identity_change_v1 (customer approval, staff limits, stale value,
--      expiry, single use, audit) and the append-only identity history.
-- P3:  billing profile revisions by trigger and the locked revision on billing items.
-- Invoice provider: per-tenant selection, dispatch enable gate, open-export switch block, audit.
-- Invoice file export: file provider readiness and fail-closed file creation.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  staff uuid := gen_random_uuid();
  req uuid;
  res jsonb;
  v text;
  n integer;
  stale_before jsonb;
  stale_after jsonb;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'F12 synthetic A','active'),(other_c,'F12 synthetic B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,personal_number,invoice_email,billing_street,billing_postal_code,billing_city)
  VALUES(customer,c,'F12-A','Synthetic customer','private','19121212-1212','kund@example.test','Gatan 1','11122','Stockholm');

  -- P3: insert creates revision 1.
  SELECT billing_profile_revision INTO n FROM public.customers WHERE id = customer;
  IF n <> 1 THEN RAISE EXCEPTION 'P3 insert revision expected 1, got %', n; END IF;
  IF (SELECT count(*) FROM public.customer_billing_profile_revisions WHERE customer_id = customer) <> 1 THEN RAISE EXCEPTION 'P3 insert revision row missing'; END IF;

  -- P3: unrelated change does not bump; billing change does; writers cannot move the revision.
  UPDATE public.customers SET phone = '0701234567' WHERE id = customer;
  UPDATE public.customers SET billing_profile_revision = 99 WHERE id = customer;
  SELECT billing_profile_revision INTO n FROM public.customers WHERE id = customer;
  IF n <> 1 THEN RAISE EXCEPTION 'P3 non-billing update bumped or moved revision: %', n; END IF;
  UPDATE public.customers SET invoice_email = 'faktura@example.test', billing_city = 'Uppsala' WHERE id = customer;
  SELECT billing_profile_revision INTO n FROM public.customers WHERE id = customer;
  IF n <> 2 THEN RAISE EXCEPTION 'P3 billing update expected revision 2, got %', n; END IF;
  IF (SELECT changed_fields FROM public.customer_billing_profile_revisions WHERE customer_id = customer AND revision = 2)
     <> ARRAY['invoice_email','billing_city'] THEN RAISE EXCEPTION 'P3 changed_fields wrong'; END IF;

  -- P3: history is append-only.
  BEGIN
    UPDATE public.customer_billing_profile_revisions SET invoice_email = 'x@example.test' WHERE customer_id = customer;
    RAISE EXCEPTION 'P3 history update was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.customer_billing_profile_revisions WHERE customer_id = customer;
    RAISE EXCEPTION 'P3 history delete was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- P3: billing items lock the revision current at insert; it cannot be changed later. Real items
  -- need a full billing underlay graph, so the production trigger function is exercised on a
  -- temporary table with the same columns, and its attachment to the real table is asserted.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.billing_export_run_items'::regclass AND NOT t.tgisinternal
                    AND p.proname = 'gridex_billing_item_lock_profile_revision') THEN
    RAISE EXCEPTION 'P3 lock trigger missing on billing_export_run_items';
  END IF;
  CREATE TEMP TABLE p3_items (company_id uuid NOT NULL, customer_id uuid, customer_billing_profile_revision integer) ON COMMIT DROP;
  CREATE TRIGGER p3_items_lock BEFORE INSERT OR UPDATE ON p3_items
    FOR EACH ROW EXECUTE FUNCTION public.gridex_billing_item_lock_profile_revision();
  INSERT INTO p3_items(company_id, customer_id) VALUES (c, customer);
  IF (SELECT customer_billing_profile_revision FROM p3_items) <> 2 THEN RAISE EXCEPTION 'P3 billing item did not lock revision 2'; END IF;
  UPDATE public.customers SET billing_street = 'Nya gatan 2' WHERE id = customer;
  IF (SELECT customer_billing_profile_revision FROM p3_items) <> 2 THEN RAISE EXCEPTION 'P3 billing item revision followed a later profile change'; END IF;
  BEGIN
    UPDATE p3_items SET customer_billing_profile_revision = 3;
    RAISE EXCEPTION 'P3 billing item revision was changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Another tenant's customer id never resolves a revision.
  INSERT INTO p3_items(company_id, customer_id) VALUES (other_c, customer);
  IF (SELECT customer_billing_profile_revision FROM p3_items WHERE company_id = other_c) IS NOT NULL THEN
    RAISE EXCEPTION 'P3 cross-tenant revision lookup';
  END IF;

  -- F12: staff cannot apply a change that requires customer approval.
  INSERT INTO public.customer_identity_change_requests(company_id,customer_id,field,previous_value,new_value,reason,requested_by,approval_required,affected_contract_count,recipient_email,token_hash,expires_at,status)
  VALUES(c,customer,'personal_number','19121212-1212','19811218-9876','Felregistrerat',staff,true,1,'kund@example.test',repeat('a',64),now() + interval '1 day','pending_customer_approval')
  RETURNING id INTO req;
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'staff', staff);
    RAISE EXCEPTION 'F12 staff applied an approval-required change';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- F12: the token lookup finds exactly this request; another tenant cannot decide it.
  IF (SELECT count(*) FROM public.gridex_find_customer_identity_change_by_token_v1(repeat('a',64))) <> 1 THEN RAISE EXCEPTION 'F12 token lookup failed'; END IF;
  IF (SELECT count(*) FROM public.gridex_find_customer_identity_change_by_token_v1('not-a-hash')) <> 0 THEN RAISE EXCEPTION 'F12 malformed token matched'; END IF;
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(other_c, req, 'applied', 'customer', NULL);
    RAISE EXCEPTION 'F12 cross-tenant decision was allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- F12: customer approval applies, audits and is single use.
  res := public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL);
  IF res->>'status' <> 'applied' THEN RAISE EXCEPTION 'F12 approve returned %', res; END IF;
  SELECT personal_number INTO v FROM public.customers WHERE id = customer;
  IF v <> '19811218-9876' THEN RAISE EXCEPTION 'F12 number not applied: %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE resource_id = req::text AND action = 'customer_identity_change_applied'
                 AND new_values->>'personal_number' = '••••9876' AND old_values->>'personal_number' = '••••1212') THEN
    RAISE EXCEPTION 'F12 audit row missing or unmasked';
  END IF;
  IF (SELECT array_agg(event_type ORDER BY created_at, event_type) FROM public.customer_identity_change_events WHERE request_id = req) <> ARRAY['applied','approved'] THEN
    RAISE EXCEPTION 'F12 events wrong';
  END IF;
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL);
    RAISE EXCEPTION 'F12 link reused';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  -- F12: identity history is append-only.
  BEGIN
    UPDATE public.customer_identity_change_events SET new_value_masked = 'x' WHERE request_id = req;
    RAISE EXCEPTION 'F12 history update was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- F12: stale value refused; expired link expires instead of applying.
  INSERT INTO public.customer_identity_change_requests(company_id,customer_id,field,previous_value,new_value,reason,requested_by,approval_required,affected_contract_count,recipient_email,token_hash,expires_at,status)
  VALUES(c,customer,'personal_number','19121212-1212','20000101-0008','Gammal begäran',staff,true,1,'kund@example.test',repeat('b',64),now() + interval '1 day','pending_customer_approval')
  RETURNING id INTO req;
  SELECT jsonb_build_object(
    'customer', (SELECT to_jsonb(snapshot_row) FROM public.customers snapshot_row WHERE id=customer AND company_id=c),
    'request', (SELECT to_jsonb(snapshot_row) FROM public.customer_identity_change_requests snapshot_row WHERE id=req AND company_id=c),
    'events', (SELECT coalesce(jsonb_agg(to_jsonb(snapshot_row) ORDER BY id),'[]'::jsonb) FROM public.customer_identity_change_events snapshot_row WHERE customer_id=customer AND company_id=c),
    'audit', (SELECT coalesce(jsonb_agg(to_jsonb(snapshot_row) ORDER BY id),'[]'::jsonb) FROM public.audit_logs snapshot_row WHERE company_id=c),
    'billing_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(snapshot_row) ORDER BY revision),'[]'::jsonb) FROM public.customer_billing_profile_revisions snapshot_row WHERE customer_id=customer AND company_id=c)
  ) INTO stale_before;
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL);
    RAISE EXCEPTION 'F12 stale request applied';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM IS DISTINCT FROM 'identity_change_stale' THEN RAISE; END IF;
  END;
  SELECT jsonb_build_object(
    'customer', (SELECT to_jsonb(snapshot_row) FROM public.customers snapshot_row WHERE id=customer AND company_id=c),
    'request', (SELECT to_jsonb(snapshot_row) FROM public.customer_identity_change_requests snapshot_row WHERE id=req AND company_id=c),
    'events', (SELECT coalesce(jsonb_agg(to_jsonb(snapshot_row) ORDER BY id),'[]'::jsonb) FROM public.customer_identity_change_events snapshot_row WHERE customer_id=customer AND company_id=c),
    'audit', (SELECT coalesce(jsonb_agg(to_jsonb(snapshot_row) ORDER BY id),'[]'::jsonb) FROM public.audit_logs snapshot_row WHERE company_id=c),
    'billing_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(snapshot_row) ORDER BY revision),'[]'::jsonb) FROM public.customer_billing_profile_revisions snapshot_row WHERE customer_id=customer AND company_id=c)
  ) INTO stale_after;
  IF stale_after IS DISTINCT FROM stale_before THEN
    RAISE EXCEPTION 'F12 stale decision changed customer, request, history, audit or billing revision';
  END IF;
  PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'cancelled', 'staff', staff);

  INSERT INTO public.customer_identity_change_requests(company_id,customer_id,field,previous_value,new_value,reason,requested_by,approval_required,affected_contract_count,recipient_email,token_hash,expires_at,status)
  VALUES(c,customer,'personal_number','19811218-9876','20000101-0008','Utgången länk',staff,true,1,'kund@example.test',repeat('c',64),now() - interval '1 minute','pending_customer_approval')
  RETURNING id INTO req;
  res := public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL);
  IF res->>'status' <> 'expired' THEN RAISE EXCEPTION 'F12 expired link returned %', res; END IF;
  SELECT personal_number INTO v FROM public.customers WHERE id = customer;
  IF v <> '19811218-9876' THEN RAISE EXCEPTION 'F12 expired link changed the number'; END IF;

  -- F12 takeover: binding contracts need all three confirmations against the exact snapshot.
  INSERT INTO public.customer_identity_change_requests(company_id,customer_id,field,previous_value,new_value,reason,requested_by,approval_required,affected_contract_count,recipient_email,token_hash,expires_at,status,takeover_required,takeover_snapshot,takeover_snapshot_sha256)
  VALUES(c,customer,'personal_number','19811218-9876','20000101-0008','Övertagande',staff,true,1,'kund@example.test',repeat('d',64),now() + interval '1 day','pending_customer_approval',
         true,'{"contracts":[],"terms":[]}'::jsonb,repeat('e',64))
  RETURNING id INTO req;
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL, NULL);
    RAISE EXCEPTION 'F12 takeover applied without acceptance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL,
      jsonb_build_object('snapshot_sha256', repeat('e',64), 'confirmations', jsonb_build_object('identity', true, 'contracts', true, 'terms', false)));
    RAISE EXCEPTION 'F12 takeover applied without terms acceptance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL,
      jsonb_build_object('snapshot_sha256', repeat('f',64), 'confirmations', jsonb_build_object('identity', true, 'contracts', true, 'terms', true)));
    RAISE EXCEPTION 'F12 takeover applied against another snapshot';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  res := public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL,
    jsonb_build_object('snapshot_sha256', repeat('e',64), 'confirmations', jsonb_build_object('identity', true, 'contracts', true, 'terms', true), 'ip_hash', 'h'));
  IF res->>'status' <> 'applied' THEN RAISE EXCEPTION 'F12 takeover approve returned %', res; END IF;
  IF (SELECT acceptance_evidence->>'snapshot_sha256' FROM public.customer_identity_change_requests WHERE id = req) <> repeat('e',64)
     OR (SELECT acceptance_evidence ? 'accepted_at' FROM public.customer_identity_change_requests WHERE id = req) IS NOT TRUE THEN
    RAISE EXCEPTION 'F12 takeover acceptance evidence missing';
  END IF;
  SELECT personal_number INTO v FROM public.customers WHERE id = customer;
  IF v <> '20000101-0008' THEN RAISE EXCEPTION 'F12 takeover number not applied: %', v; END IF;

  RAISE NOTICE 'tenantservice F12 + P3 native regression passed';
END $$;

-- Tenant invoice provider selection (gridex_select_invoice_provider_v1 / gridex_set_invoice_dispatch_enabled_v1).
DO $$
DECLARE
  c uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  res jsonb;
  r record;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'Provider synthetic','active');

  BEGIN
    PERFORM public.gridex_select_invoice_provider_v1(c, 'file_export', 'test', actor);
    RAISE EXCEPTION 'provider: generic file export must not be newly selectable';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invoice_provider_not_available' THEN RAISE; END IF;
  END;

  res := public.gridex_select_invoice_provider_v1(c, 'capway_aptic', 'test', actor);
  IF (res->>'connection_created')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'provider: connection not created %', res; END IF;
  SELECT invoice_export_target_system, billing_provider_environment, invoice_export_enabled INTO r FROM public.companies WHERE id = c;
  IF r.invoice_export_target_system <> 'capway_aptic' OR r.billing_provider_environment <> 'test' OR r.invoice_export_enabled THEN
    RAISE EXCEPTION 'provider: selection not stored %', r;
  END IF;

  BEGIN
    PERFORM public.gridex_set_invoice_dispatch_enabled_v1(c, true, actor);
    RAISE EXCEPTION 'provider: dispatch enabled before connection test';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'invoice_provider_connection_not_ready' THEN RAISE; END IF;
  END;

  UPDATE public.billing_provider_connections SET status = 'ready' WHERE company_id = c AND provider = 'capway_aptic' AND environment = 'test';
  PERFORM public.gridex_set_invoice_dispatch_enabled_v1(c, true, actor);
  IF NOT (SELECT invoice_export_enabled FROM public.companies WHERE id = c) THEN RAISE EXCEPTION 'provider: dispatch not enabled'; END IF;

  INSERT INTO public.invoice_export_runs(company_id, billing_month, status) VALUES (c, '2026-09', 'processing');
  BEGIN
    PERFORM public.gridex_select_invoice_provider_v1(c, 'capway_aptic', 'production', actor);
    RAISE EXCEPTION 'provider: switch allowed with open export';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'invoice_provider_switch_blocked_open_exports' THEN RAISE; END IF;
  END;
  UPDATE public.invoice_export_runs SET status = 'sent' WHERE company_id = c;

  PERFORM public.gridex_select_invoice_provider_v1(c, 'capway_aptic', 'production', actor);
  IF (SELECT invoice_export_enabled FROM public.companies WHERE id = c) THEN RAISE EXCEPTION 'provider: switch must disable dispatch'; END IF;

  IF (SELECT count(*) FROM public.audit_logs WHERE company_id = c AND action IN ('invoice_provider_selected','invoice_dispatch_enabled')) <> 3 THEN
    RAISE EXCEPTION 'provider: audit rows missing';
  END IF;

  RAISE NOTICE 'tenant invoice provider selection native regression passed';
END $$;

-- Invoice file export (Nordfin file provider): ready without credentials; file creation fails closed.
DO $$
DECLARE
  c uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(c,'File export synthetic','active');
  PERFORM public.gridex_select_invoice_provider_v1(c, 'nordfin', 'test', actor);
  IF (SELECT status FROM public.billing_provider_connections WHERE company_id = c AND provider = 'nordfin' AND environment = 'test') <> 'ready' THEN
    RAISE EXCEPTION 'file export: connection should be ready without credentials';
  END IF;

  BEGIN
    PERFORM public.gridex_create_invoice_export_file_v1(c, '2026-09', 'test', actor,
      jsonb_build_array(jsonb_build_object('invoice_export_item_id', gen_random_uuid(), 'amount_inc_vat', 1)), repeat('a', 64));
    RAISE EXCEPTION 'file export: file created while dispatch disabled';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'invoice_file_provider_not_active' THEN RAISE; END IF;
  END;

  PERFORM public.gridex_set_invoice_dispatch_enabled_v1(c, true, actor);
  BEGIN
    PERFORM public.gridex_create_invoice_export_file_v1(c, '2026-09', 'test', actor,
      jsonb_build_array(jsonb_build_object('invoice_export_item_id', gen_random_uuid(), 'amount_inc_vat', 1)), repeat('a', 64));
    RAISE EXCEPTION 'file export: unknown invoice accepted';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'invoice_file_items_changed' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.invoice_export_files WHERE company_id = c) THEN
    RAISE EXCEPTION 'file export: rejected claim left a file row';
  END IF;

  RAISE NOTICE 'invoice file export native regression passed';
END $$;

ROLLBACK;
