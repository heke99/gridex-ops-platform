-- A historically registered notice must leave an already final contract end intact.
DO $migration$
DECLARE
  fn record;
  source text;
  end_before constant text := 'ended_at = coalesce(p_derived_ends_at, ended_at),';
  plan_before constant text := 'case when v_contract.ends_at is null and isfinite(p_derived_ends_at)';
  end_after constant text := $body$ended_at = case when v_contract.status in ('terminated', 'cancelled', 'expired')
          then ended_at else coalesce(p_derived_ends_at, ended_at) end,$body$;
  plan_after constant text := $body$case when v_contract.status not in ('terminated', 'cancelled', 'expired')
        and v_contract.ends_at is null and isfinite(p_derived_ends_at)$body$;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout','3s',true);
  SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p)-'prosrc' AS metadata
    INTO STRICT fn
  FROM pg_proc p
  WHERE p.oid='public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)'::regprocedure
    AND p.prosecdef AND p.proowner=current_user::regrole;
  IF encode(sha256(convert_to(fn.prosrc,'UTF8')),'hex')
    <> '17bb28ab42273389a22ce481dcad5846b4747d81cb5207bb164d6cfead4b2919' THEN
    RAISE EXCEPTION 'termination_notice_terminal_fence_exact_predecessor_required';
  END IF;
  IF (length(fn.prosrc)-length(replace(fn.prosrc,end_before,'')))/length(end_before) <> 1
    OR (length(fn.prosrc)-length(replace(fn.prosrc,plan_before,'')))/length(plan_before) <> 1 THEN
    RAISE EXCEPTION 'termination_notice_terminal_fence_exact_anchors_required';
  END IF;
  source := replace(replace(fn.prosrc,end_before,end_after),plan_before,plan_after);
  EXECUTE replace(fn.definition,fn.prosrc,source);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=fn.oid) IS DISTINCT FROM fn.metadata THEN
    RAISE EXCEPTION 'termination_notice_terminal_fence_rpc_metadata_changed';
  END IF;
END
$migration$;
