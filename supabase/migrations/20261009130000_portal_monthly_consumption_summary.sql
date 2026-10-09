-- ops-api-review F15: complete-month consumption totals for the OPS customer portal.
--
-- The portal previously summed only the newest 250/500 detail rows per month card. This function
-- aggregates the whole Europe/Stockholm calendar month natively, bounded to one tenant and the
-- authenticated portal customers, using only the current revision of each metering value
-- (corrections never double count) and only the gross consumption direction. Coverage fields let
-- the UI mark incomplete months (missing intervals) instead of presenting a partial sum as complete.

create or replace function public.gridex_portal_monthly_consumption_v1(
  p_company_id uuid,
  p_customer_ids uuid[],
  p_from_month date,
  p_to_month date
)
returns table (
  month_key text,
  total_kwh numeric,
  value_count bigint,
  metering_point_count bigint,
  covered_seconds bigint,
  expected_seconds bigint,
  is_complete boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_company_id is null
     or p_customer_ids is null
     or cardinality(p_customer_ids) = 0
     or cardinality(p_customer_ids) > 50
     or array_position(p_customer_ids, null) is not null then
    raise exception 'portal_consumption_scope_invalid' using errcode = '22023';
  end if;
  if p_from_month is null or p_to_month is null or p_from_month > p_to_month
     or p_to_month > (p_from_month + interval '36 months')::date then
    raise exception 'portal_consumption_period_invalid' using errcode = '22023';
  end if;
  -- Every requested customer must belong to the requested tenant.
  if exists (
    select 1
      from unnest(p_customer_ids) as requested(customer_id)
     where not exists (
       select 1 from public.customers c
        where c.id = requested.customer_id and c.company_id = p_company_id
     )
  ) then
    raise exception 'portal_consumption_customer_scope_invalid' using errcode = '42501';
  end if;

  v_from := date_trunc('month', p_from_month::timestamp) at time zone 'Europe/Stockholm';
  v_to := (date_trunc('month', p_to_month::timestamp) + interval '1 month') at time zone 'Europe/Stockholm';

  return query
  with current_values as (
    select
      to_char(date_trunc('month', mv.period_start at time zone 'Europe/Stockholm'), 'YYYY-MM') as month_key,
      coalesce(mv.metering_point_id::text, '') as metering_point,
      mv.value_kwh,
      case when mv.period_end > mv.period_start
           then extract(epoch from (mv.period_end - mv.period_start))
           else 0 end as seconds
    from public.metering_values mv
    where mv.company_id = p_company_id
      and mv.customer_id = any(p_customer_ids)
      and mv.period_start >= v_from
      and mv.period_start < v_to
      and mv.is_current
      and mv.revision_status = 'current'
      and mv.direction = 'consumption'
      and mv.value_kwh is not null
  ),
  months as (
    select
      cv.month_key,
      sum(cv.value_kwh)::numeric as total_kwh,
      count(*)::bigint as value_count,
      count(distinct cv.metering_point)::bigint as metering_point_count,
      sum(cv.seconds)::bigint as covered_seconds
    from current_values cv
    group by cv.month_key
  )
  select
    m.month_key,
    m.total_kwh,
    m.value_count,
    m.metering_point_count,
    m.covered_seconds,
    (m.metering_point_count * extract(epoch from (
      ((to_date(m.month_key, 'YYYY-MM') + interval '1 month')::timestamp at time zone 'Europe/Stockholm')
      - (to_date(m.month_key, 'YYYY-MM')::timestamp at time zone 'Europe/Stockholm')
    )))::bigint as expected_seconds,
    m.covered_seconds >= (m.metering_point_count * extract(epoch from (
      ((to_date(m.month_key, 'YYYY-MM') + interval '1 month')::timestamp at time zone 'Europe/Stockholm')
      - (to_date(m.month_key, 'YYYY-MM')::timestamp at time zone 'Europe/Stockholm')
    )))::bigint as is_complete
  from months m
  order by m.month_key desc;
end;
$$;

revoke all on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) from public;
revoke all on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) from anon;
revoke all on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) from authenticated;
grant execute on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) to service_role;

comment on function public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date) is
  'OPS portal: complete Europe/Stockholm month consumption totals per tenant/customer set; current revision and gross consumption only; service_role only.';
