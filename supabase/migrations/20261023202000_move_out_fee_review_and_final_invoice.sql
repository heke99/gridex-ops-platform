-- FINDINGS H3d (reports/h3d-move-out-notice.md D4/H6, D7), owner decision 2026-10-23 B2 "Avgiftsgranskning för alla"
-- (OWNER-DECISIONS.md row 17) and decision 20: a move-out inside the binding period gets an operator fee review
-- (customer_operation_tasks 'break_fee_review') for EVERY customer type, both for a manual move-out
-- (gridex_close_customer_lifecycle_v1 mode 'move_out', gridex_end_customer_supply_v1 'move_out') and for a received
-- grid-owner end (Z05 L/LK, gridex_supply_end_followup_v1). The operator decides; no fee is ever charged automatically
-- and a break fee never enters the regular monthly billing run (lib/pricing/engine.ts, isOutsideRegularMonthlyBilling).
--
-- Defects in the installed bodies (identical to supabase/schema.sql, read from the world database):
--   * gridex_end_customer_supply_v1 created a review only for 'supplier_switch' ("Moving out does not").
--   * gridex_close_customer_lifecycle_v1 (the customer card's move-out, the path operators actually use) created no
--     review, no final-invoice task (D7), and cancelled every open task of the customer, including a 'final_invoice_pending'
--     or 'break_fee_review' an earlier Z05 had created (D7).
--   * All paths computed the binding end from customer_contracts.starts_at, the requested/planned start, not the start
--     the market confirmed (H6). The repo's commitment rule (lib/customer-contracts/commitment.ts) reads the actual or
--     confirmed start first.
--   * A manual end compared the binding end with the LAST supplied day, so a binding that ends the day after the move-out
--     (fully served) was reviewed; and nothing kept the review to one per contract.
--
-- Rule (one block per writer; text identical in meaning):
--   binding start = coalesce(contract.actual_start_at, contract.confirmed_start_at,
--                            first supplied day under the contract (min coalesce(actual_start_date, start_date) of its
--                            active/confirmed/ending/ended periods of the same tenant and customer),
--                            contract.starts_at, contract.expected_start_at)
--   binding end   = binding start + binding_months (calendar months, month-end clamped as Postgres date arithmetic)
--   a review is due when binding_months > 0 and binding end > the first day no longer supplied
--     (manual ends: last supplied day + 1; the received end: its end date, already exclusive);
--   one review per contract: none is created when any 'break_fee_review' already names the contract (any status).
--   Reviews carry contract, binding start/end, supply end, first unsupplied day, end reason, end key, the customer type
--   (information only, never a filter) and charged_automatically=false.
-- gridex_close_customer_lifecycle_v1 additionally (D7): keeps open 'final_invoice_pending' and 'break_fee_review' tasks
-- when it cancels the customer's open work, and creates one 'final_invoice_pending' per supply period it ended (both
-- modes; end_key 'customer-lifecycle-close:<period>:<date>', supply_period_id, the move-out date as the last supplied day),
-- like the Z05 and end-supply paths. The review in the close path is created for mode 'move_out' only; 'terminate'
-- (a termination without a move, owner decision B3) is left for the termination slice.
--
-- Exact-needle rewrites of the installed bodies; refuses (move_out_fee_review_rule_source_changed) unless every needle
-- is present exactly once and the H3d marker is absent. Owner, ACL, security definer, volatility and configuration
-- (proconfig) are preserved and checked (move_out_fee_review_metadata_changed).
begin;

create function pg_temp.h3d_rewrite_v1(p_target regprocedure, p_old text[], p_new text[]) returns void
language plpgsql as $rewrite$
declare
  f record;
  body text;
  i integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = p_target;
  if position('H3d (20261023202000)' in f.prosrc) <> 0
    or not (f.metadata->>'prosecdef')::boolean
    or cardinality(p_old) <> cardinality(p_new)
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'move_out_fee_review_rule_source_changed:%', p_target using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'move_out_fee_review_rule_source_changed:%:%', p_target, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'move_out_fee_review_metadata_changed:%', p_target using errcode = 'P0U01';
  end if;
end
$rewrite$;

