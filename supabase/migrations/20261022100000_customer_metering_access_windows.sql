-- FINDINGS F79 (owner decision 2026-10-22): a customer sees only metering values the customer has a verified
-- right to. Mina sidor, the customer API and the partner (website) API read every value stored on the customer
-- (company_id + customer_id, or the site), so a customer who moved in saw the previous occupant's consumption and
-- a supplier-switch customer saw values from before our supply without any basis.
--
-- One server-side rule for every customer channel, applied before any limit, page, sum or chart:
--   * Supply basis: an established supply period of the same tenant, customer and metering point
--     (confirmed_by_grid_owner, active, ending, ended; never cancelled/rejected or an unconfirmed application).
--     The window is the actual confirmed start and end: market_start_at/market_end_at from the Ediel source,
--     otherwise the confirmed start date (actual_start_date, else start_date) and the end date as exclusive
--     bound, at 00:00 Europe/Stockholm. Each period is its own window; a gap is never opened. An ended period
--     keeps the customer's own history; the next customer of the point has its own periods.
--   * Permission basis (history before our supply): only a value bound to a metering permission
--     (metering_values.permission_id) of the same tenant, customer and metering point whose approval rests on
--     a received grid-owner Z14 (qualified transition), inside the approved report period. normalized_metering_values carries no permission
--     binding, so this basis stays closed there until the right can be proven.
-- A value is visible only when its whole interval [period_start, period_end) lies inside one window.
-- Stored values, originals and internal staff access are unchanged.
BEGIN;

