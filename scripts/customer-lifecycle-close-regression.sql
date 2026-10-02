-- Atomic customer move-out/termination native regression (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid();
  other_c uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  site uuid := gen_random_uuid();
  mp uuid := gen_random_uuid();
  sw uuid;
  res jsonb;
  open_period uuid := gen_random_uuid();
  future_period uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(actor,'authenticated','authenticated','lifecycle-actor@example.invalid',now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.companies(id,name,status) VALUES(c,'Lifecycle synthetic A','active'),(other_c,'Lifecycle synthetic B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
  VALUES(customer,c,'LC-A','Lifecycle customer','private');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site,c,customer,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp,c,customer,site,'735999999999999992','monthly','consumption',true,'active');
  INSERT INTO public.supplier_switch_requests(company_id,customer_id,site_id,metering_point_id,request_type,status)
  VALUES(c,customer,site,mp,'switch','draft') RETURNING id INTO sw;
  INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,status,source)
  VALUES (open_period,c,customer,mp,DATE '2026-01-01','active','manual'),
         (future_period,c,customer,mp,DATE '2026-12-01','active','manual');

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.gridex_close_customer_lifecycle_v1(c, customer, actor, 'move_out', current_date, null, 'note', false);
    RAISE EXCEPTION 'close allowed for authenticated role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  BEGIN
    PERFORM public.gridex_close_customer_lifecycle_v1(other_c, customer, actor, 'move_out', current_date, null, 'note', false);
    RAISE EXCEPTION 'cross-tenant close allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  res := public.gridex_close_customer_lifecycle_v1(c, customer, actor, 'move_out', DATE '2026-11-01', 'Flyttar', 'Utflytt registrerad', true);

  IF (SELECT status FROM public.customers WHERE id = customer AND moved_out_at = DATE '2026-11-01' AND lifecycle_closed_by = actor) IS DISTINCT FROM 'moved' THEN
    RAISE EXCEPTION 'customer not moved with lifecycle fields';
  END IF;
  IF (SELECT status FROM public.customer_sites WHERE id = site AND move_out_date = DATE '2026-11-01') IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'site not closed';
  END IF;
  IF (SELECT status FROM public.metering_points WHERE id = mp AND end_date = DATE '2026-11-01') IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'metering point not closed';
  END IF;
  -- Billing stops at the move-out date: the open period ends on it, a later one is cancelled.
  IF (SELECT end_date FROM public.customer_supply_periods WHERE id = open_period) IS DISTINCT FROM DATE '2026-11-01'
     OR (SELECT status FROM public.customer_supply_periods WHERE id = open_period) <> 'active' THEN
    RAISE EXCEPTION 'open supply period not ended on move-out date';
  END IF;
  IF (SELECT status FROM public.customer_supply_periods WHERE id = future_period) <> 'cancelled' THEN
    RAISE EXCEPTION 'future supply period not cancelled';
  END IF;
  IF (res->>'supply_periods_ended')::int <> 1 OR (res->>'supply_periods_cancelled')::int <> 1 THEN
    RAISE EXCEPTION 'supply period counts not returned';
  END IF;
  IF (SELECT status FROM public.supplier_switch_requests WHERE id = sw) <> 'failed' THEN
    RAISE EXCEPTION 'switch not stopped';
  END IF;
  IF (SELECT count(*) FROM public.customer_operation_tasks WHERE customer_id = customer AND status = 'open'
        AND task_type IN ('supplier_switch_stopped_followup', 'move_out_confirmation_pending')) <> 2 THEN
    RAISE EXCEPTION 'follow-up tasks missing';
  END IF;
  IF (SELECT count(*) FROM public.customer_internal_notes WHERE customer_id = customer AND body = 'Utflytt registrerad') <> 1 THEN
    RAISE EXCEPTION 'note missing';
  END IF;
  IF (SELECT count(*) FROM public.customer_lifecycle_events WHERE customer_id = customer AND company_id = c AND event_type = 'move_out') <> 1 THEN
    RAISE EXCEPTION 'lifecycle event missing';
  END IF;
  IF jsonb_array_length(res->'failed_switch_request_ids') <> 1 THEN
    RAISE EXCEPTION 'switch ids not returned';
  END IF;

  -- A closed customer cannot be closed again.
  BEGIN
    PERFORM public.gridex_close_customer_lifecycle_v1(c, customer, actor, 'terminate', current_date, null, 'again', false);
    RAISE EXCEPTION 'closed customer closed again';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'customer_lifecycle_already_closed' THEN RAISE; END IF;
  END;

  IF has_function_privilege('authenticated', 'public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute lifecycle close';
  END IF;

  RAISE NOTICE 'customer lifecycle close regression: ok';
END $$;

ROLLBACK;
