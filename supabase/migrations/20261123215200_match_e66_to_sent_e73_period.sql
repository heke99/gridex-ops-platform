CREATE FUNCTION public.gridex_read_sent_e73_period_v1(
  p_company_id uuid,
  p_request_id uuid,
  p_environment text,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog
SET TimeZone TO 'UTC'
AS $period$
DECLARE
  sent_range tstzrange;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'metering.write') IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ediel_sent_e73_period_forbidden';
  END IF;
  IF p_request_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test', 'production') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ediel_sent_e73_period_invalid_scope';
  END IF;
  sent_range := gridex_utilts_binding.e73_sent_request_range_v1(p_company_id, p_request_id, p_environment);
  IF sent_range IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('requestedFrom', lower(sent_range), 'requestedUntil', upper(sent_range));
END
$period$;

REVOKE ALL ON FUNCTION public.gridex_read_sent_e73_period_v1(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_sent_e73_period_v1(uuid, uuid, text, uuid)
  TO service_role;
