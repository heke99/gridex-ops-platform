DO $migration$
DECLARE
  saved_search_path CONSTANT text := current_setting('search_path');
  source_view record;
  view_before record;
  definition text;
BEGIN
  -- Existing delivery writers and retention keep the original relation.
  CREATE POLICY webhook_delivery_diagnostics_platform_read ON public.webhook_deliveries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.gridex_user_is_platform_admin()));

  -- These pre-existing invoker views need delivery counts and failure states.
  -- Resolve their original company boundary without exposing transport bodies.
  CREATE FUNCTION private.gridex_webhook_delivery_summary_rows_v1(
    p_company_id uuid, p_statuses text[] DEFAULT NULL, p_include_failure boolean DEFAULT false
  )
  RETURNS TABLE(id uuid, company_id uuid, status text, created_at timestamptz, failure_reason text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO pg_catalog
  AS $summary$
    WITH caller AS (
      SELECT current_setting('role',true) AS request_role,
        current_setting('role',true) IN ('service_role','postgres')
          OR (current_setting('role',true) = 'none' AND session_user = 'postgres') AS server_read,
        public.gridex_is_current_session_allowed() AS active_session,
        public.gridex_user_is_platform_admin() AS platform_read
    )
    SELECT d.id,d.company_id,d.status,d.created_at,
      CASE WHEN p_include_failure AND (caller.server_read OR caller.platform_read) THEN d.failure_reason END
    FROM public.webhook_deliveries d
    CROSS JOIN caller
    WHERE (p_company_id IS NULL OR d.company_id = p_company_id)
      AND (p_statuses IS NULL OR d.status = ANY(p_statuses))
      AND (caller.server_read OR (
        caller.request_role = 'authenticated' AND caller.active_session
        AND (caller.platform_read OR (
          d.company_id IN (SELECT public.gridex_user_company_ids()) AND public.gridex_can_read_company(d.company_id)
        ))
      ))
  $summary$;
  REVOKE ALL ON FUNCTION private.gridex_webhook_delivery_summary_rows_v1(uuid,text[],boolean)
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION private.gridex_webhook_delivery_summary_rows_v1(uuid,text[],boolean) TO authenticated,service_role;

  PERFORM set_config('search_path','pg_catalog,pg_temp',true);
  FOR source_view IN SELECT * FROM (VALUES
    ('company_dashboard_summary_v','6e99d799167f7402db291273a3fe0afe2e295aa407a98feb794a01956ebe9cad','public.webhook_deliveries x',
      'private.gridex_webhook_delivery_summary_rows_v1(c.id, ARRAY[''failed'',''dead'',''dead_letter'',''retrying'']::text[]) x',1),
    ('gridex_company_operations_statistics_v','95c1abdf4ead6727109c26dcc18ba4ce20df40a2aa3f4aae91b5ee3b2a7f2255','public.webhook_deliveries x',
      'private.gridex_webhook_delivery_summary_rows_v1(c.id) x',2),
    ('gridex_launch_error_summary_v','a3e13e78297edac2ec9dd9029482b374a9cd2990597143c373ee7321ee91afe7','public.webhook_deliveries w',
      'private.gridex_webhook_delivery_summary_rows_v1(NULL, ARRAY[''failed'',''dead_letter'']::text[], true) w',1)
  ) AS expected(view_name,view_digest,old_source,new_source,expected_references)
  LOOP
    SELECT c.oid,c.relowner,c.relacl,c.reloptions INTO STRICT view_before
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=source_view.view_name AND c.relkind='v'
      AND c.reloptions=ARRAY['security_invoker=true'];
    definition := pg_get_viewdef(view_before.oid,false);
    IF encode(sha256(convert_to(definition,'UTF8')),'hex') <> source_view.view_digest
      OR (length(definition)-length(replace(definition,source_view.old_source,''))) / length(source_view.old_source)
      <> source_view.expected_references THEN
      RAISE EXCEPTION 'webhook_delivery_summary_predecessor_required: %',source_view.view_name;
    END IF;

    EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH (security_invoker=true) AS %s',
      source_view.view_name,replace(definition,source_view.old_source,source_view.new_source));
    IF NOT EXISTS (
      SELECT FROM pg_class c WHERE c.oid=view_before.oid AND c.relowner=view_before.relowner
        AND c.relacl IS NOT DISTINCT FROM view_before.relacl AND c.reloptions=view_before.reloptions
    ) THEN
      RAISE EXCEPTION 'webhook_delivery_summary_metadata_changed: %',source_view.view_name;
    END IF;
  END LOOP;
  PERFORM set_config('search_path',saved_search_path,true);

  CREATE VIEW public.gridex_webhook_delivery_business_v WITH (security_invoker=true) AS
  SELECT d.id, d.company_id, d.status, d.created_at,
    CASE
      WHEN d.event_type = 'webhook.test' THEN 'connection_test'
      WHEN d.event_type LIKE 'customer.%' THEN 'customer'
      WHEN d.event_type LIKE 'contract.%' THEN 'contract'
      WHEN d.event_type LIKE 'invoice.%' OR d.event_type LIKE 'billing.%' THEN 'invoice'
      ELSE 'connection_update'
    END AS event_category,
    COALESCE(
      CASE WHEN jsonb_typeof(d.payload->'data'->'customer_number') = 'string' THEN d.payload->'data'->>'customer_number' END,
      CASE WHEN jsonb_typeof(d.payload->'customer_number') = 'string' THEN d.payload->>'customer_number' END
    ) AS customer_number,
    COALESCE(NULLIF(d.target_url,''),s.endpoint_url) AS endpoint_url
  FROM public.webhook_deliveries d
  LEFT JOIN public.webhook_subscriptions s
    ON s.id = d.webhook_subscription_id AND s.company_id = d.company_id;
  REVOKE ALL ON TABLE public.gridex_webhook_delivery_business_v FROM PUBLIC,anon,authenticated,service_role;
  GRANT SELECT ON TABLE public.gridex_webhook_delivery_business_v TO service_role;

  CREATE FUNCTION public.gridex_list_webhook_delivery_business_v1(
    p_company_id uuid, p_status text DEFAULT NULL, p_limit integer DEFAULT 100
  )
  RETURNS SETOF public.gridex_webhook_delivery_business_v
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO pg_catalog
  AS $reader$
  BEGIN
    IF current_setting('role', true) IS DISTINCT FROM 'authenticated'
      OR public.gridex_is_current_session_allowed() IS NOT TRUE
      OR (SELECT auth.uid()) IS NULL THEN
      RAISE EXCEPTION 'webhook_delivery_session_required' USING ERRCODE='42501';
    END IF;
    IF p_company_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'webhook_delivery_scope_invalid' USING ERRCODE='22023';
    END IF;
    IF public.gridex_user_is_platform_admin() IS NOT TRUE AND (
      NOT EXISTS (SELECT FROM public.gridex_user_company_ids() AS scope(company_id) WHERE scope.company_id = p_company_id)
      OR public.gridex_can_read_company(p_company_id) IS NOT TRUE
      OR NOT (
        public.gridex_actor_has_company_permission((SELECT auth.uid()),p_company_id,'integrations.read') IS TRUE
        OR public.gridex_actor_has_company_permission((SELECT auth.uid()),p_company_id,'integrations.write') IS TRUE
      )
    ) THEN
      RAISE EXCEPTION 'webhook_delivery_company_required' USING ERRCODE='42501';
    END IF;

    RETURN QUERY SELECT d.*
    FROM public.gridex_webhook_delivery_business_v d
    WHERE d.company_id = p_company_id
      AND (p_status IS NULL OR d.status = p_status OR (p_status = 'needs_attention' AND d.status IN ('failed','dead_letter')))
    ORDER BY d.created_at DESC,d.id DESC
    LIMIT p_limit;
  END;
  $reader$;
  REVOKE ALL ON FUNCTION public.gridex_list_webhook_delivery_business_v1(uuid,text,integer)
    FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_list_webhook_delivery_business_v1(uuid,text,integer) TO authenticated;
END
$migration$;
