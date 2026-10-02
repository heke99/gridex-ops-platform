-- Atomic customer move-out / termination.
--
-- 1. Converge the canonical schema with the hosted one. The lifecycle columns
--    and customer_lifecycle_events were created by the legacy migration
--    20260519_customer_move_out_lifecycle.sql, which the 14-digit clean replay
--    does not apply. The app writes them on every move-out, so the canonical
--    schema must have them too. Every statement is idempotent; the hosted
--    database already has all of it.
-- 2. gridex_close_customer_lifecycle_v1 performs the move-out/termination
--    graph (customer, sites, metering points, contracts, switch requests,
--    tasks, note, lifecycle event) in one transaction. Before, the customer
--    card ran these as separate writes and an error halfway left a closed
--    customer with open contracts or switches.

alter table public.customers add column if not exists moved_out_at date;
alter table public.customers add column if not exists lifecycle_closed_at timestamptz;
alter table public.customers add column if not exists lifecycle_closed_by uuid references auth.users(id) on delete set null;
alter table public.customers add column if not exists lifecycle_status_reason text;
create index if not exists customers_company_moved_out_idx
  on public.customers (company_id, moved_out_at) where moved_out_at is not null;
create index if not exists customers_company_lifecycle_closed_idx
  on public.customers (company_id, lifecycle_closed_at desc) where lifecycle_closed_at is not null;

alter table public.customer_sites add column if not exists move_out_date date;

create table if not exists public.customer_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  event_type text not null,
  event_status text not null default 'completed',
  effective_date date,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_lifecycle_events_type_check
    check (event_type in ('move_out', 'terminate', 'restore', 'note')),
  constraint customer_lifecycle_events_status_check
    check (event_status in ('draft', 'completed', 'cancelled'))
);
create index if not exists customer_lifecycle_events_company_created_idx
  on public.customer_lifecycle_events (company_id, created_at desc);
create index if not exists customer_lifecycle_events_customer_created_idx
  on public.customer_lifecycle_events (customer_id, created_at desc);
alter table public.customer_lifecycle_events enable row level security;
revoke all on table public.customer_lifecycle_events from anon, authenticated;
grant all on table public.customer_lifecycle_events to service_role;

