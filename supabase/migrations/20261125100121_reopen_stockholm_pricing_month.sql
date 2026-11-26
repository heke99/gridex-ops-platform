-- Pricing period starts are timestamptz. Reopen the tenant's Swedish civil
-- billing month independently of the database session's time zone.
DO $pricing_month$
DECLARE
  owner constant regprocedure := 'public.gridex_unlock_pricing_runs_for_month(uuid,text,uuid,text)'::regprocedure;
  old_bounds constant text := $old$    and billing_period_start >= v_month_start
    and billing_period_start < v_month_end;$old$;
  stockholm_bounds constant text := $new$    and billing_period_start >= (v_month_start::timestamp AT TIME ZONE 'Europe/Stockholm')
    and billing_period_start < (v_month_end::timestamp AT TIME ZONE 'Europe/Stockholm');$new$;
  prior_md5 constant text := '531fd0d45ff6195ac77261aef9b5c75a';
  next_md5 constant text := 'b47a3ba26bd491f8bba52eaff66f9d7f';
  actual_md5 text;
BEGIN
  SELECT md5(prosrc) INTO STRICT actual_md5 FROM pg_proc WHERE oid=owner;
  IF actual_md5=next_md5 THEN RETURN; END IF;
  IF actual_md5 IS DISTINCT FROM prior_md5 THEN
    RAISE EXCEPTION 'pricing_unlock_month_predecessor_changed';
  END IF;
  EXECUTE replace(pg_get_functiondef(owner),old_bounds,stockholm_bounds);
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=owner) IS DISTINCT FROM next_md5 THEN
    RAISE EXCEPTION 'pricing_unlock_month_replacement_failed';
  END IF;
END
$pricing_month$;
