-- Tenant invoice provider selection.
--
-- Each tenant chooses one of the platform's invoice providers (Capway today, Nordfin later) and
-- the environment (test/production). Approved invoices are then dispatched through that provider.
-- The catalog says which providers exist and which are open for selection; a provider without a
-- finished integration is listed but cannot be selected. Selection and enabling run through
-- SECURITY DEFINER RPCs that lock the company row, refuse a provider switch while exports are
-- open, create the tenant's connection row and write audit_logs.
-- Also brings companies.billing_provider_environment under migration control: the column exists
-- in production and is read by the billing code, but no earlier migration created it.
-- Forward-only; existing rows keep their values.
BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS billing_provider_environment text;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_billing_provider_environment_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_billing_provider_environment_check
  CHECK (billing_provider_environment IS NULL OR billing_provider_environment IN ('test', 'production'));

CREATE TABLE public.invoice_provider_catalog (
  provider text PRIMARY KEY,
  label text NOT NULL,
  selectable boolean NOT NULL DEFAULT false,
  unavailable_reason text,
  sort_order integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_provider_catalog_reason_check CHECK (selectable OR unavailable_reason IS NOT NULL)
);

COMMENT ON TABLE public.invoice_provider_catalog IS
  'Platform catalog of invoice providers a tenant can choose. selectable=false means listed but not yet integrated.';

INSERT INTO public.invoice_provider_catalog (provider, label, selectable, unavailable_reason, sort_order) VALUES
  ('capway_aptic', 'Capway', true, NULL, 10),
  ('nordfin', 'Nordfin', false, 'Integrationen med Nordfin är inte klar ännu.', 20)
ON CONFLICT (provider) DO NOTHING;

ALTER TABLE public.billing_provider_connections DROP CONSTRAINT IF EXISTS billing_provider_connections_provider_check;
ALTER TABLE public.billing_provider_connections ADD CONSTRAINT billing_provider_connections_provider_check
  CHECK (provider IN ('capway_aptic', 'nordfin', 'fortnox', 'billogram', 'manual_export', 'custom'));

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_invoice_export_target_system_fkey;
ALTER TABLE public.companies ADD CONSTRAINT companies_invoice_export_target_system_fkey
  FOREIGN KEY (invoice_export_target_system) REFERENCES public.invoice_provider_catalog(provider);

