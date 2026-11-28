-- Supply-end follow-up for source-owned ends (clean replay only; synthetic data; rolled back).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  cust_a uuid := gen_random_uuid();
  cust_b uuid := gen_random_uuid();
  site_a uuid := gen_random_uuid();
  site_b uuid := gen_random_uuid();
  mp_a uuid := gen_random_uuid();
  mp_b uuid := gen_random_uuid();
  mp_c uuid := gen_random_uuid();
  period_a uuid := gen_random_uuid();
  period_b uuid := gen_random_uuid();
  period_c uuid := gen_random_uuid();
  end_source uuid := gen_random_uuid();
  scheduled_end_date constant date := DATE '2026-10-20';
  end_cutoff constant timestamptz := TIMESTAMP '2026-10-20 00:00:00' AT TIME ZONE 'Europe/Stockholm';
  end_wire constant text := $wire$UNB+UNOC:3+54321:14+12345:14+261009:1200+I++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z05+DOC+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735999999999999981:::9'CCI++Z13'CAV+Z22'RFF+LI:A'RFF+Z05:TES'NAD+UD+CA:SE1:260'DTM+93:202610200000:203'UNT+12+M'UNZ+1+I'$wire$;
  previous_period jsonb;
  scheduled_period jsonb;
  final_task uuid;
BEGIN
  INSERT INTO public.companies(id,name,status) VALUES(a,'Source end A','active'),(b,'Source end B','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status)
  VALUES(cust_a,a,'SRC-A','Customer at A','private','active'),(cust_b,b,'SRC-B','Customer at B','private','active');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country)
  VALUES(site_a,a,cust_a,'Site','consumption','active','SE'),(site_b,b,cust_b,'Site','consumption','active','SE');
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,metering_point_id,reading_frequency,measurement_type,is_settlement_relevant,status)
  VALUES(mp_a,a,cust_a,site_a,'735999999999999981','monthly','consumption',true,'active'),
        (mp_c,a,cust_a,site_a,'735999999999999982','monthly','consumption',true,'active'),
        (mp_b,b,cust_b,site_b,'735999999999999981','monthly','consumption',true,'active');
  INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,status,source)
  VALUES(period_a,a,cust_a,mp_a,DATE '2026-01-01','active','manual'),
        (period_c,a,cust_a,mp_c,DATE '2026-01-01','active','manual'),
        (period_b,b,cust_b,mp_b,DATE '2026-01-01','active','manual');

  -- Exercise the follow-up trigger with a synthetic receipt captured at the
  -- source boundary. Scenario tests separately cover the Ediel source owner.
  INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,
    raw_payload,status,message_received_at,customer_id,metering_point_id,application_reference,sender_ediel_id,receiver_ediel_id,
    canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT end_source,a,'test','inbound','PRODAT','Z05',end_wire,'received',
    TIMESTAMPTZ '2026-10-09 12:00:00+00',cust_a,mp_a,'23-DDQ-PRODAT','54321','12345',
    pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id = profile.rule_pack_id
  WHERE profile.profile_key = 'PRODAT:Z05:L:26.A:r3' AND profile.is_enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Z05 L fixture catalog profile unavailable'; END IF;
  SELECT to_jsonb(p) INTO STRICT previous_period FROM public.customer_supply_periods p WHERE id = period_a;
  UPDATE public.customer_supply_periods p SET end_date = scheduled_end_date, market_end_at = end_cutoff,
    source_end_message_id = end_source, market_state_version = 1, status = 'ending'
  WHERE id = period_a RETURNING to_jsonb(p) INTO STRICT scheduled_period;
  INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,
    source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id)
  VALUES(end_source,a,encode(sha256(convert_to(end_wire,'UTF8')),'hex'),'Z05',
    gridex_received_sources.normal_switch_wire_v1(end_wire)->'objects',
    jsonb_build_array(previous_period),jsonb_build_array(scheduled_period),ARRAY[]::uuid[],gen_random_uuid());
  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks WHERE company_id = a AND task_type = 'final_invoice_pending') THEN
    RAISE EXCEPTION 'scheduled source-owned end opened a final invoice task before completion';
  END IF;

  -- Completing an already due schedule changes only its status, like the timer.
  UPDATE public.customer_supply_periods SET status = 'ended' WHERE id = period_a;
  SELECT id INTO STRICT final_task FROM public.customer_operation_tasks
  WHERE company_id = a AND customer_id = cust_a AND metering_point_id = mp_a
    AND task_type = 'final_invoice_pending' AND status = 'open'
    AND metadata->>'supply_period_id' = period_a::text
    AND metadata->>'source_end_message_id' = end_source::text
    AND metadata->>'market_state_version' = '1'
    AND (metadata->>'market_end_at')::timestamptz = end_cutoff;

  -- Replaying the recorded final state keeps the same task.
  UPDATE public.customer_supply_periods SET status = 'ended' WHERE id = period_a;
  IF (SELECT count(*) FROM public.customer_operation_tasks WHERE company_id = a AND task_type = 'final_invoice_pending') <> 1 THEN
    RAISE EXCEPTION 'source-owned end follow-up not idempotent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customer_operation_tasks WHERE id = final_task) THEN
    RAISE EXCEPTION 'source-owned end replay replaced the original task';
  END IF;

  -- The legacy owner's own end (end_key) is not doubled by the trigger.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.gridex_end_customer_supply_v1(a, cust_a, mp_c, DATE '2026-10-15', 'supplier_switch', null, null);
  IF (SELECT count(*) FROM public.customer_operation_tasks WHERE company_id = a AND task_type = 'final_invoice_pending') <> 2 THEN
    RAISE EXCEPTION 'legacy end and trigger follow-up double counted';
  END IF;

  -- The other tenant is untouched.
  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks WHERE company_id = b)
     OR (SELECT status FROM public.customer_supply_periods WHERE id = period_b) <> 'active' THEN
    RAISE EXCEPTION 'other tenant changed by supply end follow-up';
  END IF;

  IF has_function_privilege('authenticated', 'public.gridex_supply_end_followup_v1()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.gridex_supply_end_followup_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'supply end follow-up callable by clients';
  END IF;
END
$$;

ROLLBACK;
