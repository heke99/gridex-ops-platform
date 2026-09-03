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
