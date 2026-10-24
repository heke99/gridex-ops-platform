-- A due contract remains active until its supply ends. Filter completed and
-- ineligible work before LIMIT so later contracts remain reachable. Row locks
-- serialize task creation per contract; a competing bounded invocation skips
-- locked contracts. No transport or customer operation is executed here.
begin;
do $bounded_progress$
declare
  f record;
  body text := $replacement$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Europe/Stockholm')::date);
  v_row record;
  v_created integer := 0;
  v_contract_ids uuid[] := '{}';
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_termination_service_role_required';
  end if;
  for v_row in
    select c.id, c.company_id, c.customer_id, c.termination_notice_date,
      (c.ended_at at time zone 'Europe/Stockholm')::date as planned_end,
      (select array_agg(sp.id order by sp.start_date, sp.id) from public.customer_supply_periods sp
        where sp.company_id = c.company_id and coalesce(sp.customer_contract_id, sp.contract_id) = c.id
          and sp.status in ('active', 'confirmed_by_grid_owner')
          and (coalesce(sp.actual_end_date, sp.end_date) is null
            or coalesce(sp.actual_end_date, sp.end_date) > (c.ended_at at time zone 'Europe/Stockholm')::date)) as period_ids,
      (select sp.metering_point_id from public.customer_supply_periods sp
        where sp.company_id = c.company_id and coalesce(sp.customer_contract_id, sp.contract_id) = c.id
          and sp.status in ('active', 'confirmed_by_grid_owner')
        order by sp.start_date desc, sp.id limit 1) as metering_point_id
    from public.customer_contracts c
    where (p_company_id is null or c.company_id = p_company_id)
      and c.status in ('signed', 'active')
      and c.termination_notice_date is not null
      and c.ended_at is not null
      and (c.ended_at at time zone 'Europe/Stockholm')::date <= v_as_of
      -- Qualify progress before the page boundary: already handled or ineligible
      -- contracts must not occupy the next bounded batch forever.
      and exists (
        select 1 from public.customer_supply_periods sp
        where sp.company_id = c.company_id and coalesce(sp.customer_contract_id, sp.contract_id) = c.id
          and sp.status in ('active', 'confirmed_by_grid_owner')
          and (coalesce(sp.actual_end_date, sp.end_date) is null
            or coalesce(sp.actual_end_date, sp.end_date) > (c.ended_at at time zone 'Europe/Stockholm')::date))
      and not exists (
        select 1 from public.customer_operation_tasks t
        where t.company_id = c.company_id and t.task_type = 'termination_end_of_supply_pending'
          and t.metadata->>'contract_id' = c.id::text
          and t.metadata->>'planned_end_date' = to_char((c.ended_at at time zone 'Europe/Stockholm')::date, 'YYYY-MM-DD'))
    order by c.company_id, c.id
    limit 500
    for update of c skip locked
  loop
    continue when v_row.period_ids is null;
    continue when exists (
      select 1 from public.customer_operation_tasks t
      where t.company_id = v_row.company_id and t.task_type = 'termination_end_of_supply_pending'
        and t.metadata->>'contract_id' = v_row.id::text
        and t.metadata->>'planned_end_date' = to_char(v_row.planned_end, 'YYYY-MM-DD'));
    insert into public.customer_operation_tasks (
      company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata
    ) values (
      v_row.company_id, v_row.customer_id, v_row.metering_point_id, 'termination_end_of_supply_pending', 'open', 'high',
      'Skicka avslut (Z08) till nätägaren',
      'Kundens uppsägningstid löpte ut ' || to_char(v_row.planned_end, 'YYYY-MM-DD')
        || ' och inget leverantörsbyte (Z05) har avslutat leveransen. Skicka ett avslut av leverans (Z08) till nätägaren. Inget skickas automatiskt.',
      jsonb_build_object('contract_id', v_row.id, 'termination_notice_date', v_row.termination_notice_date,
        'planned_end_date', v_row.planned_end, 'supply_period_ids', to_jsonb(v_row.period_ids), 'checked_on', v_as_of,
        'end_key', 'termination-expiry:' || v_row.id::text || ':' || to_char(v_row.planned_end, 'YYYY-MM-DD'),
        'sent_automatically', false)
    );
    v_created := v_created + 1;
    v_contract_ids := v_contract_ids || v_row.id;
  end loop;
  return jsonb_build_object('as_of', v_as_of, 'tasks_created', v_created, 'contract_ids', to_jsonb(v_contract_ids));
end
$replacement$;
begin
  select p.oid, p.prosrc, pg_get_functiondef(p.oid) as definition,
    to_jsonb(p) - 'prosrc' as metadata into strict f
  from pg_proc p where p.oid = 'public.gridex_termination_notice_expiry_tasks_v1(uuid,date)'::regprocedure;
  if encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc, 'UTF8')), 'hex') <> '9345c9a92f998ca1399a64032cf3360b622f77f8677e50274207bd4ec7b68a81'
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'termination_expiry_bounded_progress_source_unqualified' using errcode = 'P0U01';
  end if;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'termination_expiry_bounded_progress_metadata_changed' using errcode = 'P0U01';
  end if;
end
$bounded_progress$;
commit;
