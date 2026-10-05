-- Atomic supplier-switch writes.
--
-- The switch request and its event history were written as separate app
-- calls: a request could exist without its "created" event, and a status
-- change could land without the event that explains it (or the reverse).
-- These commands keep the business decisions in the app (start-date policy,
-- own-supplier resolution, readiness) but write each step in one transaction,
-- always inside the request's tenant.
--
-- Callers are the service role or an authenticated user who can write the
-- company (the same rule as the table's RLS policies).

create or replace function public.gridex_assert_switch_writer_v1(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_catalog', 'pg_temp'
as $function$
begin
  if p_company_id is null then
    raise exception using errcode = '22023', message = 'supplier_switch_company_required';
  end if;
  if auth.role() = 'service_role' then
    return;
  end if;
  if not public.gridex_can_write_company(p_company_id) then
    raise exception using errcode = '42501', message = 'supplier_switch_write_not_allowed';
  end if;
end
$function$;

-- Creates the request and its "created" event together. A repeated
-- automation key returns the open request it already created.
create or replace function public.gridex_create_supplier_switch_v1(
  p_company_id uuid,
  p_request jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_row public.supplier_switch_requests%rowtype;
  v_existing public.supplier_switch_requests%rowtype;
  v_key text := nullif(p_request->>'automation_key', '');
  v_payload jsonb;
  v_columns text;
begin
  perform public.gridex_assert_switch_writer_v1(p_company_id);

  if v_key is not null then
    select * into v_existing
    from public.supplier_switch_requests
    where company_id = p_company_id
      and automation_key = v_key
      and status in ('draft', 'queued', 'submitted', 'accepted', 'cancellation_requested',
        'cancellation_sent', 'manual_followup_required', 'pending', 'ready', 'prepared',
        'in_progress', 'sent', 'waiting_response', 'awaiting_confirmation', 'confirmed')
    limit 1;
    if found then
      return jsonb_build_object('request', to_jsonb(v_existing), 'existing', true);
    end if;
  end if;

  -- Insert only the columns the caller sent so table defaults still apply;
  -- the tenant always comes from p_company_id.
  v_payload := (p_request - 'company_id') || jsonb_build_object('company_id', p_company_id);
  select string_agg(quote_ident(key), ', ' order by key) into v_columns
  from jsonb_object_keys(v_payload) as key
  where key in (
    select attname from pg_attribute
    where attrelid = 'public.supplier_switch_requests'::regclass and attnum > 0 and not attisdropped
  );
  execute format(
    'insert into public.supplier_switch_requests (%1$s) select %1$s from jsonb_populate_record(null::public.supplier_switch_requests, $1) returning *',
    v_columns
  ) into v_row using v_payload;

  insert into public.supplier_switch_events (
    switch_request_id, event_type, event_status, message, payload, company_id, created_by
  ) values (
    v_row.id,
    coalesce(p_event->>'event_type', 'created'),
    coalesce(p_event->>'event_status', 'success'),
    p_event->>'message',
    coalesce(p_event->'payload', '{}'::jsonb),
    p_company_id,
    nullif(p_event->>'created_by', '')::uuid
  );

  return jsonb_build_object('request', to_jsonb(v_row), 'existing', false);
end
$function$;

-- Applies a status/field change to a request and records its event together.
-- Only whitelisted operational columns can change; identity and tenant
-- columns cannot be moved through this command.
create or replace function public.gridex_transition_supplier_switch_v1(
  p_company_id uuid,
  p_request_id uuid,
  p_patch jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
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

  return jsonb_build_object('before', to_jsonb(v_before), 'request', to_jsonb(v_after));
end
$function$;

-- Completes an accepted switch: the site and metering point become the new
-- supplier's, the request is completed and the event recorded, together.
create or replace function public.gridex_finalize_supplier_switch_v1(
  p_company_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_request public.supplier_switch_requests%rowtype;
  v_site_before public.customer_sites%rowtype;
  v_site_after public.customer_sites%rowtype;
  v_point_before public.metering_points%rowtype;
  v_point_after public.metering_points%rowtype;
begin
  perform public.gridex_assert_switch_writer_v1(p_company_id);

  select * into v_request
  from public.supplier_switch_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'supplier_switch_not_found_for_tenant';
  end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('already_completed', true, 'request', to_jsonb(v_request));
  end if;
  if v_request.status <> 'accepted' or v_request.inbound_z04_message_id is null then
    raise exception using errcode = '23514', message = 'supplier_switch_finalize_requires_accepted_z04';
  end if;

  select * into v_site_before
  from public.customer_sites
  where id = v_request.site_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'supplier_switch_site_not_found_for_tenant';
  end if;

  update public.customer_sites
  set current_supplier_name = v_request.incoming_supplier_name,
      current_supplier_org_number = v_request.incoming_supplier_org_number,
      status = case when status = 'closed' then 'closed' else 'active' end,
      grid_owner_id = coalesce(grid_owner_id, v_request.grid_owner_id),
      price_area_code = coalesce(price_area_code, v_request.price_area_code),
      updated_by = p_actor_user_id
  where id = v_site_before.id
  returning * into v_site_after;

  if v_request.metering_point_id is not null then
    select * into v_point_before
    from public.metering_points
    where id = v_request.metering_point_id and company_id = p_company_id
    for update;
    if found then
      update public.metering_points
      set status = case when status = 'closed' then 'closed' else 'active' end,
          grid_owner_id = coalesce(grid_owner_id, v_request.grid_owner_id),
          price_area_code = coalesce(price_area_code, v_request.price_area_code),
          updated_by = p_actor_user_id
      where id = v_point_before.id
      returning * into v_point_after;
    end if;
  end if;

  update public.supplier_switch_requests
  set status = 'completed', completed_at = now(), updated_by = p_actor_user_id, updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.supplier_switch_events (
    switch_request_id, event_type, event_status, message, payload, company_id, created_by
  ) values (
    p_request_id,
    coalesce(p_event->>'event_type', 'execution_completed'),
    coalesce(p_event->>'event_status', 'completed'),
    p_event->>'message',
    coalesce(p_event->'payload', '{}'::jsonb) || jsonb_build_object(
      'siteStatusBefore', v_site_before.status,
      'siteStatusAfter', v_site_after.status,
      'meteringPointStatusBefore', v_point_before.status,
      'meteringPointStatusAfter', v_point_after.status
    ),
    p_company_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'already_completed', false,
    'request', to_jsonb(v_request),
    'site_before', to_jsonb(v_site_before),
    'site_after', to_jsonb(v_site_after),
    'metering_point_before', case when v_point_before.id is null then null else to_jsonb(v_point_before) end,
    'metering_point_after', case when v_point_after.id is null then null else to_jsonb(v_point_after) end
  );
end
$function$;

revoke all on function public.gridex_assert_switch_writer_v1(uuid) from public, anon;
revoke all on function public.gridex_create_supplier_switch_v1(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.gridex_transition_supplier_switch_v1(uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.gridex_finalize_supplier_switch_v1(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.gridex_create_supplier_switch_v1(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.gridex_transition_supplier_switch_v1(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.gridex_finalize_supplier_switch_v1(uuid, uuid, uuid, jsonb) to authenticated, service_role;
