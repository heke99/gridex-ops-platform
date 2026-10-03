-- Customer portfolio phase 2: one "active customer" definition for every KPI,
-- persisted forecast snapshots, churn reasons, forecast vs actual, cohort
-- retention, bidding-zone split and expiring powers of attorney.
-- All read RPCs assert tenant or white-label read access first
-- (gridex_customer_portfolio_assert_read, 20261003130000).

-- ---------------------------------------------------------------------------
-- 1. Persisted forecast snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.customer_portfolio_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  as_of_month date not null,
  month date not null,
  month_index integer not null check (month_index between 1 and 24),
  forecast_kwh numeric not null default 0 check (forecast_kwh >= 0),
  low_kwh numeric not null default 0 check (low_kwh >= 0),
  high_kwh numeric not null default 0 check (high_kwh >= 0),
  metering_points integer not null default 0,
  points_with_history integer not null default 0,
  computed_at timestamptz not null default now(),
  constraint customer_portfolio_forecast_snapshots_key unique (company_id, as_of_month, month),
  constraint customer_portfolio_forecast_snapshots_month_start check (
    as_of_month = date_trunc('month', as_of_month)::date and month = date_trunc('month', month)::date
  )
);

-- Service-role only. Clients read forecasts through the read RPCs, which assert
-- tenant or white-label access (gridex_customer_portfolio_assert_read).
alter table public.customer_portfolio_forecast_snapshots enable row level security;

revoke all on table public.customer_portfolio_forecast_snapshots from public, anon, authenticated;
grant all on table public.customer_portfolio_forecast_snapshots to service_role;

insert into public.platform_table_classification (table_name, kind, rationale, classified_by)
values (
  'customer_portfolio_forecast_snapshots',
  'system',
  'Service-role only: written by gridex_snapshot_customer_portfolio_month with the tenant from its parameter and read through security-definer portfolio RPCs that assert tenant or white-label access; no client role holds any privilege.',
  'migration'
)
on conflict (table_name) do nothing;

create index if not exists customer_contracts_company_customer_ends_idx
  on public.customer_contracts(company_id, customer_id, ends_at);
create index if not exists powers_of_attorney_company_valid_to_idx
  on public.powers_of_attorney(company_id, valid_to)
  where valid_to is not null;

-- ---------------------------------------------------------------------------
-- 2. Per-point forecast; the company forecast aggregates it (same algorithm as
--    20261003130000, now reusable for the bidding-zone split)
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
    select mv.metering_point_id,
           extract(month from mv.period_start)::integer as month_number,
           sum(mv.value_kwh) as kwh
    from public.metering_values mv
    join points pt on pt.metering_point_id = mv.metering_point_id
    where mv.company_id = p_company_id
      and mv.is_current
      and mv.reading_type = 'consumption'
      and mv.value_kwh is not null
      and mv.period_start >= v_hist_from
      and mv.period_start < v_start
    group by 1, 2
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
    select * from public.gridex_customer_portfolio_point_forecast_internal(p_company_id, v_start, v_months)
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

-- Snapshot first, live computation as fallback.
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
as $$
declare
  v_month date := date_trunc('month', coalesce(p_as_of, current_date))::date;
begin
  if exists (
    select 1 from public.customer_portfolio_forecast_snapshots s
    where s.company_id = p_company_id and s.as_of_month = v_month
  ) then
    return query
    select s.month, s.month_index, s.forecast_kwh, s.low_kwh, s.high_kwh, s.metering_points, s.points_with_history
    from public.customer_portfolio_forecast_snapshots s
    where s.company_id = p_company_id and s.as_of_month = v_month
    order by s.month;
  else
    return query select * from public.gridex_customer_portfolio_forecast_internal(p_company_id, v_month, 12);
  end if;
end;
$$;

