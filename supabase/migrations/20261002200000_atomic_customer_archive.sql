-- Atomic customer archive and archived-customer write fence.
--
-- Before: archiveCustomerImpl marked the customer archived and then closed
-- sites, metering points, contracts and switch requests in separate
-- best-effort calls. A failure in any step left an archived customer with
-- open contracts or switches and only a console warning.
--
-- After: one SECURITY DEFINER command does the whole graph in one transaction,
-- and new contracts, switch requests, sites and metering points can no longer
-- be created for an archived customer from any path (API, portal, jobs).

create or replace function public.gridex_archive_customer_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_customer public.customers%rowtype;
  v_after public.customers%rowtype;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Arkiverad via kundkort.');
  v_now timestamptz := now();
  v_contract record;
  v_sites integer := 0;
  v_points integer := 0;
  v_contracts integer := 0;
  v_switch_ids uuid[] := '{}';
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_archive_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'customer_archive_payload_invalid';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;

  if v_customer.status = 'archived' then
    return jsonb_build_object('customer', to_jsonb(v_customer), 'already_archived', true);
  end if;

  update public.customers
  set status = 'archived',
      archived_at = v_now,
      archived_by = p_actor_user_id,
      archive_reason = v_reason,
      updated_at = v_now
  where id = p_customer_id and company_id = p_company_id
  returning * into v_after;

  update public.customer_sites
  set status = 'closed', closed_at = v_now, closed_reason = v_reason, updated_at = v_now
  where company_id = p_company_id and customer_id = p_customer_id;
  get diagnostics v_sites = row_count;

  update public.metering_points mp
  set status = 'closed', closed_at = v_now, closed_reason = v_reason, updated_at = v_now
  where mp.company_id = p_company_id
    and (mp.customer_id = p_customer_id
      or mp.site_id in (
        select s.id from public.customer_sites s
        where s.company_id = p_company_id and s.customer_id = p_customer_id));
  get diagnostics v_points = row_count;

  for v_contract in
    select c.id
    from public.customer_contracts c
    where c.company_id = p_company_id
      and c.customer_id = p_customer_id
      and c.status in ('draft', 'pending_signature', 'signature_failed', 'signed', 'active')
    order by c.id
  loop
    perform public.gridex_record_customer_contract_event_v1(
      p_company_id,
      v_contract.id,
      p_customer_id,
      'cancelled',
      v_now,
      'Avtalet avslutades när kunden arkiverades.',
      jsonb_build_object(
        'ends_at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD'),
        'termination_notice_date', v_now,
        'termination_reason', 'other',
        'rejected_reason', v_reason
      ),
      p_actor_user_id,
      null,
      'customer-archive:' || p_customer_id::text || ':' || v_contract.id::text
    );
    v_contracts := v_contracts + 1;
  end loop;

  with failed as (
    update public.supplier_switch_requests
    set status = 'failed', failed_at = v_now, failure_reason = v_reason, updated_at = v_now
    where company_id = p_company_id
      and customer_id = p_customer_id
      and status in ('draft', 'queued', 'submitted', 'accepted',
        'cancellation_requested', 'cancellation_sent', 'manual_followup_required')
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_switch_ids from failed;

  insert into public.audit_logs (
    actor_user_id, company_id, entity_type, entity_id, action,
    old_values, new_values, metadata, previous_status, new_status
  ) values (
    p_actor_user_id, p_company_id, 'customer', p_customer_id::text, 'customer.archived',
    to_jsonb(v_customer), to_jsonb(v_after),
    jsonb_build_object(
      'label', 'Arkiverade kund',
      'reason', v_reason,
      'retainedData', true,
      'hardDelete', false,
      'closedSites', v_sites,
      'closedMeteringPoints', v_points,
      'cancelledContracts', v_contracts,
      'failedSwitchRequests', coalesce(array_length(v_switch_ids, 1), 0),
      'source', 'gridex_archive_customer_v1'
    ),
    v_customer.status, 'archived'
  );

  return jsonb_build_object(
    'customer', to_jsonb(v_after),
    'already_archived', false,
    'closed_sites', v_sites,
    'closed_metering_points', v_points,
    'cancelled_contracts', v_contracts,
    'failed_switch_request_ids', to_jsonb(v_switch_ids)
  );
end
$function$;

revoke all on function public.gridex_archive_customer_v1(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.gridex_archive_customer_v1(uuid, uuid, uuid, text) to service_role;

create or replace function public.gridex_assert_customer_not_archived_for_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_status text;
begin
  if new.customer_id is null then
    return new;
  end if;

  select status into v_status from public.customers where id = new.customer_id;

  if v_status = 'archived' then
    raise exception 'Customer % is archived, new % rows are blocked', new.customer_id, tg_table_name
      using errcode = 'P0001';
  end if;

  return new;
end
$function$;

revoke all on function public.gridex_assert_customer_not_archived_for_insert() from public, anon, authenticated;

drop trigger if exists customer_contracts_customer_archived_guard_trg on public.customer_contracts;
create trigger customer_contracts_customer_archived_guard_trg
  before insert on public.customer_contracts
  for each row execute function public.gridex_assert_customer_not_archived_for_insert();

drop trigger if exists supplier_switch_requests_customer_archived_guard_trg on public.supplier_switch_requests;
create trigger supplier_switch_requests_customer_archived_guard_trg
  before insert on public.supplier_switch_requests
  for each row execute function public.gridex_assert_customer_not_archived_for_insert();

drop trigger if exists customer_sites_customer_archived_guard_trg on public.customer_sites;
create trigger customer_sites_customer_archived_guard_trg
  before insert on public.customer_sites
  for each row execute function public.gridex_assert_customer_not_archived_for_insert();

drop trigger if exists metering_points_customer_archived_guard_trg on public.metering_points;
create trigger metering_points_customer_archived_guard_trg
  before insert on public.metering_points
  for each row execute function public.gridex_assert_customer_not_archived_for_insert();
