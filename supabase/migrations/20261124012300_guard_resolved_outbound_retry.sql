do $migration$
begin
  create function public.gridex_resolve_legacy_outbound_route_v1(
    p_company_id uuid, p_customer_id uuid, p_request_id uuid, p_actor_id uuid,
    p_expected_status text, p_expected_updated_at timestamptz, p_route_id uuid, p_mode text
  ) returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
  as $command$
  declare
    v_before public.outbound_requests%rowtype;
    v_after public.outbound_requests%rowtype;
    v_route public.communication_routes%rowtype;
    v_switch public.supplier_switch_requests%rowtype;
    v_payload jsonb;
    v_requeue boolean;
  begin
    if auth.role() is distinct from 'service_role' or p_actor_id is null
       or p_company_id is null or p_customer_id is null then
      raise exception using errcode = '42501', message = 'outbound_route_operator_required';
    end if;
    if p_expected_updated_at is null or p_expected_status is null
       or (p_mode in ('rerun', 'manual_assign', 'bulk')) is not true
       or (p_mode = 'manual_assign' and p_route_id is null) then
      raise exception using errcode = '22023', message = 'outbound_route_revision_required';
    end if;
    if (
      public.canonical_actor_is_platform_admin(p_actor_id)
      or public.gridex_actor_has_company_permission(p_actor_id, p_company_id, 'switching.write')
      or public.gridex_actor_has_company_permission(p_actor_id, p_company_id, 'metering.write')
      or public.gridex_actor_has_company_permission(p_actor_id, p_company_id, 'billing_underlay.write')
    ) is not true then
      raise exception using errcode = '42501', message = 'outbound_route_operator_forbidden';
    end if;
    perform 1 from public.companies where id = p_company_id and status in ('active','onboarding') for share;
    if not found then
      raise exception using errcode = '42501', message = 'outbound_route_company_not_operational';
    end if;

    select * into v_before from public.outbound_requests
    where company_id = p_company_id and customer_id = p_customer_id and id = p_request_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'outbound_route_request_not_found';
    end if;
    if v_before.channel_type <> 'unresolved' or v_before.status is distinct from p_expected_status
       or v_before.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object('status', 'held', 'reason', 'stale', 'request', to_jsonb(v_before));
    end if;

    if v_before.request_type = 'supplier_switch' and v_before.source_type = 'supplier_switch_request' then
      begin
        select * into v_switch from public.supplier_switch_requests
        where company_id = p_company_id and customer_id = p_customer_id
          and site_id = v_before.site_id and id = v_before.source_id
        for share nowait;
      exception when lock_not_available then
        return jsonb_build_object('status', 'held', 'reason', 'stale', 'request', to_jsonb(v_before));
      end;
      if v_switch.id is null or (v_switch.status in ('draft','queued','submitted','failed')) is not true
         or v_switch.lifecycle_blocked is true or v_switch.paused_at is not null
         or v_switch.inbound_z04_message_id is not null or v_switch.outbound_z03_message_id is not null then
        return jsonb_build_object('status', 'held', 'reason', 'source_history', 'request', to_jsonb(v_before));
      end if;
    end if;

    -- Renderers can insert an original before binding its outbound/switch, and
    -- ediel_messages has no FK to either row. Try a short exclusion fence without
    -- waiting for unrelated writers. An unavailable fence leaves all state intact.
    begin
      lock table public.ediel_messages in share mode nowait;
    exception when lock_not_available then
      return jsonb_build_object('status', 'held', 'reason', 'transport_history', 'request', to_jsonb(v_before));
    end;
    if v_before.sent_at is not null or v_before.acknowledged_at is not null or v_before.attempts_count <> 0
       or (v_before.status in ('queued', 'prepared', 'failed', 'cancelled')) is not true
       or nullif(v_before.response_payload->>'edielMessageId', '') is not null
       or v_before.metadata ? 'superseded_by_intent'
       or exists (
         select 1 from public.outbound_dispatch_events as event
         where event.outbound_request_id = v_before.id and (event.company_id is null or event.company_id = p_company_id)
           and (event.event_type in ('sent','acknowledged','delivery_uncertain')
             or event.event_status in ('sent','acknowledged','provider_accepted','delivery_uncertain'))
       )
       or exists (
         select 1 from public.outbound_requests as prior
         where prior.company_id = p_company_id and prior.customer_id = p_customer_id
           and prior.site_id = v_switch.site_id and prior.request_type = 'supplier_switch'
           and prior.source_type = 'supplier_switch_request' and prior.source_id = v_switch.id
           and prior.id <> v_before.id
           and (prior.sent_at is not null or prior.acknowledged_at is not null or prior.attempts_count <> 0
             or prior.status in ('sent','acknowledged','delivery_uncertain'))
       )
       or exists (
         select 1 from public.ediel_messages as message
         where message.company_id = p_company_id and message.direction = 'outbound'
           and (message.outbound_request_id = v_before.id
                or (message.switch_request_id = v_switch.id and message.message_family = 'PRODAT' and message.message_code = 'Z03'))
       ) then
      return jsonb_build_object('status', 'held', 'reason', 'transport_history', 'request', to_jsonb(v_before));
    end if;

    if p_route_id is not null then
      select * into v_route from public.communication_routes
      where id = p_route_id and is_active
        and (company_id = p_company_id or (p_mode = 'manual_assign' and company_id is null))
        and (grid_owner_id is null or grid_owner_id = v_before.grid_owner_id)
        and route_scope = case when p_mode <> 'manual_assign' then v_before.request_type
          when v_before.request_type in ('supplier_switch','customer_masterdata','meter_values') then v_before.request_type
          else 'billing_underlay' end
        and case v_before.payload->>'environment'
          when 'production' then environment_type::text = 'production'
          when 'test' then environment_type::text in ('tgt_test','agt_test','bilateral_test')
          else environment_type is null end
      for share;
      if not found or v_route.route_type = 'unresolved' then
        return jsonb_build_object('status','held','reason','route_unavailable','request',to_jsonb(v_before));
      end if;
    end if;

    v_requeue := v_route.id is not null and v_before.status in ('failed','cancelled');
    v_payload := jsonb_build_object('communication_route', case when v_route.id is not null then jsonb_build_object(
      'id', v_route.id, 'route_name', v_route.route_name, 'route_scope', v_route.route_scope,
      'route_type', v_route.route_type, 'target_system', v_route.target_system, 'endpoint', v_route.endpoint,
      'target_email', v_route.target_email, 'supported_payload_version', v_route.supported_payload_version,
      'grid_owner_id', v_route.grid_owner_id) end);

    update public.outbound_requests
    set communication_route_id = v_route.id, channel_type = coalesce(v_route.route_type, 'unresolved'),
        payload = coalesce(payload, '{}'::jsonb) || v_payload,
        status = case when v_requeue then 'queued' else status end,
        failed_at = case when v_requeue then null else failed_at end,
        failure_reason = case when v_requeue then null else failure_reason end,
        prepared_at = case when v_requeue then null else prepared_at end,
        updated_by = p_actor_id, updated_at = now()
    where id = p_request_id and company_id = p_company_id
    returning * into strict v_after;

    if v_requeue then
      insert into public.outbound_dispatch_events (
        company_id, outbound_request_id, event_type, event_status, message, payload, created_by
      ) values (
        p_company_id, p_request_id, 'queued', 'queued', 'Route löstes och utskicket återköades.',
        jsonb_build_object('retry',true,'attemptsCount',v_after.attempts_count,'routeId',v_route.id,'mode',p_mode), p_actor_id
      );
    end if;

    if p_mode = 'manual_assign' then
      insert into public.outbound_dispatch_events (
        company_id, outbound_request_id, event_type, event_status, message, payload, created_by
      ) values (
        p_company_id, p_request_id, 'queued', v_after.status,
        case when v_requeue then format('Manuell route %s valdes och requesten återköades.', v_route.route_name)
          else format('Manuell route %s valdes från unresolved-sidan.', v_route.route_name) end,
        jsonb_build_object('communicationRouteId', v_route.id, 'routeName', v_route.route_name,
          'routeType', v_route.route_type, 'manuallyAssigned', true, 'requeued', v_requeue), p_actor_id
      );
    end if;

    if v_switch.id is not null then
      insert into public.supplier_switch_events (
        company_id, switch_request_id, event_type, event_status, message, payload, created_by
      ) values (
        p_company_id, v_switch.id,
        case when v_route.id is null then 'outbound_route_still_unresolved'
             when p_mode = 'manual_assign' then 'outbound_route_assigned' else 'outbound_route_resolved' end,
        v_after.channel_type,
        case when v_route.id is null then 'Utskicket saknar fortfarande en kommunikationsväg.'
             else 'Utskickets kommunikationsväg har verifierats.' end,
        jsonb_build_object('outboundRequestId',p_request_id,'channelType',v_after.channel_type,
          'communicationRouteId',v_route.id,'actorUserId',p_actor_id,
          'mode',case when p_mode = 'manual_assign' then 'manual_assign' else 'rerun' end), p_actor_id
      );
    end if;

    insert into public.audit_logs (
      company_id, actor_user_id, entity_type, entity_id, action, old_values, new_values, metadata
    ) values (
      p_company_id, p_actor_id, 'outbound_request', p_request_id::text,
      case p_mode when 'manual_assign' then 'outbound_request_route_assigned_manually'
        when 'bulk' then 'outbound_request_route_resolution_reran_bulk' else 'outbound_request_route_resolution_reran' end,
      to_jsonb(v_before), to_jsonb(v_after),
      jsonb_build_object('customerId',p_customer_id,'beforeChannelType',v_before.channel_type,
        'afterChannelType',v_after.channel_type,'beforeRouteId',v_before.communication_route_id,
        'afterRouteId',v_after.communication_route_id,'requeued',v_requeue)
      || case when p_mode = 'manual_assign' then jsonb_build_object(
        'communicationRouteId',v_route.id,'routeName',v_route.route_name,'routeType',v_route.route_type)
        else '{}'::jsonb end
    );

    return jsonb_build_object('status','resolved','requeued',v_requeue,'request',to_jsonb(v_after));
  end;
  $command$;

  revoke all on function public.gridex_resolve_legacy_outbound_route_v1(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)
    from public, anon, authenticated, service_role;
  grant execute on function public.gridex_resolve_legacy_outbound_route_v1(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)
    to service_role;
end
$migration$;
