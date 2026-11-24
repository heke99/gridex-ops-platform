-- Store the underlay graph and the exact request receipt in one transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_b11_migration$
BEGIN
CREATE SCHEMA gridex_underlay_generation;
CREATE TABLE gridex_underlay_generation.receipts (
  company_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  intent_key text NOT NULL,
  request_scope jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, actor_user_id, intent_key)
);
ALTER TABLE gridex_underlay_generation.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA gridex_underlay_generation FROM PUBLIC, service_role;
REVOKE ALL ON TABLE gridex_underlay_generation.receipts FROM PUBLIC, service_role;

CREATE FUNCTION gridex_underlay_generation.require_request_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_key text,p_scope jsonb)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $$
BEGIN
  IF coalesce(current_setting('role', true), '') <> 'service_role' AND session_user <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';
  END IF;
  IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_intent_key IS NULL
     OR length(p_intent_key) NOT BETWEEN 8 AND 200 OR p_intent_key COLLATE "C" !~ '^[-A-Za-z0-9._:+~]+$'
     OR jsonb_typeof(p_scope) IS DISTINCT FROM 'object'
     OR NOT p_scope ?& ARRAY['billingMonth','customerId','meteringPointId']
     OR p_scope - ARRAY['billingMonth','customerId','meteringPointId'] <> '{}'::jsonb
     OR coalesce(p_scope->>'billingMonth','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$|^21[0-9]{2}-(0[1-9]|1[0-2])$|^2200-(0[1-9]|1[0-2])$'
     OR coalesce(jsonb_typeof(p_scope->'customerId'),'') NOT IN ('null','string')
     OR coalesce(jsonb_typeof(p_scope->'meteringPointId'),'') NOT IN ('null','string') THEN
    RAISE EXCEPTION 'billing_underlay_intent_invalid' USING ERRCODE='22023';
  END IF;
END $$;

CREATE FUNCTION public.gridex_read_underlay_generation_receipt_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_key text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE receipt gridex_underlay_generation.receipts%ROWTYPE; saved_id uuid;
BEGIN
  PERFORM gridex_underlay_generation.require_request_v1(p_company_id,p_actor_user_id,p_intent_key,p_scope);
  SELECT * INTO receipt FROM gridex_underlay_generation.receipts
  WHERE company_id=p_company_id AND actor_user_id=p_actor_user_id AND intent_key=p_intent_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF receipt.request_scope IS DISTINCT FROM p_scope THEN
    RAISE EXCEPTION 'billing_underlay_intent_scope_conflict' USING ERRCODE='22023';
  END IF;
  FOR saved_id IN SELECT (value->>'underlayId')::uuid FROM jsonb_array_elements(receipt.result->'results')
                  WHERE value->>'underlayId' IS NOT NULL LOOP
    IF NOT EXISTS (SELECT FROM public.billing_underlays WHERE company_id=p_company_id AND id=saved_id) THEN
      RAISE EXCEPTION 'billing_underlay_receipt_unavailable' USING ERRCODE='55000';
    END IF;
    PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company_id,saved_id);
  END LOOP;
  RETURN receipt.result;
END $$;

