-- 20260513_ediel_agt_saas_runtime_safe.sql
-- Safe replacement for the earlier AGT/SaaS tenant migration.
-- Important fixes:
-- 1) ediel_route_profiles has receiver_ediel_id, not counterparty_ediel_id.
-- 2) ediel_route_profiles has is_enabled, not is_active.
-- 3) Every index is guarded by information_schema column checks so the migration can run
--    against the current Gridex/Gridcore schema and also survive partially-applied prior runs.

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
    'ediel_tgt_dynamic_test_data',
    'outbound_requests'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', target_table);

      IF EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = target_table
          AND c.column_name = 'company_id'
      ) THEN
        EXECUTE format(
          'CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)',
          target_table || '_company_id_idx',
          target_table
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Ediel messages: tenant + operational filters.
DO $$
BEGIN
  IF to_regclass('public.ediel_messages') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'message_family')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'status')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'created_at')
  THEN
    CREATE INDEX IF NOT EXISTS ediel_messages_company_family_status_idx
      ON public.ediel_messages (company_id, message_family, status, created_at DESC);
  END IF;

  IF to_regclass('public.ediel_messages') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'direction')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'sender_ediel_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'receiver_ediel_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'interchange_reference')
  THEN
    CREATE INDEX IF NOT EXISTS ediel_messages_company_direction_ref_idx
      ON public.ediel_messages (company_id, direction, sender_ediel_id, receiver_ediel_id, interchange_reference);
  END IF;
END $$;

-- Ediel test runs: tenant + AGT/TGT lookup filters.
DO $$
BEGIN
  IF to_regclass('public.ediel_test_runs') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_test_runs' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_test_runs' AND column_name = 'test_suite')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_test_runs' AND column_name = 'role_code')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_test_runs' AND column_name = 'test_case_code')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_test_runs' AND column_name = 'status')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_test_runs' AND column_name = 'created_at')
  THEN
    CREATE INDEX IF NOT EXISTS ediel_test_runs_company_suite_case_idx
      ON public.ediel_test_runs (company_id, test_suite, role_code, test_case_code, status, created_at DESC);
  END IF;
END $$;

-- Actor settings: actual schema uses is_active.
DO $$
BEGIN
  IF to_regclass('public.ediel_actor_settings') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_actor_settings' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_actor_settings' AND column_name = 'environment')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_actor_settings' AND column_name = 'actor_role')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_actor_settings' AND column_name = 'is_active')
  THEN
    CREATE INDEX IF NOT EXISTS ediel_actor_settings_company_active_idx
      ON public.ediel_actor_settings (company_id, environment, actor_role, is_active);
  END IF;
END $$;

-- Route profiles: actual schema uses receiver_ediel_id and is_enabled.
-- Do NOT use counterparty_ediel_id or is_active here; those columns are not in this project schema.
DO $$
BEGIN
  IF to_regclass('public.ediel_route_profiles') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_route_profiles' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_route_profiles' AND column_name = 'environment')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_route_profiles' AND column_name = 'receiver_ediel_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_route_profiles' AND column_name = 'is_enabled')
  THEN
    CREATE INDEX IF NOT EXISTS ediel_route_profiles_company_receiver_idx
      ON public.ediel_route_profiles (company_id, environment, receiver_ediel_id, is_enabled);
  END IF;

  IF to_regclass('public.ediel_route_profiles') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_route_profiles' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_route_profiles' AND column_name = 'communication_route_id')
  THEN
    CREATE INDEX IF NOT EXISTS ediel_route_profiles_company_route_idx
      ON public.ediel_route_profiles (company_id, communication_route_id);
  END IF;
END $$;

-- Communication routes: actual schema uses is_active.
DO $$
BEGIN
  IF to_regclass('public.communication_routes') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'communication_routes' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'communication_routes' AND column_name = 'route_scope')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'communication_routes' AND column_name = 'route_type')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'communication_routes' AND column_name = 'is_active')
  THEN
    CREATE INDEX IF NOT EXISTS communication_routes_company_scope_active_idx
      ON public.communication_routes (company_id, route_scope, route_type, is_active);
  END IF;
END $$;

-- Column comments, guarded so reruns/partial runs do not fail.
DO $$
BEGIN
  IF to_regclass('public.ediel_messages') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_messages' AND column_name = 'company_id')
  THEN
    COMMENT ON COLUMN public.ediel_messages.company_id IS 'Tenant owner for SaaS Ediel runtime data. Nullable until historical rows are backfilled.';
  END IF;

  IF to_regclass('public.ediel_test_runs') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_test_runs' AND column_name = 'company_id')
  THEN
    COMMENT ON COLUMN public.ediel_test_runs.company_id IS 'Tenant owner for SaaS Ediel test runs including AGT 2026A.';
  END IF;

  IF to_regclass('public.ediel_route_profiles') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_route_profiles' AND column_name = 'company_id')
  THEN
    COMMENT ON COLUMN public.ediel_route_profiles.company_id IS 'Tenant owner for SaaS Ediel route profiles. Nullable until route ownership is enforced.';
  END IF;

  IF to_regclass('public.ediel_actor_settings') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ediel_actor_settings' AND column_name = 'company_id')
  THEN
    COMMENT ON COLUMN public.ediel_actor_settings.company_id IS 'Tenant owner for SaaS Ediel actor identity. Nullable until active actor selection is company-scoped.';
  END IF;
END $$;
