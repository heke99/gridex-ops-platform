-- Automatically finalize a supplier switch exactly when Gridex becomes the active
-- electricity supplier. The transition is tenant-scoped, Z04-gated, date-gated,
-- idempotent and atomic so overlapping cron runs cannot partially or doubly
-- activate the same customer/site.
--
-- This RPC is service-role only. Interactive/admin flows keep their existing
-- guarded execution path.

create or replace function public.gridex_finalize_supplier_switch_activation(
  p_company_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.supplier_switch_requests%rowtype;
  v_site public.customer_sites%rowtype;
  v_point public.metering_points%rowtype;
  v_effective_date date;
  v_market_date date := (now() at time zone 'Europe/Stockholm')::date;
  v_now timestamptz := now();
begin
  if p_company_id is null or p_request_id is null or p_actor_user_id is null then
    raise exception 'supplier_switch_activation_scope_required';
  end if;

  select *
  into v_request
  from public.supplier_switch_requests
  where id = p_request_id
    and company_id = p_company_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_found',
      'reason_code', 'supplier_switch_not_found_in_tenant'
    );
  end if;

  if v_request.status = 'completed' then
    return jsonb_build_object(
      'status', 'already_completed',
      'request_id', v_request.id,
      'company_id', v_request.company_id,
      'effective_start_date', coalesce(v_request.confirmed_start_date, v_request.requested_start_date),
      'market_date', v_market_date
    );
  end if;

  if v_request.status <> 'accepted' then
    return jsonb_build_object(
      'status', 'blocked',
      'reason_code', 'supplier_switch_not_accepted',
      'request_status', v_request.status
    );
  end if;

  if coalesce(v_request.lifecycle_blocked, false) then
    return jsonb_build_object(
      'status', 'blocked',
      'reason_code', 'supplier_switch_lifecycle_blocked'
    );
  end if;

  if v_request.inbound_z04_message_id is null then
    return jsonb_build_object(
      'status', 'blocked',
      'reason_code', 'missing_z04_confirmation'
    );
  end if;

  if not exists (
    select 1
    from public.ediel_messages m
    where m.id = v_request.inbound_z04_message_id
      and m.company_id = p_company_id
      and m.direction = 'inbound'
      and m.message_family = 'PRODAT'
      and m.message_code = 'Z04'
  ) then
    return jsonb_build_object(
      'status', 'blocked',
      'reason_code', 'invalid_z04_confirmation'
    );
  end if;

  v_effective_date := coalesce(v_request.confirmed_start_date, v_request.requested_start_date);

  if v_effective_date is null then
    return jsonb_build_object(
      'status', 'blocked',
      'reason_code', 'missing_effective_start_date'
    );
  end if;

  if v_effective_date > v_market_date then
    return jsonb_build_object(
      'status', 'waiting',
      'reason_code', 'awaiting_effective_start_date',
      'effective_start_date', v_effective_date,
      'market_date', v_market_date
    );
  end if;

  select *
  into v_site
  from public.customer_sites
  where id = v_request.site_id
    and company_id = p_company_id
    and customer_id = v_request.customer_id
  for update;

  if not found then
    raise exception 'supplier_switch_site_tenant_mismatch';
  end if;

  if v_site.status = 'closed' then
    return jsonb_build_object(
      'status', 'blocked',
      'reason_code', 'supplier_switch_site_closed'
    );
  end if;

  if v_request.metering_point_id is not null then
    select *
    into v_point
    from public.metering_points
    where id = v_request.metering_point_id
      and company_id = p_company_id
      and site_id = v_request.site_id
      and (customer_id is null or customer_id = v_request.customer_id)
    for update;

    if not found then
      raise exception 'supplier_switch_metering_point_tenant_mismatch';
    end if;

    if v_point.status = 'closed' then
      return jsonb_build_object(
        'status', 'blocked',
        'reason_code', 'supplier_switch_metering_point_closed'
      );
    end if;
  end if;

  update public.customer_sites
  set current_supplier_name = v_request.incoming_supplier_name,
      current_supplier_org_number = v_request.incoming_supplier_org_number,
      status = 'active',
      grid_owner_id = coalesce(grid_owner_id, v_request.grid_owner_id),
      price_area_code = coalesce(price_area_code, v_request.price_area_code),
      updated_by = p_actor_user_id,
      updated_at = v_now
  where id = v_site.id
    and company_id = p_company_id
    and customer_id = v_request.customer_id;

  if v_request.metering_point_id is not null then
    update public.metering_points
    set status = 'active',
        grid_owner_id = coalesce(grid_owner_id, v_request.grid_owner_id),
        price_area_code = coalesce(price_area_code, v_request.price_area_code),
        updated_by = p_actor_user_id,
        updated_at = v_now
    where id = v_point.id
      and company_id = p_company_id
      and site_id = v_request.site_id;
  end if;

  update public.supplier_switch_requests
  set status = 'completed',
      completed_at = v_now,
      failure_reason = null,
      updated_by = p_actor_user_id,
      updated_at = v_now
  where id = v_request.id
    and company_id = p_company_id
    and status = 'accepted';

  if not found then
    raise exception 'supplier_switch_activation_state_changed';
  end if;

  insert into public.supplier_switch_events (
    company_id,
    switch_request_id,
    event_type,
    event_status,
    message,
    payload,
    created_by
  )
  values (
    p_company_id,
    v_request.id,
    'execution_completed',
    'completed',
    'Leveransen aktiverades automatiskt efter korrelerad inbound PRODAT Z04 och uppnått startdatum.',
    jsonb_build_object(
      'executionSource', 'automation_sweep',
      'effectiveStartDate', v_effective_date,
      'marketDate', v_market_date,
      'previousSupplierName', v_request.current_supplier_name,
      'newSupplierName', v_request.incoming_supplier_name,
      'siteId', v_request.site_id,
      'meteringPointId', v_request.metering_point_id,
      'inboundZ04MessageId', v_request.inbound_z04_message_id
    ),
    p_actor_user_id
  );

  return jsonb_build_object(
    'status', 'activated',
    'request_id', v_request.id,
    'company_id', p_company_id,
    'customer_id', v_request.customer_id,
    'site_id', v_request.site_id,
    'metering_point_id', v_request.metering_point_id,
    'effective_start_date', v_effective_date,
    'market_date', v_market_date
  );
