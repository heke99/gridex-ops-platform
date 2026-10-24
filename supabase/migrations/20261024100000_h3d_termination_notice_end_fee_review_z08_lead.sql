-- FINDINGS H3d (reports/h3d-move-out-notice.md), owner decisions 2026-10-24 B5, B6 and B7 (OWNER-DECISIONS.md rows 21-23).
--
-- B5 "Uppsägningstid + avgiftsgranskning": a termination WITHOUT a move inside the binding period ends the contract after
--   its notice period (notice date + notice_months + notice days), no longer at the later of the notice end and the
--   binding end (slice 2, 20261023204000/205000). Inside the binding the operator gets one fee review
--   ('break_fee_review', one per contract, the mechanism of 20261023202000) and decides on a break fee; nothing is ever
--   charged automatically.
--   * gridex_contract_termination_end_v1 (the planned end of "Uppsägning mottagen" and of
--     gridex_register_customer_termination_v1): the notice end; without a notice date the agreed ends_at as before. Its
--     binding parameters are kept for the signature and no longer read. TypeScript mirror:
--     lib/customer-contracts/lifecycle.ts contractTerminationEndDate.
--   * gridex_termination_break_fee_review_v1 (new): the review for a registered termination. Binding start = the rule
--     of 20261023202000 (actual/confirmed start, else the first supplied day under the contract, else the planned
--     start; H6); binding end = start + binding_months; due when binding end > planned contract end + 1 (the planned end
--     is the last contract day, as the last supplied day of a move-out). Called by gridex_register_customer_termination_v1
--     (the customer card's "Uppsägning", supply continues), by gridex_close_customer_lifecycle_v2 mode 'terminate'
--     without ongoing supply, and by the contract card's "Uppsägning mottagen" (lib/customer-contracts/db.ts).
-- B6 "I god tid före slutet": the operator task 'termination_end_of_supply_pending' (send Z08 to the grid owner) is
--   created c_lead_days = 14 calendar days BEFORE the planned contract end, with due_at = the planned end. The Ediel
--   registers define no lead time for a supplier's end of supply: the only Z08 deadline is Z08H "senast den dag hävningen
--   träder i kraft" (lib/ediel/rulebook/deadlinePolicy.ts, docs/ediel/masterplan-v2/registers/timers.json TM-Z08-H), so
--   the owner's 14 days apply (the same 14 calendar days a new supplier's Z03L needs before a delivery start). TypeScript
--   constant: lib/customer-contracts/terminationNoticeExpiry.ts TERMINATION_Z08_TASK_LEAD_DAYS (returned as lead_days).
--   The task is closed automatically (status 'cancelled', closed_automatically, closed_reason) when a received end
--   (a new supplier's Z05) ends the supply first (gridex_supply_end_followup_v1, 'supply_ended_by_received_end'), and the
--   daily check closes any open task whose contract no longer has supply beyond the planned end
--   ('supply_ended_before_z08'). An automatically closed task does not block a new one if supply resumes.
-- B7 "Behåll planerat slut" (already in slice 2, unchanged): a Z05 L before the planned end keeps the later planned end
--   and gets a fee review inside the binding; with B5 a registered termination inside the binding already has its one
--   review, so the Z05 creates none (one per contract).
--
-- Exact-needle rewrites of the installed bodies (20261023204000/205000); refuses (h3d_termination_b5_rule_source_changed)
-- unless every needle is present exactly once and the marker 'H3d (20261024100000)' is absent. Owner, ACL, security,
-- volatility and configuration are preserved and checked (h3d_termination_b5_metadata_changed).
begin;

create function pg_temp.h3d3_rewrite(p_target regprocedure, p_old text[], p_new text[]) returns void
language plpgsql as $rewrite$
declare
  f record;
  body text;
  i integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = p_target;
  if position('H3d (20261024100000)' in f.prosrc) <> 0
    or cardinality(p_old) <> cardinality(p_new)
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'h3d_termination_b5_rule_source_changed:%', p_target using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'h3d_termination_b5_rule_source_changed:%:%', p_target, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'h3d_termination_b5_metadata_changed:%', p_target using errcode = 'P0U01';
  end if;
end
$rewrite$;

-- B5: the fee review of a registered termination inside the binding period (one per contract).
create function public.gridex_termination_break_fee_review_v1(p_company_id uuid, p_customer_contract_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_contract public.customer_contracts%rowtype;
  v_planned_end date;
  v_binding_start date;
  v_binding_end date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_termination_service_role_required';
  end if;
  if p_company_id is null or p_customer_contract_id is null then
    raise exception using errcode = '22023', message = 'customer_termination_payload_invalid';
  end if;
  select * into v_contract from public.customer_contracts
  where id = p_customer_contract_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_contract_not_found_for_tenant';
  end if;
  -- A registered termination: signed/active with a notice date (supply continues), or closed as a customer
  -- termination (no supply ongoing). A move-out or a supply end has its own review (20261023202000).
  if v_contract.termination_notice_date is null or v_contract.ended_at is null
    or not (v_contract.status in ('signed', 'active')
      or (v_contract.status = 'terminated' and v_contract.termination_reason = 'customer_termination')) then
    return jsonb_build_object('contract_id', p_customer_contract_id, 'review_due', false, 'reason', 'no_registered_termination');
  end if;
  if coalesce(v_contract.binding_months, 0) <= 0 then
    return jsonb_build_object('contract_id', p_customer_contract_id, 'review_due', false, 'reason', 'no_binding');
  end if;
  v_planned_end := (v_contract.ended_at at time zone 'Europe/Stockholm')::date;
  v_binding_start := coalesce(v_contract.actual_start_at, v_contract.confirmed_start_at,
    (select min(coalesce(sp.actual_start_date, sp.start_date)) from public.customer_supply_periods sp
      where sp.company_id = p_company_id and sp.customer_id = v_contract.customer_id
        and coalesce(sp.customer_contract_id, sp.contract_id) = p_customer_contract_id
        and sp.status in ('active', 'confirmed_by_grid_owner', 'ending', 'ended')),
    v_contract.starts_at, v_contract.expected_start_at);
  v_binding_end := (v_binding_start + make_interval(months => v_contract.binding_months))::date;
  if v_binding_end is null or v_binding_end <= v_planned_end + 1 then
    return jsonb_build_object('contract_id', p_customer_contract_id, 'review_due', false, 'reason', 'binding_served',
      'binding_ends_at', v_binding_end, 'planned_end_date', v_planned_end);
  end if;
  if exists (select 1 from public.customer_operation_tasks t
      where t.company_id = p_company_id and t.task_type = 'break_fee_review'
        and t.metadata->>'contract_id' = p_customer_contract_id::text) then
    return jsonb_build_object('contract_id', p_customer_contract_id, 'review_due', true, 'created', false,
      'binding_ends_at', v_binding_end, 'planned_end_date', v_planned_end);
  end if;
  insert into public.customer_operation_tasks (
    company_id, customer_id, metering_point_id, task_type, status, priority,
    title, description, metadata, created_by, updated_by
  ) values (
    p_company_id, v_contract.customer_id, v_contract.metering_point_id, 'break_fee_review', 'open', 'normal',
    'Bedöm brytavgift vid uppsägning',
    'Kunden sade upp avtalet före bindningstidens slut (' || to_char(v_binding_end, 'YYYY-MM-DD')
      || '). Avtalet slutar efter uppsägningstiden, ' || to_char(v_planned_end, 'YYYY-MM-DD')
      || '. Bedöm om och vilken brytavgift avtalet medger. Inget debiteras automatiskt.',
    jsonb_build_object(
      'contract_id', p_customer_contract_id,
      'binding_months', v_contract.binding_months,
      'binding_starts_at', v_binding_start,
      'binding_ends_at', v_binding_end,
      'termination_notice_date', v_contract.termination_notice_date,
      'contract_end_date', v_planned_end,
      'end_reason', 'customer_termination',
      'end_key', 'customer-termination-review:' || p_customer_contract_id::text,
      'customer_type', (select c.customer_type from public.customers c where c.id = v_contract.customer_id and c.company_id = p_company_id),
      'charged_automatically', false
    ),
    p_actor_user_id, p_actor_user_id
  );
  return jsonb_build_object('contract_id', p_customer_contract_id, 'review_due', true, 'created', true,
    'binding_ends_at', v_binding_end, 'planned_end_date', v_planned_end);
end
$$;

revoke all on function public.gridex_termination_break_fee_review_v1(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.gridex_termination_break_fee_review_v1(uuid, uuid, uuid) to service_role;

-- B5: the planned end of a termination is the notice end.
select pg_temp.h3d3_rewrite(
  'public.gridex_contract_termination_end_v1(date,date,integer,integer,integer,date)'::regprocedure,
  array[
$o$  select coalesce(p_ends_at, greatest(
    case when p_starts_at is not null and coalesce(p_binding_months, 0) > 0
      then (p_starts_at + make_interval(months => p_binding_months))::date end,
    public.gridex_contract_notice_end_v1(p_notice_date, p_notice_months, p_notice_days)))$o$],
  array[
$n$  -- H3d (20261024100000), owner decision B5: the contract ends after its notice period, also inside the binding
  -- (the operator reviews a break fee, gridex_termination_break_fee_review_v1). Without a notice date: the agreed end.
  -- p_starts_at and p_binding_months are kept for the signature and not read.
  select coalesce(public.gridex_contract_notice_end_v1(p_notice_date, p_notice_months, p_notice_days), p_ends_at)$n$]);

-- B5: the registration of a termination without a move creates the review inside the binding.
select pg_temp.h3d3_rewrite(
  'public.gridex_register_customer_termination_v1(uuid,uuid,uuid,date,text,text)'::regprocedure,
  array[
$o$  v_metadata jsonb;
begin$o$,
$o$'Termination without a move: the supply continues until a new supplier takes over (Z05); when the notice period has expired without a switch, an operator task asks for an end of supply (Z08) to the grid owner.'$o$,
$o$    v_contracts := v_contracts || jsonb_build_array(jsonb_build_object('contract_id', v_contract.id,
      'termination_notice_date', v_notice_date, 'planned_end_date', v_planned_end));$o$,
$o$    'failed_switch_request_ids', '[]'::jsonb,$o$],
  array[
$n$  v_metadata jsonb;
  -- H3d (20261024100000)
  v_review jsonb;
  v_review_contract_ids uuid[] := '{}';
begin$n$,
$n$'Termination without a move: the contract ends after its notice period and the supply continues until a new supplier takes over (Z05); an operator task asks for an end of supply (Z08) to the grid owner 14 days before the notice period ends unless a new supplier''s Z05 ends the supply first. Inside the binding period the operator reviews a break fee; nothing is charged automatically.'$n$,
$n$    -- H3d (20261024100000), owner decision B5: inside the binding period one fee review per contract.
    v_review := public.gridex_termination_break_fee_review_v1(p_company_id, v_contract.id, p_actor_user_id);
    if coalesce((v_review->>'review_due')::boolean, false) then
      v_review_contract_ids := v_review_contract_ids || v_contract.id;
    end if;
    v_contracts := v_contracts || jsonb_build_array(jsonb_build_object('contract_id', v_contract.id,
      'termination_notice_date', v_notice_date, 'planned_end_date', v_planned_end,
      'break_fee_review', coalesce((v_review->>'review_due')::boolean, false)));$n$,
$n$    'failed_switch_request_ids', '[]'::jsonb,
    'break_fee_review_contract_ids', to_jsonb(v_review_contract_ids),$n$]);

-- B5: the customer card's termination without ongoing supply (closed as 'customer_termination') gets the review too.
select pg_temp.h3d3_rewrite(
  'public.gridex_close_customer_lifecycle_v2(uuid,uuid,uuid,text,date,text,text,boolean,date)'::regprocedure,
  array[
$o$  if not v_terminate then
    foreach v_review_contract_id in array v_terminated_contract_ids loop$o$],
  array[
$n$  -- H3d (20261024100000), owner decision B5: a termination without a move (no supply ongoing, closed as
  -- 'customer_termination') inside the binding period gets one fee review per contract; nothing is charged.
  if v_terminate then
    foreach v_review_contract_id in array v_terminated_contract_ids loop
      if coalesce((public.gridex_termination_break_fee_review_v1(p_company_id, v_review_contract_id, p_actor_user_id)->>'review_due')::boolean, false) then
        v_review_contract_ids := v_review_contract_ids || v_review_contract_id;
      end if;
    end loop;
  end if;
  if not v_terminate then
    foreach v_review_contract_id in array v_terminated_contract_ids loop$n$]);

-- B6: the Z08 task 14 days before the planned end; open tasks whose supply already ended are closed with a reason.
select pg_temp.h3d3_rewrite(
  'public.gridex_termination_notice_expiry_tasks_v1(uuid,date)'::regprocedure,
  array[
$o$  v_contract_ids uuid[] := '{}';
begin$o$,
$o$    raise exception using errcode = '42501', message = 'customer_termination_service_role_required';
  end if;$o$,
$o$      and (c.ended_at at time zone 'Europe/Stockholm')::date <= v_as_of$o$,
$o$        and t.metadata->>'planned_end_date' = to_char(v_row.planned_end, 'YYYY-MM-DD'));$o$,
$o$    insert into public.customer_operation_tasks (
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
    );$o$,
$o$  return jsonb_build_object('as_of', v_as_of, 'tasks_created', v_created, 'contract_ids', to_jsonb(v_contract_ids));$o$],
  array[
$n$  v_contract_ids uuid[] := '{}';
  -- H3d (20261024100000), owner decision B6: the task is created this many calendar days before the planned end, so
  -- the Z08 reaches the grid owner in good time (the registers set no other lead time for a supplier's end of supply;
  -- mirror: lib/customer-contracts/terminationNoticeExpiry.ts TERMINATION_Z08_TASK_LEAD_DAYS).
  c_lead_days constant integer := 14;
  v_closed integer := 0;
begin$n$,
$n$    raise exception using errcode = '42501', message = 'customer_termination_service_role_required';
  end if;

  -- H3d (20261024100000), owner decision B6: an open Z08 task whose contract no longer has supply beyond the planned
  -- end (a new supplier's Z05, or another end of the supply) is closed with its reason; nothing was sent.
  update public.customer_operation_tasks t
  set status = 'cancelled', resolved_at = now(), updated_at = now(),
      metadata = t.metadata || jsonb_build_object('closed_automatically', true, 'closed_reason', 'supply_ended_before_z08',
        'closed_on', v_as_of)
  where (p_company_id is null or t.company_id = p_company_id)
    and t.task_type = 'termination_end_of_supply_pending'
    and t.status in ('open', 'in_progress', 'blocked')
    and not exists (
      select 1 from public.customer_supply_periods sp
      where sp.company_id = t.company_id and coalesce(sp.customer_contract_id, sp.contract_id)::text = t.metadata->>'contract_id'
        and sp.status in ('active', 'confirmed_by_grid_owner')
        and (coalesce(sp.actual_end_date, sp.end_date) is null
          or coalesce(sp.actual_end_date, sp.end_date) > (t.metadata->>'planned_end_date')::date));
  get diagnostics v_closed = row_count;$n$,
$n$      and (c.ended_at at time zone 'Europe/Stockholm')::date <= v_as_of + c_lead_days$n$,
$n$        and t.metadata->>'planned_end_date' = to_char(v_row.planned_end, 'YYYY-MM-DD')
        and t.metadata->>'closed_automatically' is distinct from 'true');$n$,
$n$    insert into public.customer_operation_tasks (
      company_id, customer_id, metering_point_id, task_type, status, priority, title, description, due_at, metadata
    ) values (
      v_row.company_id, v_row.customer_id, v_row.metering_point_id, 'termination_end_of_supply_pending', 'open', 'high',
      'Skicka avslut (Z08) till nätägaren',
      'Kundens uppsägningstid löper ut ' || to_char(v_row.planned_end, 'YYYY-MM-DD')
        || ' och inget leverantörsbyte (Z05) har avslutat leveransen. Skicka ett avslut av leverans (Z08) till nätägaren i god tid före '
        || to_char(v_row.planned_end, 'YYYY-MM-DD')
        || '. Uppgiften stängs automatiskt om en ny leverantörs Z05 avslutar leveransen först. Inget skickas automatiskt.',
      (v_row.planned_end::timestamp at time zone 'Europe/Stockholm'),
      jsonb_build_object('contract_id', v_row.id, 'termination_notice_date', v_row.termination_notice_date,
        'planned_end_date', v_row.planned_end, 'supply_period_ids', to_jsonb(v_row.period_ids), 'checked_on', v_as_of,
        'end_key', 'termination-expiry:' || v_row.id::text || ':' || to_char(v_row.planned_end, 'YYYY-MM-DD'),
        'lead_days', c_lead_days, 'created_before_end_days', v_row.planned_end - v_as_of,
        'sent_automatically', false)
    );$n$,
$n$  return jsonb_build_object('as_of', v_as_of, 'tasks_created', v_created, 'contract_ids', to_jsonb(v_contract_ids),
    'tasks_closed', v_closed, 'lead_days', c_lead_days);$n$]);

-- B6: a received end (a new supplier's Z05) that ends the supply first closes the open Z08 task with its reason.
select pg_temp.h3d3_rewrite(
  'public.gridex_supply_end_followup_v1()'::regprocedure,
  array[
$o$  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks t WHERE t.company_id = NEW.company_id AND t.customer_id = NEW.customer_id
     AND t.task_type = 'final_invoice_pending' AND (t.metadata->>'end_key' = v_key OR t.metadata->>'received_end_key' = v_key)) THEN
    RETURN NEW;
  END IF;$o$],
  array[
$n$  -- H3d (20261024100000), owner decision B6: the received end (Z05) ended the supply before a Z08 was needed. The
  -- open Z08 task of the contract is closed with its reason when no supply of the contract runs beyond its planned end.
  IF v_contract_id IS NOT NULL THEN
    UPDATE public.customer_operation_tasks t
    SET status = 'cancelled', resolved_at = now(), updated_at = now(),
        metadata = t.metadata || jsonb_build_object('closed_automatically', true, 'closed_reason', 'supply_ended_by_received_end',
          'closed_by_end_key', v_key, 'closed_supply_end_date', v_end, 'closed_supply_period_id', NEW.id, 'closed_at', now())
    WHERE t.company_id = NEW.company_id AND t.task_type = 'termination_end_of_supply_pending'
      AND t.status IN ('open', 'in_progress', 'blocked') AND t.metadata->>'contract_id' = v_contract_id::text
      AND NOT EXISTS (SELECT 1 FROM public.customer_supply_periods sp
        WHERE sp.company_id = NEW.company_id AND coalesce(sp.customer_contract_id, sp.contract_id) = v_contract_id
          AND sp.status IN ('active','confirmed_by_grid_owner')
          AND (coalesce(sp.actual_end_date, sp.end_date) IS NULL
            OR coalesce(sp.actual_end_date, sp.end_date) > (t.metadata->>'planned_end_date')::date));
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_operation_tasks t WHERE t.company_id = NEW.company_id AND t.customer_id = NEW.customer_id
     AND t.task_type = 'final_invoice_pending' AND (t.metadata->>'end_key' = v_key OR t.metadata->>'received_end_key' = v_key)) THEN
    RETURN NEW;
  END IF;$n$]);

drop function pg_temp.h3d3_rewrite(regprocedure, text[], text[]);

commit;
