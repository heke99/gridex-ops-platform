-- Batch 3 — prismotor, fakturering, ärenden, audit och rolltest
-- Defensiv migration: körbar mot äldre Gridex-scheman där vissa tabeller/kolumner kan saknas.

DO $$
BEGIN
  IF to_regclass('public.contract_offers') IS NOT NULL THEN
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS campaign_code text;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS campaign_version text DEFAULT 'v1';
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS price_version text DEFAULT 'v1';
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS terms_version text DEFAULT 'v1';
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS max_customers integer;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS discount_value numeric;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS discount_unit text;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS start_fee_sek numeric;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS admin_fee_sek numeric;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS break_fee_sek numeric;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 0.25;
    ALTER TABLE public.contract_offers ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
    UPDATE public.contract_offers SET campaign_version = COALESCE(campaign_version, 'v1'), price_version = COALESCE(price_version, 'v1'), terms_version = COALESCE(terms_version, 'v1'), vat_rate = COALESCE(vat_rate, 0.25), metadata = COALESCE(metadata, '{}'::jsonb);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.customer_contracts') IS NOT NULL THEN
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS company_id uuid;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS campaign_code text;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS campaign_version text DEFAULT 'v1';
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS price_version text DEFAULT 'v1';
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS terms_version text DEFAULT 'v1';
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS price_snapshot jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS campaign_snapshot jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS billing_ready_status text DEFAULT 'not_checked';
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS billing_blocker_reasons jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS withdrawal_requested_at timestamptz;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS rejected_reason text;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS discount_value numeric;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS discount_unit text;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS start_fee_sek numeric;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS admin_fee_sek numeric;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS break_fee_sek numeric;
    ALTER TABLE public.customer_contracts ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 0.25;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer_contracts' AND column_name = 'customer_id')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'company_id') THEN
      UPDATE public.customer_contracts cc
         SET company_id = c.company_id
        FROM public.customers c
       WHERE cc.company_id IS NULL
         AND cc.customer_id = c.id;
    END IF;

    UPDATE public.customer_contracts
       SET campaign_version = COALESCE(campaign_version, 'v1'),
           price_version = COALESCE(price_version, 'v1'),
           terms_version = COALESCE(terms_version, 'v1'),
           price_snapshot = COALESCE(price_snapshot, '{}'::jsonb),
           campaign_snapshot = COALESCE(campaign_snapshot, '{}'::jsonb),
           billing_ready_status = COALESCE(billing_ready_status, 'not_checked'),
           billing_blocker_reasons = COALESCE(billing_blocker_reasons, '[]'::jsonb),
           vat_rate = COALESCE(vat_rate, 0.25);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.billing_underlays') IS NOT NULL THEN
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS company_id uuid;
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS contract_id uuid;
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS calculated_total_sek_ex_vat numeric;
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS calculated_vat_sek numeric;
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS calculated_total_sek_inc_vat numeric;
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS blocker_case_id uuid;
    ALTER TABLE public.billing_underlays ADD COLUMN IF NOT EXISTS export_status text DEFAULT 'not_queued';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.billing_export_runs') IS NOT NULL THEN
    ALTER TABLE public.billing_export_runs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE public.billing_export_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.billing_export_run_items') IS NOT NULL THEN
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS company_id uuid;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS contract_id uuid;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS pricing_line_items jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS blocker_case_id uuid;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS export_status text DEFAULT 'not_queued';
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS idempotency_key text;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS last_error text;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS queued_at timestamptz;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS sent_at timestamptz;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS failed_at timestamptz;
    ALTER TABLE public.billing_export_run_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.customer_cases') IS NOT NULL THEN
    ALTER TABLE public.customer_cases ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE public.customer_cases ADD COLUMN IF NOT EXISTS source text;
    ALTER TABLE public.customer_cases ADD COLUMN IF NOT EXISTS billing_blocked boolean DEFAULT false;
    ALTER TABLE public.customer_cases ADD COLUMN IF NOT EXISTS billing_manual_review boolean DEFAULT false;
    ALTER TABLE public.customer_cases ADD COLUMN IF NOT EXISTS break_fee_flagged boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS company_id uuid;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS old_values jsonb;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS new_values jsonb;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.contract_offers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS contract_offers_company_campaign_idx ON public.contract_offers(company_id, campaign_code, status) WHERE company_id IS NOT NULL;
  END IF;
  IF to_regclass('public.customer_contracts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS customer_contracts_company_billing_status_idx ON public.customer_contracts(company_id, billing_ready_status, status) WHERE company_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS customer_contracts_company_campaign_idx ON public.customer_contracts(company_id, campaign_code, status) WHERE company_id IS NOT NULL;
  END IF;
  IF to_regclass('public.billing_export_run_items') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS billing_export_run_items_company_export_status_idx ON public.billing_export_run_items(company_id, export_status, status) WHERE company_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS billing_export_run_items_blocker_case_idx ON public.billing_export_run_items(blocker_case_id) WHERE blocker_case_id IS NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE VIEW public.gridex_batch3_role_action_security_v AS
SELECT *
FROM (VALUES
  ('superadmin', 'all_tenants', 'Se och felsöka alla bolag, men alla kritiska ändringar ska audit-loggas.', true),
  ('bolagsadmin_a', 'tenant_a_only', 'Får skapa kunder, importera kunder, skapa avtal och kampanjer endast i Bolag A.', true),
  ('bolagsadmin_b', 'tenant_b_only', 'Får skapa kunder, importera kunder, skapa avtal och kampanjer endast i Bolag B.', true),
  ('kundservice_a', 'limited_customer_ops', 'Får se kund, avtal, ärenden och skapa uppgiftsbegäran i Bolag A men inte ändra prismotor eller Ediel-live.', true),
  ('ekonomi_a', 'billing_only', 'Får se faktureringsunderlag, blockerade rader och exportstatus men inte ändra aktörsprofil/live.', true),
  ('server_actions', 'company_id_enforced', 'Server actions ska härleda company_id från aktiv bolagskoppling och inte lita på manipulerad formdata.', true)
) AS t(role_key, test_area, expected_control, must_pass);
