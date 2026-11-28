DO $migration$
BEGIN
  CREATE POLICY audit_log_technical_platform_read ON public.audit_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.gridex_user_is_platform_admin()));

  CREATE VIEW public.gridex_audit_business_v WITH (security_invoker=true) AS
  SELECT a.id,a.company_id,a.created_at,
    action.key AS action_filter,entity.key AS entity_filter,
    COALESCE(action.label,'Händelse registrerad') AS action_label,
    COALESCE(entity.label,'Verksamhetsuppgift') AS entity_label
  FROM public.audit_logs a
  LEFT JOIN (VALUES
    ('customer_created_from_import','Kund registrerad från import'),
    ('customer_case_registered','Kundärende registrerat'),
    ('withdrawal_registered','Ånger registrerad'),
    ('customer.created','Kund registrerad'),
    ('customer.updated','Kunduppgifter uppdaterade'),
    ('customer.archived','Kund arkiverad'),
    ('customer_case.created','Kundärende registrerat'),
    ('customer_contract.created','Kundavtal skapat'),
    ('power_of_attorney.created','Fullmakt registrerad')
  ) AS action(key,label) ON action.key=a.action
  LEFT JOIN (VALUES
    ('customer','Kund'),
    ('customer_case','Kundärende'),
    ('customer_contract','Kundavtal'),
    ('customer_site','Anläggning'),
    ('site','Anläggning'),
    ('metering_point','Mätpunkt'),
    ('powers_of_attorney','Fullmakt'),
    ('power_of_attorney','Fullmakt'),
    ('supplier_switch_request','Leveransärende'),
    ('billing_underlay','Faktureringsunderlag'),
    ('customer_invoice','Faktura'),
    ('customer_info_request','Uppgiftsbegäran')
  ) AS entity(key,label) ON entity.key=a.entity_type
  WHERE a.company_id IS NOT NULL;
  REVOKE ALL ON TABLE public.gridex_audit_business_v FROM PUBLIC,anon,authenticated,service_role;
  GRANT SELECT ON TABLE public.gridex_audit_business_v TO service_role;

  CREATE FUNCTION public.gridex_list_audit_business_v1(
    p_company_id uuid, p_action text DEFAULT NULL, p_entity text DEFAULT NULL, p_limit integer DEFAULT 100
  )
  RETURNS TABLE(id uuid,created_at timestamptz,action_label text,entity_label text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO pg_catalog
  AS $reader$
  BEGIN
    IF current_setting('role',true) IS DISTINCT FROM 'authenticated'
      OR public.gridex_is_current_session_allowed() IS NOT TRUE
      OR (SELECT auth.uid()) IS NULL THEN
      RAISE EXCEPTION 'audit_business_session_required' USING ERRCODE='42501';
    END IF;
    IF p_company_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'audit_business_scope_invalid' USING ERRCODE='22023';
    END IF;
    IF public.gridex_user_is_platform_admin() IS NOT TRUE AND (
      NOT EXISTS (SELECT FROM public.gridex_user_company_ids() AS scope(company_id) WHERE scope.company_id=p_company_id)
      OR public.gridex_can_read_company(p_company_id) IS NOT TRUE
      OR public.gridex_actor_has_company_permission((SELECT auth.uid()),p_company_id,'audit.read') IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'audit_business_company_required' USING ERRCODE='42501';
    END IF;

    RETURN QUERY SELECT a.id,a.created_at,a.action_label,a.entity_label
    FROM public.gridex_audit_business_v a
    WHERE a.company_id=p_company_id
      AND (p_action IS NULL OR a.action_filter=p_action)
      AND (p_entity IS NULL OR a.entity_filter=p_entity)
    ORDER BY a.created_at DESC,a.id DESC
    LIMIT p_limit;
  END;
  $reader$;
  REVOKE ALL ON FUNCTION public.gridex_list_audit_business_v1(uuid,text,text,integer)
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_list_audit_business_v1(uuid,text,text,integer) TO authenticated;
END
$migration$;
