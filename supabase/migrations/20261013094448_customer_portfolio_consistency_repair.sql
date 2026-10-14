-- Customer portfolio consistency: UTC timestamp expiry dates, exact cohort counts,
-- metering-only requests and explicit forecast eligibility at the requested date.
-- Forward repair only: preserves historical snapshots, tenant assertions and grants.
-- Current-month forecasts compute from current eligibility; historical snapshots stay immutable.

-- Timestamp-shaped production PoA expiry
create or replace function public.gridex_customer_portfolio_expiring_poa(
  p_company_id uuid,
  p_days integer default 30
)
returns table (power_of_attorney_id uuid, customer_id uuid, customer_name text, scope text, valid_to date, days_left integer)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
set timezone = 'UTC'
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);
  return query
  with expiring as (
    select x.*, (x.valid_to::timestamptz at time zone 'UTC')::date as expiry_date
    from public.powers_of_attorney x
    where x.company_id = p_company_id
      and x.status in ('signed', 'accepted', 'active', 'completed')
  )
  select x.id, x.customer_id,
         coalesce(nullif(trim(c.full_name), ''), nullif(trim(c.company_name), ''),
                  nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.customer_number),
         x.scope, x.expiry_date, (x.expiry_date - v_today)::integer
  from expiring x
  left join public.customers c on c.id = x.customer_id and c.company_id = x.company_id
  where x.expiry_date between v_today and v_today + least(greatest(coalesce(p_days, 30), 1), 365)
  order by x.expiry_date, x.id
  limit 500;
end;
$$;