-- 1. gridex_end_customer_supply_v1: the review for a move-out as well, from the actual start, once per contract.
select pg_temp.h3d_rewrite_v1(
  'public.gridex_end_customer_supply_v1(uuid,uuid,uuid,date,text,uuid,uuid)'::regprocedure,
  array[
$o1$  v_binding_end date;
  v_break_fee_review boolean := false;$o1$,
$o2$      -- A switch away inside the binding period may carry a break fee. Moving
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
      end if;$o2$],
  array[
$n1$  v_binding_end date;
  v_binding_start date;
  v_break_fee_review boolean := false;$n1$,
$n2$      -- H3d (20261023202000), owner decision 2026-10-23 B2 "Avgiftsgranskning för alla": a switch away AND a
      -- move-out inside the binding period may carry a break fee, for every customer type. The fee must be reasonable
      -- and follow the contract terms, so it is never charged automatically and never enters the monthly billing run;
      -- the operator reviews it (one review per contract). The binding runs from the contract's actual start: its
      -- recorded actual or confirmed start, else the first supplied day under it, else its planned start (H6).
      -- p_end_date is the last supplied day: the binding is broken when it ends after the next day.
      if coalesce(v_contract.binding_months, 0) > 0 then
        v_binding_start := coalesce(v_contract.actual_start_at, v_contract.confirmed_start_at,
          (select min(coalesce(sp.actual_start_date, sp.start_date)) from public.customer_supply_periods sp
            where sp.company_id = p_company_id and sp.customer_id = p_customer_id
              and coalesce(sp.customer_contract_id, sp.contract_id) = v_contract_id
              and sp.status in ('active', 'confirmed_by_grid_owner', 'ending', 'ended')),
          v_contract.starts_at, v_contract.expected_start_at);
        v_binding_end := (v_binding_start + make_interval(months => v_contract.binding_months))::date;
        if v_binding_end > p_end_date + 1 then
          v_break_fee_review := true;
          if not exists (
            select 1 from public.customer_operation_tasks t
            where t.company_id = p_company_id and t.task_type = 'break_fee_review'
              and t.metadata->>'contract_id' = v_contract_id::text
          ) then
            insert into public.customer_operation_tasks (
              company_id, customer_id, metering_point_id, task_type, status, priority,
              title, description, metadata
            ) values (
              p_company_id, p_customer_id, p_metering_point_id, 'break_fee_review', 'open', 'normal',
              case when v_switch then 'Bedöm brytavgift vid leverantörsbyte' else 'Bedöm brytavgift vid flytt' end,
              case when v_switch
                then 'Kunden bytte elleverantör före bindningstidens slut. Bedöm om och vilken brytavgift avtalet medger. Inget debiteras automatiskt.'
                else 'Kunden flyttade före bindningstidens slut. Bedöm om och vilken brytavgift avtalet medger. Inget debiteras automatiskt.' end,
              jsonb_build_object(
                'contract_id', v_contract_id,
                'binding_months', v_contract.binding_months,
                'binding_starts_at', v_binding_start,
                'binding_ends_at', v_binding_end,
                'supply_end_date', p_end_date,
                'first_unsupplied_date', p_end_date + 1,
                'end_reason', p_end_reason,
                'end_key', v_key,
                'customer_type', v_customer.customer_type,
                'charged_automatically', false
              )
            );
          end if;
        end if;
      end if;$n2$]);

-- 2. gridex_supply_end_followup_v1 (Z05 L and LK): from the actual start, once per contract.
select pg_temp.h3d_rewrite_v1(
  'public.gridex_supply_end_followup_v1()'::regprocedure,
  array[
$o1$  v_binding_end date;
BEGIN$o1$,
$o2$      IF coalesce(v_contract.binding_months, 0) > 0 AND v_contract.starts_at IS NOT NULL THEN
        v_binding_end := (v_contract.starts_at + make_interval(months => v_contract.binding_months))::date;
        IF v_binding_end > v_end THEN
          INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
          VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'break_fee_review', 'open', 'normal',
            'Bedöm brytavgift vid leveransslut',
            'Leveransen upphörde före bindningstidens slut. Bedöm om avtalet medger en brytavgift; inget debiteras automatiskt.',
            jsonb_build_object('contract_id', v_contract_id, 'binding_months', v_contract.binding_months,
              'binding_ends_at', v_binding_end, 'supply_end_date', v_end, 'end_key', v_key));
        END IF;
      END IF;$o2$],
  array[
$n1$  v_binding_end date;
  v_binding_start date;
BEGIN$n1$,
$n2$      -- H3d (20261023202000), owner decision B2: a received end (Z05 L switch away or Z05 LK move-out) inside the
      -- binding period gets one operator fee review per contract, for every customer type; nothing is charged
      -- automatically. The binding runs from the contract's actual start (recorded actual/confirmed start, else the
      -- first supplied day under it, else the planned start; H6). v_end is the first day no longer supplied.
      v_binding_start := coalesce(v_contract.actual_start_at, v_contract.confirmed_start_at,
        (SELECT min(coalesce(sp.actual_start_date, sp.start_date)) FROM public.customer_supply_periods sp
          WHERE sp.company_id = NEW.company_id AND sp.customer_id = NEW.customer_id
            AND coalesce(sp.customer_contract_id, sp.contract_id) = v_contract_id
            AND sp.status IN ('active','confirmed_by_grid_owner','ending','ended')),
        v_contract.starts_at, v_contract.expected_start_at);
      IF coalesce(v_contract.binding_months, 0) > 0 AND v_binding_start IS NOT NULL THEN
        v_binding_end := (v_binding_start + make_interval(months => v_contract.binding_months))::date;
        IF v_binding_end > v_end AND NOT EXISTS (SELECT 1 FROM public.customer_operation_tasks t
            WHERE t.company_id = NEW.company_id AND t.task_type = 'break_fee_review' AND t.metadata->>'contract_id' = v_contract_id::text) THEN
          INSERT INTO public.customer_operation_tasks(company_id, customer_id, metering_point_id, task_type, status, priority, title, description, metadata)
          VALUES (NEW.company_id, NEW.customer_id, NEW.metering_point_id, 'break_fee_review', 'open', 'normal',
            'Bedöm brytavgift vid leveransslut',
            'Leveransen upphörde före bindningstidens slut. Bedöm om avtalet medger en brytavgift; inget debiteras automatiskt.',
            jsonb_build_object('contract_id', v_contract_id, 'binding_months', v_contract.binding_months,
              'binding_starts_at', v_binding_start, 'binding_ends_at', v_binding_end, 'supply_end_date', v_end,
              'first_unsupplied_date', v_end, 'end_reason', 'supply_end', 'end_key', v_key,
              'customer_type', (SELECT c.customer_type FROM public.customers c WHERE c.id = NEW.customer_id AND c.company_id = NEW.company_id),
              'charged_automatically', false));
        END IF;
      END IF;$n2$]);

