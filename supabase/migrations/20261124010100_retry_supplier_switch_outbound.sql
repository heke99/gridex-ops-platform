do $migration$
begin
  create function public.gridex_retry_supplier_switch_outbound_v1(
    p_company_id uuid,
    p_customer_id uuid,
    p_switch_request_id uuid,
    p_outbound_request_id uuid,
    p_expected_switch_status text,
    p_expected_switch_updated_at timestamptz,
    p_expected_outbound_status text,
    p_expected_outbound_updated_at timestamptz
  ) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $command$
  declare
    v_actor uuid := auth.uid();
    v_switch public.supplier_switch_requests%rowtype;
    v_before public.outbound_requests%rowtype;
    v_after public.outbound_requests%rowtype;
  begin
    if auth.role() is distinct from 'authenticated' or v_actor is null then
      raise exception using errcode = '42501', message = 'supplier_switch_retry_actor_required';
    end if;
    perform public.gridex_assert_switch_writer_v1(p_company_id);
    if not public.gridex_user_is_platform_admin()
       and not public.gridex_has_permission_in_company(p_company_id, 'masterdata.write') then
      raise exception using errcode = '42501', message = 'supplier_switch_retry_permission_required';
    end if;

    -- Serialize against company pause and the authority that can cancel the switch.
    perform 1 from public.companies
    where id = p_company_id and status in ('active', 'onboarding') for share;
    if not found then
      raise exception using errcode = '42501', message = 'supplier_switch_retry_company_not_operational';
    end if;

    if p_expected_switch_status is null or p_expected_switch_status not in ('draft', 'queued', 'submitted', 'failed')
       or p_expected_outbound_status is null or p_expected_outbound_status not in ('failed', 'cancelled')
       or p_expected_switch_updated_at is null or p_expected_outbound_updated_at is null then
      raise exception using errcode = '22023', message = 'supplier_switch_retry_invalid_revision';
    end if;

    select * into v_switch from public.supplier_switch_requests
    where company_id = p_company_id and customer_id = p_customer_id and id = p_switch_request_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'supplier_switch_retry_target_not_found';
    end if;
    if v_switch.status is distinct from p_expected_switch_status
       or v_switch.updated_at is distinct from p_expected_switch_updated_at
       or v_switch.lifecycle_blocked is true or v_switch.paused_at is not null then
      raise exception using errcode = 'PT409', message = 'supplier_switch_retry_stale';
    end if;

    select * into v_before from public.outbound_requests
    where company_id = p_company_id and customer_id = p_customer_id and site_id = v_switch.site_id
      and source_id = p_switch_request_id
      and request_type = 'supplier_switch' and source_type = 'supplier_switch_request'
    order by created_at desc, id desc
    limit 1 for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'supplier_switch_retry_target_not_found';
    end if;
    if v_before.id is distinct from p_outbound_request_id
       or v_before.status is distinct from p_expected_outbound_status
       or v_before.updated_at is distinct from p_expected_outbound_updated_at then
      raise exception using errcode = 'PT409', message = 'supplier_switch_retry_stale';
    end if;

    if v_switch.inbound_z04_message_id is not null or v_switch.outbound_z03_message_id is not null then
      raise exception using errcode = 'PT409', message = 'supplier_switch_retry_transport_history';
    end if;

    -- Keep this legacy command separate from the immutable Ediel transport owner.
    -- Freeze creation/rebinding of source messages for this short decision window.
    begin
      lock table public.ediel_messages in share mode nowait;
    exception when lock_not_available then
      raise exception using errcode = 'PT409', message = 'supplier_switch_retry_transport_history';
    end;
    if exists (
      select 1
      from public.outbound_requests as prior
      where prior.company_id = p_company_id and prior.customer_id = p_customer_id and prior.site_id = v_switch.site_id
        and prior.source_id = v_switch.id and prior.request_type = 'supplier_switch'
        and prior.source_type = 'supplier_switch_request'
        and (
          prior.sent_at is not null or prior.acknowledged_at is not null or prior.attempts_count <> 0
          or prior.status in ('sent', 'acknowledged', 'delivery_uncertain')
          or nullif(prior.response_payload->>'edielMessageId', '') is not null
          or prior.metadata ? 'superseded_by_intent'
          or exists (
            select 1 from public.outbound_dispatch_events as event
            where event.outbound_request_id = prior.id
              and (event.company_id is null or event.company_id = p_company_id)
              and (event.event_type in ('sent', 'acknowledged', 'delivery_uncertain')
                or event.event_status in ('sent', 'acknowledged', 'provider_accepted', 'delivery_uncertain'))
          )
          or exists (
            select 1 from public.ediel_messages as message
            where message.company_id = p_company_id and message.direction = 'outbound'
              and message.outbound_request_id = prior.id
          )
        )
    ) or exists (
      select 1 from public.ediel_messages as message
      where message.company_id = p_company_id and message.direction = 'outbound'
        and message.switch_request_id = v_switch.id
        and message.message_family = 'PRODAT' and message.message_code = 'Z03'
    ) then
      raise exception using errcode = 'PT409', message = 'supplier_switch_retry_transport_history';
    end if;

    update public.outbound_requests
    set status = 'queued', failure_reason = null, failed_at = null, prepared_at = null,
        updated_by = v_actor, updated_at = now()
    where company_id = p_company_id and id = v_before.id
    returning * into strict v_after;

    insert into public.outbound_dispatch_events (
      company_id, outbound_request_id, event_type, event_status, message, payload, created_by
    ) values (
      p_company_id, v_after.id, 'queued', 'queued', 'Manuell retry från switch detail.',
      jsonb_build_object('retry', true, 'attemptsCount', v_after.attempts_count), v_actor
    );

    perform public.gridex_transition_supplier_switch_v1(
      p_company_id, v_switch.id,
      jsonb_build_object(
        'status', 'queued', 'failure_reason', null,
        'external_reference', v_after.external_reference, 'updated_by', v_actor
      ), jsonb_build_object(
        'event_type', 'manual_retry_queued', 'event_status', 'queued',
        'message', format('Outbound %s återköades manuellt från switch detail.', v_after.id),
        'payload', jsonb_build_object(
          'outboundRequestId', v_after.id, 'customerId', v_switch.customer_id, 'attemptsCount', v_after.attempts_count
        ),
        'created_by', v_actor
      )
    );

    insert into public.audit_logs (
      company_id, actor_user_id, entity_type, entity_id, action, old_values, new_values, metadata
    ) values (
      p_company_id, v_actor, 'outbound_request', v_after.id::text,
      'outbound_request_manual_retry_from_switch_detail', jsonb_build_object('status', v_before.status), to_jsonb(v_after),
      jsonb_build_object(
        'customerId', v_switch.customer_id, 'switchRequestId', v_switch.id, 'requestType', v_after.request_type,
        'sourceType', v_after.source_type, 'sourceId', v_after.source_id
      )
    );

    return jsonb_build_object('queued', true);
  end;
  $command$;

  revoke all on function public.gridex_retry_supplier_switch_outbound_v1(uuid, uuid, uuid, uuid, text, timestamptz, text, timestamptz)
    from public, anon, service_role;
  grant execute on function public.gridex_retry_supplier_switch_outbound_v1(uuid, uuid, uuid, uuid, text, timestamptz, text, timestamptz)
    to authenticated;
end
$migration$;
