-- Filter noncurrent revisions and malformed legacy E66 readings at the portal detail boundary.
DO $portal_metering_detail$
BEGIN
  CREATE VIEW public.gridex_portal_current_metering_values_v1
  WITH (security_invoker=true) AS
  SELECT v.id,v.company_id,v.customer_id,v.site_id,v.metering_point_id,v.source_request_id,
    v.grid_owner_id,v.reading_type,v.value_kwh,v.quality_code,v.read_at,v.period_start,v.period_end,
    v.source_system,v.created_at,NULLIF(btrim(mp.meter_point_id),'') AS meter_point_id
  FROM public.metering_values v
  LEFT JOIN public.metering_points mp
    ON mp.id = v.metering_point_id AND mp.company_id = v.company_id
    AND (mp.customer_id IS NULL OR mp.customer_id = v.customer_id)
    AND EXISTS (
      SELECT 1 FROM public.customer_sites s
      WHERE s.id = COALESCE(mp.customer_site_id,mp.site_id)
        AND s.company_id = v.company_id AND s.customer_id = v.customer_id
        AND (COALESCE(v.customer_site_id,v.site_id) IS NULL OR COALESCE(v.customer_site_id,v.site_id) = s.id)
    )
  WHERE v.is_current AND v.revision_status='current'
    AND NOT (
      v.source_system IS NOT DISTINCT FROM 'ediel_utilts_inbound_mail'
      AND v.reading_type IS NOT DISTINCT FROM '136'
      AND (v.period_start IS NULL OR v.period_end IS NULL OR v.period_end<=v.period_start)
    );

  REVOKE ALL ON public.gridex_portal_current_metering_values_v1 FROM PUBLIC,anon,authenticated;
  GRANT SELECT ON public.gridex_portal_current_metering_values_v1 TO service_role;
END
$portal_metering_detail$;
