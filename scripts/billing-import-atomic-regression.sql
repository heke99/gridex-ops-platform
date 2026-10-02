-- Billing-underlay import is one transaction per file and once per content (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  cust_a uuid := gen_random_uuid();
  cust_b uuid := gen_random_uuid();
  rows jsonb;
  res jsonb;
  batch uuid;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(actor,'authenticated','authenticated','billing-import-actor@example.invalid',now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.companies(id,name,status) VALUES(a,'Import A','active'),(b,'Import B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
  VALUES(cust_a,a,'IM-1','Import customer A','private'),(cust_b,b,'IM-2','Import customer B','private');

  rows := jsonb_build_array(
    jsonb_build_object('row_number',1,'has_errors',false,'issues','[]'::jsonb,'normalized_payload','{}'::jsonb,
      'underlay',jsonb_build_object('customer_id',cust_a,'underlay_year',2026,'underlay_month',9,'status','received',
        'total_kwh',100,'total_sek_ex_vat',150,'currency','SEK','source_system','regression','company_id',b)),
    -- Another tenant's customer: rejected by the database, recorded as a failed row.
    jsonb_build_object('row_number',2,'has_errors',false,'issues','[]'::jsonb,'normalized_payload','{}'::jsonb,
      'underlay',jsonb_build_object('customer_id',cust_b,'underlay_year',2026,'underlay_month',9,'status','received',
        'total_kwh',1,'total_sek_ex_vat',1,'currency','SEK','source_system','regression')),
    -- No customer: never counted as imported.
    jsonb_build_object('row_number',3,'has_errors',false,'issues','[]'::jsonb,'normalized_payload','{}'::jsonb,'underlay',null)
  );

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_import_billing_underlays_v1(a, actor, '{}'::jsonb, rows);
    RAISE EXCEPTION 'non-service caller imported underlays';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  res := public.gridex_import_billing_underlays_v1(a, actor, jsonb_build_object('content_sha256','sha-1'), rows);
  batch := (res->>'batch_id')::uuid;
  IF (res->>'imported')::int <> 1 OR (res->>'failed')::int <> 2 THEN
    RAISE EXCEPTION 'unexpected counts: %', res;
  END IF;
  IF (SELECT status FROM public.billing_import_batches WHERE id = batch) <> 'partially_imported'
     OR (SELECT count(*) FROM public.billing_import_rows WHERE import_batch_id = batch AND company_id = a) <> 3 THEN
    RAISE EXCEPTION 'batch or row log incomplete';
  END IF;
  IF (SELECT count(*) FROM public.billing_underlays WHERE company_id = a) <> 1
     OR EXISTS (SELECT 1 FROM public.billing_underlays WHERE company_id = b OR customer_id = cust_b) THEN
    RAISE EXCEPTION 'underlay written for the wrong tenant';
  END IF;

  -- The same content is not imported twice.
  res := public.gridex_import_billing_underlays_v1(a, actor, jsonb_build_object('content_sha256','sha-1'), rows);
  IF NOT (res->>'duplicate')::boolean OR (SELECT count(*) FROM public.billing_underlays WHERE company_id = a) <> 1 THEN
    RAISE EXCEPTION 'duplicate import created underlays';
  END IF;

  -- An invoice purchase can only be recorded on the tenant's own export item.
  BEGIN
    PERFORM public.gridex_record_invoice_purchase_request_v1(a, gen_random_uuid(), 'factoring_without_recourse', '{}'::jsonb, actor);
    RAISE EXCEPTION 'purchase recorded on an unknown export item';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- An invoice review draft must name the same tenant in its run as in the call.
  BEGIN
    PERFORM public.gridex_create_invoice_review_draft_v1(a, jsonb_build_object('company_id', b), '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object('invoice_export_item_id', gen_random_uuid()));
    RAISE EXCEPTION 'invoice review draft accepted a foreign run';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- An invoice test approval needs a pending test export item of the tenant.
  BEGIN
    PERFORM public.gridex_approve_invoice_test_item_v1(a, gen_random_uuid(), '{}'::jsonb);
    RAISE EXCEPTION 'test approval accepted an unknown export item';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Billing lock and price lock move together.
  PERFORM public.gridex_set_billing_period_lock_v1(a, '2026-09', true, 'locked', actor, 'test', '{}'::jsonb);
  IF (SELECT status FROM public.billing_period_locks WHERE company_id = a AND billing_year = 2026 AND billing_month = 9) <> 'locked'
     OR (SELECT status FROM public.price_period_locks WHERE company_id = a AND billing_month = '2026-09' AND lock_scope = 'billing_period') <> 'locked' THEN
    RAISE EXCEPTION 'billing period lock not applied to both tables';
  END IF;
  PERFORM public.gridex_set_billing_period_lock_v1(a, '2026-09', false, null, actor, 'reopen', '{}'::jsonb);
  IF (SELECT status FROM public.billing_period_locks WHERE company_id = a AND billing_year = 2026 AND billing_month = 9) <> 'reopened'
     OR (SELECT status FROM public.price_period_locks WHERE company_id = a AND billing_month = '2026-09' AND lock_scope = 'billing_period') <> 'unlocked'
     OR EXISTS (SELECT 1 FROM public.billing_period_locks WHERE company_id = b) THEN
    RAISE EXCEPTION 'billing period unlock not applied to both tables';
  END IF;

  RAISE NOTICE 'billing import atomic regression: ok';
END $$;

ROLLBACK;