-- Metering request scope partition and UTC PoA dates
create or replace function public.gridex_customer_portfolio_monthly_internal(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (
  month date,
  active_customers_start integer,
  active_customers integer,
  new_customers integer,
  churned_customers integer,
  net_change integer,
  churn_rate numeric,
  active_metering_points integer,
  poa_requested integer,
  poa_signed integer,
  poa_active integer,
  metering_requests_total integer,
  metering_requests_historical integer,
  metering_requests_ongoing integer,
  metering_requests_failed integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_from date := date_trunc('month', p_from)::date;
  v_to date := date_trunc('month', p_to)::date;
begin
  return query
  with months as (
    select gs::date as m_start,
           (gs + interval '1 month' - interval '1 day')::date as m_end
    from generate_series(v_from, v_to, interval '1 month') gs
  ),
  periods as (
    select sp.customer_id, sp.metering_point_id, sp.start_date, sp.end_date
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id
      and sp.status <> 'cancelled'
      and sp.start_date <= (v_to + interval '1 month' - interval '1 day')::date
      and (sp.end_date is null or sp.end_date >= v_from - 1)
  ),
  active as (
    select m.m_start,
           count(distinct p.customer_id) filter (
             where p.start_date <= m.m_start - 1 and (p.end_date is null or p.end_date > m.m_start - 1)) as start_cnt,
           count(distinct p.customer_id) filter (
             where p.start_date <= m.m_end and (p.end_date is null or p.end_date > m.m_end)) as end_cnt,
           count(distinct p.metering_point_id) filter (
             where p.start_date <= m.m_end and (p.end_date is null or p.end_date > m.m_end)) as points_cnt
    from months m
    join periods p on p.start_date <= m.m_end and (p.end_date is null or p.end_date > m.m_start - 1)
    group by m.m_start
  ),
  spans as (
    select sp.customer_id,
           min(sp.start_date) as first_start,
           case when bool_or(sp.end_date is null) then null else max(sp.end_date) end as last_end
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id and sp.status <> 'cancelled'
    group by sp.customer_id
  ),
  starts as (
    select date_trunc('month', s.first_start)::date as m, count(*) as cnt
    from spans s where s.first_start >= v_from group by 1
  ),
  ends as (
    select date_trunc('month', s.last_end)::date as m, count(*) as cnt
    from spans s where s.last_end >= v_from group by 1
  ),
  poa as (
    select x.created_at::date as created_on, x.signed_at::date as signed_on,
           (x.valid_from::timestamptz at time zone 'UTC')::date as valid_from,
           (x.valid_to::timestamptz at time zone 'UTC')::date as valid_to, x.status
    from public.powers_of_attorney x
    where x.company_id = p_company_id
  ),
  poa_created as (
    select date_trunc('month', x.created_on)::date as m, count(*) as cnt from poa x where x.created_on >= v_from group by 1
  ),
  poa_signed as (
    select date_trunc('month', x.signed_on)::date as m, count(*) as cnt from poa x where x.signed_on >= v_from group by 1
  ),
  poa_valid as (
    select m.m_start, count(*) as cnt
    from months m
    join poa x on x.status in ('signed', 'accepted', 'active', 'completed')
      and coalesce(x.valid_from, x.signed_on, x.created_on) <= m.m_end
      and (x.valid_to is null or x.valid_to >= m.m_end)
    group by m.m_start
  ),
  req as (
    select date_trunc('month', x.requested_at)::date as m,
           count(*) filter (where x.request_scope in ('meter_values', 'billing_underlay')) as total,
           count(*) filter (where x.request_scope in ('meter_values', 'billing_underlay')
             and x.requested_period_start is not null
             and x.requested_period_start < date_trunc('month', x.requested_at)::date) as historical,
           count(*) filter (where x.request_scope in ('meter_values', 'billing_underlay')
             and (x.requested_period_start is null
                  or x.requested_period_start >= date_trunc('month', x.requested_at)::date)) as ongoing,
           count(*) filter (where x.request_scope in ('meter_values', 'billing_underlay')
             and x.status in ('failed', 'rejected', 'error')) as failed
    from public.grid_owner_data_requests x
    where x.company_id = p_company_id
      and x.requested_at >= v_from
      and x.requested_at < v_to + interval '1 month'
    group by 1
  )
  select m.m_start,
         coalesce(a.start_cnt, 0)::integer,
         coalesce(a.end_cnt, 0)::integer,
         coalesce(st.cnt, 0)::integer,
         coalesce(en.cnt, 0)::integer,
         null::integer,
         null::numeric,
         coalesce(a.points_cnt, 0)::integer,
         coalesce(pc.cnt, 0)::integer,
         coalesce(ps.cnt, 0)::integer,
         coalesce(pv.cnt, 0)::integer,
         coalesce(r.total, 0)::integer,
         coalesce(r.historical, 0)::integer,
         coalesce(r.ongoing, 0)::integer,
         coalesce(r.failed, 0)::integer
  from months m
  left join active a on a.m_start = m.m_start
  left join starts st on st.m = m.m_start
  left join ends en on en.m = m.m_start
  left join poa_created pc on pc.m = m.m_start
  left join poa_signed ps on ps.m = m.m_start
  left join poa_valid pv on pv.m_start = m.m_start
  left join req r on r.m = m.m_start
  order by m.m_start;
end;
$$;

-- Actual as-of supply eligibility, independent of target month
create or replace function public.gridex_customer_portfolio_point_forecast_internal(
  p_company_id uuid,
  p_as_of date default current_date,
  p_months integer default 12
)
returns table (
  month date,
  month_index integer,
  metering_point_id uuid,
  kwh numeric,
  has_history boolean,
  exact boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_start date := date_trunc('month', coalesce(p_as_of, current_date))::date;
  v_hist_from date := (date_trunc('month', coalesce(p_as_of, current_date)) - interval '12 months')::date;
  v_months integer := least(greatest(coalesce(p_months, 12), 1), 24);
begin
  return query
  with targets as (
    select (v_start + make_interval(months => i))::date as t_month, i + 1 as idx
    from generate_series(0, v_months - 1) i
  ),
  profile as (
    select w.month_number, w.weight_percent * 12 / 100.0 as factor
    from public.consumption_profile_month_weights w
    where w.profile_id = (
      select cp.id from public.consumption_profiles cp
      where cp.is_default = true and (cp.company_id = p_company_id or cp.company_id is null)
      order by (cp.company_id is null), cp.created_at
      limit 1
    )
  ),
  points as (
    select sp.metering_point_id,
           case when bool_or(sp.end_date is null) then null else max(sp.end_date) end as supply_end
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id
      and sp.status <> 'cancelled'
      and sp.start_date <= v_as_of
      and (sp.end_date is null or sp.end_date > v_as_of)
    group by sp.metering_point_id
  ),
  history as (
    select r.metering_point_id, extract(month from r.month)::integer as month_number, r.kwh
    from public.metering_point_monthly_consumption r
    join points pt on pt.metering_point_id = r.metering_point_id
    where r.company_id = p_company_id
      and r.value_count > 0
      and r.month >= v_hist_from
      and r.month < v_start
  ),
  point_avg as (
    select h.metering_point_id, avg(h.kwh) as avg_kwh from history h group by 1
  ),
  company_avg as (
    select avg(pa.avg_kwh) as avg_kwh from point_avg pa
  )
  select t.t_month, t.idx, pt.metering_point_id,
         greatest(0, coalesce(
           h.kwh,
           pa.avg_kwh * coalesce(pr.factor, 1),
           (select ca.avg_kwh from company_avg ca) * coalesce(pr.factor, 1),
           0
         )),
         (pa.metering_point_id is not null),
         (h.kwh is not null)
  from targets t
  cross join points pt
  left join history h on h.metering_point_id = pt.metering_point_id
    and h.month_number = extract(month from t.t_month)::integer
  left join point_avg pa on pa.metering_point_id = pt.metering_point_id
  left join profile pr on pr.month_number = extract(month from t.t_month)::integer
  where pt.supply_end is null or pt.supply_end > t.t_month;
end;
$$;

-- Preserve eligibility date through forecast aggregation
create or replace function public.gridex_customer_portfolio_forecast_internal(
  p_company_id uuid,
  p_as_of date default current_date,
  p_months integer default 12
)
returns table (
  month date,
  month_index integer,
  forecast_kwh numeric,
  low_kwh numeric,
  high_kwh numeric,
  metering_points integer,
  points_with_history integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_start date := date_trunc('month', coalesce(p_as_of, current_date))::date;
  v_months integer := least(greatest(coalesce(p_months, 12), 1), 24);
begin
  return query
  with targets as (
    select (v_start + make_interval(months => i))::date as t_month, i + 1 as idx
    from generate_series(0, v_months - 1) i
  ),
  pp as (
    select * from public.gridex_customer_portfolio_point_forecast_internal(p_company_id, coalesce(p_as_of, current_date), v_months)
  )
  select t.t_month, t.idx,
         round(coalesce(sum(pp.kwh), 0), 3),
         round(coalesce(sum(pp.kwh * case when pp.exact then 0.92 when pp.has_history then 0.85 else 0.7 end), 0), 3),
         round(coalesce(sum(pp.kwh * case when pp.exact then 1.08 when pp.has_history then 1.15 else 1.3 end), 0), 3),
         count(pp.metering_point_id)::integer,
         count(pp.metering_point_id) filter (where pp.has_history)::integer
  from targets t
  left join pp on pp.month = t.t_month
  group by t.t_month, t.idx
  order by t.t_month;
end;
$$;

-- Historical cache only; current forecasts include newly started supply
create or replace function public.gridex_customer_portfolio_forecast_cached_internal(
  p_company_id uuid,
  p_as_of date default current_date
)
returns table (
  month date,
  month_index integer,
  forecast_kwh numeric,
  low_kwh numeric,
  high_kwh numeric,
  metering_points integer,
  points_with_history integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_month date := date_trunc('month', coalesce(p_as_of, current_date))::date;
begin
  if v_month < date_trunc('month', current_date)::date and exists (
    select 1 from public.customer_portfolio_forecast_snapshots s
    where s.company_id = p_company_id and s.as_of_month = v_month
  ) then
    return query
    select s.month, s.month_index, s.forecast_kwh, s.low_kwh, s.high_kwh, s.metering_points, s.points_with_history
    from public.customer_portfolio_forecast_snapshots s
    where s.company_id = p_company_id and s.as_of_month = v_month
    order by s.month;
  else
    return query select * from public.gridex_customer_portfolio_forecast_internal(p_company_id, coalesce(p_as_of, current_date), 12);
  end if;
end;
$$;

-- Explicit cohort date with exact unique membership count
create or replace function public.gridex_customer_portfolio_cohorts_at(
  p_company_id uuid,
  p_as_of date,
  p_months integer default 12
)
returns table (cohort_month date, customers integer, retained_1m numeric, retained_3m numeric, retained_6m numeric, retained_12m numeric)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
set timezone = 'UTC'
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_months integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_from date := (date_trunc('month', v_as_of) - make_interval(months => v_months - 1))::date;
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);

  return query
  with periods as (
    select sp.customer_id, sp.start_date, sp.end_date
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id and sp.status <> 'cancelled'
  ),
  members as (
    select p.customer_id, date_trunc('month', min(p.start_date))::date as cohort
    from periods p
    group by p.customer_id
    having min(p.start_date) >= v_from and min(p.start_date) <= v_as_of
  ),
  checks as (
    select mb.cohort, mb.customer_id, k.k,
           (mb.cohort + make_interval(months => k.k + 1) - interval '1 day')::date as at_date
    from members mb
    cross join (values (1), (3), (6), (12)) as k(k)
  ),
  results as (
    select c.cohort, c.customer_id, c.k, c.at_date, count(p.customer_id) > 0 as active
    from checks c
    left join periods p on p.customer_id = c.customer_id
      and p.start_date <= c.at_date and (p.end_date is null or p.end_date > c.at_date)
    group by c.cohort, c.customer_id, c.k, c.at_date
  ),
  rates as (
    select r.cohort, r.k,
           case when max(r.at_date) < v_as_of then round(avg(case when r.active then 1 else 0 end), 4) end as rate
    from results r
    group by r.cohort, r.k
  )
  select mb.cohort,
         count(distinct mb.customer_id)::integer,
         max(ra.rate) filter (where ra.k = 1),
         max(ra.rate) filter (where ra.k = 3),
         max(ra.rate) filter (where ra.k = 6),
         max(ra.rate) filter (where ra.k = 12)
  from members mb
  left join rates ra on ra.cohort = mb.cohort
  group by mb.cohort
  order by mb.cohort;
end;
$$;

-- Backward-compatible cohort RPC
create or replace function public.gridex_customer_portfolio_cohorts(
  p_company_id uuid,
  p_months integer default 12
)
returns table (cohort_month date, customers integer, retained_1m numeric, retained_3m numeric, retained_6m numeric, retained_12m numeric)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
set timezone = 'UTC'
as $$
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);
  return query select * from public.gridex_customer_portfolio_cohorts_at(p_company_id, current_date, p_months);
end;
$$;

-- Same forecast anchor in white-label overview and detail
create or replace function public.gridex_whitelabel_portfolio_overview(
  p_white_label_platform_id uuid,
  p_month date default current_date
)
returns table (
  company_id uuid,
  company_name text,
  company_status text,
  active_customers integer,
  new_customers integer,
  churned_customers integer,
  net_change integer,
  poa_requested integer,
  poa_active integer,
  metering_requests_total integer,
  metering_requests_historical integer,
  forecast_month_kwh numeric,
  forecast_3m_kwh numeric,
  forecast_6m_kwh numeric,
  forecast_12m_kwh numeric
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
set timezone = 'UTC'
as $$
declare
  v_as_of date := coalesce(p_month, current_date);
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  if not public.gridex_user_can_read_whitelabel_platform(p_white_label_platform_id)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed to read this white-label platform' using errcode = '42501';
  end if;

  return query
  select c.id, c.name, c.status,
         s.active_customers, s.new_customers, s.churned_customers,
         s.active_customers - s.active_customers_start,
         s.poa_requested, s.poa_active, s.metering_requests_total, s.metering_requests_historical,
         f.m1, f.m3, f.m6, f.m12
  from public.companies c
  cross join lateral public.gridex_customer_portfolio_monthly_internal(c.id, v_month, v_month) s
  cross join lateral (
    select sum(x.forecast_kwh) filter (where x.month_index <= 1) as m1,
           sum(x.forecast_kwh) filter (where x.month_index <= 3) as m3,
           sum(x.forecast_kwh) filter (where x.month_index <= 6) as m6,
           sum(x.forecast_kwh) as m12
    from public.gridex_customer_portfolio_forecast_cached_internal(c.id, v_as_of) x
  ) f
  where c.white_label_platform_id = p_white_label_platform_id
    and c.status <> 'deleted_test_only'
  order by c.name;
end;
$$;

revoke all on function public.gridex_customer_portfolio_expiring_poa(uuid, integer) from public, anon;
revoke all on function public.gridex_customer_portfolio_cohorts_at(uuid, date, integer) from public, anon;
revoke all on function public.gridex_customer_portfolio_cohorts(uuid, integer) from public, anon;
revoke all on function public.gridex_whitelabel_portfolio_overview(uuid, date) from public, anon;
grant execute on function public.gridex_customer_portfolio_expiring_poa(uuid, integer) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_cohorts_at(uuid, date, integer) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_cohorts(uuid, integer) to authenticated, service_role;
grant execute on function public.gridex_whitelabel_portfolio_overview(uuid, date) to authenticated, service_role;
revoke all on function public.gridex_customer_portfolio_monthly_internal(uuid, date, date) from public, anon, authenticated;
revoke all on function public.gridex_customer_portfolio_point_forecast_internal(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.gridex_customer_portfolio_forecast_internal(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.gridex_customer_portfolio_forecast_cached_internal(uuid, date) from public, anon, authenticated;
grant execute on function public.gridex_customer_portfolio_monthly_internal(uuid, date, date) to service_role;
grant execute on function public.gridex_customer_portfolio_point_forecast_internal(uuid, date, integer) to service_role;
grant execute on function public.gridex_customer_portfolio_forecast_internal(uuid, date, integer) to service_role;
grant execute on function public.gridex_customer_portfolio_forecast_cached_internal(uuid, date) to service_role;
