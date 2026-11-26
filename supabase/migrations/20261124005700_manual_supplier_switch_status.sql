do $migration$
begin
  create function public.gridex_update_manual_supplier_switch_status_v1(
    p_company_id uuid,
    p_request_id uuid,
    p_expected_status text,
    p_expected_updated_at timestamptz,
    p_status text,
    p_failure_reason text,
    p_external_reference text
  ) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $body$
  declare
    v_actor uuid := auth.uid();
    v_current_status text;
    v_current_updated_at timestamptz;
    v_failure_reason text := nullif(btrim(p_failure_reason), '');
    v_external_reference text := nullif(btrim(p_external_reference), '');
    v_patch jsonb;
  begin
    if auth.role() is distinct from 'authenticated' or v_actor is null then
      raise exception using errcode = '42501', message = 'manual_supplier_switch_actor_required';
    end if;
    perform public.gridex_assert_switch_writer_v1(p_company_id);
    if not public.gridex_user_is_platform_admin()
       and not public.gridex_has_permission_in_company(p_company_id, 'masterdata.write') then
      raise exception using errcode = '42501', message = 'manual_supplier_switch_permission_required';
    end if;
    if p_expected_status is null or p_expected_status not in ('draft', 'queued', 'submitted', 'failed')
       or p_expected_updated_at is null
       or p_status is null or p_status not in ('draft', 'queued', 'submitted', 'rejected', 'failed') then
      raise exception using errcode = '22023', message = 'manual_supplier_switch_status_invalid';
    end if;

    select status, updated_at into v_current_status, v_current_updated_at
    from public.supplier_switch_requests
    where id = p_request_id and company_id = p_company_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'supplier_switch_not_found_for_tenant';
    end if;
    if v_current_status is distinct from p_expected_status or v_current_updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = 'PT409', message = 'manual_supplier_switch_status_stale';
    end if;

    v_patch := jsonb_build_object(
      'status', p_status,
      'updated_by', v_actor,
      'failure_reason', v_failure_reason,
      'external_reference', v_external_reference
    );
    if p_status = 'submitted' then
      v_patch := v_patch || jsonb_build_object('submitted_at', now());
    elsif p_status in ('failed', 'rejected') then
      v_patch := v_patch || jsonb_build_object('failed_at', now());
    end if;

    -- Reuse the canonical writer and its atomic event while still holding the row lock.
    return public.gridex_transition_supplier_switch_v1(
      p_company_id, p_request_id, v_patch,
      jsonb_build_object(
        'event_type', 'status_updated',
        'event_status', p_status,
        'message', case when p_status in ('failed', 'rejected') then
          coalesce(v_failure_reason, 'Status uppdaterad med felorsak.')
        else format('Switchärende uppdaterat till status %s.', p_status) end,
        'payload', jsonb_build_object(
          'status', p_status,
          'externalReference', v_external_reference,
          'failureReason', v_failure_reason
        ),
        'created_by', v_actor
      )
    );
  end;
  $body$;

  revoke all on function public.gridex_update_manual_supplier_switch_status_v1(uuid, uuid, text, timestamptz, text, text, text)
    from public, anon, service_role;
  grant execute on function public.gridex_update_manual_supplier_switch_status_v1(uuid, uuid, text, timestamptz, text, text, text)
    to authenticated;
end
$migration$;
