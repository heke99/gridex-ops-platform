-- Preserve the existing forecast point selection and named composite-parent
-- semantics in one snapshot, independent of PostgREST's raw row cap.
CREATE FUNCTION public.gridex_forecast_point_inventory_v1(p_company_id uuid)
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

  WITH scoped_points AS MATERIALIZED (
    SELECT mp.id, mp.company_id, mp.customer_id, mp.site_id,
      mp.grid_owner_id, mp.bidding_zone_code
    FROM public.metering_points AS mp
    WHERE mp.company_id = p_company_id
      AND mp.status IN ('active', 'live', 'ongoing')
  ), bounded_points AS (
    SELECT sp.* FROM scoped_points AS sp ORDER BY sp.id LIMIT 10000
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', bp.id, 'customer_id', bp.customer_id, 'site_id', bp.site_id,
    'grid_owner_id', bp.grid_owner_id, 'bidding_zone_code', bp.bidding_zone_code,
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

REVOKE ALL ON FUNCTION public.gridex_forecast_point_inventory_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_forecast_point_inventory_v1(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