revoke all on function public.gridex_customer_portfolio_point_forecast_internal(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.gridex_customer_portfolio_forecast_internal(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.gridex_customer_portfolio_forecast_cached_internal(uuid, date) from public, anon, authenticated;
grant execute on function public.gridex_customer_portfolio_point_forecast_internal(uuid, date, integer) to service_role;
grant execute on function public.gridex_customer_portfolio_forecast_internal(uuid, date, integer) to service_role;
grant execute on function public.gridex_customer_portfolio_forecast_cached_internal(uuid, date) to service_role;

create or replace function public.gridex_customer_portfolio_forecast(
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
set search_path = public, auth, pg_temp
as $$
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);
  return query
  select * from public.gridex_customer_portfolio_forecast_cached_internal(p_company_id, coalesce(p_as_of, current_date));
end;
$$;

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
as $$
declare
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
    from public.gridex_customer_portfolio_forecast_cached_internal(c.id, v_month) x
  ) f
  where c.white_label_platform_id = p_white_label_platform_id
    and c.status <> 'deleted_test_only'
  order by c.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Snapshot: metrics + forecast in one transaction under one lock.
--    A past month's forecast is written once and never overwritten, so
--    forecast-vs-actual compares against what was actually predicted.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_snapshot_customer_portfolio_month(
  p_company_id uuid,
  p_month date
)
returns public.company_monthly_metrics
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_current date := date_trunc('month', current_date)::date;
  v_row public.company_monthly_metrics;
begin
  if p_company_id is null or p_month is null then
    raise exception 'company_id and month are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer_portfolio:' || p_company_id::text || ':' || v_month::text, 0));

  insert into public.company_monthly_metrics as cmm (
    company_id, month, active_customers, new_customers, ended_customers, churned_customers,
    net_change, churn_rate, poa_requested, poa_signed, poa_active,
    metering_requests_total, metering_requests_historical, metering_requests_ongoing,
    metering_requests_failed, portfolio_source_version, portfolio_computed_at, updated_at
  )
  select p_company_id, v_month, s.active_customers, s.new_customers, s.churned_customers, s.churned_customers,
         s.active_customers - s.active_customers_start,
         case when s.active_customers_start > 0 then round(s.churned_customers::numeric / s.active_customers_start, 4) end,
         s.poa_requested, s.poa_signed, s.poa_active,
         s.metering_requests_total, s.metering_requests_historical, s.metering_requests_ongoing,
         s.metering_requests_failed,
         'customer_portfolio_v2', now(), now()
  from public.gridex_customer_portfolio_monthly_internal(p_company_id, v_month, v_month) s
  on conflict (company_id, month) do update set
    active_customers = excluded.active_customers,
    new_customers = excluded.new_customers,
    ended_customers = excluded.ended_customers,
    churned_customers = excluded.churned_customers,
    net_change = excluded.net_change,
    churn_rate = excluded.churn_rate,
    poa_requested = excluded.poa_requested,
    poa_signed = excluded.poa_signed,
    poa_active = excluded.poa_active,
    metering_requests_total = excluded.metering_requests_total,
    metering_requests_historical = excluded.metering_requests_historical,
    metering_requests_ongoing = excluded.metering_requests_ongoing,
    metering_requests_failed = excluded.metering_requests_failed,
    portfolio_source_version = excluded.portfolio_source_version,
    portfolio_computed_at = excluded.portfolio_computed_at,
    updated_at = excluded.updated_at
  returning cmm.* into v_row;

  if v_month >= v_current or not exists (
    select 1 from public.customer_portfolio_forecast_snapshots s
    where s.company_id = p_company_id and s.as_of_month = v_month
  ) then
    delete from public.customer_portfolio_forecast_snapshots s
    where s.company_id = p_company_id and s.as_of_month = v_month;

    insert into public.customer_portfolio_forecast_snapshots (
      company_id, as_of_month, month, month_index, forecast_kwh, low_kwh, high_kwh,
      metering_points, points_with_history, computed_at
    )
    select p_company_id, v_month, f.month, f.month_index, f.forecast_kwh, f.low_kwh, f.high_kwh,
           f.metering_points, f.points_with_history, now()
    from public.gridex_customer_portfolio_forecast_internal(p_company_id, v_month, 12) f;
  end if;

  return v_row;
end;
$$;