CREATE FUNCTION public.gridex_customer_metering_access_windows_v1(p_company_id uuid, p_customer_ids uuid[])
RETURNS TABLE(customer_id uuid, metering_point_id uuid, access_from timestamptz, access_to timestamptz, basis text, basis_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_company_id IS NULL OR p_customer_ids IS NULL OR cardinality(p_customer_ids)=0 OR cardinality(p_customer_ids)>50
  OR array_position(p_customer_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'customer_metering_scope_invalid' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT FROM unnest(p_customer_ids) r(id) WHERE NOT EXISTS(SELECT FROM public.customers c WHERE c.id=r.id AND c.company_id=p_company_id)) THEN
  RAISE EXCEPTION 'customer_metering_customer_scope_invalid' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT p.customer_id,p.metering_point_id,
  coalesce(p.market_start_at,coalesce(p.actual_start_date,p.start_date)::timestamp AT TIME ZONE 'Europe/Stockholm'),
  coalesce(p.market_end_at,coalesce(p.actual_end_date,p.end_date)::timestamp AT TIME ZONE 'Europe/Stockholm'),
  'supply_period'::text,p.id
 FROM public.customer_supply_periods p
 JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=p.company_id
 WHERE p.company_id=p_company_id AND p.customer_id=ANY(p_customer_ids)
  AND p.status IN('confirmed_by_grid_owner','active','ending','ended')
  AND coalesce(p.market_start_at::date,p.actual_start_date,p.start_date) IS NOT NULL
 UNION ALL
 SELECT m.customer_id,m.metering_point_id,
  coalesce(m.approved_start_at,m.approved_start_date::timestamp AT TIME ZONE 'Europe/Stockholm'),
  coalesce(m.approved_end_at,m.approved_end_date::timestamp AT TIME ZONE 'Europe/Stockholm'),
  'metering_permission'::text,m.id
 FROM public.metering_permissions m
 WHERE m.company_id=p_company_id AND m.customer_id=ANY(p_customer_ids) AND m.metering_point_id IS NOT NULL
  -- Only the qualified Z14 transition (20260930144205) sets active with one approved report period;
  -- partially approved, denied, manual or unproven rows open nothing.
  AND m.status IN('active','ended') AND m.inbound_z14_message_id IS NOT NULL AND m.inbound_z14_message_id=m.source_z14_message_id
  AND EXISTS(SELECT FROM public.ediel_messages z WHERE z.id=m.inbound_z14_message_id AND z.company_id=m.company_id
   AND z.direction='inbound' AND z.message_family='PRODAT' AND z.message_code='Z14')
  AND coalesce(m.approved_start_at,m.approved_start_date::timestamp AT TIME ZONE 'Europe/Stockholm') IS NOT NULL;
END $$;

-- Detail rows of normalized_metering_values for customer channels (customer API, Mina sidor bundle, partner API).
-- Optional site/facility/range/keyset filters narrow the result; the access rule is never optional.
CREATE FUNCTION public.gridex_customer_normalized_metering_values_v1(p_company_id uuid,p_customer_ids uuid[],
 p_customer_site_id uuid DEFAULT NULL,p_facility_id text DEFAULT NULL,p_period_start_from timestamptz DEFAULT NULL,
 p_period_start_before timestamptz DEFAULT NULL,p_period_end_to timestamptz DEFAULT NULL,
 p_before_period_start timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT NULL)
RETURNS SETOF public.normalized_metering_values
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_limit IS NOT NULL AND (p_limit<1 OR p_limit>5000) THEN RAISE EXCEPTION 'customer_metering_limit_invalid' USING ERRCODE='22023';END IF;
 IF (p_before_period_start IS NULL)<>(p_before_id IS NULL) THEN RAISE EXCEPTION 'customer_metering_cursor_invalid' USING ERRCODE='22023';END IF;
 RETURN QUERY
 WITH w AS MATERIALIZED (SELECT * FROM public.gridex_customer_metering_access_windows_v1(p_company_id,p_customer_ids) a WHERE a.basis='supply_period')
 SELECT v.* FROM public.normalized_metering_values v
 WHERE v.company_id=p_company_id AND v.customer_id=ANY(p_customer_ids)
  AND (p_customer_site_id IS NULL OR v.customer_site_id=p_customer_site_id)
  AND (p_facility_id IS NULL OR v.facility_id=p_facility_id)
  AND (p_period_start_from IS NULL OR v.period_start>=p_period_start_from)
  AND (p_period_start_before IS NULL OR v.period_start<p_period_start_before)
  AND (p_period_end_to IS NULL OR v.period_end<=p_period_end_to)
  AND (p_before_period_start IS NULL OR v.period_start<p_before_period_start OR (v.period_start=p_before_period_start AND v.id<p_before_id))
  AND v.period_start IS NOT NULL
  AND EXISTS(SELECT FROM w WHERE w.customer_id=v.customer_id AND w.metering_point_id=v.metering_point_id
   AND v.period_start>=w.access_from AND (w.access_to IS NULL OR (v.period_start<w.access_to AND coalesce(v.period_end,v.period_start)<=w.access_to)))
 ORDER BY v.period_start DESC,v.id DESC
 LIMIT p_limit;
END $$;

-- Detail rows of metering_values for Mina sidor (also the source of the month cards below).
CREATE FUNCTION public.gridex_customer_metering_values_v1(p_company_id uuid,p_customer_ids uuid[],
 p_period_start_from timestamptz DEFAULT NULL,p_period_start_before timestamptz DEFAULT NULL,p_limit integer DEFAULT NULL)
RETURNS SETOF public.metering_values
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_limit IS NOT NULL AND (p_limit<1 OR p_limit>5000) THEN RAISE EXCEPTION 'customer_metering_limit_invalid' USING ERRCODE='22023';END IF;
 RETURN QUERY
 WITH w AS MATERIALIZED (SELECT * FROM public.gridex_customer_metering_access_windows_v1(p_company_id,p_customer_ids))
 SELECT v.* FROM public.metering_values v
 WHERE v.company_id=p_company_id AND v.customer_id=ANY(p_customer_ids)
  AND (p_period_start_from IS NULL OR v.period_start>=p_period_start_from)
  AND (p_period_start_before IS NULL OR v.period_start<p_period_start_before)
  AND v.period_start IS NOT NULL
  AND EXISTS(SELECT FROM w WHERE w.customer_id=v.customer_id AND w.metering_point_id=v.metering_point_id
   AND (w.basis='supply_period' OR (w.basis='metering_permission' AND v.permission_id=w.basis_id))
   AND v.period_start>=w.access_from AND (w.access_to IS NULL OR (v.period_start<w.access_to AND coalesce(v.period_end,v.period_start)<=w.access_to)))
 ORDER BY v.period_start DESC,v.read_at DESC NULLS LAST,v.id DESC
 LIMIT p_limit;
END $$;

-- Month cards: the same rows; completeness is measured against the customer's own windows in the month,
-- so a move-in month is complete when the customer's part of it is covered.
CREATE OR REPLACE FUNCTION public.gridex_portal_monthly_consumption_v1(p_company_id uuid, p_customer_ids uuid[], p_from_month date, p_to_month date)
 RETURNS TABLE(month_key text, total_kwh numeric, value_count bigint, metering_point_count bigint, covered_seconds bigint, expected_seconds bigint, is_complete boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      mv.customer_id,
      mv.metering_point_id,
      mv.value_kwh,
      case when mv.period_end > mv.period_start
           then extract(epoch from (mv.period_end - mv.period_start))
           else 0 end as seconds
    from public.gridex_customer_metering_values_v1(p_company_id, p_customer_ids, v_from, v_to, null) mv
    where mv.is_current
      and mv.revision_status = 'current'
      and mv.direction = 'consumption'
      and mv.value_kwh is not null
  ),
  months as (
    select
      cv.month_key,
      sum(cv.value_kwh)::numeric as total_kwh,
      count(*)::bigint as value_count,
      count(distinct cv.metering_point_id)::bigint as metering_point_count,
      sum(cv.seconds)::bigint as covered_seconds
    from current_values cv
    group by cv.month_key
  ),
  points as (
    select distinct cv.month_key, cv.customer_id, cv.metering_point_id from current_values cv
  ),
  -- Expected time is the union of the customer's own supply windows in the month: overlapping or duplicate
  -- periods count once, and a permission window never raises the expectation.
  windows as materialized (
    select w.customer_id, w.metering_point_id, range_agg(tstzrange(w.access_from, w.access_to)) as covered
    from public.gridex_customer_metering_access_windows_v1(p_company_id, p_customer_ids) w
    where w.basis = 'supply_period'
    group by w.customer_id, w.metering_point_id
  ),
  expected as (
    select pt.month_key,
      sum(coalesce((select sum(extract(epoch from (upper(r) - lower(r))))
        from unnest(w.covered * tstzmultirange(tstzrange(
          (to_date(pt.month_key, 'YYYY-MM')::timestamp at time zone 'Europe/Stockholm'),
          ((to_date(pt.month_key, 'YYYY-MM') + interval '1 month')::timestamp at time zone 'Europe/Stockholm')))) r), 0))::bigint as seconds
    from points pt
    join windows w on w.customer_id = pt.customer_id and w.metering_point_id = pt.metering_point_id
    group by pt.month_key
  )
  select
    m.month_key,
    m.total_kwh,
    m.value_count,
    m.metering_point_count,
    m.covered_seconds,
    coalesce(e.seconds, 0) as expected_seconds,
    coalesce(e.seconds, 0) > 0 and m.covered_seconds >= coalesce(e.seconds, 0) as is_complete
  from months m
  left join expected e on e.month_key = m.month_key
  order by m.month_key desc;
end;
$function$;

REVOKE ALL ON FUNCTION public.gridex_customer_metering_access_windows_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gridex_customer_normalized_metering_values_v1(uuid,uuid[],uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gridex_customer_metering_values_v1(uuid,uuid[],timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gridex_portal_monthly_consumption_v1(uuid,uuid[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_customer_metering_access_windows_v1(uuid,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_customer_normalized_metering_values_v1(uuid,uuid[],uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_customer_metering_values_v1(uuid,uuid[],timestamptz,timestamptz,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_portal_monthly_consumption_v1(uuid,uuid[],date,date) TO service_role;

COMMIT;
