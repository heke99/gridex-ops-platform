-- Tenantservice F12 + P3 native regression (clean replay only; synthetic data; rolled back).
-- F12: gridex_decide_customer_identity_change_v1 (customer approval, staff limits, stale value,
--      expiry, single use, audit) and the append-only identity history.
-- P3:  billing profile revisions by trigger and the locked revision on billing items.
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
  BEGIN
    PERFORM public.gridex_decide_customer_identity_change_v1(c, req, 'applied', 'customer', NULL);
    RAISE EXCEPTION 'F12 stale request applied';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
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

ROLLBACK;
