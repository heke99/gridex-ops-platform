-- A canonical tenant may not have the optional white-label catalogue.
-- Preserve tenant and configured white-label reads while keeping the
-- cross-company refusal stable on clean and partially provisioned schemas.
CREATE OR REPLACE FUNCTION public.gridex_customer_portfolio_assert_read(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_platform_id uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required' USING ERRCODE = '22023';
  END IF;

  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF public.gridex_can_read_company(p_company_id) THEN
    RETURN;
  END IF;

  IF pg_catalog.to_regclass('public.white_label_platforms') IS NOT NULL
    AND pg_catalog.to_regclass('public.white_label_platform_memberships') IS NOT NULL
    AND EXISTS (
      SELECT FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.companies'::regclass
        AND a.attname = 'white_label_platform_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    )
  THEN
    SELECT c.white_label_platform_id INTO v_platform_id
    FROM public.companies c
    WHERE c.id = p_company_id;

    IF v_platform_id IS NOT NULL
      AND public.gridex_user_can_read_whitelabel_platform(v_platform_id)
    THEN
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'Not allowed to read portfolio for this company' USING ERRCODE = '42501';
END;
$function$;
