-- Reality scenario K ("statistics are computed and shown correctly"), FINDINGS K-03, K-04, K-05, K-07, K-08.
--
--   K-03  The monthly consumption rollup (metering_point_monthly_consumption, which feeds "Mottagna mätvärden",
--         actual kWh, customer/zone/grid-owner metrics and the forecast history) bucketed every value by its UTC
--         month: the first one (CET) or two (CEST) hours of every Swedish month were counted in the previous
--         month. Same class as DST-C1 (the portal's month cards already use Europe/Stockholm months).
--   K-04  "Saknade mätvärden" (gridex_missing_metering_points_v1) used a UTC month window and expected values
--         for every active metering point, also for months the tenant does not supply the point (a pending
--         switch, a customer who left). A value in the first Stockholm hours of the next month also hid a
--         completely missing month. (Local world, October 2026: 305 shown, 131 supplied points without values.)
--   K-05  Portfolio "Fullmakter begärda/signerade" and the metering-request months were UTC calendar months
--         (the function forced TimeZone=UTC): a power of attorney signed 1 November 00:30 in Sweden counted in
--         October.
--   K-07  "Kunder totalt" in the monthly snapshot counted test-portal customers and archived/deleted customers,
--         which the dashboard's "Kunder" excludes, so the same tenant showed two different customer totals.
--   K-08  "Aktiva anläggningar"/"Aktiva mätpunkter" in the monthly snapshot used customer_sites/metering_points
--         .status, which stays 'active' after the customer has left; the portfolio's supply-period definition
--         ("the one active definition used by every KPI", lib/analytics/customerPortfolio.ts) is now used.
--
-- A received end (Z05) writes end_date = the first day no longer supplied together with market_end_at, a manual
-- end writes the last supplied day (lib/billing/supplyPeriodEnd.ts, FINDINGS H1); the supply checks below read
-- both. Signatures, owners, grants, security mode, locks and every other output are unchanged.
begin;

-- K-03: Europe/Stockholm month buckets and bounds. Body otherwise identical to 20261003150000.
create or replace function public.gridex_rebuild_metering_monthly_consumption(p_company_id uuid, p_from_month date, p_to_month date)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
           date_trunc('month', mv.period_start at time zone 'Europe/Stockholm')::date as month,
           sum(coalesce(mv.value_kwh, mv.quantity_kwh, mv.quantity)) as kwh,
           count(*)::integer as value_count
    from public.metering_values mv
    where mv.company_id = p_company_id
      and mv.metering_point_id is not null
      and coalesce(mv.is_current, true)
      and coalesce(mv.reading_type, 'consumption') = 'consumption'
      and coalesce(mv.value_kwh, mv.quantity_kwh, mv.quantity) is not null
      and mv.period_start >= (v_from::timestamp at time zone 'Europe/Stockholm')
      and mv.period_start < ((v_to + interval '1 month')::timestamp at time zone 'Europe/Stockholm')
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
$function$;

-- K-04: Stockholm month window; a point is expected to have values only in a month the tenant supplies it
-- (a non-cancelled supply period reaching into the month): the portfolio's single "supplied" definition. A point
-- whose switch is still pending, starts later or has ended carries no expectation for the month.
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
         and (coalesce(sp.actual_end_date,sp.end_date) is null
          or (case when sp.market_end_at is not null
                    and sp.market_end_at<=(coalesce(sp.actual_end_date,sp.end_date)::timestamp at time zone 'Europe/Stockholm')+interval '1 hour'
                   then coalesce(sp.actual_end_date,sp.end_date)
                   else coalesce(sp.actual_end_date,sp.end_date)+1 end)>b.month_start))
  and not exists(select 1 from public.metering_values v
   where v.company_id=p_company and v.metering_point_id=p.id and coalesce(v.is_current,true)
    and v.period_start>=b.from_at
    and v.period_start<b.to_at)
$$;

-- K-05: the portfolio months are Swedish calendar months. Only the TimeZone setting and the two validity
-- expressions change (valid_from/valid_to are dates; ::date keeps a timestamptz variant on its Swedish date).
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
$function$;

-- K-07/K-08 in the monthly snapshot: exactly three source expressions of the installed builder change; its
-- data-request months follow Swedish months (K-05) through the function's TimeZone setting.
do $k$
declare
  f record;
  body text;
  customers_needle constant text := $n$(select count(*) from public.customers c where c.company_id = p_company_id),$n$;
  customers_replacement constant text := $n$(select count(*) from public.customers c where c.company_id = p_company_id
           and coalesce(c.source, '') <> 'ediel_portal_test'
           and coalesce(c.status, '') not in ('archived', 'deleted', 'deleted_test_only', 'pending_deletion')),$n$;
  sites_needle constant text := $n$(select count(*) from public.customer_sites s where s.company_id = p_company_id and s.status in ('active', 'live', 'ongoing')),$n$;
  sites_replacement constant text := $n$(select count(distinct coalesce(mp.customer_site_id, mp.site_id)) from public.customer_supply_periods sp
           join public.metering_points mp on mp.id = sp.metering_point_id and mp.company_id = sp.company_id
           where sp.company_id = p_company_id and sp.status <> 'cancelled' and sp.start_date <= v_next - 1
             and (sp.end_date is null or sp.end_date > v_next - 1)),$n$;
  points_needle constant text := $n$(select count(*) from public.metering_points mp where mp.company_id = p_company_id and mp.status in ('active', 'live', 'ongoing')),$n$;
  points_replacement constant text := $n$(select count(distinct sp.metering_point_id) from public.customer_supply_periods sp
           where sp.company_id = p_company_id and sp.status <> 'cancelled' and sp.start_date <= v_next - 1
             and (sp.end_date is null or sp.end_date > v_next - 1)),$n$;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'public.gridex_rebuild_company_analytics_month(uuid,date)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, customers_needle, ''))) / length(customers_needle) <> 1
     or (length(f.prosrc) - length(replace(f.prosrc, sites_needle, ''))) / length(sites_needle) <> 1
     or (length(f.prosrc) - length(replace(f.prosrc, points_needle, ''))) / length(points_needle) <> 1 then
    raise exception 'statistics_k_analytics_month_predecessor_required';
  end if;
  body := replace(replace(replace(f.prosrc, customers_needle, customers_replacement), sites_needle, sites_replacement), points_needle, points_replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata then
    raise exception 'statistics_k_analytics_month_metadata_changed';
  end if;
end
$k$;
alter function public.gridex_rebuild_company_analytics_month(uuid, date) set "TimeZone" to 'Europe/Stockholm';

commit;
