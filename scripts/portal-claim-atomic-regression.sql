-- Approved portal claim writes account, claim and event for the customer's tenant (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  portal_user uuid := gen_random_uuid();
  cust_a uuid := gen_random_uuid();
  res jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(portal_user,'authenticated','authenticated','portal-claim@example.invalid',now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.companies(id,name,status) VALUES(a,'Portal A','active'),(b,'Portal B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(cust_a,a,'PC-1','Portal customer','private');

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_approve_portal_claim_v1(a, cust_a, portal_user, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'non-service caller approved a claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- The customer must belong to the named tenant.
  BEGIN
    PERFORM public.gridex_approve_portal_claim_v1(b, cust_a, portal_user, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'claim approved under another tenant';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  res := public.gridex_approve_portal_claim_v1(a, cust_a, portal_user,
    jsonb_build_object('user_email','portal-claim@example.invalid'),
    jsonb_build_object('personal_number_last4','1234'),
    jsonb_build_object('message','linked'));
  IF (SELECT count(*) FROM public.customer_portal_accounts WHERE user_id = portal_user AND customer_id = cust_a AND company_id = a AND is_active) <> 1
     OR (SELECT count(*) FROM public.customer_portal_claims WHERE user_id = portal_user AND customer_id = cust_a AND company_id = a AND status = 'approved') <> 1
     OR (SELECT count(*) FROM public.customer_portal_events WHERE user_id = portal_user AND customer_id = cust_a AND company_id = a) <> 1 THEN
    RAISE EXCEPTION 'claim graph incomplete';
  END IF;

  -- Claiming again updates the same account instead of adding a second one.
  PERFORM public.gridex_approve_portal_claim_v1(a, cust_a, portal_user, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);
  IF (SELECT count(*) FROM public.customer_portal_accounts WHERE user_id = portal_user AND customer_id = cust_a) <> 1 THEN
    RAISE EXCEPTION 'duplicate portal account';
  END IF;

  RAISE NOTICE 'portal claim atomic regression: ok';
END $$;

ROLLBACK;
