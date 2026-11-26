CREATE FUNCTION public.gridex_scan_metering_period_gaps_v1(
  p_company_id uuid,
  p_month_starts date[],
  p_after_point_id uuid DEFAULT NULL
) RETURNS TABLE (
  point_id uuid,
  site_id uuid,
  customer_id uuid,
  grid_owner_id uuid,
  meter_point_id text,
  facility_id text,
  missing_months date[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO pg_catalog
AS $$
BEGIN
  IF p_company_id IS NULL
    OR coalesce(cardinality(p_month_starts), 0) NOT BETWEEN 1 AND 36
    OR EXISTS (
      SELECT FROM unnest(p_month_starts) AS months(month_start)
      WHERE month_start IS NULL OR NOT isfinite(month_start)
        OR extract(day FROM month_start) IS DISTINCT FROM 1::numeric
        OR month_start < DATE '0001-01-01' OR month_start >= DATE '9999-12-01'
    )
  THEN
    RAISE EXCEPTION 'Ogiltigt periodurval.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT point.id AS point_id, site.id AS site_id, site.customer_id,
           coalesce(point.grid_owner_id, site.grid_owner_id) AS grid_owner_id,
           point.meter_point_id, site.facility_id
    FROM public.metering_points AS point
    JOIN public.customer_sites AS site
      ON site.id = point.site_id AND site.company_id = point.company_id
    WHERE point.company_id = p_company_id
      AND (p_after_point_id IS NULL OR point.id > p_after_point_id)
    ORDER BY point.id
    LIMIT 200
  )
  SELECT page.point_id, page.site_id, page.customer_id, page.grid_owner_id,
         page.meter_point_id::text, page.facility_id::text,
         ARRAY(
           SELECT DISTINCT month_start
           FROM unnest(p_month_starts) AS months(month_start)
           WHERE page.customer_id IS NOT NULL
             AND NOT EXISTS (
               SELECT FROM public.metering_values AS value
               WHERE value.company_id = p_company_id
                 AND value.metering_point_id = page.point_id
                 AND value.period_start >= (month_start::timestamp AT TIME ZONE 'UTC')
                 AND value.period_start < ((month_start + INTERVAL '1 month') AT TIME ZONE 'UTC')
             )
           ORDER BY month_start
         )
  FROM page
  ORDER BY page.point_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gridex_scan_metering_period_gaps_v1(uuid,date[],uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_scan_metering_period_gaps_v1(uuid,date[],uuid) TO service_role;