-- Choose provider + environment. Disables dispatch until the new connection is tested and enabled.
CREATE FUNCTION public.gridex_select_invoice_provider_v1(
  p_company_id uuid, p_provider text, p_environment text, p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  c record;
  cat record;
  v_open integer;
  v_connection_id uuid;
BEGIN
  IF p_environment NOT IN ('test', 'production') THEN
    RAISE EXCEPTION 'invoice_provider_environment_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cat FROM public.invoice_provider_catalog WHERE provider = p_provider;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_provider_unknown' USING ERRCODE = '22023';
  END IF;
  IF NOT cat.selectable THEN
    RAISE EXCEPTION 'invoice_provider_not_available' USING ERRCODE = '22023';
  END IF;

  SELECT id, invoice_export_target_system, billing_provider_environment, invoice_export_enabled
    INTO c FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF c.invoice_export_target_system IS DISTINCT FROM p_provider
     OR c.billing_provider_environment IS DISTINCT FROM p_environment THEN
    SELECT count(*) INTO v_open FROM public.invoice_export_runs
     WHERE company_id = p_company_id AND status IN ('draft', 'processing');
    IF v_open > 0 THEN
      RAISE EXCEPTION 'invoice_provider_switch_blocked_open_exports' USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO public.billing_provider_connections (company_id, provider, environment, status, display_name, readiness_issues)
  VALUES (p_company_id, p_provider, p_environment, 'incomplete', cat.label,
          jsonb_build_array(jsonb_build_object('code', 'connection_test_required')))
  ON CONFLICT (company_id, provider, environment) DO NOTHING
  RETURNING id INTO v_connection_id;

  UPDATE public.companies
     SET invoice_export_target_system = p_provider,
         billing_provider_environment = p_environment,
         invoice_export_enabled = CASE
           WHEN c.invoice_export_target_system IS DISTINCT FROM p_provider
             OR c.billing_provider_environment IS DISTINCT FROM p_environment THEN false
           ELSE invoice_export_enabled END
   WHERE id = p_company_id;

  INSERT INTO public.audit_logs (company_id, actor_user_id, actor_type, system_actor, entity_type, entity_id, action,
                                 old_values, new_values, metadata, resource_type, resource_id)
  VALUES (p_company_id, p_actor_user_id, CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN p_actor_user_id IS NULL THEN 'invoice_provider_settings' ELSE NULL END,
          'company', p_company_id::text, 'invoice_provider_selected',
          jsonb_build_object('provider', c.invoice_export_target_system, 'environment', c.billing_provider_environment,
                             'invoice_export_enabled', c.invoice_export_enabled),
          jsonb_build_object('provider', p_provider, 'environment', p_environment),
          jsonb_build_object('connection_created', v_connection_id IS NOT NULL),
          'company', p_company_id::text);

  RETURN jsonb_build_object('provider', p_provider, 'environment', p_environment,
                            'connection_created', v_connection_id IS NOT NULL);
END $$;

-- Turn invoice dispatch on/off. On requires a selected provider whose connection is tested (ready/active).
CREATE FUNCTION public.gridex_set_invoice_dispatch_enabled_v1(
  p_company_id uuid, p_enabled boolean, p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  c record;
  v_status text;
BEGIN
  SELECT id, invoice_export_target_system, billing_provider_environment, invoice_export_enabled
    INTO c FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_enabled THEN
    IF c.invoice_export_target_system IS NULL OR c.billing_provider_environment IS NULL THEN
      RAISE EXCEPTION 'invoice_provider_not_selected' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.invoice_provider_catalog
                    WHERE provider = c.invoice_export_target_system AND selectable) THEN
      RAISE EXCEPTION 'invoice_provider_not_available' USING ERRCODE = '55000';
    END IF;
    SELECT status INTO v_status FROM public.billing_provider_connections
     WHERE company_id = p_company_id AND provider = c.invoice_export_target_system
       AND environment = c.billing_provider_environment;
    IF v_status IS NULL OR v_status NOT IN ('ready', 'active') THEN
      RAISE EXCEPTION 'invoice_provider_connection_not_ready' USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.companies SET invoice_export_enabled = p_enabled WHERE id = p_company_id;

  INSERT INTO public.audit_logs (company_id, actor_user_id, actor_type, system_actor, entity_type, entity_id, action,
                                 old_values, new_values, metadata, resource_type, resource_id)
  VALUES (p_company_id, p_actor_user_id, CASE WHEN p_actor_user_id IS NULL THEN 'system' ELSE 'user' END,
          CASE WHEN p_actor_user_id IS NULL THEN 'invoice_provider_settings' ELSE NULL END,
          'company', p_company_id::text,
          CASE WHEN p_enabled THEN 'invoice_dispatch_enabled' ELSE 'invoice_dispatch_disabled' END,
          jsonb_build_object('invoice_export_enabled', c.invoice_export_enabled),
          jsonb_build_object('invoice_export_enabled', p_enabled),
          jsonb_build_object('provider', c.invoice_export_target_system, 'environment', c.billing_provider_environment),
          'company', p_company_id::text);

  RETURN jsonb_build_object('enabled', p_enabled, 'provider', c.invoice_export_target_system,
                            'environment', c.billing_provider_environment);
END $$;

ALTER TABLE public.invoice_provider_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_provider_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.invoice_provider_catalog TO service_role;
REVOKE ALL ON FUNCTION public.gridex_select_invoice_provider_v1(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gridex_set_invoice_dispatch_enabled_v1(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_select_invoice_provider_v1(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gridex_set_invoice_dispatch_enabled_v1(uuid, boolean, uuid) TO service_role;

INSERT INTO public.platform_table_classification(table_name, kind, rationale, null_company_meaning, classified_by)
VALUES ('invoice_provider_catalog', 'platform_shared',
  'Platform-wide list of invoice providers a tenant may choose; no tenant data. Service-role read only, RLS enabled.',
  NULL, 'migration:tenant_invoice_provider_selection')
ON CONFLICT (table_name) DO UPDATE SET
  kind = EXCLUDED.kind, rationale = EXCLUDED.rationale, null_company_meaning = EXCLUDED.null_company_meaning,
  classified_by = EXCLUDED.classified_by, classified_at = now();

COMMIT;
