-- 20260519_ediel_tenant_profile_runtime_sync.sql
-- Make Ediel actor/route/runtime data tenant-owned so a supplier profile saved in SaaS mode
-- is reused by Ediel Live Center, route profiles, AGT onboarding and outbound dispatch.

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'ediel_actor_settings',
    'ediel_route_profiles',
    'communication_routes',
    'ediel_messages',
    'ediel_message_events',
    'ediel_test_runs',
    'ediel_test_run_messages',
    'outbound_requests',
    'grid_owner_data_requests',
    'meter_reading_series',
    'meter_reading_values',
    'billing_metering_exports'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', target_table);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)', target_table || '_company_id_idx', target_table);
    END IF;
  END LOOP;
END $$;

-- If this is a single-tenant installation with existing Ediel data, attach old global rows to the only company.
DO $$
DECLARE
  only_company_id uuid;
  company_count integer;
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO company_count FROM public.companies;
  SELECT id INTO only_company_id FROM public.companies LIMIT 1;

  IF only_company_id IS NOT NULL AND company_count = 1 THEN
    IF to_regclass('public.ediel_actor_settings') IS NOT NULL THEN
      UPDATE public.ediel_actor_settings SET company_id = only_company_id WHERE company_id IS NULL;
    END IF;

    IF to_regclass('public.communication_routes') IS NOT NULL THEN
      UPDATE public.communication_routes SET company_id = only_company_id WHERE company_id IS NULL;
    END IF;

    IF to_regclass('public.ediel_route_profiles') IS NOT NULL THEN
      UPDATE public.ediel_route_profiles SET company_id = only_company_id WHERE company_id IS NULL;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.ediel_actor_settings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS ediel_actor_settings_company_env_active_idx
      ON public.ediel_actor_settings (company_id, environment, is_active, updated_at DESC);
  END IF;

  IF to_regclass('public.communication_routes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS communication_routes_company_scope_updated_idx
      ON public.communication_routes (company_id, route_scope, route_type, updated_at DESC);
  END IF;

  IF to_regclass('public.ediel_route_profiles') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS ediel_route_profiles_company_route_updated_idx
      ON public.ediel_route_profiles (company_id, communication_route_id, updated_at DESC);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.ediel_actor_settings') IS NOT NULL THEN
    COMMENT ON COLUMN public.ediel_actor_settings.company_id IS 'Tenant/company that owns this Ediel actor profile. Required for SaaS runtime selection.';
  END IF;

  IF to_regclass('public.communication_routes') IS NOT NULL THEN
    COMMENT ON COLUMN public.communication_routes.company_id IS 'Tenant/company that owns this route. Global legacy rows may be null until backfilled.';
  END IF;

  IF to_regclass('public.ediel_route_profiles') IS NOT NULL THEN
    COMMENT ON COLUMN public.ediel_route_profiles.company_id IS 'Tenant/company that owns this Ediel runtime profile. Must match communication_routes.company_id in SaaS mode.';
  END IF;
END $$;
