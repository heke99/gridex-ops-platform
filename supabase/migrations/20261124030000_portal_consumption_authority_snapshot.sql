-- Read a complete bounded site/point/period inventory in one customer-scoped snapshot.
CREATE FUNCTION public.gridex_portal_consumption_authority_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO pg_catalog
SET TimeZone TO 'UTC'
AS $function$
DECLARE
  point_ids uuid[];
  point_rows jsonb;
  period_rows jsonb;
  requested_sites integer;
  points_owned boolean;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='consumption_authority_service_role_required';
  END IF;
  IF p_company_id IS NULL OR p_customer_id IS NULL OR p_site_ids IS NULL
      OR array_ndims(p_site_ids)>1 OR cardinality(p_site_ids)>100 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_consumption_site_scope';
  END IF;
  requested_sites := cardinality(p_site_ids);
  IF (SELECT count(DISTINCT id) FROM unnest(p_site_ids) AS input(id))<>requested_sites THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_consumption_site_scope';
  END IF;
  IF (SELECT count(*) FROM public.customer_sites site
      WHERE (site.company_id,site.customer_id)=(p_company_id,p_customer_id) AND site.id=ANY(p_site_ids))<>requested_sites THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='consumption_site_scope_changed';
  END IF;

  SELECT coalesce(array_agg(selected.id),ARRAY[]::uuid[]),
         coalesce(jsonb_agg(to_jsonb(selected) ORDER BY selected.id),'[]'::jsonb),
         coalesce(bool_and((selected.customer_id IS NULL OR selected.customer_id=p_customer_id)
           AND coalesce(selected.customer_site_id,selected.site_id)=ANY(p_site_ids)),true)
  INTO point_ids, point_rows, points_owned
  FROM (
    SELECT point.id,point.company_id,point.customer_id,point.site_id,point.customer_site_id,
           point.metering_point_id,point.site_facility_id,point.status
    FROM public.metering_points point
    LEFT JOIN public.customer_sites canonical
      ON (canonical.company_id,canonical.customer_id,canonical.id)=(p_company_id,p_customer_id,point.customer_site_id)
    WHERE point.company_id=p_company_id
      AND (point.customer_site_id=ANY(p_site_ids) OR point.site_id=ANY(p_site_ids))
      -- Suppress an old alias only when the actual canonical site is owned
      -- by this customer. Unverified links must hold the application read.
      AND (point.customer_site_id=ANY(p_site_ids) OR canonical.id IS NULL)
    LIMIT 1001
  ) AS selected;
  IF cardinality(point_ids)>1000 THEN
    RAISE EXCEPTION USING ERRCODE='54000', MESSAGE='consumption_point_capacity';
  END IF;
  IF points_owned IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='consumption_point_scope_changed';
  END IF;
  IF cardinality(point_ids)=0 THEN
    RETURN jsonb_build_object('points',point_rows,'point_count',0,'periods','[]'::jsonb,'period_count',0);
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(selected) ORDER BY selected.id),'[]'::jsonb)
  INTO period_rows
  FROM (
    SELECT period.id,period.company_id,period.customer_id,period.metering_point_id,period.status,
           period.actual_start_date,period.actual_end_date,period.end_date,period.market_start_at,period.market_end_at,
           period.market_state_version
    FROM public.customer_supply_periods period
    WHERE (period.company_id,period.customer_id)=(p_company_id,p_customer_id) AND period.metering_point_id=ANY(point_ids)
    LIMIT 1001
  ) AS selected;
  IF jsonb_array_length(period_rows)>1000 THEN
    RAISE EXCEPTION USING ERRCODE='54000', MESSAGE='consumption_period_capacity';
  END IF;
  RETURN jsonb_build_object('points',point_rows,'point_count',cardinality(point_ids),
                            'periods',period_rows,'period_count',jsonb_array_length(period_rows));
END;
$function$;

REVOKE ALL ON FUNCTION public.gridex_portal_consumption_authority_v1(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_portal_consumption_authority_v1(uuid,uuid,uuid[]) TO service_role;
