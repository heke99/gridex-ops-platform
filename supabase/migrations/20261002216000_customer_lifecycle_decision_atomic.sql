-- Atomic effect of a withdrawal / cancellation / rejection decision.
--
-- The customer card applied the decision with direct writes:
-- * scope "customer" set status 'archived' on the customer row only, so
--   contracts, sites, metering points and switches stayed open;
-- * scope "contract" cancelled the contract with a termination reason but no
--   termination notice date, which the contract guard rejects, so the
--   decision failed for every contract;
-- * scope "site" closed the site but left its metering points open.
-- gridex_register_customer_lifecycle_decision_v1 applies the effect for the
-- chosen scope in one transaction, inside the customer's tenant.

create or replace function public.gridex_register_customer_lifecycle_decision_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_actor_user_id uuid,
  p_decision_type text,
  p_scope_type text,
  p_scope_id uuid,
  p_received_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_now timestamptz := now();
  v_received timestamptz := coalesce(p_received_at, now());
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Kundbeslut registrerat.');
  v_result jsonb := '{}'::jsonb;
  v_rows integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'lifecycle_decision_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_actor_user_id is null
     or p_decision_type not in ('withdrawal', 'cancelled', 'rejected')
     or p_scope_type not in ('customer', 'contract', 'site', 'metering_point')
     or (p_scope_type <> 'customer' and p_scope_id is null) then
    raise exception using errcode = '22023', message = 'lifecycle_decision_payload_invalid';
  end if;

  perform 1 from public.customers
  where id = p_customer_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;

  if p_scope_type = 'customer' then
    -- The whole customer relationship ends: the canonical archive closes the graph.
    v_result := public.gridex_archive_customer_v1(p_company_id, p_customer_id, p_actor_user_id, v_reason);
    update public.customers
    set lifecycle_status_reason = v_reason,
        lifecycle_closed_at = coalesce(lifecycle_closed_at, v_now)
    where id = p_customer_id and company_id = p_company_id;

  elsif p_scope_type = 'contract' then
    perform 1 from public.customer_contracts
    where id = p_scope_id and company_id = p_company_id and customer_id = p_customer_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'contract_not_found_for_customer';
    end if;
    v_result := public.gridex_record_customer_contract_event_v1(
      p_company_id,
      p_scope_id,
      p_customer_id,
      'cancelled',
      v_received,
      v_reason,
      jsonb_build_object(
        'reason_code', case when p_decision_type = 'withdrawal' then 'cancelled_by_customer' else p_decision_type end,
        'withdrawal_requested_at', case when p_decision_type = 'withdrawal' then v_received end,
        'rejected_reason', case when p_decision_type = 'rejected' then v_reason end,
        'termination_reason', case p_decision_type
          when 'withdrawal' then 'customer_withdrawal'
          when 'cancelled' then 'customer_request'
          else 'other' end,
        'termination_notice_date', v_received,
        'ends_at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD')
      ),
      p_actor_user_id,
      null,
      'lifecycle-decision:' || p_scope_id::text || ':' || p_decision_type
    );

  elsif p_scope_type = 'site' then
    update public.customer_sites
    set status = 'closed', closed_at = v_now, closed_reason = v_reason, updated_by = p_actor_user_id
    where id = p_scope_id and customer_id = p_customer_id and company_id = p_company_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception using errcode = 'P0002', message = 'site_not_found_for_customer';
    end if;
    update public.metering_points
    set status = 'closed', closed_at = v_now, closed_reason = v_reason, updated_by = p_actor_user_id
    where site_id = p_scope_id and company_id = p_company_id and status <> 'closed';
    get diagnostics v_rows = row_count;
    v_result := jsonb_build_object('closed_metering_points', v_rows);

  else
    update public.metering_points
    set status = 'closed', closed_at = v_now, closed_reason = v_reason, updated_by = p_actor_user_id
    where id = p_scope_id
      and company_id = p_company_id
      and (customer_id = p_customer_id
        or site_id in (select s.id from public.customer_sites s
                       where s.customer_id = p_customer_id and s.company_id = p_company_id));
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception using errcode = 'P0002', message = 'metering_point_not_found_for_customer';
    end if;
  end if;

  return jsonb_build_object('scope_type', p_scope_type, 'scope_id', p_scope_id, 'effect', v_result);
end
$function$;

revoke all on function public.gridex_register_customer_lifecycle_decision_v1(uuid, uuid, uuid, text, text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.gridex_register_customer_lifecycle_decision_v1(uuid, uuid, uuid, text, text, uuid, timestamptz, text) to service_role;
