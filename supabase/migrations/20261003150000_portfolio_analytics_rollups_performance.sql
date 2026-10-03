-- Portfolio and analytics performance: monthly consumption rollup and set-based rebuilds.
--
-- Measured on 5 000 customers / 8.76M hourly values (scripts/sql/customer-portfolio/30_perf_seed.sql):
-- bidding-zone split 8.0 s, uncached forecast 8.9 s, forecast vs actual 2.5 s and the
-- 12-month summary 1.3 s per page view, because they read hourly metering_values or ran
-- correlated subqueries. The nightly analytics builder issued ~4 HTTP queries per customer
-- and summed rows client-side, where PostgREST's row cap silently truncated kWh totals.
--
-- Fixes:
--   * metering_point_monthly_consumption: one row per point and month, rebuilt set-based;
--     forecast, bidding zones and forecast-vs-actual read it instead of hourly values.
--   * monthly summary and cohorts rewritten as joins + grouping.
--   * gridex_rebuild_company_analytics_month: company, customer, bidding-zone and grid-owner
--     monthly metrics in one transaction, plus the portfolio snapshot.
-- kWh is coalesce(value_kwh, quantity_kwh, quantity): writers use all three columns.
-- Months are UTC calendar months, as everywhere else in analytics.
-- No destructive DDL or row removal: the hosted apply path stalls on such statements.

-- ---------------------------------------------------------------------------
-- 1. Monthly consumption rollup
-- ---------------------------------------------------------------------------
create table if not exists public.metering_point_monthly_consumption (
  company_id uuid not null references public.companies(id),
  metering_point_id uuid not null,
  month date not null,
  kwh numeric not null default 0,
  value_count integer not null default 0,
  computed_at timestamptz not null default now(),
  constraint metering_point_monthly_consumption_pkey primary key (company_id, metering_point_id, month),
  constraint metering_point_monthly_consumption_month_start check (month = date_trunc('month', month)::date)
);

create index if not exists metering_point_monthly_consumption_company_month_idx
  on public.metering_point_monthly_consumption(company_id, month);

alter table public.metering_point_monthly_consumption enable row level security;
revoke all on table public.metering_point_monthly_consumption from public, anon, authenticated;
grant all on table public.metering_point_monthly_consumption to service_role;

insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values (
  'metering_point_monthly_consumption',
  'system',
  'Service-role only: monthly consumption per metering point rebuilt by gridex_rebuild_metering_monthly_consumption with the tenant from its parameter; read only through security-definer portfolio and analytics RPCs.',
  'migration'
)
on conflict (table_name) do nothing;

-- grid_owner_monthly_metrics: the live database already has this key; make the repository
-- converge so the set-based upsert below has a conflict target everywhere.
create unique index if not exists grid_owner_monthly_metrics_company_owner_month_uidx
  on public.grid_owner_monthly_metrics (company_id, coalesce(grid_owner_id, '00000000-0000-0000-0000-000000000000'::uuid), month);

create index if not exists customer_supply_periods_company_start_idx
  on public.customer_supply_periods(company_id, start_date);