end;
$$;

revoke execute on function public.gridex_finalize_supplier_switch_activation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_finalize_supplier_switch_activation(uuid, uuid, uuid)
  to service_role;

create or replace function public.gridex_process_ready_supplier_switch_activations(
  p_actor_user_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_market_date date := (now() at time zone 'Europe/Stockholm')::date;
  v_row record;
  v_activation jsonb;
  v_status text;
  v_activated integer := 0;
  v_already_completed integer := 0;
  v_waiting integer := 0;
  v_blocked integer := 0;
  v_failed integer := 0;
  v_scanned integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_activated_customers jsonb := '[]'::jsonb;
begin
  if p_actor_user_id is null then
    raise exception 'supplier_switch_activation_actor_required';
  end if;

  for v_row in
    select
      r.id,
      r.company_id,
      r.customer_id
    from public.supplier_switch_requests r
    where r.status = 'accepted'
      and r.company_id is not null
      and r.inbound_z04_message_id is not null
      and coalesce(r.confirmed_start_date, r.requested_start_date) is not null
      and coalesce(r.confirmed_start_date, r.requested_start_date) <= v_market_date
    order by coalesce(r.confirmed_start_date, r.requested_start_date), r.created_at, r.id
    limit v_limit
  loop
    v_scanned := v_scanned + 1;

    begin
      v_activation := public.gridex_finalize_supplier_switch_activation(
        v_row.company_id,
        v_row.id,
        p_actor_user_id
      );
      v_status := coalesce(v_activation->>'status', 'unknown');

      if v_status = 'activated' then
        v_activated := v_activated + 1;
        if not (v_activated_customers @> jsonb_build_array(v_row.customer_id::text)) then
          v_activated_customers := v_activated_customers || jsonb_build_array(v_row.customer_id::text);
        end if;
      elsif v_status = 'already_completed' then
        v_already_completed := v_already_completed + 1;
      elsif v_status = 'waiting' then
        v_waiting := v_waiting + 1;
      elsif v_status = 'blocked' then
        v_blocked := v_blocked + 1;
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'requestId', v_row.id,
          'companyId', v_row.company_id,
          'code', coalesce(v_activation->>'reason_code', 'supplier_switch_activation_blocked')
        ));
      else
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'requestId', v_row.id,
          'companyId', v_row.company_id,
          'code', coalesce(v_activation->>'reason_code', 'supplier_switch_activation_unexpected_result'),
          'status', v_status
        ));
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'requestId', v_row.id,
        'companyId', v_row.company_id,
        'code', 'supplier_switch_activation_failed',
        'message', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'marketDate', v_market_date,
    'scanned', v_scanned,
    'ready', v_scanned,
    'activated', v_activated,
    'alreadyCompleted', v_already_completed,
    'waiting', v_waiting,
    'blocked', v_blocked,
    'failed', v_failed,
    'failures', v_failures,
    'activatedCustomerIds', v_activated_customers
  );
end;
$$;

revoke execute on function public.gridex_process_ready_supplier_switch_activations(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.gridex_process_ready_supplier_switch_activations(uuid, integer)
  to service_role;
