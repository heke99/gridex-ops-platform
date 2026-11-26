-- Keep the existing v1 contract available while the forecast runtime moves to
-- period-aware selection. Staff's soft close is a commercial plan, not an
-- assertion about the grid owner's actual end of delivery.
CREATE FUNCTION public.gridex_forecast_point_inventory_v2(
  p_company_id uuid, p_period_start date, p_period_end date
)
RETURNS TABLE(points jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'forecast_point_inventory_company_required' USING ERRCODE = '22023';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL
     OR NOT pg_catalog.isfinite(p_period_start) OR NOT pg_catalog.isfinite(p_period_end)
     OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'forecast_point_inventory_period_invalid' USING ERRCODE = '22023';
  END IF;

  WITH scoped_points AS MATERIALIZED (
    SELECT mp.id, mp.company_id, mp.customer_id, mp.site_id,
      mp.grid_owner_id, mp.bidding_zone_code, NULL::numeric AS lifecycle_supply_fraction
    FROM public.metering_points AS mp
    WHERE mp.company_id = p_company_id
      AND mp.status IN ('active', 'live', 'ongoing')
    UNION ALL
    SELECT mp.id, mp.company_id, mp.customer_id, mp.site_id,
      mp.grid_owner_id, mp.bidding_zone_code, supply.fraction
    FROM public.metering_points AS mp
    CROSS JOIN LATERAL (
      -- Merge overlapping supply rows before counting the forecast coverage.
      SELECT extract(epoch FROM sum(upper(delivery) - lower(delivery)))
        / ((p_period_end - p_period_start)::numeric * 86400) AS fraction
      FROM unnest((
        SELECT range_agg(tsrange(bounds.start_at, bounds.end_at))
        FROM public.customer_supply_periods AS sp
        CROSS JOIN LATERAL (
          SELECT greatest(p_period_start::timestamp, sp.start_date::timestamp,
            CASE WHEN sp.status = 'ending' THEN sp.market_start_at AT TIME ZONE 'Europe/Stockholm' END) AS start_at,
            least(p_period_end::timestamp, (mp.end_date + 1)::timestamp, (sp.end_date + 1)::timestamp,
            CASE WHEN sp.status IN ('ending', 'ended') THEN sp.market_end_at AT TIME ZONE 'Europe/Stockholm' END) AS end_at
        ) AS bounds
        WHERE sp.company_id = mp.company_id AND sp.customer_id = mp.customer_id
          AND sp.metering_point_id = mp.id
          AND sp.start_date < p_period_end
          AND (sp.end_date IS NULL OR sp.end_date >= p_period_start)
          AND (
            sp.status IN ('active', 'confirmed_by_grid_owner')
            OR (sp.status = 'ended' AND sp.market_end_at IS NOT NULL)
            OR (sp.status = 'ending' AND sp.source_end_message_id IS NOT NULL
                AND sp.end_date IS NOT NULL AND sp.market_start_at < sp.market_end_at)
          )
          AND bounds.start_at < bounds.end_at
      )) AS intervals(delivery)
    ) AS supply
    WHERE mp.company_id = p_company_id AND mp.status = 'closed'
      AND mp.end_date >= p_period_start AND supply.fraction > 0
      AND EXISTS (
        SELECT FROM public.customer_lifecycle_events AS event
        WHERE event.company_id = mp.company_id AND event.customer_id = mp.customer_id
          AND event.event_type IN ('move_out', 'terminate') AND event.event_status = 'completed'
          AND event.effective_date = mp.end_date AND event.created_at = mp.closed_at
      )
  ), bounded_points AS (
    SELECT sp.* FROM scoped_points AS sp ORDER BY sp.id LIMIT 10000
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', bp.id, 'customer_id', bp.customer_id, 'site_id', bp.site_id,
    'grid_owner_id', bp.grid_owner_id, 'bidding_zone_code', bp.bidding_zone_code,
    'lifecycle_supply_fraction', bp.lifecycle_supply_fraction,
    'source_customer', CASE WHEN c.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'company_id', c.company_id, 'source', c.source) END
  ) ORDER BY bp.id), '[]'::jsonb),
    (SELECT pg_catalog.count(*) FROM scoped_points)
  INTO points, total_count
  FROM bounded_points AS bp
  LEFT JOIN public.customers AS c ON c.company_id = bp.company_id AND c.id = bp.customer_id;

  IF total_count > 10000 THEN
    RAISE EXCEPTION 'forecast_point_inventory_limit_exceeded' USING ERRCODE = '22023';
  END IF;
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.gridex_forecast_point_inventory_v2(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_forecast_point_inventory_v2(uuid, date, date) TO service_role;

NOTIFY pgrst, 'reload schema';
