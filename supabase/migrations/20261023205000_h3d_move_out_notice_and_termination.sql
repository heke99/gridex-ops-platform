-- FINDINGS H3d slice 2 (reports/h3d-move-out-notice.md D1, D2, D3, D6, D8, D9; H3c open items 1 and 2), owner decisions
-- 2026-10-23 B1, B3 and 20 (OWNER-DECISIONS.md rows 16, 18, 20).
--
-- B1 (move-out): the CONTRACT ends by its notice period, counted from the customer's notice date, for every customer
--   type; the SUPPLY (energy and fixed fees, decision 20) ends on the move-out day. A customer whose grid contract
--   ended has no supply either: the new close mode 'grid_contract_ended' ends the supply like a move-out, with its own
--   reason. Contract end = greatest(last supplied day, notice date + notice_months + notice days) (20261023204000), so it
--   may lie after the supply end; billing carries only the supplied days (20261023203000, D8).
-- D3: the customer's notice date is kept: an earlier registered termination_notice_date stands; otherwise the notice
--   date the operator entered (p_notice_date), else the Stockholm day of the close. It is never overwritten by now().
-- D9: the close writes the actual reason: 'move_out', 'grid_contract_ended', or 'customer_termination' (mode
--   'terminate'), never 'move_out' for a termination.
-- B3 (termination without a move): the supply continues until a new supplier takes over (Z05 from the grid owner).
--   * gridex_register_customer_termination_v1 records the termination on the customer's signed/active contracts
--     (termination_notice_received: the notice date, and ended_at = the planned end by the rule "Uppsägning mottagen"
--     already uses, gridex_contract_termination_end_v1). Status, supply, sites, points and open work are untouched.
--   * The close's mode 'terminate' delegates to it while any supply is ongoing after the given date (it no longer ends
--     the supply and closes the customer). Without ongoing supply it closes as before, with 'customer_termination'.
--   * gridex_termination_notice_expiry_tasks_v1 (customer-operations cron): when the planned end has been reached and
--     the contract is still signed/active with an open supply period (no new supplier's Z05 has ended it), it creates
--     ONE operator task 'termination_end_of_supply_pending' per contract and planned end: send an end of supply (Z08)
--     to the grid owner. Nothing is sent automatically. This is where "Uppsägning mottagen" now leads.
-- Z05 after a manual end (H3c open 1): a received end on a period the close ended manually (planned_end_* marker, no
--   end_key) now (a) corrects the terminated manual-end contract's ended_at to the received end when that end is later,
--   so billing keeps carrying the supplied days, and (b) keeps ONE final invoice per supply period: the close's open
--   'final_invoice_pending' task is updated with the received end (received_end_key); an already resolved one gets a
--   'final_invoice_correction_review' instead of a second final invoice. The Z05 contract event is unchanged, except
--   that an earlier registered notice date and a later planned contract end (B1/B3) are kept.
-- H3c open 2 (documented, not changed): a Z05 after gridex_end_customer_supply_v1('move_out') is refused by the received
--   source owners (z05_accepted_relationship_baseline_required) because that writer marks the period 'ended' without a
--   received end. The refusal is raised in gridex_received_sources.other_supply_scope_effect_v1 (DB-05 protected) and
--   apply_supply_before_legal_context_v1 (the approved AT-Z05 owner); neither is changed here. The writer has no app
--   caller; the customer card's close (which keeps the period's status and so accepts the Z05) is the operator path.
-- D6: the close (mode 'move_out'/'grid_contract_ended') keeps a pending move-in at another address: a site whose
--   pending switch request is a move-in (process_type/request_type 'move_in') and that has no supply ongoing at the
--   move-out date keeps its site, metering points, future supply periods, contracts, switch request and open tasks, and
--   the customer keeps its status (only moved_out_at and the lifecycle fields record the move).
-- gridex_end_customer_supply_v1 'move_out': the same B1/D3 contract end and notice date ('supplier_switch' unchanged).
--
-- gridex_close_customer_lifecycle_v2 is v1 with the parameter p_notice_date (default null) and the changes above; v1
-- keeps its signature and delegates with p_notice_date null. Exact-needle rewrites of the installed bodies (after
-- 20261023202000); refuses (h3d_notice_termination_rule_source_changed) unless every needle is present exactly once and
-- the H3d slice-2 marker is absent. Owner, ACL, security definer, volatility and configuration are preserved and checked
-- (h3d_notice_termination_metadata_changed); v2 gets v1's owner, ACL and configuration.
begin;

