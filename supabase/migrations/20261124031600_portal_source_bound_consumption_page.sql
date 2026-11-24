DO $verify_month_owner$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid = 'gridex_private.portal_monthly_consumption_v2(uuid,uuid[],date,date)'::regprocedure
      AND p.proowner = current_user::regrole::oid AND NOT p.prosecdef AND p.provolatile = 's'
      AND encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') = 'edae8adf2b73a81b9b9b44ae7c4074f8c5782db5d0a8e506c527d1ffd135b729'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'portal_supply_month_owner_preimage_changed';
  END IF;
END
$verify_month_owner$;

-- Both portal presentations derive their permissions from the same physical
-- delivery windows in a single stable database snapshot.
CREATE FUNCTION gridex_private.portal_consumption_supply_windows_v1(
  p_company_id uuid, p_customer_ids uuid[]
)
RETURNS TABLE(customer_id uuid, metering_point_id uuid, starts_at timestamptz,
              ends_at timestamptz, confirmed boolean)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
SET TimeZone = 'UTC'
AS $supply_windows$
  WITH scoped_periods AS MATERIALIZED (
    SELECT sp.id, sp.customer_id, sp.metering_point_id, sp.status, sp.actual_start_date,
      sp.start_date, sp.actual_end_date, sp.end_date, sp.market_start_at,
      sp.market_end_at, sp.market_state_version
    FROM public.customer_supply_periods sp
    JOIN public.metering_points mp
      ON (mp.company_id, mp.id) = (sp.company_id, sp.metering_point_id)
      AND (mp.customer_id IS NULL OR mp.customer_id = sp.customer_id)
    JOIN public.customer_sites s
      ON (s.company_id, s.customer_id, s.id) =
         (sp.company_id, sp.customer_id, coalesce(mp.customer_site_id, mp.site_id))
    WHERE sp.company_id = p_company_id
      AND sp.customer_id = ANY(p_customer_ids)
      AND sp.status IN ('active', 'confirmed_by_grid_owner', 'ending', 'ended')
      AND mp.measurement_type IN ('consumption', 'mixed')
  ), terminal_periods AS (
    SELECT p.id, p.customer_id,
      (row_number() OVER (PARTITION BY p.customer_id ORDER BY p.id) - 1) / 1000 AS batch_no
    FROM scoped_periods p
    WHERE p.status = 'ended' AND p.actual_end_date IS NULL
  ), terminal_batches AS (
    SELECT p.customer_id, array_agg(p.id ORDER BY p.id) AS ids
    FROM terminal_periods p
    GROUP BY p.customer_id, p.batch_no
  ), verified_ends AS MATERIALIZED (
    SELECT p.customer_id, e.period_id, e.market_state_version, e.effective_end_at
    FROM terminal_batches p
    CROSS JOIN LATERAL public.gridex_portal_verified_supply_ends_v1(p_company_id, p.customer_id, p.ids) e
  )
  SELECT p.customer_id, p.metering_point_id,
    greatest(
      coalesce(p.actual_start_date, p.start_date)::timestamp AT TIME ZONE 'Europe/Stockholm',
      coalesce(p.market_start_at, '-infinity'::timestamptz)
    ),
    least(
      coalesce((p.actual_end_date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm', 'infinity'::timestamptz),
      coalesce((p.end_date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm', 'infinity'::timestamptz),
      coalesce(e.effective_end_at, p.market_end_at, 'infinity'::timestamptz)
    ),
    p.actual_start_date IS NOT NULL AND p.market_start_at IS NOT NULL
      AND (p.status <> 'ended' OR p.actual_end_date IS NOT NULL OR e.period_id IS NOT NULL)
  FROM scoped_periods p
  LEFT JOIN verified_ends e
    ON (e.customer_id, e.period_id, e.market_state_version) = (p.customer_id, p.id, p.market_state_version)
      AND e.effective_end_at = p.market_end_at
$supply_windows$;

REVOKE ALL ON FUNCTION gridex_private.portal_consumption_supply_windows_v1(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

create or replace function gridex_private.portal_monthly_consumption_v2(
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
    select w.customer_id, w.metering_point_id, w.starts_at, w.ends_at, w.confirmed
    from gridex_private.portal_consumption_supply_windows_v1(p_company_id, p_customer_ids) w
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

CREATE FUNCTION public.gridex_portal_consumption_page_v1(
  p_company_id uuid, p_customer_ids uuid[], p_from_month date, p_to_month date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET TimeZone = 'UTC'
SET row_security = off
AS $consumption_page$
DECLARE
  months jsonb;
  readings jsonb;
BEGIN
  -- The existing month owner verifies company, customer scope and date range.
  SELECT coalesce(jsonb_agg(to_jsonb(month) ORDER BY month.month_key DESC), '[]'::jsonb)
  INTO months
  FROM gridex_private.portal_monthly_consumption_v2(p_company_id, p_customer_ids, p_from_month, p_to_month) month;

  WITH supply_windows AS MATERIALIZED (
    SELECT w.customer_id, w.metering_point_id,
      range_agg(tstzrange(w.starts_at, w.ends_at, '[)')) AS intervals
    FROM gridex_private.portal_consumption_supply_windows_v1(p_company_id, p_customer_ids) w
    WHERE w.confirmed AND w.starts_at < w.ends_at
    GROUP BY w.customer_id, w.metering_point_id
  ), eligible_readings AS (
    SELECT v.id, v.customer_id, v.site_id, v.metering_point_id, v.source_request_id,
      v.grid_owner_id, v.reading_type, v.value_kwh, v.quality_code, v.read_at,
      v.period_start, v.period_end, v.source_system, v.created_at, v.meter_point_id
    FROM public.gridex_portal_current_metering_values_v1 v
    WHERE v.company_id = p_company_id AND v.customer_id = ANY(p_customer_ids)
      AND v.period_start < v.period_end
      AND EXISTS (
        SELECT FROM public.metering_values source
        WHERE (source.company_id, source.customer_id, source.id) = (v.company_id, v.customer_id, v.id)
          AND source.direction = 'consumption'
      )
      AND EXISTS (
        SELECT FROM supply_windows w
        WHERE (w.customer_id, w.metering_point_id) = (v.customer_id, v.metering_point_id)
          AND w.intervals @> CASE WHEN v.period_start < v.period_end
            THEN tstzrange(v.period_start, v.period_end, '[)') END
      )
    ORDER BY v.period_start DESC NULLS LAST, v.read_at DESC, v.id DESC
    LIMIT 500
  )
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.period_start DESC NULLS LAST, r.read_at DESC, r.id DESC), '[]'::jsonb)
  INTO readings
  FROM eligible_readings r;

  RETURN jsonb_build_object('values', readings, 'months', months);
END
$consumption_page$;

REVOKE ALL ON FUNCTION public.gridex_portal_consumption_page_v1(uuid, uuid[], date, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_portal_consumption_page_v1(uuid, uuid[], date, date)
  TO service_role;
