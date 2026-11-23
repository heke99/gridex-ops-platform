DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.gridex_submit_customer_move_out_v1(jsonb)'::regprocedure);
  old_check text := $old$  if v_requested_date < current_date
     or v_requested_date > current_date + 730 then
    raise exception using
      errcode = '22023',
      message = 'customer_move_out_date_invalid';
  end if;

$old$;
  anchor text := $anchor$  select site.*
  into v_site
  from public.customer_sites site$anchor$;
  new_check text := $new$  if v_requested_date < (statement_timestamp() at time zone 'Europe/Stockholm')::date
     or v_requested_date > (statement_timestamp() at time zone 'Europe/Stockholm')::date + 730 then
    raise exception using
      errcode = '22023',
      message = 'customer_move_out_date_invalid';
  end if;

$new$;
BEGIN
  IF strpos(definition, old_check) = 0
     OR strpos(definition, anchor) = 0
     OR strpos(definition, 'customer_move_out_idempotency_conflict') <= strpos(definition, old_check)
     OR strpos(definition, 'customer_move_out_idempotency_conflict') >= strpos(definition, anchor)
     OR length(definition) - length(replace(definition, old_check, '')) <> length(old_check)
     OR length(definition) - length(replace(definition, anchor, '')) <> length(anchor) THEN
    RAISE EXCEPTION 'Unexpected move-out command definition';
  END IF;

  EXECUTE replace(replace(definition, old_check, ''), anchor, new_check || anchor);
END;
$migration$;
