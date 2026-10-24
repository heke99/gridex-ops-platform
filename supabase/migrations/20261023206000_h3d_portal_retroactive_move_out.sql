-- FINDINGS H3d D5 and D12 (reports/h3d-move-out-notice.md): the customer portal API refused a move-out date before
-- today (customer_move_out_date_invalid), so a customer who had already moved could not report it, and "today" was the
-- database's current_date (the UTC day) instead of the Swedish calendar day.
--
-- Rule: the requested move-out date may lie up to 30 days back from the Stockholm day (and at most 730 days ahead, as
-- before). A date before today is a retroactive report: the operator's case says so (metadata retroactive = true,
-- priority high, title "Utflyttningsanmälan (retroaktiv)"). Nothing else changes: the report still only creates the
-- completion and the review case (next_action review_move_out_submission); the operator ends the supply, and a manual
-- end may shorten an Ediel-qualified period but never extend it (H3c).
--
-- Exact-needle rewrite of the installed body (20260730153000); refuses (h3d_portal_move_out_rule_source_changed) unless
-- every needle is present exactly once and the H3d marker is absent. Owner, ACL, security definer, volatility and
-- configuration are preserved and checked (h3d_portal_move_out_metadata_changed).
begin;

do $h3d5$
declare
  f record;
  body text;
  old_text text[] := array[
$o$  if v_requested_date < current_date
     or v_requested_date > current_date + 730 then$o$,
$o$    'normal',
    'Utflyttningsanmälan',$o$,
$o$      'facility_reference', v_facility_reference,
      'requested_move_out_date', v_requested_date
    )
  )
  returning id into v_case_id;$o$];
  new_text text[] := array[
$n$  -- H3d D5/D12 (20261023206000): up to 30 days back from the Stockholm day, as a retroactive report.
  if v_requested_date < (now() at time zone 'Europe/Stockholm')::date - 30
     or v_requested_date > (now() at time zone 'Europe/Stockholm')::date + 730 then$n$,
$n$    case when v_requested_date < (now() at time zone 'Europe/Stockholm')::date then 'high' else 'normal' end,
    case when v_requested_date < (now() at time zone 'Europe/Stockholm')::date
      then 'Utflyttningsanmälan (retroaktiv)' else 'Utflyttningsanmälan' end,$n$,
$n$      'facility_reference', v_facility_reference,
      'requested_move_out_date', v_requested_date,
      'retroactive', v_requested_date < (now() at time zone 'Europe/Stockholm')::date
    )
  )
  returning id into v_case_id;$n$];
  i integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'public.gridex_submit_customer_move_out_v1(jsonb)'::regprocedure;
  if position('H3d D5/D12 (20261023206000)' in f.prosrc) <> 0 or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'h3d_portal_move_out_rule_source_changed' using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(old_text) loop
    if (length(body) - length(replace(body, old_text[i], ''))) / length(old_text[i]) <> 1 then
      raise exception 'h3d_portal_move_out_rule_source_changed:%', i using errcode = 'P0U01';
    end if;
    body := replace(body, old_text[i], new_text[i]);
  end loop;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h3d_portal_move_out_metadata_changed' using errcode = 'P0U01';
  end if;
end
$h3d5$;

commit;
