-- Supabase CLI records the migration and DDL in one transaction.
SET lock_timeout='5s';
SET statement_timeout='60s';
DO $gridex_month_migration$
BEGIN
IF to_regclass('public.automation_locks') IS NULL OR to_regclass('public.billing_automation_runs') IS NULL THEN
  RAISE EXCEPTION 'monthly_billing_native_predecessor_missing';
END IF;
IF to_regprocedure('public.gridex_finish_monthly_billing_run_v1(uuid,text,uuid,uuid,uuid,text,integer,integer,integer,text,jsonb)') IS NULL
  OR to_regprocedure('public.gridex_store_billing_underlay_batch(uuid,jsonb,uuid)') IS NULL
  OR NOT has_function_privilege('service_role','public.gridex_store_billing_underlay_batch(uuid,jsonb,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'monthly_e66_native_predecessor_missing';
END IF;
CREATE FUNCTION public.gridex_store_e66_monthly_underlay_for_run_v1(
  p_company_id uuid,
  p_automation_run_id uuid,
  p_lock_token uuid,
  p_commands jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
SET statement_timeout = '30s'
AS $function$
DECLARE
  run record;
  command jsonb;
  base jsonb;
  items jsonb;
  item_count integer;
  matching_ids integer;
  source_count integer;
  lock_expires_at timestamptz;
  result jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'monthly_e66_service_role_required' USING ERRCODE = '42501';
  END IF;

  -- All monthly writers lock automation_locks before billing_automation_runs.
  SELECT l.expires_at INTO lock_expires_at
  FROM public.automation_locks l
  JOIN public.billing_automation_runs r ON r.lock_key=l.lock_key AND r.company_id=l.company_id
  WHERE r.id=p_automation_run_id AND r.company_id=p_company_id AND l.lock_token=p_lock_token
    AND r.lock_token=p_lock_token
    AND l.lock_key='billing-monthly-prepare:' || r.company_id::text || ':' || r.period_month
  FOR SHARE OF l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'monthly_e66_active_run_lock_required' USING ERRCODE = '42501';
  END IF;

  SELECT r.created_by AS actor_id, r.billing_year, r.billing_month
  INTO run
  FROM public.billing_automation_runs r
  JOIN public.automation_locks l ON l.lock_key = r.lock_key AND l.company_id = r.company_id
  WHERE r.id = p_automation_run_id AND r.company_id = p_company_id
    AND r.status = 'running' AND r.created_by IS NOT NULL
    AND r.lock_key = 'billing-monthly-prepare:' || r.company_id::text || ':' || r.period_month
    AND r.lock_token = p_lock_token AND l.lock_token = r.lock_token
    AND l.expires_at > clock_timestamp() + interval '30 seconds'
    AND r.metadata->>'source' = 'monthly_billing_prepare_only_v3'
    AND r.metadata->'approval_required' = 'true'::jsonb
    AND l.metadata->>'domain' = 'monthly_billing_prepare'
    AND l.metadata->>'billingMonth' = r.period_month
  FOR SHARE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'monthly_e66_active_run_lock_required' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_commands) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'monthly_e66_single_qualified_scope_required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_commands) <> 1 THEN
    RAISE EXCEPTION 'monthly_e66_single_qualified_scope_required' USING ERRCODE = '22023';
  END IF;
  command := p_commands->0;
  base := command->'underlay';
  items := command->'items';
  IF jsonb_typeof(items) IS DISTINCT FROM 'array'
    OR base->>'status' IS DISTINCT FROM 'validated'
    OR base->>'readiness_status' IS DISTINCT FROM 'ready'
    OR base->>'source_system' IS DISTINCT FROM 'normalized_metering_values'
    OR (base->>'underlay_year')::integer IS DISTINCT FROM run.billing_year
    OR (base->>'underlay_month')::integer IS DISTINCT FROM run.billing_month
  THEN
    RAISE EXCEPTION 'monthly_e66_single_qualified_scope_required' USING ERRCODE = '22023';
  END IF;
  item_count := jsonb_array_length(items);
  IF item_count NOT BETWEEN 2001 AND 3000 THEN
    RAISE EXCEPTION 'monthly_e66_single_qualified_scope_required' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT n.id), count(DISTINCT s.id) INTO matching_ids, source_count
  FROM jsonb_array_elements(items) AS i(value)
  JOIN public.normalized_metering_values n
    ON n.id = (i.value->>'source_normalized_metering_value_id')::uuid AND n.company_id = p_company_id
  JOIN public.ediel_messages s
    ON s.id = n.source_message_id AND s.company_id = n.company_id
  WHERE n.customer_id = (base->>'customer_id')::uuid
    AND n.metering_point_id = (base->>'metering_point_id')::uuid
    AND n.supply_period_id = (base->>'supply_period_id')::uuid
    AND s.direction = 'inbound' AND s.message_family = 'UTILTS' AND s.message_code = 'E66';
  IF matching_ids <> item_count OR source_count <> 1 THEN
    RAISE EXCEPTION 'monthly_e66_single_qualified_scope_required' USING ERRCODE = '22023';
  END IF;

  result := public.gridex_store_billing_underlay_batch(p_company_id,p_commands,run.actor_id);
  IF lock_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'monthly_e66_active_run_lock_required' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_store_e66_monthly_underlay_for_run_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_store_e66_monthly_underlay_for_run_v1(uuid,uuid,uuid,jsonb) TO service_role;

END
$gridex_month_migration$;
RESET statement_timeout;
RESET lock_timeout;
