-- 20260519_operations_core_saas_sync.sql
-- Batch Operations Core: SaaS-safe operations/customer sync foundations.
-- This migration is intentionally guarded so it can run on partially upgraded Gridex/GridCore databases.

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'customer_contracts',
    'customer_contract_events',
    'contract_offers',
    'powers_of_attorney',
    'customer_authorization_documents',
    'customer_operation_tasks',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'metering_values',
    'billing_underlays',
    'partner_exports',
    'outbound_requests',
    'audit_logs'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', target_table);

      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = target_table
          AND column_name = 'company_id'
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

-- Customer sync/search indexes used by Operations Core.
DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'customer_number')
  THEN
    CREATE INDEX IF NOT EXISTS customers_company_customer_number_idx
      ON public.customers (company_id, customer_number);
  END IF;

  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'personal_number')
  THEN
    CREATE INDEX IF NOT EXISTS customers_company_personal_number_idx
      ON public.customers (company_id, personal_number);
  END IF;

  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'org_number')
  THEN
    CREATE INDEX IF NOT EXISTS customers_company_org_number_idx
      ON public.customers (company_id, org_number);
  END IF;

  IF to_regclass('public.customer_sites') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer_sites' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer_sites' AND column_name = 'customer_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer_sites' AND column_name = 'facility_id')
  THEN
    CREATE INDEX IF NOT EXISTS customer_sites_company_customer_facility_idx
      ON public.customer_sites (company_id, customer_id, facility_id);
  END IF;

  IF to_regclass('public.metering_points') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'metering_points' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'metering_points' AND column_name = 'meter_point_id')
  THEN
    CREATE INDEX IF NOT EXISTS metering_points_company_meter_point_idx
      ON public.metering_points (company_id, meter_point_id);
  END IF;

  IF to_regclass('public.metering_points') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'metering_points' AND column_name = 'company_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'metering_points' AND column_name = 'ediel_reference')
  THEN
    CREATE INDEX IF NOT EXISTS metering_points_company_ediel_reference_idx
      ON public.metering_points (company_id, ediel_reference);
  END IF;
END $$;

-- Durable operations sync journal: records what linked/failed to link without mutating Ediel test facit.
CREATE TABLE IF NOT EXISTS public.customer_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,
  customer_id uuid NULL,
  site_id uuid NULL,
  metering_point_id uuid NULL,
  source_type text NOT NULL,
  source_id uuid NULL,
  source_reference text NULL,
  match_status text NOT NULL DEFAULT 'pending',
  match_confidence numeric(5,2) NULL,
  matched_by text[] NOT NULL DEFAULT '{}',
  event_type text NOT NULL,
  title text NOT NULL,
  description text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  resolution_note text NULL,
  CONSTRAINT customer_sync_events_match_status_check
    CHECK (match_status IN ('pending', 'matched', 'unresolved', 'ignored', 'resolved'))
);

CREATE INDEX IF NOT EXISTS customer_sync_events_company_status_idx
  ON public.customer_sync_events (company_id, match_status, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_sync_events_customer_idx
  ON public.customer_sync_events (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_sync_events_source_idx
  ON public.customer_sync_events (source_type, source_id, source_reference);

COMMENT ON TABLE public.customer_sync_events IS 'Operations Core SaaS sync journal for customer/site/metering/billing/Ediel linkage decisions. Keeps unresolved inbound and matching history tenant-safe.';
COMMENT ON COLUMN public.customer_sync_events.company_id IS 'Tenant owner. Must be populated for SaaS production data before strict RLS is enabled.';
COMMENT ON COLUMN public.customer_sync_events.matched_by IS 'Match keys used, e.g. customer_number, org_number, facility_id, meter_point_id, ediel_reference.';
