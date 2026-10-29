-- Reality scenario K, FINDINGS K-06 (owner decision 2026-10-23): churn and the "active" counts read the customer's
-- LAST SUPPLY DAY, and the month figures reconcile.
--
-- customer_supply_periods.end_date has two meanings (lib/billing/supplyPeriodEnd.ts, FINDINGS H1): a received
-- Ediel end (PRODAT Z05 and the source-owned closures) writes end_date = the first day no longer supplied together
-- with market_end_at at the start of that day (exclusive); the manual end writes end_date = actual_end_date = the
-- last supplied day and no market_end_at (inclusive). The portfolio read the raw end_date, so a switch away on
-- 1 October (Z05, end_date 2026-10-01) was churned in October while a manual end on 30 September was churned in
-- September, and a manually ended customer was not counted as supplied on its last day.
--
-- Rules (Swedish calendar months, 20261022210000):
--   * supplied on day D: start_date <= D and (last supply day is null or >= D);
--   * churned in month M: the customer's latest last supply day (no open period) falls in M - the card hint
--     "Sista leveransdag i månaden";
--   * active at a month boundary B (the 1st of a month): supplied on both B - 1 and B (any of its periods).
--     active_customers_start(M) = active at the 1st of M, active_customers(M) = active at the 1st of M + 1, so
--     active_customers(M) = active_customers_start(M + 1), a customer churned in M is not active at the end of M,
--     a customer starting on the 1st of M is new in M and not active at the start of M, and
--     net_change(M) = new(M) - churned(M) apart from re-entries. A customer moving between facilities without a
--     gap stays active;
--   * point-in-time readers (active_counts, bidding_zones at p_as_of) count supply on that day.
--
-- gridex_supply_period_last_day_v1 is the one canonical expression (the SQL twin of supplyPeriodLastSuppliedDate):
-- a received market end at or before the start of its end date (00:00 in Ediel's fixed normal time = local
-- midnight in winter, 01:00 in summer) is exclusive; every other end date is the last supplied day. It replaces
-- every raw end_date in:
--   * gridex_customer_portfolio_monthly_internal and gridex_missing_metering_points_v1 (created on this branch by
--     20261022210000): CREATE OR REPLACE with that body otherwise unchanged; the missing-value window keeps its
--     meaning (supplied some day of the month);
--   * gridex_customer_portfolio_active_counts, gridex_customer_portfolio_churn_reasons,
--     gridex_customer_portfolio_cohorts_at (retention at the end of month k = active at the boundary; also behind
--     gridex_customer_portfolio_cohorts), gridex_customer_portfolio_bidding_zones and the monthly snapshot builder
--     gridex_rebuild_company_analytics_month (active sites/points at month end = active at the boundary):
--     exact-needle body rewrites with predecessor guards; owner, ACL, security mode and configuration preserved,
--     and no raw end_date may remain in a rewritten body.
-- Not changed: the forecast functions (supply end as forecast horizon) and the billing gate (20261022150000),
-- which carries its own copy of the same rule. Tenant scope, guards, grants and every other output are unchanged.
begin;

create or replace function public.gridex_supply_period_last_day_v1(p_end_date date, p_actual_end_date date, p_market_end_at timestamptz)
returns date
language sql stable parallel safe security invoker set search_path = pg_catalog, pg_temp
as $$
  select case
    when coalesce(p_actual_end_date, p_end_date) is null then null
    when p_market_end_at is not null
     and p_market_end_at <= (coalesce(p_actual_end_date, p_end_date)::timestamp at time zone 'Europe/Stockholm') + interval '1 hour'
      then coalesce(p_actual_end_date, p_end_date) - 1
    else coalesce(p_actual_end_date, p_end_date)
  end
$$;
comment on function public.gridex_supply_period_last_day_v1(date, date, timestamptz) is
  'Last supplied Stockholm civil day of a customer_supply_periods row (null = open). A received market end at the start of its end date is exclusive, any other end date inclusive. SQL twin of lib/billing/supplyPeriodEnd.ts supplyPeriodLastSuppliedDate (FINDINGS H1, K-06).';
revoke all on function public.gridex_supply_period_last_day_v1(date, date, timestamptz) from public, anon;
grant execute on function public.gridex_supply_period_last_day_v1(date, date, timestamptz) to authenticated, service_role;

