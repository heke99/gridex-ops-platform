-- Z04 legacy adapters must use the unchanged immutable same-period activation.
-- Both recognized bodies are prevalidated before either replacement. No ledger,
-- canonical authority, caller clock, or historical migration is rewritten.
BEGIN;
DO $migration$
DECLARE
  plans jsonb := jsonb_build_array(
    jsonb_build_object('signature','public.gridex_finalize_supplier_switch_activation(uuid,uuid,uuid)','oldHash','2e6ff99f4dc704da085b056378dea9bcbc96a2fa032d2b4ba6581a8e9c423095','newHash','a6b5c2a1a881157866c2362a5fa008ca2c2092aa0c7b20dcc09bfd552c5da308','source',$automatic$
declare
  v_request public.supplier_switch_requests%rowtype;
  v_site public.customer_sites%rowtype;
  v_point public.metering_points%rowtype;
  v_effective_date date;
  v_market_date date := (now() at time zone 'Europe/Stockholm')::date;
  v_now timestamptz := now();
  v_canonical_count integer;
  v_canonical_rows jsonb;
begin
  if p_company_id is null or p_request_id is null or p_actor_user_id is null then
    raise exception 'supplier_switch_activation_scope_required';
  end if;

  perform gridex_bilateral_prodat.lock_supply_v1();

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

  select count(*), jsonb_agg(to_jsonb(effect))
  into v_canonical_count, v_canonical_rows
  from public.activate_customer_supply_v1(
    p_company_id, v_request.id, v_request.inbound_z04_message_id,
    null, p_actor_user_id, null
  ) effect;

  if v_canonical_count <> 1
     or v_canonical_rows #>> '{0,supplier_switch_request_id}' is distinct from v_request.id::text
     or not exists (
       select 1
       from gridex_received_sources.normal_switch_confirmations confirmation
       join gridex_received_sources.normal_supply_activations activation
         on activation.period_id = confirmation.period_id
        and activation.company_id = confirmation.company_id
        and activation.source_message_id = confirmation.source_message_id
       join public.customer_supply_periods current_period
         on current_period.id = activation.period_id
        and current_period.company_id = activation.company_id
       where confirmation.company_id = p_company_id
         and confirmation.switch_id = v_request.id
         and confirmation.source_message_id = v_request.inbound_z04_message_id
         and activation.actor_user_id = p_actor_user_id
         and activation.result is not distinct from v_canonical_rows -> 0
         and activation.resulting_period is not distinct from to_jsonb(current_period)
         and current_period.status = 'active'
         and current_period.source_switch_request_id = v_request.id
         and current_period.source_message_id = v_request.inbound_z04_message_id
         and current_period.id::text = v_canonical_rows #>> '{0,supply_period_id}'
     ) then
    raise exception 'supplier_switch_activation_canonical_receipt_required';
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
  set failure_reason = null,
      updated_by = p_actor_user_id
  where id = v_request.id
    and company_id = p_company_id
    and status = 'completed';

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
$automatic$),
    jsonb_build_object('signature','public.gridex_finalize_supplier_switch_v1(uuid,uuid,uuid,jsonb)','oldHash','a69f65d2472c856358e825f711910f1e9aef88d75062eed02b3589bd89c2b139','newHash','280657250589279b01ef7b114517e532fe13553f90b8ff1c862f72a68ebabf9b','source',$manual$
declare
  v_request public.supplier_switch_requests%rowtype;
  v_site_before public.customer_sites%rowtype;
  v_site_after public.customer_sites%rowtype;
  v_point_before public.metering_points%rowtype;
  v_point_after public.metering_points%rowtype;
  v_canonical_count integer;
  v_canonical_rows jsonb;
begin
  perform public.gridex_assert_switch_writer_v1(p_company_id);

  perform gridex_bilateral_prodat.lock_supply_v1();

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

  select count(*), jsonb_agg(to_jsonb(effect))
  into v_canonical_count, v_canonical_rows
  from public.activate_customer_supply_v1(
    p_company_id, v_request.id, v_request.inbound_z04_message_id,
    null, p_actor_user_id, null
  ) effect;

  if v_canonical_count <> 1
     or v_canonical_rows #>> '{0,supplier_switch_request_id}' is distinct from v_request.id::text
     or not exists (
       select 1
       from gridex_received_sources.normal_switch_confirmations confirmation
       join gridex_received_sources.normal_supply_activations activation
         on activation.period_id = confirmation.period_id
        and activation.company_id = confirmation.company_id
        and activation.source_message_id = confirmation.source_message_id
       join public.customer_supply_periods current_period
         on current_period.id = activation.period_id
        and current_period.company_id = activation.company_id
       where confirmation.company_id = p_company_id
         and confirmation.switch_id = v_request.id
         and confirmation.source_message_id = v_request.inbound_z04_message_id
         and activation.actor_user_id = p_actor_user_id
         and activation.result is not distinct from v_canonical_rows -> 0
         and activation.resulting_period is not distinct from to_jsonb(current_period)
         and current_period.status = 'active'
         and current_period.source_switch_request_id = v_request.id
         and current_period.source_message_id = v_request.inbound_z04_message_id
         and current_period.id::text = v_canonical_rows #>> '{0,supply_period_id}'
     ) then
    raise exception 'supplier_switch_activation_canonical_receipt_required';
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
  set updated_by = p_actor_user_id
  where id = p_request_id and company_id = p_company_id and status = 'completed'
  returning * into v_request;
  if not found then
    raise exception 'supplier_switch_activation_state_changed';
  end if;

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
$manual$)
  );
  prepared jsonb := '[]'::jsonb;
  plan jsonb; item jsonb; function_oid oid; source text; actual_hash text; definition text;
BEGIN
  FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
    function_oid := to_regprocedure(plan->>'signature');
    IF function_oid IS NULL THEN RAISE EXCEPTION 'z04_legacy_activation_predecessor_missing'; END IF;
    SELECT prosrc INTO STRICT source FROM pg_proc WHERE oid=function_oid;
    actual_hash := encode(sha256(convert_to(source,'UTF8')),'hex');
    IF actual_hash = plan->>'newHash' THEN CONTINUE; END IF;
    IF actual_hash IS DISTINCT FROM plan->>'oldHash' THEN
      RAISE EXCEPTION 'z04_legacy_activation_predecessor_unrecognized';
    END IF;
    IF encode(sha256(convert_to(plan->>'source','UTF8')),'hex') IS DISTINCT FROM plan->>'newHash' THEN
      RAISE EXCEPTION 'z04_legacy_activation_successor_checksum_mismatch';
    END IF;
    definition := pg_get_functiondef(function_oid);
    IF (length(definition)-length(replace(definition,source,''))) <> length(source) THEN
      RAISE EXCEPTION 'z04_legacy_activation_body_not_unique';
    END IF;
    prepared := prepared || jsonb_build_array(jsonb_build_object(
      'signature',plan->>'signature','newHash',plan->>'newHash',
      'definition',replace(definition,source,plan->>'source')));
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(prepared) LOOP
    EXECUTE item->>'definition';
    SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO actual_hash
      FROM pg_proc WHERE oid=to_regprocedure(item->>'signature');
    IF actual_hash IS DISTINCT FROM item->>'newHash' THEN
      RAISE EXCEPTION 'z04_legacy_activation_successor_installation_mismatch';
    END IF;
  END LOOP;
END $migration$;
COMMIT;