-- The lifecycle event types of the new modes.
alter table public.customer_lifecycle_events drop constraint customer_lifecycle_events_type_check;
alter table public.customer_lifecycle_events add constraint customer_lifecycle_events_type_check
  check (event_type = any (array['move_out'::text, 'terminate'::text, 'restore'::text, 'note'::text,
    'grid_contract_ended'::text, 'termination_registered'::text]));

create index if not exists customer_contracts_pending_termination_idx
  on public.customer_contracts (company_id, ended_at)
  where status in ('signed', 'active') and termination_notice_date is not null;

create function pg_temp.h3d2_rewrite(p_body text, p_old text[], p_new text[], p_label text) returns text
language plpgsql as $rewrite$
declare
  body text := p_body;
  i integer;
begin
  if position('H3d (20261023205000)' in body) <> 0 or cardinality(p_old) <> cardinality(p_new) then
    raise exception 'h3d_notice_termination_rule_source_changed:%', p_label using errcode = 'P0U01';
  end if;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'h3d_notice_termination_rule_source_changed:%:%', p_label, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  return body;
end
$rewrite$;

-- B3: register a termination without a move. The supply is not touched.
create function public.gridex_register_customer_termination_v1(
  p_company_id uuid, p_customer_id uuid, p_actor_user_id uuid, p_notice_date date, p_reason text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_customer public.customers%rowtype;
  v_contract record;
  v_notice_date date;
  v_planned_end date;
  v_contracts jsonb := '[]'::jsonb;
  v_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_lifecycle_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_actor_user_id is null or p_notice_date is null then
    raise exception using errcode = '22023', message = 'customer_lifecycle_payload_invalid';
  end if;
  select * into v_customer from public.customers
  where id = p_customer_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;
  if v_customer.status in ('archived', 'moved', 'terminated') then
    raise exception using errcode = '23514', message = 'customer_lifecycle_already_closed';
  end if;
  v_metadata := jsonb_build_object('mode', 'terminate', 'noticeDate', p_notice_date, 'reason', p_reason,
    'source', 'admin_customer_card', 'supplyContinues', true,
    'legalHandling', 'Termination without a move: the supply continues until a new supplier takes over (Z05); when the notice period has expired without a switch, an operator task asks for an end of supply (Z08) to the grid owner.');

  for v_contract in
    select c.id, c.status, c.starts_at, c.ends_at, c.binding_months, c.notice_months, c.termination_notice_date
    from public.customer_contracts c
    where c.company_id = p_company_id and c.customer_id = p_customer_id and c.status in ('signed', 'active')
    order by c.id
    for update
  loop
    -- D3: an earlier registered notice date stands.
    v_notice_date := coalesce(v_contract.termination_notice_date, p_notice_date);
    v_planned_end := public.gridex_contract_termination_end_v1(v_contract.starts_at, v_contract.ends_at,
      v_contract.binding_months, v_contract.notice_months,
      public.gridex_customer_contract_notice_days_v1(p_company_id, v_contract.id), v_notice_date);
    perform public.gridex_record_customer_contract_event_v1(
      p_company_id, v_contract.id, p_customer_id, 'termination_notice_received', v_notice_date::timestamptz,
      'Kunden sade upp avtalet utan flytt. Leveransen fortsätter tills en ny leverantör tar över.',
      v_metadata || jsonb_build_object('termination_reason', 'customer_termination', 'notice_end_date', v_planned_end),
      p_actor_user_id, v_planned_end::timestamptz,
      'customer-termination:' || v_contract.id::text || ':' || to_char(v_notice_date, 'YYYY-MM-DD'));
    v_contracts := v_contracts || jsonb_build_array(jsonb_build_object('contract_id', v_contract.id,
      'termination_notice_date', v_notice_date, 'planned_end_date', v_planned_end));
  end loop;
  if jsonb_array_length(v_contracts) = 0 then
    raise exception using errcode = '23514', message = 'customer_termination_contract_not_found';
  end if;

  if nullif(btrim(p_note), '') is not null then
    insert into public.customer_internal_notes (company_id, customer_id, body, created_by, updated_by)
    values (p_company_id, p_customer_id, p_note, p_actor_user_id, p_actor_user_id);
  end if;
  insert into public.customer_lifecycle_events (
    company_id, customer_id, event_type, event_status, effective_date, reason, payload, created_by
  ) values (
    p_company_id, p_customer_id, 'termination_registered', 'completed', p_notice_date, p_reason,
    v_metadata || jsonb_build_object('contracts', v_contracts), p_actor_user_id
  );

  return jsonb_build_object(
    'mode', 'terminate',
    'termination_registered', true,
    'supply_continues', true,
    'customer_before', to_jsonb(v_customer),
    'customer', to_jsonb(v_customer),
    'contracts', v_contracts,
    'failed_switch_request_ids', '[]'::jsonb,
    'lifecycle', v_metadata
  );
end
$$;

-- B3: the scheduled check when the notice period has expired without a switch.
create function public.gridex_termination_notice_expiry_tasks_v1(p_company_id uuid default null, p_as_of date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
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
    order by c.company_id, c.id
    limit 500
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
$$;

revoke all on function public.gridex_register_customer_termination_v1(uuid, uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.gridex_register_customer_termination_v1(uuid, uuid, uuid, date, text, text) to service_role;
revoke all on function public.gridex_termination_notice_expiry_tasks_v1(uuid, date) from public, anon, authenticated;
grant execute on function public.gridex_termination_notice_expiry_tasks_v1(uuid, date) to service_role;

do $h3d2$
declare
  v1 regprocedure := 'public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean)'::regprocedure;
  header_v1 constant text := 'CREATE OR REPLACE FUNCTION public.gridex_close_customer_lifecycle_v1(p_company_id uuid, p_customer_id uuid, p_actor_user_id uuid, p_mode text, p_move_out_date date, p_reason text, p_note text, p_create_follow_up_task boolean DEFAULT false)';
  header_v2 constant text := 'CREATE FUNCTION public.gridex_close_customer_lifecycle_v2(p_company_id uuid, p_customer_id uuid, p_actor_user_id uuid, p_mode text, p_move_out_date date, p_reason text, p_note text, p_create_follow_up_task boolean DEFAULT false, p_notice_date date DEFAULT NULL::date)';
  f record;
  g record;
  body text;
  v2 regprocedure;
  target regprocedure;
begin
  select p.oid, p.proowner, p.proacl, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = v1;
  if position('H3d (20261023202000)' in f.prosrc) = 0 or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1
    or (length(f.definition) - length(replace(f.definition, header_v1, ''))) / length(header_v1) <> 1
    or to_regprocedure('public.gridex_close_customer_lifecycle_v2(uuid,uuid,uuid,text,date,text,text,boolean,date)') is not null then
    raise exception 'h3d_notice_termination_rule_source_changed:close' using errcode = 'P0U01';
  end if;
  body := pg_temp.h3d2_rewrite(f.prosrc, array[
$o$  v_binding_end date;
begin$o$,
$o$     or p_mode not in ('move_out', 'terminate') or p_move_out_date is null then$o$,
$o$  if v_before.status in ('archived', 'moved', 'terminated') then
    raise exception using errcode = '23514', message = 'customer_lifecycle_already_closed';
  end if;
$o$,
$o$    case when v_terminate then 'Kund avslutad.' else 'Kunden har flyttat.' end);$o$,
$o$  set status = case when v_terminate then 'terminated' else 'moved' end,$o$,
$o$    where company_id = p_company_id and customer_id = p_customer_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_site_ids from closed;$o$,
$o$    and status in ('active', 'confirmed_by_grid_owner')
    and start_date > p_move_out_date;
  get diagnostics v_supply_cancelled = row_count;$o$,
$o$    select c.id, c.status
    from public.customer_contracts c
    where c.company_id = p_company_id
      and c.customer_id = p_customer_id
      and c.status in ('draft', 'pending_signature', 'signature_failed', 'signed', 'active')
    order by c.id
  loop
    v_event_type := case when v_contract.status in ('signed', 'active') then 'terminated' else 'cancelled' end;$o$,
$o$      case
        when v_terminate then$o$,
$o$      v_metadata || jsonb_build_object(
        'ends_at', p_move_out_date,
        'termination_notice_date', v_now,
        'termination_reason', 'move_out'
      ),$o$,
$o$    if v_event_type = 'terminated' then
      v_terminated_contract_ids := v_terminated_contract_ids || v_contract.id;
    end if;$o$,
$o$      and status in ('draft', 'queued', 'submitted', 'accepted')
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_switch_ids from failed;$o$,
$o$    and coalesce(task_type, '') not in ('final_invoice_pending', 'break_fee_review');$o$,
$o$        'Bedöm brytavgift vid flytt',
        'Kunden flyttade före bindningstidens slut. Bedöm om och vilken brytavgift avtalet medger. Inget debiteras automatiskt.',$o$,
$o$          'end_reason', 'move_out',
          'end_key', 'customer-lifecycle-close:' || p_customer_id::text || ':' || v_review_contract_id::text,$o$,
$o$    'break_fee_review_contract_ids', to_jsonb(v_review_contract_ids)
  );$o$
  ], array[
$n$  v_binding_end date;
  -- H3d (20261023205000)
  v_today date := (now() at time zone 'Europe/Stockholm')::date;
  v_grid boolean := p_mode = 'grid_contract_ended';
  v_reason text := case p_mode when 'terminate' then 'customer_termination' else p_mode end;
  v_ongoing integer := 0;
  v_notice_date date;
  v_notice_end date;
  v_contract_end date;
  v_contract_ends jsonb := '[]'::jsonb;
  v_move_in_site_ids uuid[] := '{}';
  v_move_in_contract_ids uuid[] := '{}';
begin$n$,
$n$     or p_mode not in ('move_out', 'terminate', 'grid_contract_ended') or p_move_out_date is null then$n$,
$n$  if v_before.status in ('archived', 'moved', 'terminated') then
    raise exception using errcode = '23514', message = 'customer_lifecycle_already_closed';
  end if;

  -- H3d (20261023205000), owner decision B3: a termination without a move while supply continues after the given date
  -- is registered on the contracts; the supply continues until a new supplier takes over (Z05), and an operator task
  -- asks for an end of supply (Z08) when the notice period has expired without a switch. Nothing is closed here.
  if v_terminate then
    select count(*) into v_ongoing
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id and sp.customer_id = p_customer_id
      and sp.status in ('active', 'confirmed_by_grid_owner', 'ending')
      and sp.start_date <= p_move_out_date
      and (coalesce(sp.actual_end_date, sp.end_date) is null or coalesce(sp.actual_end_date, sp.end_date) > p_move_out_date);
    if v_ongoing > 0 then
      return public.gridex_register_customer_termination_v1(p_company_id, p_customer_id, p_actor_user_id,
        coalesce(p_notice_date, p_move_out_date), p_reason, p_note);
    end if;
  else
    -- H3d D6: a pending move-in at another address (a site without supply ongoing at the move-out date) is kept.
    select coalesce(array_agg(distinct coalesce(r.customer_site_id, r.site_id)), '{}') into v_move_in_site_ids
    from public.supplier_switch_requests r
    where r.company_id = p_company_id and r.customer_id = p_customer_id
      and r.status in ('draft', 'queued', 'submitted', 'accepted')
      and (r.process_type = 'move_in' or r.request_type = 'move_in')
      and coalesce(r.customer_site_id, r.site_id) is not null
      and not exists (
        select 1 from public.customer_supply_periods sp
        join public.metering_points mp on mp.id = sp.metering_point_id and mp.company_id = sp.company_id
        where sp.company_id = p_company_id and sp.customer_id = p_customer_id
          and mp.site_id = coalesce(r.customer_site_id, r.site_id)
          and sp.status in ('active', 'confirmed_by_grid_owner', 'ending')
          and sp.start_date <= p_move_out_date);
    if cardinality(v_move_in_site_ids) > 0 then
      select coalesce(array_agg(distinct c.id), '{}') into v_move_in_contract_ids
      from public.customer_contracts c
      where c.company_id = p_company_id and c.customer_id = p_customer_id
        and (coalesce(coalesce(c.customer_site_id, c.site_id) = any (v_move_in_site_ids), false)
          or exists (select 1 from public.metering_points mp where mp.id = c.metering_point_id and mp.company_id = p_company_id
            and mp.site_id = any (v_move_in_site_ids))
          or exists (select 1 from public.supplier_switch_requests r where r.company_id = p_company_id and r.customer_id = p_customer_id
            and r.status in ('draft', 'queued', 'submitted', 'accepted') and (r.process_type = 'move_in' or r.request_type = 'move_in')
            and coalesce(r.customer_site_id, r.site_id) = any (v_move_in_site_ids)
            and c.id in (r.customer_contract_id, r.contract_id)));
    end if;
  end if;
$n$,
$n$    case when v_terminate then 'Kund avslutad.' when v_grid then 'Nätavtalet har upphört.' else 'Kunden har flyttat.' end);$n$,
$n$  set status = case when cardinality(v_move_in_site_ids) > 0 then v_before.status
                     when v_terminate then 'terminated' when v_grid then 'inactive' else 'moved' end,$n$,
$n$    where company_id = p_company_id and customer_id = p_customer_id
      and not (id = any (v_move_in_site_ids))
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_site_ids from closed;$n$,
$n$    and status in ('active', 'confirmed_by_grid_owner')
    and start_date > p_move_out_date
    and not exists (select 1 from public.metering_points mp where mp.id = customer_supply_periods.metering_point_id
      and mp.company_id = p_company_id and mp.site_id = any (v_move_in_site_ids));
  get diagnostics v_supply_cancelled = row_count;$n$,
$n$    select c.id, c.status, c.notice_months, c.termination_notice_date
    from public.customer_contracts c
    where c.company_id = p_company_id
      and c.customer_id = p_customer_id
      and c.status in ('draft', 'pending_signature', 'signature_failed', 'signed', 'active')
      and not (c.id = any (v_move_in_contract_ids))
    order by c.id
  loop
    v_event_type := case when v_contract.status in ('signed', 'active') then 'terminated' else 'cancelled' end;
    -- H3d (20261023205000), owner decision B1 and D3: the contract ends by its notice period counted from the
    -- customer's notice date (an earlier registered date stands), never before the last supplied day; the supply ends
    -- on the move-out date regardless (decision 20). An unsigned contract is cancelled on the date.
    v_notice_date := coalesce(v_contract.termination_notice_date, p_notice_date, v_today);
    v_notice_end := public.gridex_contract_notice_end_v1(v_notice_date, v_contract.notice_months,
      public.gridex_customer_contract_notice_days_v1(p_company_id, v_contract.id));
    v_contract_end := case when v_event_type = 'terminated' then greatest(p_move_out_date, v_notice_end) else p_move_out_date end;$n$,
$n$      case
        when v_grid then
          case when v_event_type = 'terminated' then 'Avtalet avslutades' else 'Avtalsprocessen avbröts' end
          || ' eftersom kundens nätavtal upphörde.'
        when v_terminate then$n$,
$n$      v_metadata || jsonb_build_object(
        'ends_at', p_move_out_date,
        'ended_at', v_contract_end,
        'termination_notice_date', v_notice_date,
        'termination_reason', v_reason,
        'supply_end_date', p_move_out_date,
        'notice_end_date', v_notice_end
      ),$n$,
$n$    if v_event_type = 'terminated' then
      v_terminated_contract_ids := v_terminated_contract_ids || v_contract.id;
    end if;
    v_contract_ends := v_contract_ends || jsonb_build_array(jsonb_build_object('contract_id', v_contract.id,
      'event_type', v_event_type, 'termination_notice_date', v_notice_date, 'notice_end_date', v_notice_end,
      'ended_at', v_contract_end, 'termination_reason', v_reason));$n$,
$n$      and status in ('draft', 'queued', 'submitted', 'accepted')
      and not coalesce(coalesce(customer_site_id, site_id) = any (v_move_in_site_ids), false)
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_switch_ids from failed;$n$,
$n$    and coalesce(task_type, '') not in ('final_invoice_pending', 'break_fee_review')
    and not coalesce(site_id = any (v_move_in_site_ids), false)
    and not coalesce(metering_point_id in (select mp.id from public.metering_points mp
      where mp.company_id = p_company_id and mp.site_id = any (v_move_in_site_ids)), false);$n$,
$n$        case when v_grid then 'Bedöm brytavgift när nätavtalet upphört' else 'Bedöm brytavgift vid flytt' end,
        case when v_grid
          then 'Kundens nätavtal upphörde före bindningstidens slut. Bedöm om och vilken brytavgift avtalet medger. Inget debiteras automatiskt.'
          else 'Kunden flyttade före bindningstidens slut. Bedöm om och vilken brytavgift avtalet medger. Inget debiteras automatiskt.' end,$n$,
$n$          'end_reason', p_mode,
          'end_key', 'customer-lifecycle-close:' || p_customer_id::text || ':' || v_review_contract_id::text,$n$,
$n$    'break_fee_review_contract_ids', to_jsonb(v_review_contract_ids),
    'mode', p_mode,
    'contract_ends', v_contract_ends,
    'kept_move_in_site_ids', to_jsonb(v_move_in_site_ids),
    'kept_move_in_contract_ids', to_jsonb(v_move_in_contract_ids)
  );$n$
  ], 'close');

  -- v2: v1's definition with the new name, the notice-date parameter and the rewritten body.
  execute replace(replace(f.definition, f.prosrc, body), header_v1, header_v2);
  v2 := 'public.gridex_close_customer_lifecycle_v2(uuid,uuid,uuid,text,date,text,text,boolean,date)'::regprocedure;
  execute format('alter function %s owner to %I', v2, pg_get_userbyid(f.proowner));
  execute format('revoke all on function %s from public, anon, authenticated', v2);
  for g in select distinct a.grantee from aclexplode(f.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> f.proowner and a.grantee <> 0 loop
    execute format('grant execute on function %s to %I', v2, pg_get_userbyid(g.grantee));
  end loop;
  if (select (to_jsonb(p) - ARRAY['prosrc','oid','proname','proargtypes','pronargs','pronargdefaults','proargnames','proargdefaults','proacl'])
        from pg_proc p where p.oid = v2)
      is distinct from (f.metadata - ARRAY['oid','proname','proargtypes','pronargs','pronargdefaults','proargnames','proargdefaults','proacl'])
    or (select p.prosrc from pg_proc p where p.oid = v2) is distinct from body
    or (select array_agg(row(a.grantee, a.privilege_type)::text order by a.grantee, a.privilege_type) from pg_proc p, aclexplode(p.proacl) a where p.oid = v2)
      is distinct from (select array_agg(row(a.grantee, a.privilege_type)::text order by a.grantee, a.privilege_type) from aclexplode(f.proacl) a) then
    raise exception 'h3d_notice_termination_metadata_changed:close_v2' using errcode = 'P0U01';
  end if;

  -- v1 keeps its signature, owner, ACL and configuration and delegates (no notice date).
  body := $v1$
begin
  -- H3d (20261023205000): the close lives in gridex_close_customer_lifecycle_v2, which also takes the customer's notice
  -- date. v1 keeps its signature for existing callers: an earlier registered notice date, else the Stockholm day.
  return public.gridex_close_customer_lifecycle_v2(p_company_id, p_customer_id, p_actor_user_id, p_mode,
    p_move_out_date, p_reason, p_note, p_create_follow_up_task, null);
end
$v1$;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h3d_notice_termination_metadata_changed:close_v1' using errcode = 'P0U01';
  end if;

  -- gridex_end_customer_supply_v1: B1/D3 for 'move_out' ('supplier_switch' keeps the end date).
  target := 'public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid)'::regprocedure;
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = target;
  if position('H3d (20261023202000)' in f.prosrc) = 0 or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'h3d_notice_termination_rule_source_changed:end_supply' using errcode = 'P0U01';
  end if;
  body := pg_temp.h3d2_rewrite(f.prosrc, array[
$o$        jsonb_build_object(
          'ends_at', p_end_date,
          'termination_notice_date', v_now,
          'termination_reason', p_end_reason,$o$
  ], array[
$n$        jsonb_build_object(
          'ends_at', p_end_date,
          -- H3d (20261023205000), owner decision B1 and D3: a move-out contract ends by its notice period from the
          -- customer's notice date (an earlier registered date stands, else today), never before the last supplied day.
          'ended_at', case when v_switch then p_end_date else greatest(p_end_date, public.gridex_contract_notice_end_v1(
            coalesce(v_contract.termination_notice_date, (v_now at time zone 'Europe/Stockholm')::date), v_contract.notice_months,
            public.gridex_customer_contract_notice_days_v1(p_company_id, v_contract_id))) end,
          'termination_notice_date', coalesce(v_contract.termination_notice_date::timestamptz, v_now),
          'termination_reason', p_end_reason,$n$
  ], 'end_supply');
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h3d_notice_termination_metadata_changed:end_supply' using errcode = 'P0U01';
  end if;

  -- gridex_supply_end_followup_v1 (Z05): H3c open 1 and the one final invoice per period; B1/D3 for a registered notice.
  target := 'public.gridex_supply_end_followup_v1()'::regprocedure;
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = target;
  if position('H3d (20261023202000)' in f.prosrc) = 0 or not (f.metadata->>'prosecdef')::boolean
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'h3d_notice_termination_rule_source_changed:followup' using errcode = 'P0U01';
  end if;
  body := pg_temp.h3d2_rewrite(f.prosrc, array[
$o$     AND t.task_type = 'final_invoice_pending' AND t.metadata->>'end_key' = v_key) THEN$o$,
$o$          jsonb_build_object('ends_at', v_end, 'termination_notice_date', now(), 'termination_reason', 'supply_end',
            'reason_code', 'supply_end', 'source_message_id', NEW.source_message_id),$o$,
$o$        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
  VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'final_invoice_pending', 'open', 'high', 'Slutfaktura',$o$
  ], array[
$n$     AND t.task_type = 'final_invoice_pending' AND (t.metadata->>'end_key' = v_key OR t.metadata->>'received_end_key' = v_key)) THEN$n$,
$n$          jsonb_build_object('ends_at', v_end, 'termination_notice_date', coalesce(v_contract.termination_notice_date::timestamptz, now()), 'termination_reason', 'supply_end',
            'reason_code', 'supply_end', 'source_message_id', NEW.source_message_id)
          -- H3d (20261023205000), owner decisions B1/B3 and D3: an earlier registered notice date stands, and a planned
          -- contract end after the received end (the notice period runs on) is kept; billing stops at the supply end.
          || CASE WHEN v_contract.termination_notice_date IS NOT NULL AND v_contract.ended_at IS NOT NULL
               AND (v_contract.ended_at AT TIME ZONE 'Europe/Stockholm')::date > v_end
             THEN jsonb_build_object('ended_at', v_contract.ended_at) ELSE '{}'::jsonb END,$n$,
$n$        END IF;
      END IF;
    -- H3d (20261023205000), H3c open 1: a received end after a manual end (the close terminated the contract on the
    -- move-out day, 'move_out'/'grid_contract_ended'/'customer_termination') that ends LATER corrects the contract's
    -- end to the received end, so the supplied days stay billable (20261023203000). An earlier received end needs no
    -- correction: the contract may end after its supply.
    ELSIF FOUND AND v_contract.status = 'terminated'
      AND v_contract.termination_reason IN ('move_out', 'grid_contract_ended', 'customer_termination')
      AND v_contract.ended_at IS NOT NULL
      AND greatest((v_contract.ended_at AT TIME ZONE 'UTC')::date, (v_contract.ended_at AT TIME ZONE 'Europe/Stockholm')::date) < v_end THEN
      UPDATE public.customer_contracts
      SET ended_at = (v_end::timestamp AT TIME ZONE 'Europe/Stockholm'),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('ended_at_corrected_by_received_end',
            jsonb_build_object('previous_ended_at', v_contract.ended_at, 'supply_end_date', v_end, 'end_key', v_key,
              'supply_period_id', NEW.id, 'corrected_at', now())),
          updated_at = now()
      WHERE id = v_contract_id AND company_id = NEW.company_id AND customer_id = NEW.customer_id;
    END IF;
  END IF;

  -- H3d (20261023205000), H3c open 1: one final invoice per supply period. The close's open final invoice for this
  -- period takes the received end; an already resolved one gets a correction review instead of a second final invoice.
  UPDATE public.customer_operation_tasks t
  SET metadata = t.metadata || jsonb_build_object('supply_end_date', v_end, 'received_end_key', v_key,
        'received_end_reason', 'supply_end', 'manual_supply_end_date', t.metadata->'supply_end_date',
        'corrected_by_received_end_at', now()),
      description = 'Leveransen upphör ' || to_char(v_end, 'YYYY-MM-DD') || ' enligt nätägarens besked (ersätter det manuella slutet '
        || coalesce(t.metadata->>'supply_end_date', '') || '). Invänta slutavläsningen och fakturera perioden till och med slutdatumet.'
  WHERE t.company_id = NEW.company_id AND t.customer_id = NEW.customer_id AND t.task_type = 'final_invoice_pending'
    AND t.status IN ('open', 'in_progress', 'blocked') AND t.metadata->>'supply_period_id' = NEW.id::text;
  IF FOUND THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks t WHERE t.company_id = NEW.company_id AND t.customer_id = NEW.customer_id
      AND t.task_type = 'final_invoice_pending' AND t.status <> 'cancelled' AND t.metadata->>'supply_period_id' = NEW.id::text) THEN
    IF NOT EXISTS (SELECT 1 FROM public.customer_operation_tasks t WHERE t.company_id = NEW.company_id AND t.customer_id = NEW.customer_id
        AND t.task_type = 'final_invoice_correction_review' AND t.metadata->>'received_end_key' = v_key) THEN
      INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
      VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'final_invoice_correction_review', 'open', 'high', 'Kontrollera slutfakturan',
        'Nätägaren anger leveransslut ' || to_char(v_end, 'YYYY-MM-DD') || ' efter att slutfakturan redan hanterats. Kontrollera om slutfakturan behöver rättas.',
        jsonb_build_object('supply_end_date', v_end, 'end_reason', 'supply_end', 'received_end_key', v_key, 'supply_period_id', NEW.id));
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
  VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'final_invoice_pending', 'open', 'high', 'Slutfaktura',$n$
  ], 'followup');
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h3d_notice_termination_metadata_changed:followup' using errcode = 'P0U01';
  end if;
end
$h3d2$;

drop function pg_temp.h3d2_rewrite(text, text[], text[], text);

commit;
