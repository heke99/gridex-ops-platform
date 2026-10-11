-- SC-037 / P-11: supplier-switch transition with an expected-status predicate.
-- Body copied from gridex_transition_supplier_switch_v1 (unchanged for its
-- other callers). After the same row lock, a locked status outside
-- p_expected_statuses returns a not-applied no-op (no write, no event) so a
-- late negative ACK cannot roll back a switch that Z04 already confirmed.
-- Writer assertion, event write, SECURITY DEFINER, search_path and grants
-- are identical to v1.

CREATE OR REPLACE FUNCTION public.gridex_transition_supplier_switch_v2(p_company_id uuid, p_request_id uuid, p_patch jsonb, p_event jsonb, p_expected_statuses text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
    AS $_$
declare
  v_before public.supplier_switch_requests%rowtype;
  v_after public.supplier_switch_requests%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb) - 'updated_at';
  v_key text;
  v_set text;
  v_allowed constant text[] := array[
    'status', 'requested_start_date', 'confirmed_start_date', 'submitted_at', 'completed_at',
    'failed_at', 'failure_reason', 'external_reference', 'validation_snapshot', 'metadata',
    'lifecycle_blocked', 'lifecycle_block_source', 'lifecycle_block_id', 'pause_reason',
    'paused_at', 'paused_by', 'inbound_z04_message_id', 'updated_by',
    'authorization_document_id', 'power_of_attorney_id', 'operation_id'
  ];
begin
  perform public.gridex_assert_switch_writer_v1(p_company_id);

  select * into v_before
  from public.supplier_switch_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'supplier_switch_not_found_for_tenant';
  end if;

  if p_expected_statuses is null or not (v_before.status = any (p_expected_statuses)) then
    return jsonb_build_object('applied', false, 'currentStatus', v_before.status, 'request', to_jsonb(v_before));
  end if;

  for v_key in select jsonb_object_keys(v_patch) loop
    if not v_key = any (v_allowed) then
      raise exception using errcode = '22023', message = 'supplier_switch_patch_column_not_allowed', detail = v_key;
    end if;
  end loop;

  -- Only the keys the caller sent are written; identity and tenant columns never move.
  select string_agg(format('%1$I = patch.%1$I', key), ', ')
  into v_set
  from jsonb_object_keys(v_patch) as key;
  v_set := concat_ws(', ', v_set, 'updated_at = now()');

  execute format(
    'update public.supplier_switch_requests target set %s
       from jsonb_populate_record(null::public.supplier_switch_requests, $3) as patch
      where target.id = $1 and target.company_id = $2
      returning target.*',
    v_set
  ) into v_after using p_request_id, p_company_id, v_patch;

  if p_event is not null then
    insert into public.supplier_switch_events (
      switch_request_id, event_type, event_status, message, payload, company_id, created_by
    ) values (
      p_request_id,
      coalesce(p_event->>'event_type', 'status_changed'),
      coalesce(p_event->>'event_status', 'success'),
      p_event->>'message',
      coalesce(p_event->'payload', '{}'::jsonb)
        || jsonb_build_object('previous_status', v_before.status, 'new_status', v_after.status),
      p_company_id,
      nullif(p_event->>'created_by', '')::uuid
    );
  end if;

  return jsonb_build_object('applied', true, 'before', to_jsonb(v_before), 'request', to_jsonb(v_after));
end
$_$;

REVOKE ALL ON FUNCTION public.gridex_transition_supplier_switch_v2(p_company_id uuid, p_request_id uuid, p_patch jsonb, p_event jsonb, p_expected_statuses text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gridex_transition_supplier_switch_v2(p_company_id uuid, p_request_id uuid, p_patch jsonb, p_event jsonb, p_expected_statuses text[]) TO service_role;
GRANT ALL ON FUNCTION public.gridex_transition_supplier_switch_v2(p_company_id uuid, p_request_id uuid, p_patch jsonb, p_event jsonb, p_expected_statuses text[]) TO authenticated;
