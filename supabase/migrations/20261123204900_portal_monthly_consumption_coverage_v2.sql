-- Install and verify V2 before switching both portal pages to it.
-- Existing V1 callers keep their established function and semantics.
DO $install$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout','5s',true);
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc
    WHERE oid = pg_catalog.to_regprocedure('public.gridex_portal_monthly_consumption_v1(uuid,uuid[],date,date)')
      AND prosrc IS NOT NULL AND pg_catalog.md5(prosrc) = 'ba2f7f990b1e2eb1c31ee2048a4e6f35'
      AND prosecdef AND provolatile = 's' AND proowner = current_user::regrole::oid
  ) THEN
    RAISE EXCEPTION 'portal_consumption_coverage_requires_exact_predecessor' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.to_regnamespace('gridex_private') IS NULL THEN
    RAISE EXCEPTION 'portal_consumption_coverage_requires_private_schema' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.to_regprocedure('public.gridex_portal_monthly_consumption_v2(uuid,uuid[],date,date)') IS NOT NULL
    OR pg_catalog.to_regprocedure('gridex_private.portal_monthly_consumption_v2(uuid,uuid[],date,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'portal_consumption_coverage_v2_already_exists' USING ERRCODE='55000';
  END IF;

create function gridex_private.portal_monthly_consumption_v2(
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
  is_complete boolean,
  reason_codes text[],
  period_start timestamptz,
  period_end timestamptz
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
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

  return query
  with month_bounds as (
    select
      to_char(m.local_start, 'YYYY-MM') as month_key,
      m.local_start at time zone 'Europe/Stockholm' as starts_at,
      (m.local_start + interval '1 month') at time zone 'Europe/Stockholm' as ends_at
    from generate_series(
      date_trunc('month', p_from_month::timestamp),
      date_trunc('month', p_to_month::timestamp),
      interval '1 month'
    ) as m(local_start)
  ), supply_bounds as (
    select
      sp.customer_id,
      sp.metering_point_id,
      greatest(
        coalesce(sp.actual_start_date, sp.start_date)::timestamp at time zone 'Europe/Stockholm',
        coalesce(sp.market_start_at, '-infinity'::timestamptz)
      ) as starts_at,
      least(
        coalesce((sp.actual_end_date + 1)::timestamp at time zone 'Europe/Stockholm', 'infinity'::timestamptz),
        coalesce((sp.end_date + 1)::timestamp at time zone 'Europe/Stockholm', 'infinity'::timestamptz),
        coalesce(sp.market_end_at, 'infinity'::timestamptz)
      ) as ends_at,
      sp.actual_start_date is not null and sp.market_start_at is not null
        and (sp.status <> 'ended' or sp.actual_end_date is not null) as confirmed
    from public.customer_supply_periods sp
    join public.metering_points mp
      on mp.company_id = sp.company_id and mp.id = sp.metering_point_id
    join public.customer_sites s
      on s.company_id = sp.company_id and s.customer_id = sp.customer_id
      and s.id = coalesce(mp.customer_site_id, mp.site_id)
    where sp.company_id = p_company_id
      and sp.customer_id = any(p_customer_ids)
      and sp.status in ('active', 'confirmed_by_grid_owner', 'ending', 'ended')
      and mp.measurement_type in ('consumption', 'mixed')
  ), series_windows as (
    select
      m.month_key,
      b.customer_id,
      b.metering_point_id,
      -- Planned dates can locate a legacy review month. Only confirmed bounds
      -- contribute expected coverage or admit readings.
      range_agg(tstzrange(greatest(m.starts_at, b.starts_at), least(m.ends_at, b.ends_at), '[)'))
        filter (where b.confirmed) as expected_ranges,
      bool_or(not b.confirmed) as has_unconfirmed_supply
    from month_bounds m
    join supply_bounds b on b.starts_at < m.ends_at and b.ends_at > m.starts_at
    where b.starts_at < b.ends_at
    group by m.month_key, b.customer_id, b.metering_point_id
  ), clipped_readings as (
    select
      w.month_key,
      w.customer_id,
      w.metering_point_id,
      mv.value_kwh,
      w.expected_ranges * tstzmultirange(r.reading_range) as reading_ranges,
      not (w.expected_ranges @> r.reading_range) as needs_energy_allocation
    from series_windows w
    join public.metering_values mv
      on mv.company_id = p_company_id and mv.customer_id = w.customer_id
      and mv.metering_point_id = w.metering_point_id
      and mv.period_start < upper(range_merge(w.expected_ranges))
      and mv.period_end > lower(range_merge(w.expected_ranges))
    cross join lateral (
      select case when mv.period_end > mv.period_start
        then tstzrange(mv.period_start, mv.period_end, '[)') end as reading_range
    ) r
    where w.expected_ranges && tstzmultirange(r.reading_range)
      and mv.is_current and mv.revision_status = 'current'
      and mv.direction = 'consumption' and mv.value_kwh is not null
  ), observed as (
    select
      r.month_key,
      r.customer_id,
      r.metering_point_id,
      count(*) as value_count,
      sum(r.value_kwh) as total_kwh,
      range_agg(r.reading_ranges) as covered_ranges,
      sum((
        select sum(extract(epoch from upper(u.span) - lower(u.span)))
        from unnest(r.reading_ranges) as u(span)
      )) as raw_seconds,
      bool_or(r.needs_energy_allocation) as needs_energy_allocation
    from clipped_readings r
    group by r.month_key, r.customer_id, r.metering_point_id
  ), coverage as (
    select
      w.month_key,
      w.metering_point_id,
      w.has_unconfirmed_supply,
      coalesce(o.value_count, 0) as value_count,
      o.total_kwh,
      coalesce(covered.seconds, 0) as covered_seconds,
      coalesce(expected.seconds, 0) as expected_seconds,
      coalesce(o.raw_seconds > covered.seconds, false) as overlaps,
      coalesce(o.needs_energy_allocation, false) as crosses_boundary
    from series_windows w
    left join observed o using (month_key, customer_id, metering_point_id)
    cross join lateral (
      select sum(extract(epoch from upper(u.span) - lower(u.span))) as seconds
      from unnest(w.expected_ranges) as u(span)
    ) expected
    cross join lateral (
      select sum(extract(epoch from upper(u.span) - lower(u.span))) as seconds
      from unnest(o.covered_ranges) as u(span)
    ) covered
  )
  select
    c.month_key,
    -- The union makes overlap visible. Energy requires a separate allocation
    -- rule when readings overlap or cross an authorized month or supply boundary.
    case when bool_or(c.overlaps or c.crosses_boundary) then null else sum(c.total_kwh) end,
    sum(c.value_count)::bigint,
    count(distinct c.metering_point_id)::bigint,
    sum(c.covered_seconds)::bigint,
    sum(c.expected_seconds)::bigint,
    bool_and(c.expected_seconds > 0 and c.covered_seconds = c.expected_seconds
      and not c.has_unconfirmed_supply and not c.overlaps and not c.crosses_boundary),
    array_remove(array[
      case when bool_or(c.covered_seconds < c.expected_seconds) then 'coverage_gap' end,
      case when bool_or(c.overlaps) then 'reading_overlap' end,
      case when bool_or(c.crosses_boundary) then 'reading_crosses_boundary' end,
      case when bool_or(c.has_unconfirmed_supply) then 'supply_unconfirmed' end
    ], null)::text[],
    min(m.starts_at),
    min(m.ends_at)
  from coverage c
  join month_bounds m on m.month_key = c.month_key
  group by c.month_key
  order by c.month_key desc;
end;
$$;

revoke all on function gridex_private.portal_monthly_consumption_v2(uuid, uuid[], date, date) from public, anon, authenticated, service_role;

create function public.gridex_portal_monthly_consumption_v2(
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
  is_complete boolean,
  reason_codes text[],
  period_start timestamptz,
  period_end timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select m.month_key, m.total_kwh, m.value_count, m.metering_point_count,
    m.covered_seconds, m.expected_seconds, m.is_complete, m.reason_codes, m.period_start, m.period_end
  from gridex_private.portal_monthly_consumption_v2(p_company_id, p_customer_ids, p_from_month, p_to_month) m
  order by m.month_key desc;
$$;

revoke all on function public.gridex_portal_monthly_consumption_v2(uuid, uuid[], date, date) from public, anon, authenticated, service_role;
grant execute on function public.gridex_portal_monthly_consumption_v2(uuid, uuid[], date, date) to service_role;

comment on function public.gridex_portal_monthly_consumption_v2(uuid, uuid[], date, date) is
  'OPS portal: Stockholm month coverage over confirmed gross consumption supply with stable reason codes and exact half-open time bounds. Ambiguous energy is NULL. Service role only.';

END
$install$;