-- 3. gridex_close_customer_lifecycle_v1: final-invoice tasks (D7), kept review/final-invoice tasks (D7), and the
--    move-out review (B2).
select pg_temp.h3d_rewrite_v1(
  'public.gridex_close_customer_lifecycle_v1(uuid,uuid,uuid,text,date,text,text,boolean)'::regprocedure,
  array[
$o1$  v_supply_cancelled integer := 0;
begin$o1$,
$o2$  update public.customer_supply_periods
  set end_date = p_move_out_date,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'planned_end_source', 'customer_lifecycle_close',
        'planned_end_reason', p_mode,
        'planned_end_recorded_at', v_now
      ),
      updated_at = v_now
  where company_id = p_company_id
    and customer_id = p_customer_id
    and status in ('active', 'confirmed_by_grid_owner')
    and start_date <= p_move_out_date
    and (end_date is null or end_date > p_move_out_date);
  get diagnostics v_supply_ended = row_count;$o2$,
$o3$    v_contracts := v_contracts + 1;
  end loop;$o3$,
$o4$  update public.customer_operation_tasks
  set status = 'cancelled', resolved_at = v_now, updated_by = p_actor_user_id
  where company_id = p_company_id
    and customer_id = p_customer_id
    and status in ('open', 'in_progress', 'blocked');$o4$,
$o5$    'lifecycle', v_metadata
  );$o5$],
  array[
$n1$  v_supply_cancelled integer := 0;
  -- H3d (20261023202000)
  v_ended_period_ids uuid[] := '{}';
  v_terminated_contract_ids uuid[] := '{}';
  v_review_contract_ids uuid[] := '{}';
  v_final_invoice_tasks integer := 0;
  v_review_contract public.customer_contracts%rowtype;
  v_review_contract_id uuid;
  v_binding_start date;
  v_binding_end date;
begin$n1$,
$n2$  with ended as (
    update public.customer_supply_periods
    set end_date = p_move_out_date,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'planned_end_source', 'customer_lifecycle_close',
          'planned_end_reason', p_mode,
          'planned_end_recorded_at', v_now
        ),
        updated_at = v_now
    where company_id = p_company_id
      and customer_id = p_customer_id
      and status in ('active', 'confirmed_by_grid_owner')
      and start_date <= p_move_out_date
      and (end_date is null or end_date > p_move_out_date)
    returning id
  )
  select coalesce(array_agg(id order by id), '{}'), count(*) into v_ended_period_ids, v_supply_ended from ended;$n2$,
$n3$    if v_event_type = 'terminated' then
      v_terminated_contract_ids := v_terminated_contract_ids || v_contract.id;
    end if;
    v_contracts := v_contracts + 1;
  end loop;$n3$,