-- K-04 window of 20261022210000, unchanged in meaning: supplied some day of the month = last supply day on or
-- after the month start.
create or replace function public.gridex_missing_metering_points_v1(p_company uuid,p_month date)
returns table(metering_point_id uuid,grid_owner_id uuid)
language sql stable security invoker set search_path=public,pg_temp as $$
 with bounds as(
  select date_trunc('month',p_month)::date as month_start,
   (date_trunc('month',p_month)::date::timestamp at time zone 'Europe/Stockholm') as from_at,
   ((date_trunc('month',p_month)::date+interval '1 month')::timestamp at time zone 'Europe/Stockholm') as to_at)
 select p.id,p.grid_owner_id from public.metering_points p cross join bounds b
 where p.company_id=p_company and b.month_start is not null
  and public.gridex_data_quality_source_exists_v1(p_company,'metering_point',p.id,true)
  and exists(select 1 from public.customer_supply_periods sp
        where sp.company_id=p_company and sp.metering_point_id=p.id and sp.status<>'cancelled'
         and sp.start_date<(b.month_start+interval '1 month')::date
         and coalesce(public.gridex_supply_period_last_day_v1(sp.end_date,sp.actual_end_date,sp.market_end_at)>=b.month_start,true))
  and not exists(select 1 from public.metering_values v
   where v.company_id=p_company and v.metering_point_id=p.id and coalesce(v.is_current,true)
    and v.period_start>=b.from_at
    and v.period_start<b.to_at)
$$;

-- K-06: the body of 20261022210000 with the raw end_date replaced by the last supply day (last_day) and the
-- active counts taken at the month boundaries (supplied on the day before and on the 1st).
create or replace function public.gridex_customer_portfolio_monthly_internal(p_company_id uuid, p_from date, p_to date)
 returns table(month date, active_customers_start integer, active_customers integer, new_customers integer, churned_customers integer, net_change integer, churn_rate numeric, active_metering_points integer, poa_requested integer, poa_signed integer, poa_active integer, metering_requests_total integer, metering_requests_historical integer, metering_requests_ongoing integer, metering_requests_failed integer)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set "TimeZone" to 'Europe/Stockholm'
