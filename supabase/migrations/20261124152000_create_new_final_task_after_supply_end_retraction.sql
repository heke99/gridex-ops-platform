-- A separately qualified Z05 after retraction needs its own final-metering task.
DO $migration$
DECLARE
  owner_oid constant regprocedure := 'public.gridex_supply_end_followup_v1()'::regprocedure;
  owner_row record;
  new_body text;
  old_vars constant text := $vars$  v_completed_end_source uuid;$vars$;
  new_vars constant text := $vars$  v_completed_end_source uuid;
  v_has_same_day_task boolean;
  v_has_blocking_task boolean;$vars$;
  old_check constant text := $body$  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks t WHERE t.company_id = NEW.company_id AND t.customer_id = NEW.customer_id
     AND t.task_type = 'final_invoice_pending' AND t.metadata->>'end_key' = v_key) THEN
    RETURN NEW;
  END IF;

  IF v_contract_id IS NOT NULL THEN$body$;
  new_check constant text := $body$  -- Keep unqualified legacy tasks and unretracted sources as blockers. A new
  -- qualified end gets a task only when every prior same-day task is retracted.
  SELECT count(*)>0,coalesce(bool_or(CASE
    WHEN v_completed_end_source IS NULL
      OR t.metadata->>'source_end_message_id'=v_completed_end_source::text THEN true
    WHEN t.metering_point_id IS NOT DISTINCT FROM NEW.metering_point_id
      AND t.metadata->>'supply_period_id'=NEW.id::text
      AND pg_input_is_valid(t.metadata->>'source_end_message_id','uuid')
      AND t.metadata->>'market_state_version' IS NOT NULL
      AND t.metadata->>'market_end_at' IS NOT NULL
    THEN NOT gridex_received_sources.supply_end_retracted_v1(NEW.company_id,NEW.customer_id,NEW.metering_point_id,
      (t.metadata->>'source_end_message_id')::uuid,NEW.id,t.metadata->>'market_state_version',t.metadata->>'market_end_at')
    ELSE true END),false)
  INTO v_has_same_day_task,v_has_blocking_task
  FROM public.customer_operation_tasks t
  WHERE t.company_id=NEW.company_id AND t.customer_id=NEW.customer_id
    AND t.task_type='final_invoice_pending' AND t.metadata->>'end_key'=v_key;

  IF v_has_blocking_task THEN RETURN NEW; END IF;
  -- The prior same-day contract processing stands. Create only the new task.
  IF v_contract_id IS NOT NULL AND NOT v_has_same_day_task THEN$body$;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  SELECT p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
    INTO STRICT owner_row FROM pg_proc p WHERE p.oid=owner_oid;
  IF encode(sha256(convert_to(owner_row.prosrc,'UTF8')),'hex') IS DISTINCT FROM
    'b18cccef9f6852ec51cb0753034c615809cc65ba11432ae0c85de5566942e5d4'
    OR (length(owner_row.prosrc)-length(replace(owner_row.prosrc,old_vars,'')))/length(old_vars)<>1
    OR (length(owner_row.prosrc)-length(replace(owner_row.prosrc,old_check,'')))/length(old_check)<>1
  THEN RAISE EXCEPTION 'supply_end_task_dedupe_predecessor_changed'; END IF;

  new_body:=replace(replace(owner_row.prosrc,old_vars,new_vars),old_check,new_check);
  IF encode(sha256(convert_to(new_body,'UTF8')),'hex') IS DISTINCT FROM
    '9fbe140c5ca26265215cdbf765167a66495995c647672f758e7811963a6b96dc'
  THEN RAISE EXCEPTION 'supply_end_task_dedupe_postimage_changed'; END IF;

  EXECUTE replace(owner_row.definition,owner_row.prosrc,new_body);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=owner_oid) IS DISTINCT FROM owner_row.metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=owner_oid) IS DISTINCT FROM new_body
  THEN RAISE EXCEPTION 'supply_end_task_dedupe_metadata_changed'; END IF;
END
$migration$;