revoke all on function public.gridex_snapshot_customer_portfolio_month(uuid, date) from public, anon, authenticated;
grant execute on function public.gridex_snapshot_customer_portfolio_month(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. One "active customer" count for every KPI (batch)
-- ---------------------------------------------------------------------------
create or replace function public.gridex_customer_portfolio_active_counts(
  p_company_ids uuid[],
  p_at date default current_date
)
returns table (company_id uuid, active_customers integer, active_metering_points integer)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_id uuid;
  v_at date := coalesce(p_at, current_date);
begin
  if p_company_ids is null or cardinality(p_company_ids) > 1000 then
    raise exception 'Between 0 and 1000 companies are required' using errcode = '22023';
  end if;

  foreach v_id in array p_company_ids loop
    perform public.gridex_customer_portfolio_assert_read(v_id);
  end loop;

  return query
  select ids.id,
         count(distinct sp.customer_id)::integer,
         count(distinct sp.metering_point_id)::integer
  from unnest(p_company_ids) as ids(id)
  left join public.customer_supply_periods sp
    on sp.company_id = ids.id
   and sp.status <> 'cancelled'
   and sp.start_date <= v_at
   and (sp.end_date is null or sp.end_date > v_at)
  group by ids.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Add-ons
-- ---------------------------------------------------------------------------

-- Churn reasons per month: contract termination_reason, else the latest completed
-- lifecycle event (reason or type), else the supply source, else 'unknown'.
create or replace function public.gridex_customer_portfolio_churn_reasons(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (month date, reason text, customers integer)
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
  with spans as (
    select sp.customer_id,
           case when bool_or(sp.end_date is null) then null else max(sp.end_date) end as last_end
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id and sp.status <> 'cancelled'
    group by sp.customer_id
  ),
  churned as (
    select s.customer_id, s.last_end
    from spans s
    where s.last_end between date_trunc('month', p_from)::date
                         and (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date
  )
  select date_trunc('month', ch.last_end)::date,
         coalesce(
           (select nullif(trim(cc.termination_reason), '') from public.customer_contracts cc
             where cc.company_id = p_company_id and cc.customer_id = ch.customer_id
               and cc.termination_reason is not null
             order by cc.ends_at desc nulls last limit 1),
           (select coalesce(nullif(trim(e.reason), ''), e.event_type) from public.customer_lifecycle_events e
             where e.company_id = p_company_id and e.customer_id = ch.customer_id
               and e.event_status = 'completed' and e.event_type in ('move_out', 'terminate')
             order by e.effective_date desc nulls last, e.created_at desc limit 1),
           'unknown'
         ) as reason,
         count(*)::integer
  from churned ch
  group by 1, 2
  order by 1, 3 desc;
end;
$$;

-- Forecast vs actual per past month: the forecast made at the start of the month
-- (snapshot, month_index 1) against current consumption values for that month.
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
    select date_trunc('month', mv.period_start)::date as m, sum(mv.value_kwh) as kwh
    from public.metering_values mv
    where mv.company_id = p_company_id
      and mv.is_current and mv.reading_type = 'consumption' and mv.value_kwh is not null
      and mv.period_start >= date_trunc('month', p_from)
      and mv.period_start < date_trunc('month', p_to) + interval '1 month'
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

-- Cohort retention: customers grouped by first supply month; share still supplied
-- 1, 3, 6 and 12 months later (null while that point lies in the future).
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
  firsts as (
    select p.customer_id, date_trunc('month', min(p.start_date))::date as cohort
    from periods p group by p.customer_id
  ),
  cohort_members as (
    select f.cohort, f.customer_id from firsts f where f.cohort >= v_from
  ),
  checks as (
    select cm.cohort, cm.customer_id, k.k,
           (cm.cohort + make_interval(months => k.k + 1) - interval '1 day')::date as at_date
    from cohort_members cm
    cross join (values (1), (3), (6), (12)) as k(k)
  ),
  results as (
    select c.cohort, c.k, c.at_date,
           exists (select 1 from periods p where p.customer_id = c.customer_id
                    and p.start_date <= c.at_date and (p.end_date is null or p.end_date > c.at_date)) as active
    from checks c
  )
  select cm.cohort,
         count(distinct cm.customer_id)::integer,
         (select case when max(r.at_date) < current_date then round(avg(case when r.active then 1 else 0 end), 4) end from results r where r.cohort = cm.cohort and r.k = 1),
         (select case when max(r.at_date) < current_date then round(avg(case when r.active then 1 else 0 end), 4) end from results r where r.cohort = cm.cohort and r.k = 3),
         (select case when max(r.at_date) < current_date then round(avg(case when r.active then 1 else 0 end), 4) end from results r where r.cohort = cm.cohort and r.k = 6),
         (select case when max(r.at_date) < current_date then round(avg(case when r.active then 1 else 0 end), 4) end from results r where r.cohort = cm.cohort and r.k = 12)
  from cohort_members cm
  group by cm.cohort
  order by cm.cohort;
end;
$$;

-- Active customers, points and 12-month forecast per bidding zone (SE1-SE4).
create or replace function public.gridex_customer_portfolio_bidding_zones(
  p_company_id uuid,
  p_as_of date default current_date
)
returns table (bidding_zone_code text, active_customers integer, metering_points integer, forecast_12m_kwh numeric)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_at date := coalesce(p_as_of, current_date);
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);

  return query
  with active as (
    select sp.customer_id, sp.metering_point_id,
           coalesce(nullif(upper(trim(mp.bidding_zone_code)), ''), 'UNKNOWN') as zone
    from public.customer_supply_periods sp
    left join public.metering_points mp on mp.id = sp.metering_point_id
    where sp.company_id = p_company_id and sp.status <> 'cancelled'
      and sp.start_date <= v_at and (sp.end_date is null or sp.end_date > v_at)
  ),
  fc as (
    select coalesce(nullif(upper(trim(mp.bidding_zone_code)), ''), 'UNKNOWN') as zone, sum(pf.kwh) as kwh
    from public.gridex_customer_portfolio_point_forecast_internal(p_company_id, v_at, 12) pf
    left join public.metering_points mp on mp.id = pf.metering_point_id
    group by 1
  )
  select z.zone,
         count(distinct a.customer_id)::integer,
         count(distinct a.metering_point_id)::integer,
         round(coalesce(max(fc.kwh), 0), 3)
  from (select zone from active union select zone from fc) z
  left join active a on a.zone = z.zone
  left join fc on fc.zone = z.zone
  group by z.zone
  order by z.zone;
end;
$$;

-- Valid powers of attorney expiring within p_days.
create or replace function public.gridex_customer_portfolio_expiring_poa(
  p_company_id uuid,
  p_days integer default 30
)
returns table (power_of_attorney_id uuid, customer_id uuid, customer_name text, scope text, valid_to date, days_left integer)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);

  return query
  select x.id, x.customer_id,
         coalesce(nullif(trim(c.full_name), ''), nullif(trim(c.company_name), ''),
                  nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.customer_number),
         x.scope, x.valid_to, (x.valid_to - current_date)::integer
  from public.powers_of_attorney x
  left join public.customers c on c.id = x.customer_id and c.company_id = x.company_id
  where x.company_id = p_company_id
    and x.status in ('signed', 'accepted', 'active', 'completed')
    and x.valid_to between current_date and current_date + least(greatest(coalesce(p_days, 30), 1), 365)
  order by x.valid_to, x.id
  limit 500;
end;
$$;

revoke all on function public.gridex_customer_portfolio_forecast(uuid, date) from public, anon;
revoke all on function public.gridex_whitelabel_portfolio_overview(uuid, date) from public, anon;
revoke all on function public.gridex_customer_portfolio_active_counts(uuid[], date) from public, anon;
revoke all on function public.gridex_customer_portfolio_churn_reasons(uuid, date, date) from public, anon;
revoke all on function public.gridex_customer_portfolio_forecast_accuracy(uuid, date, date) from public, anon;
revoke all on function public.gridex_customer_portfolio_cohorts(uuid, integer) from public, anon;
revoke all on function public.gridex_customer_portfolio_bidding_zones(uuid, date) from public, anon;
revoke all on function public.gridex_customer_portfolio_expiring_poa(uuid, integer) from public, anon;
grant execute on function public.gridex_customer_portfolio_forecast(uuid, date) to authenticated, service_role;
grant execute on function public.gridex_whitelabel_portfolio_overview(uuid, date) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_active_counts(uuid[], date) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_churn_reasons(uuid, date, date) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_forecast_accuracy(uuid, date, date) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_cohorts(uuid, integer) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_bidding_zones(uuid, date) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_expiring_poa(uuid, integer) to authenticated, service_role;