as $function$
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
  supply as (
    select sp.customer_id, sp.metering_point_id, sp.start_date,
           public.gridex_supply_period_last_day_v1(sp.end_date, sp.actual_end_date, sp.market_end_at) as last_day
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id
      and sp.status <> 'cancelled'
  ),
  -- The month boundaries: the 1st of every month and of the month after the range.
  boundaries as (
    select gs::date as b
    from generate_series(v_from, (v_to + interval '1 month')::date, interval '1 month') gs
  ),
  -- Periods touching b - 1 or b; per boundary, whether some period supplies b - 1 and some period supplies b.
  crossing as (
    select bd.b, s.customer_id, s.metering_point_id,
           bool_or(s.start_date <= bd.b - 1) as supplied_before,
           bool_or(s.last_day is null or s.last_day >= bd.b) as supplied_from
    from boundaries bd
    join supply s on s.start_date <= bd.b and (s.last_day is null or s.last_day >= bd.b - 1)
    group by bd.b, s.customer_id, s.metering_point_id
  ),
  customers_at as (
    select x.b, count(*) as cnt
    from (select c.b, c.customer_id from crossing c group by c.b, c.customer_id
          having bool_or(c.supplied_before) and bool_or(c.supplied_from)) x
    group by x.b
  ),
  points_at as (
    select x.b, count(*) as cnt
    from (select c.b, c.metering_point_id from crossing c group by c.b, c.metering_point_id
          having bool_or(c.supplied_before) and bool_or(c.supplied_from)) x
    group by x.b
  ),
  spans as (
    select s.customer_id,
           min(s.start_date) as first_start,
           case when bool_or(s.last_day is null) then null else max(s.last_day) end as last_end
    from supply s
    group by s.customer_id
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
           x.valid_from::date as valid_from,
           x.valid_to::date as valid_to, x.status
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
         coalesce(cs.cnt, 0)::integer,
         coalesce(ce.cnt, 0)::integer,
         coalesce(st.cnt, 0)::integer,
         coalesce(en.cnt, 0)::integer,
         null::integer,
         null::numeric,
         coalesce(pe.cnt, 0)::integer,
         coalesce(pc.cnt, 0)::integer,
         coalesce(ps.cnt, 0)::integer,
         coalesce(pv.cnt, 0)::integer,
         coalesce(r.total, 0)::integer,
         coalesce(r.historical, 0)::integer,
         coalesce(r.ongoing, 0)::integer,
         coalesce(r.failed, 0)::integer
  from months m
  left join customers_at cs on cs.b = m.m_start
  left join customers_at ce on ce.b = m.m_end + 1
  left join points_at pe on pe.b = m.m_end + 1
  left join starts st on st.m = m.m_start
  left join ends en on en.m = m.m_start
  left join poa_created pc on pc.m = m.m_start
  left join poa_signed ps on ps.m = m.m_start
  left join poa_valid pv on pv.m_start = m.m_start
  left join req r on r.m = m.m_start
  order by m.m_start;
end;
$function$;

-- K-06 in the installed readers and the snapshot builder: only the end-date expressions change.
do $k06$
declare
  f record;
  body text;
  target record;
  i integer;
  last_day constant text := 'public.gridex_supply_period_last_day_v1(sp.end_date, sp.actual_end_date, sp.market_end_at)';
begin
  for target in
    select * from (values
      -- Point in time: supplied on p_at.
      ('public.gridex_customer_portfolio_active_counts(uuid[],date)',
       array[$n$(sp.end_date is null or sp.end_date > v_at)$n$], array[1],
       array['coalesce(' || last_day || ' >= v_at, true)']),
      -- Churn month = month of the latest last supply day.
      ('public.gridex_customer_portfolio_churn_reasons(uuid,date,date)',
       array[$n$case when bool_or(sp.end_date is null) then null else max(sp.end_date) end as last_end$n$], array[1],
       array['case when bool_or(' || last_day || ' is null) then null else max(' || last_day || ') end as last_end']),
      -- Point in time: supplied on p_as_of.
      ('public.gridex_customer_portfolio_bidding_zones(uuid,date)',
       array[$n$and sp.start_date <= v_at and (sp.end_date is null or sp.end_date > v_at)$n$], array[1],
       array['and sp.start_date <= v_at and coalesce(' || last_day || ' >= v_at, true)']),
      -- Retained at the end of month k (at_date = its last day): active at the boundary at_date | at_date + 1.
      ('public.gridex_customer_portfolio_cohorts_at(uuid,date,integer)',
       array[$n$select sp.customer_id, sp.start_date, sp.end_date$n$,
             $n$select c.cohort, c.customer_id, c.k, c.at_date, count(p.customer_id) > 0 as active$n$,
             $n$and p.start_date <= c.at_date and (p.end_date is null or p.end_date > c.at_date)$n$], array[1, 1, 1],
       array['select sp.customer_id, sp.start_date, ' || last_day || ' as last_day',
             'select c.cohort, c.customer_id, c.k, c.at_date, coalesce(bool_or(p.start_date <= c.at_date) and bool_or(p.last_day is null or p.last_day >= c.at_date + 1), false) as active',
             'and p.start_date <= c.at_date + 1 and (p.last_day is null or p.last_day >= c.at_date)']),
      -- Active sites/points at month end: supplied on the month's last day and on the 1st of the next month.
      ('public.gridex_rebuild_company_analytics_month(uuid,date)',
       array[$n$(select count(distinct coalesce(mp.customer_site_id, mp.site_id)) from public.customer_supply_periods sp
           join public.metering_points mp on mp.id = sp.metering_point_id and mp.company_id = sp.company_id
           where sp.company_id = p_company_id and sp.status <> 'cancelled' and sp.start_date <= v_next - 1
             and (sp.end_date is null or sp.end_date > v_next - 1)),$n$,
             $n$(select count(distinct sp.metering_point_id) from public.customer_supply_periods sp
           where sp.company_id = p_company_id and sp.status <> 'cancelled' and sp.start_date <= v_next - 1
             and (sp.end_date is null or sp.end_date > v_next - 1)),$n$], array[1, 1],
       array['(select count(x.site_id) from (select coalesce(mp.customer_site_id, mp.site_id) as site_id from public.customer_supply_periods sp
           join public.metering_points mp on mp.id = sp.metering_point_id and mp.company_id = sp.company_id
           where sp.company_id = p_company_id and sp.status <> ''cancelled'' and sp.start_date <= v_next
             and coalesce(' || last_day || ' >= v_next - 1, true)
           group by 1
           having bool_or(sp.start_date <= v_next - 1) and bool_or(coalesce(' || last_day || ' >= v_next, true))) x),',
             '(select count(*) from (select sp.metering_point_id from public.customer_supply_periods sp
           where sp.company_id = p_company_id and sp.status <> ''cancelled'' and sp.start_date <= v_next
             and coalesce(' || last_day || ' >= v_next - 1, true)
           group by 1
           having bool_or(sp.start_date <= v_next - 1) and bool_or(coalesce(' || last_day || ' >= v_next, true))) x),'])
    ) as t(signature, needles, occurrences, replacements)
  loop
    select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
    from pg_proc p where p.oid = target.signature::regprocedure;
    if position('gridex_supply_period_last_day_v1' in f.prosrc) > 0 then
      raise exception 'statistics_k06_predecessor_required:%', target.signature;
    end if;
    body := f.prosrc;
    for i in 1 .. cardinality(target.needles) loop
      if (length(body) - length(replace(body, target.needles[i], ''))) / length(target.needles[i]) <> target.occurrences[i] then
        raise exception 'statistics_k06_predecessor_required:%:%', target.signature, i;
      end if;
      body := replace(body, target.needles[i], target.replacements[i]);
    end loop;
    -- Every end date of a rewritten body is read through the canonical expression.
    if position('end_date' in replace(body, last_day, '')) > 0 then
      raise exception 'statistics_k06_raw_end_date_left:%', target.signature;
    end if;
    execute replace(f.definition, f.prosrc, body);
    if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata then
      raise exception 'statistics_k06_metadata_changed:%', target.signature;
    end if;
  end loop;
end
$k06$;

commit;
