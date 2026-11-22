DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.gridex_submit_customer_move_out_v1(jsonb)'::regprocedure);
  anchor text := $anchor$  insert into public.customer_portal_completions($anchor$;
  deduplicate text := $deduplicate$  -- The scoped site row is locked above, serializing submissions for this facility.
  select completion.*
  into v_existing
  from public.customer_portal_completions completion
  where completion.company_id = v_company_id
    and completion.customer_id = v_customer_id
    and completion.site_id = v_site.id
    and completion.completion_type = 'move_out'
    and completion.status in ('submitted', 'in_review', 'accepted')
    and completion.submitted_payload->'requested_move_out_date' = to_jsonb(v_requested_date)
  order by completion.created_at, completion.id
  limit 1;

  if found then
    if (v_existing.submitted_payload - 'metadata') is distinct from jsonb_build_object(
      'facility_reference', v_facility_reference,
      'customer_contract_reference', v_contract_reference,
      'requested_move_out_date', v_requested_date,
      'reason', nullif(p_command->>'reason', ''),
      'new_address', coalesce(p_command->'new_address', '{}'::jsonb),
      'contact_details', coalesce(p_command->'contact_details', '{}'::jsonb)
    ) then
      raise exception using
        errcode = '23505',
        message = 'customer_move_out_active_submission_conflict';
    end if;
    return jsonb_build_object(
      'completion_reference', v_existing.completion_reference,
      'customer_reference', v_customer_reference,
      'facility_reference', v_facility_reference,
      'contract_reference', v_contract_reference,
      'requested_move_out_date', v_requested_date,
      'status', 'submitted',
      'submitted_at', v_existing.created_at,
      'replayed', true
    );
  end if;

$deduplicate$;
BEGIN
  IF strpos(definition, anchor) = 0
     OR strpos(definition, 'for update;') = 0
     OR strpos(definition, 'for update;') >= strpos(definition, anchor)
     OR length(definition) - length(replace(definition, anchor, '')) <> length(anchor) THEN
    RAISE EXCEPTION 'Unexpected move-out command definition';
  END IF;
  EXECUTE replace(definition, anchor, deduplicate || anchor);
END;
$migration$;
