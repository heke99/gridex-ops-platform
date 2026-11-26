-- Correct the notice date without changing planned or actual end authority.
DO $migration$
DECLARE
  fn record;
  needle constant text := 'set termination_notice_date = p_happened_at,';
  replacement constant text := 'set termination_notice_date = (p_happened_at at time zone ''Europe/Stockholm'')::date,';
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout','3s',true);
  SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p)-'prosrc' AS metadata
    INTO STRICT fn
  FROM pg_proc p
  WHERE p.oid='public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)'::regprocedure
    AND p.prosecdef AND p.proowner=current_user::regrole;
  IF encode(sha256(convert_to(fn.prosrc,'UTF8')),'hex')
    <> 'bb199ad37956b3e07ce0bee093f024c184d4f7f5e732e901ec7329a54d0558c7' THEN
    RAISE EXCEPTION 'termination_notice_exact_predecessor_required';
  END IF;
  IF (length(fn.prosrc)-length(replace(fn.prosrc,needle,'')))/length(needle) <> 1 THEN
    RAISE EXCEPTION 'termination_notice_exact_calendar_anchor_required';
  END IF;
  EXECUTE replace(fn.definition,fn.prosrc,replace(fn.prosrc,needle,replacement));
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=fn.oid) IS DISTINCT FROM fn.metadata THEN
    RAISE EXCEPTION 'termination_notice_rpc_metadata_changed';
  END IF;
END
$migration$;
