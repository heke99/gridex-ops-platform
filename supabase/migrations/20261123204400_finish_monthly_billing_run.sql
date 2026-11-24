-- Supabase CLI records the migration and DDL in one transaction.
SET lock_timeout='5s';
SET statement_timeout='60s';
DO $gridex_month_migration$
BEGIN
IF to_regclass('public.automation_locks') IS NULL OR to_regclass('public.billing_automation_runs') IS NULL THEN
  RAISE EXCEPTION 'monthly_billing_native_predecessor_missing';
END IF;
CREATE FUNCTION public.gridex_finish_monthly_billing_run_v1(
 p_company_id uuid,p_period_month text,p_run_id uuid,p_actor_user_id uuid,p_lock_token uuid,
 p_status text,p_total_underlays integer,p_total_blocked integer,p_total_prepared integer,p_failure_reason text,p_metadata jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 lock_row public.automation_locks%rowtype;
 run_row public.billing_automation_runs%rowtype;
 expected_lock_key text:='billing-monthly-prepare:'||p_company_id::text||':'||p_period_month;
 finished timestamptz;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_actor_user_id IS NULL OR p_lock_token IS NULL
 THEN RAISE EXCEPTION 'monthly_billing_finish_scope_required' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('completed','completed_with_blockers','failed')
    OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'monthly_billing_finish_result_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO lock_row FROM public.automation_locks l
 WHERE l.lock_key=expected_lock_key AND l.company_id=p_company_id
   AND l.lock_token=p_lock_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'monthly_billing_finish_lease_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO run_row FROM public.billing_automation_runs r
 WHERE r.id=p_run_id AND r.company_id=p_company_id AND r.period_month=p_period_month
   AND r.created_by=p_actor_user_id AND r.lock_key=lock_row.lock_key AND r.lock_token=p_lock_token FOR UPDATE;
 finished:=clock_timestamp();
 IF NOT FOUND OR lock_row.expires_at<=finished THEN
  RAISE EXCEPTION 'monthly_billing_finish_lease_unavailable' USING ERRCODE='42501'; END IF;
 IF run_row.status<>'running' THEN
  IF run_row.finished_at IS NULL OR
     ROW(run_row.status,run_row.total_underlays,run_row.total_blocked,run_row.total_exported,run_row.failure_reason,
         run_row.metadata,run_row.updated_by,run_row.export_confirmed)
       IS DISTINCT FROM ROW(p_status,p_total_underlays,p_total_blocked,p_total_prepared,p_failure_reason,p_metadata,p_actor_user_id,false)
  THEN RAISE EXCEPTION 'monthly_billing_run_already_finished' USING ERRCODE='55000'; END IF;
  RETURN run_row.id;
 END IF;
 UPDATE public.billing_automation_runs r SET status=p_status,finished_at=finished,updated_at=finished,
   total_underlays=p_total_underlays,total_blocked=p_total_blocked,total_exported=p_total_prepared,
   export_confirmed=false,failure_reason=p_failure_reason,metadata=p_metadata,updated_by=p_actor_user_id
 WHERE r.id=run_row.id;
 IF lock_row.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'monthly_billing_finish_lease_unavailable' USING ERRCODE='42501'; END IF;
 RETURN run_row.id;
END $$;
REVOKE ALL ON FUNCTION public.gridex_finish_monthly_billing_run_v1(uuid,text,uuid,uuid,uuid,text,integer,integer,integer,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_finish_monthly_billing_run_v1(uuid,text,uuid,uuid,uuid,text,integer,integer,integer,text,jsonb) TO service_role;

END
$gridex_month_migration$;
RESET statement_timeout;
RESET lock_timeout;