CREATE FUNCTION gridex_underlay_generation.require_history_needs_v1(p_company_id uuid, p_scope jsonb, p_results jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  result_row jsonb;
  need jsonb;
  supply public.customer_supply_periods%ROWTYPE;
  need_customer_id uuid;
  need_point_id uuid;
  need_supply_id uuid;
  requested_start timestamptz;
  requested_end timestamptz;
  month_day date;
  month_start timestamptz;
  month_end timestamptz;
  expected_start timestamptz;
  expected_end timestamptz;
BEGIN
  FOR result_row IN SELECT value FROM jsonb_array_elements(p_results) WHERE value ? 'historyNeed' LOOP
    need := result_row->'historyNeed';
    IF result_row->>'status' IS DISTINCT FROM 'needs_review'
      OR result_row->'underlayId' IS DISTINCT FROM 'null'::jsonb
      OR jsonb_typeof(need) IS DISTINCT FROM 'object'
      OR NOT need ?& ARRAY['state','customerId','meteringPointId','supplyPeriodId','start','end']
      OR need - ARRAY['state','customerId','meteringPointId','supplyPeriodId','start','end'] <> '{}'::jsonb
      OR need->>'state' IS DISTINCT FROM 'awaiting_qualification'
      OR jsonb_typeof(need->'customerId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(need->'meteringPointId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(need->'supplyPeriodId') IS DISTINCT FROM 'string'
      OR coalesce(need->>'start','') COLLATE "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      OR coalesce(need->>'end','') COLLATE "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN
      RAISE EXCEPTION 'billing_underlay_history_need_invalid' USING ERRCODE='22023';
    END IF;
    BEGIN
      need_customer_id := (need->>'customerId')::uuid;
      need_point_id := (need->>'meteringPointId')::uuid;
      need_supply_id := (need->>'supplyPeriodId')::uuid;
      requested_start := (need->>'start')::timestamptz;
      requested_end := (need->>'end')::timestamptz;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'billing_underlay_history_need_invalid' USING ERRCODE='22023';
    END;

    IF (p_scope->>'customerId' IS NOT NULL AND need_customer_id IS DISTINCT FROM (p_scope->>'customerId')::uuid)
      OR (p_scope->>'meteringPointId' IS NOT NULL AND need_point_id IS DISTINCT FROM (p_scope->>'meteringPointId')::uuid) THEN
      RAISE EXCEPTION 'billing_underlay_history_need_scope_changed' USING ERRCODE='22023';
    END IF;

    SELECT s.* INTO supply FROM public.customer_supply_periods AS s
    WHERE s.id=need_supply_id AND s.company_id=p_company_id AND s.customer_id=need_customer_id AND s.metering_point_id=need_point_id
      AND s.status IN ('active','confirmed_by_grid_owner','ended') FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'billing_underlay_history_need_scope_changed' USING ERRCODE='22023';
    END IF;

    -- Mirror the mounted PUNKT13 segment selection. For a qualified ongoing
    -- Ediel source, its admitted instant and fixed normal time are authoritative.
    -- All other rows use the existing Stockholm civil-date segment.
    month_day := ((p_scope->>'billingMonth') || '-01')::date;
    IF supply.source = 'ediel_qualified_source' AND supply.source_message_id IS NOT NULL
      AND supply.status IN ('active','confirmed_by_grid_owner') AND supply.end_date IS NULL
      AND supply.actual_end_date IS NULL AND supply.market_end_at IS NULL
      AND supply.market_start_at IS NOT NULL AND isfinite(supply.market_start_at) THEN
      month_start := month_day::timestamp AT TIME ZONE INTERVAL '+01:00';
      month_end := (month_day + interval '1 month') AT TIME ZONE INTERVAL '+01:00';
      expected_start := greatest(month_start, date_trunc('milliseconds', supply.market_start_at));
      expected_end := month_end;
    ELSE
      month_start := month_day::timestamp AT TIME ZONE 'Europe/Stockholm';
      month_end := (month_day + interval '1 month') AT TIME ZONE 'Europe/Stockholm';
      expected_start := greatest(month_start, supply.start_date::timestamp AT TIME ZONE 'Europe/Stockholm');
      expected_end := least(month_end, coalesce((supply.end_date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm', month_end));
    END IF;
    IF requested_start >= requested_end OR requested_start <> expected_start OR requested_end <> expected_end THEN
      RAISE EXCEPTION 'billing_underlay_history_need_period_changed' USING ERRCODE='22023';
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION gridex_underlay_generation.require_history_needs_v1(uuid,jsonb,jsonb) FROM PUBLIC, service_role;

CREATE FUNCTION public.gridex_store_underlay_generation_receipt_v1(
 p_company_id uuid,p_actor_user_id uuid,p_intent_key text,p_scope jsonb,p_source_rows integer,
 p_before jsonb,p_commands jsonb,p_command_results jsonb,p_after jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE existing jsonb; saved_ids jsonb; saved_results jsonb; results jsonb; receipt jsonb;
BEGIN
  PERFORM gridex_underlay_generation.require_request_v1(p_company_id,p_actor_user_id,p_intent_key,p_scope);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));
  existing:=public.gridex_read_underlay_generation_receipt_v1(p_company_id,p_actor_user_id,p_intent_key,p_scope);
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  IF p_source_rows IS NULL OR p_source_rows<0 OR jsonb_typeof(p_before) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_commands) IS DISTINCT FROM 'array' OR jsonb_typeof(p_command_results) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_after) IS DISTINCT FROM 'array' OR jsonb_array_length(p_commands)<>jsonb_array_length(p_command_results)
     OR EXISTS(SELECT FROM jsonb_array_elements(p_before||p_after) WHERE value->'underlayId' IS DISTINCT FROM 'null'::jsonb)
     OR EXISTS(SELECT FROM jsonb_array_elements(p_commands) WHERE
        value->'underlay'->>'underlay_year' IS DISTINCT FROM split_part(p_scope->>'billingMonth','-',1)
        OR lpad(value->'underlay'->>'underlay_month',2,'0') IS DISTINCT FROM split_part(p_scope->>'billingMonth','-',2)
        OR (p_scope->>'customerId' IS NOT NULL AND value->'underlay'->>'customer_id' IS DISTINCT FROM p_scope->>'customerId')
        OR (p_scope->>'meteringPointId' IS NOT NULL AND value->'underlay'->>'metering_point_id' IS DISTINCT FROM p_scope->>'meteringPointId')) THEN
    RAISE EXCEPTION 'billing_underlay_intent_result_invalid' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(p_command_results) WHERE value ? 'historyNeed') THEN
    RAISE EXCEPTION 'billing_underlay_history_need_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM gridex_underlay_generation.require_history_needs_v1(p_company_id,p_scope,p_before||p_after);
  saved_ids:=public.gridex_store_billing_underlay_batch(p_company_id,p_commands,p_actor_user_id);
  IF jsonb_typeof(saved_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(saved_ids)<>jsonb_array_length(p_commands) THEN
    RAISE EXCEPTION 'billing_underlay_batch_result_count_mismatch' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(res.value||jsonb_build_object('underlayId',ids.value) ORDER BY ids.n),'[]'::jsonb)
  INTO saved_results
  FROM jsonb_array_elements(p_command_results) WITH ORDINALITY AS res(value,n)
  JOIN jsonb_array_elements(saved_ids) WITH ORDINALITY AS ids(value,n) USING(n);
  results:=p_before||saved_results||p_after;
  IF EXISTS(SELECT FROM jsonb_array_elements(results) WHERE
       value->>'status' IS NULL OR value->>'status' NOT IN ('ready_for_pricing','needs_review')
       OR value->>'sourceTable' IS DISTINCT FROM 'normalized_metering_values'
       OR jsonb_typeof(value->'sourceRows') IS DISTINCT FROM 'number'
       OR jsonb_typeof(value->'warnings') IS DISTINCT FROM 'array'
       OR (value->>'status'='ready_for_pricing' AND value->>'underlayId' IS NULL)) THEN
    RAISE EXCEPTION 'billing_underlay_intent_result_invalid' USING ERRCODE='22023';
  END IF;
  receipt:=jsonb_build_object(
    'billingMonth',p_scope->>'billingMonth','scope',p_scope-'billingMonth','sourceTable','normalized_metering_values',
    'sourceRows',p_source_rows,'underlays',jsonb_array_length(results),
    'readyForPricing',(SELECT count(*) FROM jsonb_array_elements(results) WHERE value->>'status'='ready_for_pricing'),
    'needsReview',(SELECT count(*) FROM jsonb_array_elements(results) WHERE value->>'status'='needs_review'),'results',results
  );
  INSERT INTO gridex_underlay_generation.receipts(company_id,actor_user_id,intent_key,request_scope,result)
    VALUES(p_company_id,p_actor_user_id,p_intent_key,p_scope,receipt);
  RETURN receipt;
END $$;

REVOKE ALL ON FUNCTION public.gridex_read_underlay_generation_receipt_v1(uuid,uuid,text,jsonb),
 public.gridex_store_underlay_generation_receipt_v1(uuid,uuid,text,jsonb,integer,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gridex_read_underlay_generation_receipt_v1(uuid,uuid,text,jsonb),
 public.gridex_store_underlay_generation_receipt_v1(uuid,uuid,text,jsonb,integer,jsonb,jsonb,jsonb,jsonb) TO service_role;
END
$gridex_b11_migration$;
RESET statement_timeout;
RESET lock_timeout;
