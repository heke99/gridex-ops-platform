DO $migration$
BEGIN
  -- The stored configuration includes transport headers and credential references.
  CREATE POLICY webhook_subscription_credentials_platform_read ON public.webhook_subscriptions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.gridex_user_is_platform_admin()));

  CREATE FUNCTION public.gridex_list_webhook_subscription_business_v1(
    p_company_id uuid, p_limit integer DEFAULT 100
  )
  RETURNS TABLE(id uuid,company_id uuid,name text,endpoint_url text,status text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO pg_catalog
  AS $reader$
  BEGIN
    IF current_setting('role',true) IS DISTINCT FROM 'authenticated'
      OR public.gridex_is_current_session_allowed() IS NOT TRUE
      OR (SELECT auth.uid()) IS NULL THEN
      RAISE EXCEPTION 'webhook_subscription_session_required' USING ERRCODE='42501';
    END IF;
    IF p_company_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'webhook_subscription_scope_invalid' USING ERRCODE='22023';
    END IF;
    IF public.gridex_user_is_platform_admin() IS NOT TRUE AND (
      NOT EXISTS (SELECT FROM public.gridex_user_company_ids() AS scope(company_id) WHERE scope.company_id=p_company_id)
      OR public.gridex_can_read_company(p_company_id) IS NOT TRUE
      OR NOT (
        public.gridex_actor_has_company_permission((SELECT auth.uid()),p_company_id,'integrations.read') IS TRUE
        OR public.gridex_actor_has_company_permission((SELECT auth.uid()),p_company_id,'integrations.write') IS TRUE
      )
    ) THEN
      RAISE EXCEPTION 'webhook_subscription_company_required' USING ERRCODE='42501';
    END IF;

    RETURN QUERY SELECT s.id,s.company_id,s.name,s.endpoint_url,s.status
    FROM public.webhook_subscriptions s
    WHERE s.company_id=p_company_id
    ORDER BY s.created_at DESC,s.id DESC
    LIMIT p_limit;
  END;
  $reader$;
  REVOKE ALL ON FUNCTION public.gridex_list_webhook_subscription_business_v1(uuid,integer)
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_list_webhook_subscription_business_v1(uuid,integer) TO authenticated;
END
$migration$;
