DO $gridex_invoice_migration$
BEGIN
DO $period_preflight$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.gridex_set_billing_period_lock_v1(uuid,text,boolean,text,uuid,text,jsonb)'::regprocedure) IS DISTINCT FROM 'c80bc53c9071acd4f72857ace9c8dc9b' THEN
  RAISE EXCEPTION 'unexpected billing period writer body';
 END IF;
END
$period_preflight$;
CREATE OR REPLACE FUNCTION public.gridex_set_billing_period_lock_v1(p_company_id uuid, p_billing_month text, p_locked boolean, p_status text, p_actor_user_id uuid, p_reason text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
    AS $_$
declare
  v_now timestamptz := now();
  v_year integer;
  v_month integer;
  v_status text := case when p_locked then coalesce(nullif(p_status, ''), 'locked') else 'reopened' end;
  v_lock public.billing_period_locks%rowtype;
  v_unlocked_runs integer := 0;
  v_auto boolean := p_locked AND v_status='exported' AND coalesce(p_metadata->>'locked_by_flow','')='invoice_export';
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'billing_period_lock_service_role_required';
  end if;
  if p_company_id is null or p_locked is null or p_billing_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or (p_locked and v_status not in ('locked', 'exported', 'closed')) then
    raise exception using errcode = '22023', message = 'billing_period_lock_payload_invalid';
  end if;
  v_year := split_part(p_billing_month, '-', 1)::integer;
  v_month := split_part(p_billing_month, '-', 2)::integer;

  if p_locked then
    insert into public.billing_period_locks (
      company_id, billing_year, billing_month, status, locked_by, locked_at, unlocked_by, unlocked_at,
      lock_reason, metadata, updated_at
    ) values (
      p_company_id, v_year, v_month, v_status, p_actor_user_id, v_now, null, null,
      coalesce(p_reason, 'Fakturaperioden är låst.'), coalesce(p_metadata, '{}'::jsonb), v_now
    )
    on conflict (company_id, billing_year, billing_month) do update set
      status = excluded.status, locked_by = excluded.locked_by, locked_at = excluded.locked_at,
      unlocked_by = null, unlocked_at = null, lock_reason = excluded.lock_reason,
      metadata = excluded.metadata, updated_at = excluded.updated_at
    where NOT v_auto OR (public.billing_period_locks.status='open' AND public.billing_period_locks.unlocked_at IS NULL)
    returning * into v_lock;
    IF NOT FOUND THEN
      SELECT * INTO v_lock FROM public.billing_period_locks
      WHERE company_id=p_company_id AND billing_year=v_year AND billing_month=v_month;
      RETURN jsonb_build_object('lock',to_jsonb(v_lock),'unlocked_pricing_runs',0,'auto_lock_status','preserved');
    END IF;


    insert into public.price_period_locks (
      company_id, billing_month, lock_scope, status, locked_by, locked_at, reason, metadata
    ) values (
      p_company_id, p_billing_month, 'billing_period', 'locked', p_actor_user_id, v_now,
      coalesce(p_reason, 'Fakturaperioden är låst.'), coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (company_id, billing_month, lock_scope) do update set
      status = 'locked', locked_by = excluded.locked_by, locked_at = excluded.locked_at,
      reason = excluded.reason, metadata = excluded.metadata;
  else
    insert into public.billing_period_locks (
      company_id, billing_year, billing_month, status, unlocked_by, unlocked_at, lock_reason, updated_at
    ) values (
      p_company_id, v_year, v_month, 'reopened', p_actor_user_id, v_now,
      coalesce(p_reason, 'Fakturaperioden har låsts upp.'), v_now
    )
    on conflict (company_id, billing_year, billing_month) do update set
      status = 'reopened', unlocked_by = excluded.unlocked_by, unlocked_at = excluded.unlocked_at,
      lock_reason = excluded.lock_reason, updated_at = excluded.updated_at
    returning * into v_lock;

    update public.price_period_locks
    set status = 'unlocked', reason = coalesce(p_reason, 'Fakturaperioden har låsts upp.')
    where company_id = p_company_id
      and billing_month = p_billing_month
      and lock_scope in ('billing_period', 'invoice_export');

    v_unlocked_runs := public.gridex_unlock_pricing_runs_for_month(
      p_company_id, p_billing_month, p_actor_user_id, coalesce(p_reason, 'billing_period_unlocked'));
  end if;

  return jsonb_build_object('lock', to_jsonb(v_lock), 'unlocked_pricing_runs', coalesce(v_unlocked_runs, 0));
end
$_$;
CREATE TABLE gridex_invoice_file_archive.period_reconciliations (
 company_id uuid NOT NULL, file_id uuid NOT NULL, billing_month text NOT NULL, actor_id uuid NOT NULL,
 expected_period jsonb, status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','locked','incomplete','superseded','already_locked')),
 reason text, last_error_code text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,file_id),
 FOREIGN KEY(company_id,file_id) REFERENCES public.invoice_export_files(company_id,id)
);
ALTER TABLE gridex_invoice_file_archive.period_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE INDEX period_reconciliations_due_idx ON gridex_invoice_file_archive.period_reconciliations(updated_at,company_id,file_id)
WHERE status IN ('pending','incomplete');
REVOKE ALL ON TABLE gridex_invoice_file_archive.period_reconciliations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_invoice_file_archive.queue_period_reconciliation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $queue_period$
DECLARE v_expected jsonb;
BEGIN
 SELECT jsonb_build_object('id',l.id,'status',l.status,'updatedAt',l.updated_at,'unlockedAt',l.unlocked_at,'version',l.xmin::text)
 INTO v_expected FROM public.billing_period_locks l
 WHERE l.company_id=NEW.company_id AND l.billing_year=left(NEW.billing_month,4)::integer AND l.billing_month=right(NEW.billing_month,2)::integer;
 INSERT INTO gridex_invoice_file_archive.period_reconciliations(company_id,file_id,billing_month,actor_id,expected_period)
 VALUES(NEW.company_id,NEW.id,NEW.billing_month,NEW.created_by,v_expected);
 RETURN NEW;
END
$queue_period$;
REVOKE ALL ON FUNCTION gridex_invoice_file_archive.queue_period_reconciliation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER queue_invoice_export_period_reconciliation AFTER INSERT ON public.invoice_export_files
 FOR EACH ROW WHEN (NEW.artifact_archive_version=2) EXECUTE FUNCTION gridex_invoice_file_archive.queue_period_reconciliation();

CREATE FUNCTION public.gridex_read_invoice_export_period_reconciliation_v1(p_company_id uuid,p_file_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $read_period$
 SELECT jsonb_build_object('fileId',j.file_id,'billingMonth',j.billing_month,'status',j.status,'reason',j.reason,
  'currentPeriodStatus',CASE WHEN l.status IN ('locked','exported','closed','reopened') THEN l.status WHEN EXISTS(
    SELECT FROM public.price_period_locks p WHERE p.company_id=j.company_id AND p.billing_month=j.billing_month
     AND p.lock_scope IN ('billing_period','invoice_export') AND p.status='locked') THEN 'locked' ELSE 'open' END)
 FROM gridex_invoice_file_archive.period_reconciliations j
 LEFT JOIN public.billing_period_locks l ON l.company_id=j.company_id
    AND l.billing_year=left(j.billing_month,4)::integer AND l.billing_month=right(j.billing_month,2)::integer
 WHERE j.company_id=p_company_id AND j.file_id=p_file_id;
$read_period$;
REVOKE ALL ON FUNCTION public.gridex_read_invoice_export_period_reconciliation_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_invoice_export_period_reconciliation_v1(uuid,uuid) TO service_role;

CREATE FUNCTION public.gridex_reconcile_invoice_export_period_v1(p_company_id uuid,p_file_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC'
AS $reconcile_period$
DECLARE
 v_job gridex_invoice_file_archive.period_reconciliations%rowtype;
 v_current jsonb; v_result jsonb; v_year integer; v_month integer;
 v_status text; v_reason text;
BEGIN
 SELECT * INTO v_job FROM gridex_invoice_file_archive.period_reconciliations
 WHERE company_id=p_company_id AND file_id=p_file_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_job.status IN ('locked','superseded','already_locked') THEN
  RETURN public.gridex_read_invoice_export_period_reconciliation_v1(p_company_id,p_file_id);
 END IF;
 v_year:=left(v_job.billing_month,4)::integer;
 v_month:=right(v_job.billing_month,2)::integer;
 BEGIN
  -- Global read consistency for the complete eligibility sets, including inserts.
  -- NOWAIT leaves the work durable if a publisher already owns a mutation lock.
  LOCK TABLE public.billing_underlays,public.invoice_export_items IN SHARE MODE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
  UPDATE gridex_invoice_file_archive.period_reconciliations SET reason='producer_busy',updated_at=clock_timestamp()
  WHERE company_id=p_company_id AND file_id=p_file_id;
  RETURN public.gridex_read_invoice_export_period_reconciliation_v1(p_company_id,p_file_id);
 END;

 BEGIN
 SELECT jsonb_build_object('id',l.id,'status',l.status,'updatedAt',l.updated_at,'unlockedAt',l.unlocked_at,'version',l.xmin::text)
 INTO v_current FROM public.billing_period_locks l
 WHERE l.company_id=p_company_id AND l.billing_year=v_year AND l.billing_month=v_month FOR UPDATE;
 IF v_current->>'status'='reopened' OR v_current->>'unlockedAt' IS NOT NULL THEN
  v_status:='superseded';
  v_reason:='manual_reopen';
 ELSIF v_current->>'status' IN ('locked','exported','closed') THEN
  v_status:='already_locked';
  v_reason:='existing_period_lock';
 ELSIF EXISTS(SELECT FROM public.price_period_locks p WHERE p.company_id=p_company_id AND p.billing_month=v_job.billing_month
      AND p.lock_scope IN ('billing_period','invoice_export') AND p.status='locked') THEN
  v_status:='already_locked';
  v_reason:='existing_legacy_period_lock';
 ELSIF v_current IS DISTINCT FROM v_job.expected_period THEN
  v_status:='superseded';
  v_reason:='period_revision_changed';
 ELSIF NOT EXISTS(SELECT FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.underlay_year=v_year AND b.underlay_month=v_month)
   OR EXISTS(SELECT FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.underlay_year=v_year AND b.underlay_month=v_month
     AND (b.status IS DISTINCT FROM 'validated' OR b.readiness_status IS DISTINCT FROM 'ready'
       OR NOT EXISTS(SELECT FROM public.invoice_export_items i WHERE i.company_id=p_company_id AND i.billing_underlay_id=b.id AND i.status IN ('sent','credited')))) THEN
  v_status:='incomplete';
  v_reason:='underlays_not_ready_or_exported';
 ELSE
  IF v_current IS NULL THEN
   -- The unique key also serializes concurrent first manual commands. The
   -- provisional row is visible only inside this transaction and is rolled
   -- back together with the canonical booking if any action fails.
   INSERT INTO public.billing_period_locks(company_id,billing_year,billing_month,status)
   VALUES(p_company_id,v_year,v_month,'open') ON CONFLICT(company_id,billing_year,billing_month) DO NOTHING;
   IF NOT FOUND THEN
    v_status:='superseded';
    v_reason:='period_revision_changed';
   END IF;
  END IF;
  IF v_status IS NULL THEN
   v_result:=public.gridex_set_billing_period_lock_v1(p_company_id,v_job.billing_month,true,'exported',v_job.actor_id,
     'Alla faktureringsunderlag är klara och samtliga fakturor är skickade eller krediterade.',
     jsonb_build_object('locked_by_flow','invoice_export','export_file_id',p_file_id));
   IF v_result#>>'{lock,status}' IS DISTINCT FROM 'exported' OR v_result->>'auto_lock_status'='preserved' THEN
    RAISE EXCEPTION 'billing_period_lock_compare_and_set_failed' USING ERRCODE='40001';
   END IF;
   v_status:='locked';
  END IF;
 END IF;
 UPDATE gridex_invoice_file_archive.period_reconciliations SET status=v_status,reason=v_reason,last_error_code=NULL,updated_at=clock_timestamp()
 WHERE company_id=p_company_id AND file_id=p_file_id;
 EXCEPTION WHEN OTHERS THEN
  -- Roll back all canonical period effects before recording retryable failure.
  UPDATE gridex_invoice_file_archive.period_reconciliations
  SET status='pending',reason='reconcile_failed',last_error_code=SQLSTATE,updated_at=clock_timestamp()
  WHERE company_id=p_company_id AND file_id=p_file_id;
 END;
 RETURN public.gridex_read_invoice_export_period_reconciliation_v1(p_company_id,p_file_id);
END
$reconcile_period$;
REVOKE ALL ON FUNCTION public.gridex_reconcile_invoice_export_period_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_reconcile_invoice_export_period_v1(uuid,uuid) TO service_role;

CREATE FUNCTION public.gridex_list_due_invoice_export_period_reconciliations_v1(p_limit integer DEFAULT 10)
RETURNS TABLE(company_id uuid,file_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $due_period$
 SELECT j.company_id,j.file_id FROM gridex_invoice_file_archive.period_reconciliations j
 WHERE j.status IN ('pending','incomplete')
   AND (j.reason IS NULL OR j.updated_at<=now()-interval '30 seconds')
 ORDER BY j.updated_at,j.company_id,j.file_id
 LIMIT greatest(1,least(coalesce(p_limit,10),50));
$due_period$;
REVOKE ALL ON FUNCTION public.gridex_list_due_invoice_export_period_reconciliations_v1(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_due_invoice_export_period_reconciliations_v1(integer) TO service_role;
END
$gridex_invoice_migration$;