$n4$  -- H3d (20261023202000), D7: the final invoice and the operator's fee review of an earlier supply end are kept.
  update public.customer_operation_tasks
  set status = 'cancelled', resolved_at = v_now, updated_by = p_actor_user_id
  where company_id = p_company_id
    and customer_id = p_customer_id
    and status in ('open', 'in_progress', 'blocked')
    and coalesce(task_type, '') not in ('final_invoice_pending', 'break_fee_review');

  -- H3d D7: a final invoice for every supply period this close ended (both modes), as the Z05 and end-supply paths
  -- create it. The move-out date is the last supplied day.
  insert into public.customer_operation_tasks (
    company_id, customer_id, metering_point_id, task_type, status, priority,
    title, description, metadata, created_by, updated_by
  )
  select p_company_id, p_customer_id, sp.metering_point_id, 'final_invoice_pending', 'open', 'high',
    'Slutfaktura',
    'Leveransen upphör efter ' || to_char(p_move_out_date, 'YYYY-MM-DD') || ' (sista leveransdag). Invänta slutavläsningen och fakturera perioden till och med den dagen.',
    jsonb_build_object('supply_end_date', p_move_out_date, 'last_supplied_date', p_move_out_date, 'end_reason', p_mode,
      'end_key', 'customer-lifecycle-close:' || sp.id::text || ':' || to_char(p_move_out_date, 'YYYY-MM-DD'),
      'supply_period_id', sp.id),
    p_actor_user_id, p_actor_user_id
  from public.customer_supply_periods sp
  where sp.company_id = p_company_id
    and sp.customer_id = p_customer_id
    and sp.id = any (v_ended_period_ids)
    and not exists (
      select 1 from public.customer_operation_tasks t
      where t.company_id = p_company_id and t.customer_id = p_customer_id
        and t.task_type = 'final_invoice_pending' and t.status <> 'cancelled'
        and t.metadata->>'supply_period_id' = sp.id::text
        and t.metadata->>'supply_end_date' = to_char(p_move_out_date, 'YYYY-MM-DD'))
  order by sp.id;
  get diagnostics v_final_invoice_tasks = row_count;

  -- H3d B2 (owner decision 2026-10-23 "Avgiftsgranskning för alla"): a move-out inside the binding period gets one
  -- operator fee review per contract, for every customer type; nothing is charged automatically. The binding runs from
  -- the contract's actual start (recorded actual/confirmed start, else the first supplied day under it, else the
  -- planned start; H6). The move-out date is the last supplied day.
  if not v_terminate then
    foreach v_review_contract_id in array v_terminated_contract_ids loop
      select * into v_review_contract
      from public.customer_contracts
      where id = v_review_contract_id and company_id = p_company_id and customer_id = p_customer_id
      for update;
      continue when not found or coalesce(v_review_contract.binding_months, 0) <= 0;
      v_binding_start := coalesce(v_review_contract.actual_start_at, v_review_contract.confirmed_start_at,
        (select min(coalesce(sp.actual_start_date, sp.start_date)) from public.customer_supply_periods sp
          where sp.company_id = p_company_id and sp.customer_id = p_customer_id
            and coalesce(sp.customer_contract_id, sp.contract_id) = v_review_contract_id
            and sp.status in ('active', 'confirmed_by_grid_owner', 'ending', 'ended')),
        v_review_contract.starts_at, v_review_contract.expected_start_at);
      v_binding_end := (v_binding_start + make_interval(months => v_review_contract.binding_months))::date;
      continue when v_binding_end is null or v_binding_end <= p_move_out_date + 1;
      v_review_contract_ids := v_review_contract_ids || v_review_contract_id;
      continue when exists (
        select 1 from public.customer_operation_tasks t
        where t.company_id = p_company_id and t.task_type = 'break_fee_review'
          and t.metadata->>'contract_id' = v_review_contract_id::text);
      insert into public.customer_operation_tasks (
        company_id, customer_id, metering_point_id, task_type, status, priority,
        title, description, metadata, created_by, updated_by
      ) values (
        p_company_id, p_customer_id, v_review_contract.metering_point_id, 'break_fee_review', 'open', 'normal',
        'Bedöm brytavgift vid flytt',
        'Kunden flyttade före bindningstidens slut. Bedöm om och vilken brytavgift avtalet medger. Inget debiteras automatiskt.',
        jsonb_build_object(
          'contract_id', v_review_contract_id,
          'binding_months', v_review_contract.binding_months,
          'binding_starts_at', v_binding_start,
          'binding_ends_at', v_binding_end,
          'supply_end_date', p_move_out_date,
          'first_unsupplied_date', p_move_out_date + 1,
          'end_reason', 'move_out',
          'end_key', 'customer-lifecycle-close:' || p_customer_id::text || ':' || v_review_contract_id::text,
          'customer_type', v_before.customer_type,
          'charged_automatically', false
        ),
        p_actor_user_id, p_actor_user_id
      );
    end loop;
  end if;$n4$,
$n5$    'lifecycle', v_metadata,
    'final_invoice_tasks', v_final_invoice_tasks,
    'break_fee_review_contract_ids', to_jsonb(v_review_contract_ids)
  );$n5$]);

drop function pg_temp.h3d_rewrite_v1(regprocedure, text[], text[]);

commit;
