-- End of supply for the current (losing) supplier.
--
-- When the grid owner reports that supply ends (PRODAT Z05:L = customer
-- switched to another supplier, possibly another tenant on this platform;
-- Z05:LK = the grid/customer relationship ends, i.e. move-out), the old
-- flow only stamped the supply period as 'ended'. That removed it from
-- billing, so the final partial period was never invoiced, the contract kept
-- running, and nothing handled break fee, final invoice or customer status.
--
-- gridex_end_customer_supply_v1 does it in one transaction, scoped to the
-- receiving tenant only. The other tenant's customer is never touched: each
-- tenant holds its own customer, site, metering point and contract rows.

create or replace function public.gridex_end_customer_supply_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_metering_point_id uuid,
  p_end_date date,
  p_end_reason text,
  p_source_message_id uuid default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_customer public.customers%rowtype;
  v_period public.customer_supply_periods%rowtype;
  v_contract public.customer_contracts%rowtype;
  v_contract_id uuid;
  v_now timestamptz := now();
  v_switch boolean := p_end_reason = 'supplier_switch';
  v_binding_end date;
  v_break_fee_review boolean := false;
  v_contract_ended boolean := false;
  v_remaining integer;
  v_new_status text;
  v_key text := coalesce(p_source_message_id::text, p_metering_point_id::text || ':' || p_end_date::text);
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'supply_end_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_metering_point_id is null
     or p_end_date is null or p_end_reason not in ('supplier_switch', 'move_out') then
    raise exception using errcode = '22023', message = 'supply_end_payload_invalid';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;

  -- The current period: open, or carrying only a planned end from a move-out registration.
  select * into v_period
  from public.customer_supply_periods
  where company_id = p_company_id
    and customer_id = p_customer_id
    and metering_point_id = p_metering_point_id
    and (status in ('active', 'confirmed_by_grid_owner')
         or (status = 'ended' and metadata->>'end_key' = v_key))
    and start_date <= p_end_date
  order by start_date desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active_supply_period_not_found';
  end if;

  -- Idempotent replay of the same end message.
  if v_period.actual_end_date = p_end_date
     and v_period.metadata->>'end_key' = v_key then
    return jsonb_build_object('supply_period_id', v_period.id, 'already_applied', true);
  end if;

  -- 'ended' is the market-confirmed end the Ediel closure review requires;
  -- billing still covers the period up to and including end_date.
  update public.customer_supply_periods
  set end_date = p_end_date,
      actual_end_date = p_end_date,
      status = 'ended',
      source_message_id = coalesce(p_source_message_id, source_message_id),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'end_reason', p_end_reason,
        'end_key', v_key,
        'ended_by_grid_owner_at', v_now
      ),
      updated_at = v_now
  where id = v_period.id;

  -- Supply that would have started after the end date can no longer start.
  update public.customer_supply_periods
  set status = 'cancelled',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancelled_by', 'supply_end', 'end_key', v_key),
      updated_at = v_now
  where company_id = p_company_id
    and customer_id = p_customer_id
    and metering_point_id = p_metering_point_id
    and status in ('active', 'confirmed_by_grid_owner')
    and start_date > p_end_date;

  v_contract_id := coalesce(v_period.customer_contract_id, v_period.contract_id);
  if v_contract_id is not null then
    select * into v_contract
    from public.customer_contracts
    where id = v_contract_id and company_id = p_company_id and customer_id = p_customer_id;

    -- End the contract only when no other metering point is still supplied under it.
    if found
       and v_contract.status in ('signed', 'active')
       and not exists (
         select 1 from public.customer_supply_periods other
         where other.company_id = p_company_id
           and coalesce(other.customer_contract_id, other.contract_id) = v_contract_id
           and other.id <> v_period.id
           and other.status in ('active', 'confirmed_by_grid_owner')
           and (coalesce(other.actual_end_date, other.end_date) is null
                or coalesce(other.actual_end_date, other.end_date) > p_end_date)
       ) then
      perform public.gridex_record_customer_contract_event_v1(
        p_company_id,
        v_contract_id,
        p_customer_id,
        'terminated',
        v_now,
        case when v_switch
          then 'Avtalet upphörde eftersom kunden bytte elleverantör.'
          else 'Avtalet upphörde eftersom kunden flyttade.' end,
        jsonb_build_object(
          'ends_at', p_end_date,
          'termination_notice_date', v_now,
          'termination_reason', p_end_reason,
          'reason_code', p_end_reason,
          'source_message_id', p_source_message_id
        ),
        p_actor_user_id,
        null,
        'supply-end:' || v_contract_id::text || ':' || v_key
      );
      v_contract_ended := true;

      -- A switch away inside the binding period may carry a break fee. Moving
      -- out does not. The fee must be reasonable and follow the contract terms,
      -- so it is never charged automatically; a person reviews it.
      if v_switch and coalesce(v_contract.binding_months, 0) > 0 and v_contract.starts_at is not null then
        v_binding_end := (v_contract.starts_at + make_interval(months => v_contract.binding_months))::date;
        if v_binding_end > p_end_date then
          v_break_fee_review := true;
          insert into public.customer_operation_tasks (
            company_id, customer_id, metering_point_id, task_type, status, priority,
            title, description, metadata
          ) values (
            p_company_id, p_customer_id, p_metering_point_id, 'break_fee_review', 'open', 'normal',
            'Bedöm brytavgift vid leverantörsbyte',
            'Kunden bytte elleverantör före bindningstidens slut. Bedöm om och vilken brytavgift avtalet medger.',
            jsonb_build_object(
              'contract_id', v_contract_id,
              'binding_months', v_contract.binding_months,
              'binding_ends_at', v_binding_end,
              'supply_end_date', p_end_date,
              'end_key', v_key
            )
          );
        end if;
      end if;
    end if;
  end if;

  -- Final invoice for the period up to the end date.
  if not exists (
    select 1 from public.customer_operation_tasks
    where company_id = p_company_id and customer_id = p_customer_id
      and task_type = 'final_invoice_pending'
      and metadata->>'end_key' = v_key
  ) then
    insert into public.customer_operation_tasks (
      company_id, customer_id, metering_point_id, task_type, status, priority,
      title, description, metadata
    ) values (
      p_company_id, p_customer_id, p_metering_point_id, 'final_invoice_pending', 'open', 'high',
      'Slutfaktura',
      'Leveransen upphörde ' || to_char(p_end_date, 'YYYY-MM-DD') || '. Invänta slutavläsningen och fakturera perioden till och med slutdatumet.',
      jsonb_build_object('supply_end_date', p_end_date, 'end_reason', p_end_reason, 'end_key', v_key)
    );
  end if;

  -- The customer stays as a historical record; only the status changes when nothing is supplied any more.
  select count(*) into v_remaining
  from public.customer_supply_periods
  where company_id = p_company_id
    and customer_id = p_customer_id
    and status in ('active', 'confirmed_by_grid_owner')
    and (coalesce(actual_end_date, end_date) is null or coalesce(actual_end_date, end_date) > p_end_date);

  v_new_status := v_customer.status;
  if v_remaining = 0 and v_customer.status in ('active', 'pending_verification') then
    v_new_status := case when v_switch then 'inactive' else 'moved' end;
    update public.customers
    set status = v_new_status,
        moved_out_at = case when v_switch then moved_out_at else p_end_date end,
        lifecycle_status_reason = case when v_switch
          then 'Kunden har bytt elleverantör.'
          else 'Kunden har flyttat.' end,
        updated_at = v_now
    where id = p_customer_id and company_id = p_company_id;
  end if;

  return jsonb_build_object(
    'supply_period_id', v_period.id,
    'already_applied', false,
    'contract_ended', v_contract_ended,
    'break_fee_review', v_break_fee_review,
    'customer_status', v_new_status
  );
end
$function$;

revoke all on function public.gridex_end_customer_supply_v1(uuid, uuid, uuid, date, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.gridex_end_customer_supply_v1(uuid, uuid, uuid, date, text, uuid, uuid) to service_role;
