-- Normalize overlapping permissive RLS policies without changing their effective authorization union.
-- This migration deliberately preserves existing read/write semantics while avoiding duplicate policy evaluation.

DO $$
DECLARE
  r record;
  roles_sql text;
  using_expr text;
  check_expr text;
  base_name text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'ALL'
      AND policyname = ANY (ARRAY[
        'gridcore_ai_list_discrepancies_tenant_write',
        'gridcore_ai_list_import_rows_tenant_write',
        'gridcore_ai_list_imports_tenant_write',
        'billing_automation_runs_write_company_or_service',
        'company_capabilities_platform_write',
        'company_market_price_sources_tenant_write',
        'contract_price_option_area_tenant_write',
        'contract_price_options_tenant_write',
        'gridex_launch_platform_only',
        'ediel_message_intents_write_company_or_service',
        'grid_owner_verification_reviews_platform_write',
        'manual_communication_mailboxes_platform_write',
        'manual_email_outbox_write',
        'manual_inbound_messages_write',
        'platform_actor_certificates_platform_write',
        'platform_actor_readiness_checks_platform_write',
        'platform_actor_readiness_runs_platform_write',
        'platform_default_legal_templates_platform_write',
        'power_of_attorney_events_tenant_write'
      ])
    ORDER BY tablename, policyname
  LOOP
    SELECT string_agg(quote_ident(role_name::text), ', ' ORDER BY ord)
      INTO roles_sql
    FROM unnest(r.roles) WITH ORDINALITY AS u(role_name, ord);

    using_expr := coalesce(r.qual, 'true');
    check_expr := coalesce(r.with_check, r.qual, 'true');

    -- Keep auth helper calls statement-stable if an older definition still contains direct calls.
    using_expr := replace(replace(replace(using_expr,
      'auth.role()', '(select auth.role())'),
      'auth.uid()', '(select auth.uid())'),
      'auth.jwt()', '(select auth.jwt())');
    check_expr := replace(replace(replace(check_expr,
      'auth.role()', '(select auth.role())'),
      'auth.uid()', '(select auth.uid())'),
      'auth.jwt()', '(select auth.jwt())');

    base_name := left(r.policyname, 55);

    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO %s WITH CHECK (%s)',
      base_name || '_insert', r.tablename, roles_sql, check_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
      base_name || '_update', r.tablename, roles_sql, using_expr, check_expr
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO %s USING (%s)',
      base_name || '_delete', r.tablename, roles_sql, using_expr
    );
  END LOOP;
END
$$;

-- Preserve the exact authorization union for company actor test runs while separating reads from writes.
DROP POLICY IF EXISTS company_actor_test_runs_company_read ON public.company_actor_test_runs;
DROP POLICY IF EXISTS company_actor_test_runs_platform_all ON public.company_actor_test_runs;
CREATE POLICY company_actor_test_runs_read
  ON public.company_actor_test_runs FOR SELECT TO public
  USING (gridex_can_read_company(company_id) OR gridex_user_is_platform_admin());
CREATE POLICY company_actor_test_runs_platform_insert
  ON public.company_actor_test_runs FOR INSERT TO public
  WITH CHECK (gridex_user_is_platform_admin());
CREATE POLICY company_actor_test_runs_platform_update
  ON public.company_actor_test_runs FOR UPDATE TO public
  USING (gridex_user_is_platform_admin())
  WITH CHECK (gridex_user_is_platform_admin());
CREATE POLICY company_actor_test_runs_platform_delete
  ON public.company_actor_test_runs FOR DELETE TO public
  USING (gridex_user_is_platform_admin());

-- The two prior write policies represented an OR-union. Collapse that union into one policy per mutation.
DROP POLICY IF EXISTS grid_owner_contact_channels_platform_write ON public.grid_owner_contact_channels;
DROP POLICY IF EXISTS grid_owner_contact_channels_tenant_write ON public.grid_owner_contact_channels;
CREATE POLICY grid_owner_contact_channels_write_insert
  ON public.grid_owner_contact_channels FOR INSERT TO public
  WITH CHECK (
    (select auth.role()) = 'service_role'
    OR gridex_user_is_platform_admin()
    OR (company_id IS NOT NULL AND gridex_user_can_manage_company(company_id))
  );
CREATE POLICY grid_owner_contact_channels_write_update
  ON public.grid_owner_contact_channels FOR UPDATE TO public
  USING (
    (select auth.role()) = 'service_role'
    OR gridex_user_is_platform_admin()
    OR (company_id IS NOT NULL AND gridex_user_can_manage_company(company_id))
  )
  WITH CHECK (
    (select auth.role()) = 'service_role'
    OR gridex_user_is_platform_admin()
    OR (company_id IS NOT NULL AND gridex_user_can_manage_company(company_id))
  );
CREATE POLICY grid_owner_contact_channels_write_delete
  ON public.grid_owner_contact_channels FOR DELETE TO public
  USING (
    (select auth.role()) = 'service_role'
    OR gridex_user_is_platform_admin()
    OR (company_id IS NOT NULL AND gridex_user_can_manage_company(company_id))
  );

-- Remove stale generated policies only where a canonical policy is a proven superset for the same role/action.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'gridex_mp_%'
      AND (
        (tablename IN ('communication_logs','domain_events','event_outbox','webhook_deliveries') AND roles::text = '{service_role}')
        OR (tablename IN ('platform_actor_contacts','platform_address_lookup_cache','platform_energy_lookup_cache') AND roles::text = '{service_role}' AND cmd = 'SELECT')
        OR (tablename = 'communication_logs' AND policyname = 'gridex_mp_b87fc2098ab3338329d2')
        OR (tablename = 'domain_events' AND policyname = 'gridex_mp_8ab602e9dbfab91e7e2e')
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END
$$;

-- Collapse the remaining authenticated read overlaps while preserving their prior OR-union exactly.
DROP POLICY IF EXISTS event_outbox_platform_admin_read ON public.event_outbox;
DROP POLICY IF EXISTS gridex_mp_81c620feaa289d414f5f ON public.event_outbox;
CREATE POLICY event_outbox_tenant_or_platform_read
  ON public.event_outbox FOR SELECT TO authenticated
  USING (gridex_user_is_platform_admin() OR gridex_can_read_company(company_id));

DROP POLICY IF EXISTS webhook_deliveries_platform_admin_read ON public.webhook_deliveries;
DROP POLICY IF EXISTS gridex_mp_b4c6a5bed0f1bb738710 ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_tenant_or_platform_read
  ON public.webhook_deliveries FOR SELECT TO authenticated
  USING (gridex_user_is_platform_admin() OR gridex_can_read_company(company_id));
