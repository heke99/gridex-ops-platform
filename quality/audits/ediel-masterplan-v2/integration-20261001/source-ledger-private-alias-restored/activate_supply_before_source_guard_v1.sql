CREATE FUNCTION gridex_received_sources.activate_supply_before_source_guard_v1(p_company_id uuid, p_supplier_switch_request_id uuid, p_source_message_id uuid, p_actual_start_date date DEFAULT NULL::date, p_actor_user_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text) RETURNS TABLE(supplier_switch_request_id uuid, supply_period_id uuid, contract_id uuid, customer_application_id uuid, workflow_id uuid, domain_event_id uuid, notification_job_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_switch public.supplier_switch_requests%rowtype;
  v_period_id uuid;
  v_contract_id uuid;
  v_application_id uuid;
  v_workflow public.customer_application_workflows%rowtype;
  v_event_id uuid;
  v_job_id uuid;
  v_start_date date;
  v_key text;
  v_now timestamptz := now();
  v_tenant_reference text;
begin
  if p_company_id is null then
    raise exception 'supply_activation_company_required' using errcode = '22023';
  end if;
  if p_supplier_switch_request_id is null then
    raise exception 'supply_activation_switch_required' using errcode = '22023';
  end if;
  if p_source_message_id is null then
    raise exception 'supply_activation_source_message_required' using errcode = '22023';
  end if;

  select * into v_switch
  from public.supplier_switch_requests
  where id = p_supplier_switch_request_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'supply_activation_switch_not_found' using errcode = 'P0002';
  end if;
  if v_switch.customer_id is null then
    raise exception 'supply_activation_customer_required' using errcode = '23502';
  end if;
  if v_switch.metering_point_id is null then
    raise exception 'supply_activation_metering_point_required' using errcode = '23502';
  end if;

  v_contract_id := coalesce(v_switch.contract_id, v_switch.customer_contract_id);
  if v_contract_id is null then
    raise exception 'supply_activation_contract_required' using errcode = '23502';
  end if;
  if v_switch.status not in (
    'confirmed',
    'accepted',
    'completed'
  ) then
    raise exception 'supply_activation_switch_not_confirmed' using errcode = '23514';
  end if;

  if not exists(
    select 1
    from public.customer_contracts cc
    join public.metering_points mp
      on mp.id=v_switch.metering_point_id
     and mp.company_id=cc.company_id
     and mp.customer_id=cc.customer_id
    left join public.customer_sites cs
      on cs.id=coalesce(v_switch.customer_site_id,v_switch.site_id)
     and cs.company_id=cc.company_id
     and cs.customer_id=cc.customer_id
    where cc.id=v_contract_id
      and cc.company_id=p_company_id
      and cc.customer_id=v_switch.customer_id
      and (
        coalesce(v_switch.customer_site_id,v_switch.site_id) is null
        or cs.id is not null
      )
  ) then
    raise exception using
      errcode='23514',
      message='supply_activation_customer_contract_site_meter_mismatch';
  end if;

  v_start_date := coalesce(
    p_actual_start_date,
    v_switch.confirmed_start_date,
    v_switch.requested_start_date
  );
  if v_start_date is null then
    raise exception 'supply_activation_start_date_required' using errcode = '23502';
  end if;
  v_key := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    format('activate_customer_supply_v1:%s:%s', p_company_id, p_supplier_switch_request_id)
  );

  insert into public.customer_supply_periods(
    company_id,
    customer_id,
    metering_point_id,
    contract_id,
    start_date,
    actual_start_date,
    source,
    source_process,
    source_message_id,
    source_switch_request_id,
    status,
    metadata,
    updated_at
  ) values (
    p_company_id,
    v_switch.customer_id,
    v_switch.metering_point_id,
    v_contract_id,
    v_start_date,
    v_start_date,
    'activate_customer_supply_v1',
    'supplier_switch_confirmation',
    p_source_message_id,
    v_switch.id,
    'active',
    jsonb_build_object(
      'activation_idempotency_key', v_key,
      'activated_at', v_now
    ),
    v_now
  )
  on conflict (company_id, metering_point_id, start_date)
    where status in ('active', 'confirmed_by_grid_owner')
  do update set
    customer_id = excluded.customer_id,
    contract_id = excluded.contract_id,
    actual_start_date = coalesce(public.customer_supply_periods.actual_start_date, excluded.actual_start_date),
    source_message_id = excluded.source_message_id,
    source_switch_request_id = excluded.source_switch_request_id,
    status = 'active',
    metadata = coalesce(public.customer_supply_periods.metadata, '{}'::jsonb)
      || excluded.metadata,
    updated_at = excluded.updated_at
  returning id into v_period_id;

  update public.supplier_switch_requests
  set status = 'completed',
      confirmed_start_date = coalesce(confirmed_start_date, v_start_date),
      completed_at = coalesce(completed_at, v_now),
      external_reference = coalesce(external_reference, v_key),
      inbound_z04_message_id = coalesce(inbound_z04_message_id, p_source_message_id),
      lifecycle_blocked = false,
      lifecycle_block_source = null,
      updated_at = v_now
  where id = v_switch.id
    and company_id = p_company_id;

  update public.customer_contracts
  set status = 'active',
      lifecycle_stage = 'active',
      actual_start_date = coalesce(actual_start_date, v_start_date),
      confirmed_start_date = coalesce(confirmed_start_date, v_start_date),
      billing_eligible_at = coalesce(billing_eligible_at, v_now),
      billing_eligibility_source = coalesce(
        billing_eligibility_source,
        'activate_customer_supply_v1'
      ),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'supply_period_id', v_period_id,
        'supplier_switch_request_id', v_switch.id,
        'activation_source_message_id', p_source_message_id
      ),
      updated_at = v_now
  where id = v_contract_id
    and company_id = p_company_id
    and customer_id = v_switch.customer_id
    and status in ('signed', 'active');

  if not found then
    raise exception 'supply_activation_contract_not_activatable' using errcode = '23514';
  end if;

  select workflow.* into v_workflow
  from public.customer_application_workflows workflow
  where workflow.company_id = p_company_id
    and workflow.customer_id = v_switch.customer_id
    and workflow.contract_id = v_contract_id
  order by created_at desc
  limit 1
  for update;

  if found then
    v_application_id := v_workflow.customer_application_id;

    insert into public.customer_application_workflow_events(
      company_id,
      workflow_id,
      customer_application_id,
      operation_id,
      from_state,
      to_state,
      event_code,
      actor_user_id,
      metadata,
      idempotency_key
    ) values (
      p_company_id,
      v_workflow.id,
      v_workflow.customer_application_id,
      v_workflow.operation_id,
      v_workflow.state,
      'completed',
      'workflow.supply_activated',
      p_actor_user_id,
      jsonb_build_object(
        'supply_period_id', v_period_id,
        'supplier_switch_request_id', v_switch.id,
        'actual_start_date', v_start_date
      ),
      v_key || ':workflow'
    )
    on conflict (company_id, idempotency_key) do nothing;

    update public.customer_application_workflows
    set state = 'completed',
        next_action = 'none',
        completed_at = coalesce(completed_at, v_now),
        last_transition_at = v_now,
        workflow_version = case
          when state = 'completed' then workflow_version
          else workflow_version + 1
        end,
        snapshot = coalesce(snapshot, '{}'::jsonb) || jsonb_build_object(
          'supply_period_id', v_period_id,
          'supplier_switch_request_id', v_switch.id,
          'actual_start_date', v_start_date,
          'billing_eligible_at', v_now,
          'next_action', 'none'
        ),
        updated_at = v_now
    where id = v_workflow.id;

    update public.website_customer_applications
    set status = 'active',
        actual_start_date = coalesce(actual_start_date, v_start_date),
        next_step = 'none',
        updated_at = v_now
    where id = v_application_id
      and company_id = p_company_id;
  end if;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    subject_customer_id,
    actor_user_id,
    source,
    idempotency_key,
    payload,
    occurred_at
  ) values (
    p_company_id,
    'supply.started',
    'customer_supply_period',
    v_period_id::text,
    v_switch.customer_id,
    p_actor_user_id,
    'activate_customer_supply_v1',
    v_key || ':domain_event',
    jsonb_build_object(
      'customer_id', v_switch.customer_id,
      'contract_id', v_contract_id,
      'customer_site_id', coalesce(v_switch.customer_site_id, v_switch.site_id),
      'metering_point_id', v_switch.metering_point_id,
      'supplier_switch_request_id', v_switch.id,
      'supply_period_id', v_period_id,
      'actual_start_date', v_start_date,
      'billing_eligible_at', v_now
    ),
    v_now
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id
    from public.domain_events
    where idempotency_key = v_key || ':domain_event';
  end if;

  insert into public.customer_operation_jobs(
    company_id,
    customer_id,
    customer_site_id,
    metering_point_id,
    job_type,
    status,
    priority,
    idempotency_key,
    payload,
    request_snapshot,
    run_after,
    created_by,
    updated_at
  ) values (
    p_company_id,
    v_switch.customer_id,
    coalesce(v_switch.customer_site_id, v_switch.site_id),
    v_switch.metering_point_id,
    'dispatch_lifecycle_notification',
    'queued',
    40,
    'lifecycle_notification:' || v_key || ':customer.welcome_active',
    jsonb_build_object(
      'event_type', 'supply_period.activated',
      'source_event_id', v_event_id,
      'contract_id', v_contract_id,
      'payload', jsonb_build_object(
        'start_date', v_start_date,
        'supply_period_id', v_period_id
      )
    ),
    jsonb_build_object(
      'domain_event_id', v_event_id,
      'supplier_switch_request_id', v_switch.id
    ),
    v_now,
    p_actor_user_id,
    v_now
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select id into v_job_id
    from public.customer_operation_jobs
    where company_id = p_company_id
      and job_type = 'dispatch_lifecycle_notification'
      and idempotency_key = 'lifecycle_notification:' || v_key || ':customer.welcome_active'
    order by created_at desc
    limit 1;
  end if;

  select external_tenant_reference into v_tenant_reference
  from public.companies
  where id = p_company_id;

  insert into public.webhook_deliveries(
    company_id,
    webhook_subscription_id,
    domain_event_id,
    event_type,
    max_attempts,
    target_url,
    idempotency_key,
    payload
  )
  select
    p_company_id,
    subscription.id,
    v_event_id,
    'supply.started',
    subscription.max_attempts,
    subscription.endpoint_url,
    format('webhook:%s:%s', subscription.id, v_event_id),
    jsonb_build_object(
      'id', v_event_id,
      'type', 'supply.started',
      'event_id', v_event_id,
      'event_type', 'supply.started',
      'created_at', v_now,
      'tenant_reference', v_tenant_reference,
      'customer_id', v_switch.customer_id,
      'aggregate', jsonb_build_object(
        'type', 'customer_supply_period',
        'id', v_period_id
      ),
      'data', jsonb_build_object(
        'contract_id', v_contract_id,
        'supplier_switch_request_id', v_switch.id,
        'supply_period_id', v_period_id,
        'actual_start_date', v_start_date
      )
    )
  from public.webhook_subscriptions subscription
  where subscription.company_id = p_company_id
    and subscription.status = 'active'
    and (
      '*' = any(coalesce(subscription.event_types, '{}'::text[]))
      or 'supply.started' = any(coalesce(subscription.event_types, '{}'::text[]))
    )
  on conflict (idempotency_key) do nothing;

  return query select
    v_switch.id,
    v_period_id,
    v_contract_id,
    v_application_id,
    v_workflow.id,
    v_event_id,
    v_job_id;
end;
$$;