create or replace function public.gridex_close_customer_lifecycle_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_actor_user_id uuid,
  p_mode text,
  p_move_out_date date,
  p_reason text,
  p_note text,
  p_create_follow_up_task boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_before public.customers%rowtype;
  v_after public.customers%rowtype;
  v_now timestamptz := now();
  v_terminate boolean := p_mode = 'terminate';
  v_close_reason text;
  v_site_ids uuid[];
  v_points integer := 0;
  v_contract record;
  v_event_type text;
  v_contracts integer := 0;
  v_switch_ids uuid[] := '{}';
  v_metadata jsonb;
  v_supply_ended integer := 0;
  v_supply_cancelled integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_lifecycle_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_actor_user_id is null
     or p_mode not in ('move_out', 'terminate') or p_move_out_date is null then
    raise exception using errcode = '22023', message = 'customer_lifecycle_payload_invalid';
  end if;

  select * into v_before
  from public.customers
  where id = p_customer_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;
  if v_before.status in ('archived', 'moved', 'terminated') then
    raise exception using errcode = '23514', message = 'customer_lifecycle_already_closed';
  end if;

  v_close_reason := coalesce(nullif(btrim(p_reason), ''),
    case when v_terminate then 'Kund avslutad.' else 'Kunden har flyttat.' end);
  v_metadata := jsonb_build_object(
    'mode', p_mode,
    'moveOutDate', p_move_out_date,
    'reason', p_reason,
    'source', 'admin_customer_card',
    'legalHandling', 'Soft close only. Customer records are retained for Ediel, metering, billing and audit traceability.'
  );

  update public.customers
  set status = case when v_terminate then 'terminated' else 'moved' end,
      moved_out_at = p_move_out_date,
      lifecycle_closed_at = v_now,
      lifecycle_closed_by = p_actor_user_id,
      lifecycle_status_reason = p_reason,
      updated_at = v_now
  where id = p_customer_id and company_id = p_company_id
  returning * into v_after;

  with closed as (
    update public.customer_sites
    set status = 'closed', move_out_date = p_move_out_date, closed_at = v_now,
        closed_reason = v_close_reason, updated_by = p_actor_user_id
    where company_id = p_company_id and customer_id = p_customer_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_site_ids from closed;

  update public.metering_points
  set status = 'closed', end_date = p_move_out_date, closed_at = v_now,
      closed_reason = v_close_reason, updated_by = p_actor_user_id
  where company_id = p_company_id and site_id = any (v_site_ids);
  get diagnostics v_points = row_count;

  -- Billing follows customer_supply_periods. Supply ends on the move-out date
  -- (inclusive) so the period up to the move is still invoiced and nothing
  -- after it. A period that had not started yet is cancelled. The grid owner's
  -- end-of-supply message later confirms the actual date.
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
    and (end_date is null or end_date > p_move_out_date);
  get diagnostics v_supply_ended = row_count;

  update public.customer_supply_periods
  set status = 'cancelled',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cancelled_by', 'customer_lifecycle_close',
        'cancelled_reason', p_mode,
        'cancelled_at', v_now
      ),
      updated_at = v_now
  where company_id = p_company_id
    and customer_id = p_customer_id
    and status in ('active', 'confirmed_by_grid_owner')
    and start_date > p_move_out_date;
  get diagnostics v_supply_cancelled = row_count;

  for v_contract in
    select c.id, c.status
    from public.customer_contracts c
    where c.company_id = p_company_id
      and c.customer_id = p_customer_id
      and c.status in ('draft', 'pending_signature', 'signature_failed', 'signed', 'active')
    order by c.id
  loop
    v_event_type := case when v_contract.status in ('signed', 'active') then 'terminated' else 'cancelled' end;
    perform public.gridex_record_customer_contract_event_v1(
      p_company_id,
      v_contract.id,
      p_customer_id,
      v_event_type,
      v_now,
      case
        when v_terminate then
          case when v_event_type = 'terminated' then 'Avtalet avslutades' else 'Avtalsprocessen avbröts' end
          || ' via kundens livscykelåtgärd.'
        else
          case when v_event_type = 'terminated' then 'Avtalet avslutades' else 'Avtalsprocessen avbröts' end
          || ' eftersom kunden registrerades som utflyttad.'
      end,
      v_metadata || jsonb_build_object(
        'ends_at', p_move_out_date,
        'termination_notice_date', v_now,
        'termination_reason', 'move_out'
      ),
      p_actor_user_id,
      null,
      'customer-lifecycle-close:' || p_customer_id::text || ':' || v_contract.id::text
    );
    v_contracts := v_contracts + 1;
  end loop;

  with failed as (
    update public.supplier_switch_requests
    set status = 'failed',
        failed_at = v_now,
        failure_reason = case when v_terminate
          then 'Kunden avslutades innan switchen slutfördes.'
          else 'Kunden registrerades som utflyttad innan switchen slutfördes.' end,
        updated_by = p_actor_user_id
    where company_id = p_company_id
      and customer_id = p_customer_id
      and status in ('draft', 'queued', 'submitted', 'accepted')
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_switch_ids from failed;

  -- Open work for the customer is cancelled before the follow-up tasks are created.
  update public.customer_operation_tasks
  set status = 'cancelled', resolved_at = v_now, updated_by = p_actor_user_id
  where company_id = p_company_id
    and customer_id = p_customer_id
    and status in ('open', 'in_progress', 'blocked');

  if cardinality(v_switch_ids) > 0 then
    insert into public.customer_operation_tasks (
      company_id, customer_id, site_id, metering_point_id, task_type, status, priority,
      title, description, metadata, created_by, updated_by
    ) values (
      p_company_id, p_customer_id, v_site_ids[1], null, 'supplier_switch_stopped_followup', 'open', 'high',
      case when v_terminate then 'Följ upp stoppat leverantörsbyte vid avslut'
           else 'Följ upp stoppat leverantörsbyte vid flytt' end,
      coalesce(p_reason, case when v_terminate
        then 'Kunden avslutades innan leverantörsbytet slutfördes.'
        else 'Kunden flyttade innan leverantörsbytet slutfördes.' end),
      jsonb_build_object('lifecycleMetadata', v_metadata, 'activeSwitchIds', to_jsonb(v_switch_ids)),
      p_actor_user_id, p_actor_user_id
    );
  end if;

  if p_create_follow_up_task then
    insert into public.customer_operation_tasks (
      company_id, customer_id, site_id, metering_point_id, task_type, status, priority,
      title, description, metadata, created_by, updated_by
    ) values (
      p_company_id, p_customer_id, v_site_ids[1], null, 'move_out_confirmation_pending', 'open', 'high',
      'Följ upp utflytt och slutunderlag',
      'Bekräfta att nätägaren har registrerat utflytt/avslut, invänta Z05LK vid relevant flöde och säkerställ slutliga mätvärden/faktureringsunderlag.',
      v_metadata, p_actor_user_id, p_actor_user_id
    );
  end if;

  insert into public.customer_internal_notes (company_id, customer_id, body, created_by, updated_by)
  values (p_company_id, p_customer_id, p_note, p_actor_user_id, p_actor_user_id);

  insert into public.customer_lifecycle_events (
    company_id, customer_id, event_type, event_status, effective_date, reason, payload, created_by
  ) values (
    p_company_id, p_customer_id, p_mode, 'completed', p_move_out_date, p_reason,
    v_metadata || jsonb_build_object(
      'affectedSites', cardinality(v_site_ids),
      'affectedMeteringPoints', v_points,
      'supplyPeriodsEnded', v_supply_ended,
      'supplyPeriodsCancelled', v_supply_cancelled,
      'terminatedContracts', v_contracts,
      'cancelledSwitchRequests', cardinality(v_switch_ids),
      'followUpTaskCreated', p_create_follow_up_task
    ),
    p_actor_user_id
  );

  return jsonb_build_object(
    'customer_before', to_jsonb(v_before),
    'customer', to_jsonb(v_after),
    'closed_sites', cardinality(v_site_ids),
    'closed_metering_points', v_points,
    'supply_periods_ended', v_supply_ended,
    'supply_periods_cancelled', v_supply_cancelled,
    'closed_contracts', v_contracts,
    'failed_switch_request_ids', to_jsonb(v_switch_ids),
    'lifecycle', v_metadata
  );
end
$function$;

revoke all on function public.gridex_close_customer_lifecycle_v1(uuid, uuid, uuid, text, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.gridex_close_customer_lifecycle_v1(uuid, uuid, uuid, text, date, text, text, boolean) to service_role;
