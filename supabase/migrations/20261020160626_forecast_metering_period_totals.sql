-- Preserve the forecasting raw-row contract while aggregating before the Data
-- API row cap. This adds no current/revision/type filter or quantity fallback.
CREATE OR REPLACE FUNCTION public.gridex_forecast_metering_period_totals_v1(
  p_company_id uuid,
  p_metering_point_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS TABLE(total_kwh numeric, value_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_company_id IS NULL OR p_metering_point_id IS NULL
    OR p_period_start IS NULL OR p_period_end IS NULL
    OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'forecast_metering_period_scope_invalid';
  END IF;

  RETURN QUERY
  SELECT coalesce(pg_catalog.sum(coalesce(mv.value_kwh, mv.quantity_kwh, 0::numeric)), 0::numeric),
         pg_catalog.count(*)
  FROM public.metering_values AS mv
  WHERE mv.company_id = p_company_id
    AND mv.metering_point_id = p_metering_point_id
    AND mv.period_start >= p_period_start
    AND mv.period_start < p_period_end;
END;
$$;

REVOKE ALL ON FUNCTION public.gridex_forecast_metering_period_totals_v1(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_forecast_metering_period_totals_v1(uuid, uuid, timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
