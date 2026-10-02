-- Power-of-attorney expiry: the status change and its 'expired' event are one write.
--
-- Before: the customer-operations cron updated each overdue POA and then
-- inserted the power_of_attorney_events row separately, swallowing insert
-- errors, so an expired POA could lose its audit event. After: one sweep RPC
-- expires overdue rows and records their events in the same transaction,
-- skipping rows another worker is already handling.

create or replace function public.gridex_expire_overdue_powers_of_attorney_v1(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_expired integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'poa_expiry_service_role_required';
  end if;

  with due as (
    select id
    from public.powers_of_attorney
    where status in ('signed', 'active', 'accepted', 'sent', 'draft')
      and valid_to is not null
      and valid_to < current_date
    order by valid_to, id
    limit v_limit
    for update skip locked
  ),
  expired as (
    update public.powers_of_attorney poa
    set status = 'expired', updated_at = now()
    from due
    where poa.id = due.id
    returning poa.id, poa.company_id, poa.valid_to
  ),
  events as (
    insert into public.power_of_attorney_events (company_id, power_of_attorney_id, event_type, payload)
    select company_id, id, 'expired',
           jsonb_build_object('valid_to', valid_to, 'source', 'customer_operations_cron')
    from expired
    returning 1
  )
  select count(*) into v_expired from events;

  return jsonb_build_object('expired', v_expired);
end
$function$;

revoke all on function public.gridex_expire_overdue_powers_of_attorney_v1(integer) from public, anon, authenticated;
grant execute on function public.gridex_expire_overdue_powers_of_attorney_v1(integer) to service_role;
