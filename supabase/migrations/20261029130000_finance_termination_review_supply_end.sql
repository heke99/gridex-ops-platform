-- Preserve the termination review's existing end date and expose the same date to the existing fee consumer.
-- No task backfill, automatic approval, invoice/snapshot mutation, grant or pricing change.
BEGIN;
DO $finance_termination_end$
DECLARE
 target regprocedure := 'public.gridex_termination_break_fee_review_v1(uuid,uuid,uuid)'::regprocedure;
 original text;
 changed text;
 definition text;
 metadata jsonb;
 old_hash constant text := 'c91f1f5566bed45ee121fc50a2144b308f35efc625466cf2db6bbb4445139eaa';
 new_hash constant text := '7411de890b6ce26e1774f70f3ff298de8013d0c48101232ac7c1734b127a23ba';
 anchor constant text := $anchor$      'contract_end_date', v_planned_end,$anchor$;
 replacement constant text := $replacement$      'contract_end_date', v_planned_end,
      'supply_end_date', v_planned_end,$replacement$;
BEGIN
 IF current_user<>session_user OR current_user IN ('anon','authenticated','service_role') THEN
  RAISE EXCEPTION 'finance_termination_review_owner_session_required' USING ERRCODE='42501';
 END IF;
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT original,metadata FROM pg_proc p WHERE oid=target;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')=new_hash THEN RETURN; END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM old_hash THEN
  RAISE EXCEPTION 'finance_termination_review_exact_source_required' USING ERRCODE='55000';
 END IF;
 IF cardinality(string_to_array(original,anchor))<>2 THEN
  RAISE EXCEPTION 'finance_termination_review_exact_anchor_required' USING ERRCODE='55000';
 END IF;
 changed:=replace(original,anchor,replacement);
 definition:=pg_get_functiondef(target);
 IF cardinality(string_to_array(definition,original))<>2 THEN
  RAISE EXCEPTION 'finance_termination_review_definition_required' USING ERRCODE='55000';
 END IF;
 EXECUTE replace(definition,original,changed);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target) IS DISTINCT FROM new_hash THEN
  RAISE EXCEPTION 'finance_termination_review_postcondition_failed' USING ERRCODE='55000';
 END IF;
END;
$finance_termination_end$;
COMMIT;