-- Rebuild [p_from_month, p_to_month]. Points without current values in a month keep a row
-- with kwh = 0 and value_count = 0 (rows are zeroed, never removed).
create or replace function public.gridex_rebuild_metering_monthly_consumption(
  p_company_id uuid,
  p_from_month date,
  p_to_month date
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date := date_trunc('month', p_from_month)::date;
  v_to date := date_trunc('month', p_to_month)::date;
  v_rows integer;
begin
  if p_company_id is null or p_from_month is null or p_to_month is null or v_from > v_to or v_to - v_from > 800 then
    raise exception 'Invalid company or month range' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('metering_monthly_consumption:' || p_company_id::text, 0));

  with fresh as (
    select mv.metering_point_id,
           date_trunc('month', mv.period_start)::date as month,
           sum(coalesce(mv.value_kwh, mv.quantity_kwh, mv.quantity)) as kwh,
           count(*)::integer as value_count
    from public.metering_values mv
    where mv.company_id = p_company_id
      and mv.metering_point_id is not null
      and coalesce(mv.is_current, true)
      and coalesce(mv.reading_type, 'consumption') = 'consumption'
      and coalesce(mv.value_kwh, mv.quantity_kwh, mv.quantity) is not null
      and mv.period_start >= v_from
      and mv.period_start < v_to + interval '1 month'
    group by 1, 2
  ),
  upserted as (
    insert into public.metering_point_monthly_consumption as c (company_id, metering_point_id, month, kwh, value_count, computed_at)
    select p_company_id, f.metering_point_id, f.month, f.kwh, f.value_count, now()
    from fresh f
    on conflict (company_id, metering_point_id, month) do update set
      kwh = excluded.kwh,
      value_count = excluded.value_count,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_rows from upserted;

  update public.metering_point_monthly_consumption c
     set kwh = 0, value_count = 0, computed_at = now()
   where c.company_id = p_company_id
     and c.month between v_from and v_to
     and c.value_count > 0
     and c.computed_at < now();

  return v_rows;
end;
$$;

revoke all on function public.gridex_rebuild_metering_monthly_consumption(uuid, date, date) from public, anon, authenticated;
grant execute on function public.gridex_rebuild_metering_monthly_consumption(uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Forecast reads the rollup (12 rows per point instead of ~8 760)
-- ---------------------------------------------------------------------------
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
as $$
declare
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
      and sp.start_date <= v_start
      and (sp.end_date is null or sp.end_date >= v_start)
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
  where pt.supply_end is null or pt.supply_end >= t.t_month;
end;
$$;

-- Forecast vs actual: actual from the rollup.
create or replace function public.gridex_customer_portfolio_forecast_accuracy(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (month date, forecast_kwh numeric, actual_kwh numeric, diff_kwh numeric, diff_percent numeric)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'Invalid period' using errcode = '22023';
  end if;

  return query
  with months as (
    select gs::date as m
    from generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month') gs
  ),
  fc as (
    select s.as_of_month as m, s.forecast_kwh
    from public.customer_portfolio_forecast_snapshots s
    where s.company_id = p_company_id and s.month_index = 1
  ),
  act as (
    select r.month as m, sum(r.kwh) as kwh
    from public.metering_point_monthly_consumption r
    where r.company_id = p_company_id
      and r.value_count > 0
      and r.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    group by 1
  )
  select mo.m, fc.forecast_kwh, round(act.kwh, 3),
         round(act.kwh - fc.forecast_kwh, 3),
         case when fc.forecast_kwh > 0 then round((act.kwh - fc.forecast_kwh) / fc.forecast_kwh * 100, 2) end
  from months mo
  left join fc on fc.m = mo.m
  left join act on act.m = mo.m
  order by mo.m;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Monthly summary and cohorts as joins + grouping
-- ---------------------------------------------------------------------------
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
           x.valid_from, x.valid_to, x.status
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
           count(*) as total,
           count(*) filter (where x.request_scope in ('meter_values', 'billing_underlay')
             and x.requested_period_start is not null
             and x.requested_period_start < date_trunc('month', x.requested_at)::date) as historical,
           count(*) filter (where x.request_scope in ('meter_values', 'billing_underlay')
             and (x.requested_period_start is null
                  or x.requested_period_start >= date_trunc('month', x.requested_at)::date)) as ongoing,
           count(*) filter (where x.status in ('failed', 'rejected', 'error')) as failed
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

create or replace function public.gridex_customer_portfolio_cohorts(
  p_company_id uuid,
  p_months integer default 12
)
returns table (cohort_month date, customers integer, retained_1m numeric, retained_3m numeric, retained_6m numeric, retained_12m numeric)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_months integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_from date := (date_trunc('month', current_date) - make_interval(months => v_months - 1))::date;
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
    having min(p.start_date) >= v_from
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
           case when max(r.at_date) < current_date then round(avg(case when r.active then 1 else 0 end), 4) end as rate
    from results r
    group by r.cohort, r.k
  )
  select mb.cohort,
         count(*)::integer,
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

-- ---------------------------------------------------------------------------
-- 4. Company analytics month in one transaction (replaces client-side N+1 sums)
-- ---------------------------------------------------------------------------
-- One row per metering point for a month: canonical point attributes + rolled-up kWh.
create or replace function public.gridex_analytics_point_month_internal(
  p_company_id uuid,
  p_month date
)
returns table (
  metering_point_id uuid,
  customer_id uuid,
  grid_owner_id uuid,
  bidding_zone_code text,
  kwh numeric,
  value_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select mp.id, mp.customer_id, mp.grid_owner_id, upper(nullif(trim(mp.bidding_zone_code), '')),
         coalesce(r.kwh, 0), coalesce(r.value_count, 0)
  from public.metering_points mp
  left join public.metering_point_monthly_consumption r
    on r.company_id = p_company_id and r.metering_point_id = mp.id
   and r.month = date_trunc('month', p_month)::date
  where mp.company_id = p_company_id;
end;
$$;

revoke all on function public.gridex_analytics_point_month_internal(uuid, date) from public, anon, authenticated;
grant execute on function public.gridex_analytics_point_month_internal(uuid, date) to service_role;

create or replace function public.gridex_rebuild_company_analytics_month(
  p_company_id uuid,
  p_month date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_run_id uuid;
  v_customers integer;
  v_zones integer;
  v_owners integer;
begin
  if p_company_id is null or p_month is null then
    raise exception 'company_id and month are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company_analytics:' || p_company_id::text || ':' || v_month::text, 0));
  perform public.gridex_rebuild_metering_monthly_consumption(p_company_id, v_month, v_month);

  -- Same rule as the analytics forecast page: latest consumption run covering the month.
  select fr.id into v_run_id
  from public.forecast_runs fr
  where fr.company_id = p_company_id
    and fr.forecast_type = 'consumption'
    and fr.period_start <= v_month
    and fr.period_end >= v_month
  order by fr.created_at desc
  limit 1;

  -- Company totals (customer counts are owned by the portfolio snapshot below).
  insert into public.company_monthly_metrics as cmm (
    company_id, month, total_customers, total_sites, active_sites, total_metering_points,
    active_metering_points, metering_values_received, metering_values_missing,
    requested_metering_values, successful_metering_requests, failed_metering_requests,
    forecast_kwh, actual_kwh, diff_kwh, diff_percent, updated_at
  )
  select p_company_id, v_month,
         (select count(*) from public.customers c where c.company_id = p_company_id),
         (select count(*) from public.customer_sites s where s.company_id = p_company_id),
         (select count(*) from public.customer_sites s where s.company_id = p_company_id and s.status in ('active', 'live', 'ongoing')),
         (select count(*) from public.metering_points mp where mp.company_id = p_company_id),
         (select count(*) from public.metering_points mp where mp.company_id = p_company_id and mp.status in ('active', 'live', 'ongoing')),
         (select coalesce(sum(a.value_count), 0) from public.gridex_analytics_point_month_internal(p_company_id, v_month) a),
         (select count(*) from public.data_quality_issues q
           where q.company_id = p_company_id and q.status = 'open' and q.issue_type = 'missing_metering_values'),
         (select count(*) from public.grid_owner_data_requests g
           where g.company_id = p_company_id and g.created_at >= v_month and g.created_at < v_next),
         (select count(*) from public.grid_owner_data_requests g
           where g.company_id = p_company_id and g.created_at >= v_month and g.created_at < v_next
             and g.status in ('completed', 'received', 'success', 'succeeded', 'done')),
         (select count(*) from public.grid_owner_data_requests g
           where g.company_id = p_company_id and g.created_at >= v_month and g.created_at < v_next
             and g.status in ('failed', 'error', 'rejected', 'blocked')),
         f.forecast_kwh, a.actual_kwh,
         a.actual_kwh - f.forecast_kwh,
         case when f.forecast_kwh <> 0 then (a.actual_kwh - f.forecast_kwh) / f.forecast_kwh * 100 end,
         now()
  from (select coalesce(sum(i.forecast_kwh), 0) as forecast_kwh
        from public.forecast_run_items i
        where i.company_id = p_company_id and i.forecast_run_id = v_run_id
          and i.period_start >= v_month and i.period_start < v_next) f,
       (select coalesce(sum(x.kwh), 0) as actual_kwh from public.gridex_analytics_point_month_internal(p_company_id, v_month) x) a
  on conflict (company_id, month) do update set
    total_customers = excluded.total_customers,
    total_sites = excluded.total_sites,
    active_sites = excluded.active_sites,
    total_metering_points = excluded.total_metering_points,
    active_metering_points = excluded.active_metering_points,
    metering_values_received = excluded.metering_values_received,
    metering_values_missing = excluded.metering_values_missing,
    requested_metering_values = excluded.requested_metering_values,
    successful_metering_requests = excluded.successful_metering_requests,
    failed_metering_requests = excluded.failed_metering_requests,
    forecast_kwh = excluded.forecast_kwh,
    actual_kwh = excluded.actual_kwh,
    diff_kwh = excluded.diff_kwh,
    diff_percent = excluded.diff_percent,
    updated_at = excluded.updated_at;

  -- Per customer (all customers, no cap).
  with sites as (
    select s.customer_id, count(*) as cnt from public.customer_sites s
    where s.company_id = p_company_id group by 1
  ),
  points as (
    select a.customer_id, count(*) as cnt, sum(a.kwh) as kwh from public.gridex_analytics_point_month_internal(p_company_id, v_month) a
    where a.customer_id is not null group by 1
  ),
  fc as (
    select i.customer_id, sum(i.forecast_kwh) as kwh from public.forecast_run_items i
    where i.company_id = p_company_id and i.forecast_run_id = v_run_id
      and i.period_start >= v_month and i.period_start < v_next and i.customer_id is not null
    group by 1
  ),
  rows_upserted as (
    insert into public.customer_monthly_metrics as m (
      company_id, customer_id, month, sites_count, metering_points_count,
      forecast_kwh, actual_kwh, diff_kwh, diff_percent, status, updated_at
    )
    select p_company_id, c.id, v_month, coalesce(s.cnt, 0), coalesce(p.cnt, 0),
           coalesce(f.kwh, 0), coalesce(p.kwh, 0),
           coalesce(p.kwh, 0) - coalesce(f.kwh, 0),
           case when coalesce(f.kwh, 0) <> 0 then (coalesce(p.kwh, 0) - f.kwh) / f.kwh * 100 end,
           c.status, now()
    from public.customers c
    left join sites s on s.customer_id = c.id
    left join points p on p.customer_id = c.id
    left join fc f on f.customer_id = c.id
    where c.company_id = p_company_id
    on conflict (company_id, customer_id, month) do update set
      sites_count = excluded.sites_count,
      metering_points_count = excluded.metering_points_count,
      forecast_kwh = excluded.forecast_kwh,
      actual_kwh = excluded.actual_kwh,
      diff_kwh = excluded.diff_kwh,
      diff_percent = excluded.diff_percent,
      status = excluded.status,
      updated_at = excluded.updated_at
    returning 1
  )
  select count(*) into v_customers from rows_upserted;

  -- Per bidding zone (SE1-SE4).
  with zones as (select unnest(array['SE1', 'SE2', 'SE3', 'SE4']) as zone),
  pts as (
    select a.bidding_zone_code as zone, count(*) as cnt, count(distinct a.customer_id) as customers, sum(a.kwh) as kwh
    from public.gridex_analytics_point_month_internal(p_company_id, v_month) a group by 1
  ),
  sites as (
    select upper(nullif(trim(s.bidding_zone_code), '')) as zone, count(*) as cnt
    from public.customer_sites s where s.company_id = p_company_id group by 1
  ),
  fc as (
    select upper(nullif(trim(i.bidding_zone_code), '')) as zone, sum(i.forecast_kwh) as kwh
    from public.forecast_run_items i
    where i.company_id = p_company_id and i.forecast_run_id = v_run_id
      and i.period_start >= v_month and i.period_start < v_next
    group by 1
  ),
  rows_upserted as (
    insert into public.bidding_zone_monthly_metrics as b (
      company_id, bidding_zone_code, month, customers_count, sites_count, metering_points_count,
      forecast_kwh, actual_kwh, diff_kwh, diff_percent, updated_at
    )
    select p_company_id, z.zone, v_month, coalesce(p.customers, 0), coalesce(s.cnt, 0), coalesce(p.cnt, 0),
           coalesce(f.kwh, 0), coalesce(p.kwh, 0),
           coalesce(p.kwh, 0) - coalesce(f.kwh, 0),
           case when coalesce(f.kwh, 0) <> 0 then (coalesce(p.kwh, 0) - f.kwh) / f.kwh * 100 end,
           now()
    from zones z
    left join pts p on p.zone = z.zone
    left join sites s on s.zone = z.zone
    left join fc f on f.zone = z.zone
    on conflict (company_id, bidding_zone_code, month) do update set
      customers_count = excluded.customers_count,
      sites_count = excluded.sites_count,
      metering_points_count = excluded.metering_points_count,
      forecast_kwh = excluded.forecast_kwh,
      actual_kwh = excluded.actual_kwh,
      diff_kwh = excluded.diff_kwh,
      diff_percent = excluded.diff_percent,
      updated_at = excluded.updated_at
    returning 1
  )
  select count(*) into v_zones from rows_upserted;

  -- Per grid owner.
  with owners as (select g.id from public.grid_owners g where g.company_id = p_company_id),
  pts as (
    select a.grid_owner_id, count(*) as cnt, count(distinct a.customer_id) as customers,
           sum(a.kwh) as kwh, sum(a.value_count) as values_received
    from public.gridex_analytics_point_month_internal(p_company_id, v_month) a where a.grid_owner_id is not null group by 1
  ),
  sites as (
    select s.grid_owner_id, count(*) as cnt from public.customer_sites s
    where s.company_id = p_company_id and s.grid_owner_id is not null group by 1
  ),
  reqs as (
    select g.grid_owner_id, count(*) as requested,
           count(*) filter (where g.status in ('failed', 'error', 'rejected', 'blocked')) as failed
    from public.grid_owner_data_requests g
    where g.company_id = p_company_id and g.grid_owner_id is not null
      and g.created_at >= v_month and g.created_at < v_next
    group by 1
  ),
  fc as (
    select i.grid_owner_id, sum(i.forecast_kwh) as kwh from public.forecast_run_items i
    where i.company_id = p_company_id and i.forecast_run_id = v_run_id
      and i.period_start >= v_month and i.period_start < v_next and i.grid_owner_id is not null
    group by 1
  ),
  missing as (
    select count(*) as cnt from public.data_quality_issues q
    where q.company_id = p_company_id and q.status = 'open' and q.issue_type = 'missing_metering_values'
  ),
  rows_upserted as (
    insert into public.grid_owner_monthly_metrics as g (
      company_id, grid_owner_id, month, customers_count, sites_count, metering_points_count,
      metering_values_requested, metering_values_received, metering_values_missing,
      failed_requests_count, forecast_kwh, actual_kwh, updated_at
    )
    select p_company_id, o.id, v_month, coalesce(p.customers, 0), coalesce(s.cnt, 0), coalesce(p.cnt, 0),
           coalesce(r.requested, 0), coalesce(p.values_received, 0), (select cnt from missing),
           coalesce(r.failed, 0), coalesce(f.kwh, 0), coalesce(p.kwh, 0), now()
    from owners o
    left join pts p on p.grid_owner_id = o.id
    left join sites s on s.grid_owner_id = o.id
    left join reqs r on r.grid_owner_id = o.id
    left join fc f on f.grid_owner_id = o.id
    on conflict (company_id, coalesce(grid_owner_id, '00000000-0000-0000-0000-000000000000'::uuid), month) do update set
      customers_count = excluded.customers_count,
      sites_count = excluded.sites_count,
      metering_points_count = excluded.metering_points_count,
      metering_values_requested = excluded.metering_values_requested,
      metering_values_received = excluded.metering_values_received,
      metering_values_missing = excluded.metering_values_missing,
      failed_requests_count = excluded.failed_requests_count,
      forecast_kwh = excluded.forecast_kwh,
      actual_kwh = excluded.actual_kwh,
      updated_at = excluded.updated_at
    returning 1
  )
  select count(*) into v_owners from rows_upserted;

  perform public.gridex_snapshot_customer_portfolio_month(p_company_id, v_month);

  return jsonb_build_object(
    'month', v_month,
    'forecast_run_id', v_run_id,
    'customers', v_customers,
    'bidding_zones', v_zones,
    'grid_owners', v_owners
  );
end;
$$;

revoke all on function public.gridex_rebuild_company_analytics_month(uuid, date) from public, anon, authenticated;
grant execute on function public.gridex_rebuild_company_analytics_month(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill the rollup for the last 13 months
-- ---------------------------------------------------------------------------
do $backfill$
declare
  v_company uuid;
begin
  for v_company in select c.id from public.companies c loop
    perform public.gridex_rebuild_metering_monthly_consumption(
      v_company,
      (date_trunc('month', current_date) - interval '12 months')::date,
      date_trunc('month', current_date)::date
    );
  end loop;
end
$backfill$;
