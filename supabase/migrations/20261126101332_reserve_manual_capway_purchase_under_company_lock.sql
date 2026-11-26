-- A committed company freeze must be observed before a manual purchase is claimed.
-- Use the same company-before-item lock order as the automatic Capway owner.
CREATE FUNCTION public.gridex_reserve_manual_capway_purchase_v1(
  p_company_id uuid,
  p_invoice_export_item_id uuid,
  p_export_run_id uuid,
  p_actor_user_id uuid,
  p_environment text,
  p_invoice_guid text,
  p_financing_mode text,
  p_expected_updated_at timestamptz,
  p_expected_provider_status text,
  p_expected_purchase_status text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $function$
DECLARE
  company public.companies%ROWTYPE;
  item public.invoice_export_items%ROWTYPE;
  response jsonb;
  reserved_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'invoice_purchase_service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_invoice_export_item_id IS NULL OR p_export_run_id IS NULL OR
      p_actor_user_id IS NULL OR p_expected_updated_at IS NULL OR
      p_environment IS NULL OR p_environment NOT IN ('test', 'production') OR
      nullif(btrim(p_invoice_guid), '') IS NULL OR p_financing_mode IS NULL OR
      p_financing_mode NOT IN ('factoring_with_recourse', 'factoring_without_recourse') THEN
    RAISE EXCEPTION 'invoice_purchase_payload_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND OR public.gridex_actor_has_company_permission(
      p_actor_user_id, p_company_id, 'billing_underlay.export'
    ) IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_purchase_actor_forbidden' USING ERRCODE = '42501';
  END IF;
  IF company.is_active IS FALSE OR lower(coalesce(company.status, 'active')) NOT IN ('active', 'enabled', 'live')
      OR company.outbound_frozen IS TRUE
      OR company.outbound_frozen_channels && ARRAY['invoice_export', '*']::text[] THEN
    RAISE EXCEPTION 'invoice_export_outbound_frozen' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO item FROM public.invoice_export_items
    WHERE id = p_invoice_export_item_id AND company_id = p_company_id AND export_run_id = p_export_run_id
    FOR UPDATE;
  IF NOT FOUND OR item.provider IS DISTINCT FROM 'capway_aptic' OR
      item.environment IS DISTINCT FROM p_environment OR item.provider_invoice_guid IS DISTINCT FROM p_invoice_guid OR
      item.status IS DISTINCT FROM 'sent' OR item.updated_at IS DISTINCT FROM p_expected_updated_at OR
      item.provider_status IS DISTINCT FROM p_expected_provider_status OR
      item.purchase_status IS DISTINCT FROM p_expected_purchase_status OR
      item.provider_status = 'cancelled' OR item.provider_purchase_confirmed_at IS NOT NULL OR
      (item.purchase_status IS NOT NULL AND item.purchase_status NOT IN ('service', 'own_ledger')) THEN
    RETURN false;
  END IF;

  response := CASE WHEN jsonb_typeof(item.response_payload) = 'object' THEN item.response_payload ELSE '{}'::jsonb END;
  IF response ? 'manual_purchase_reconciliation' OR response ? 'automatic_purchase_reconciliation' OR
      response->>'purchase' IS NOT NULL THEN
    RETURN false;
  END IF;

  reserved_at := clock_timestamp();
  UPDATE public.invoice_export_items
    SET response_payload = response || jsonb_build_object(
      'manual_purchase_reconciliation', jsonb_build_object(
        'company_id', p_company_id,
        'invoice_export_item_id', p_invoice_export_item_id,
        'export_run_id', p_export_run_id,
        'actor_user_id', p_actor_user_id,
        'provider', 'capway_aptic',
        'environment', p_environment,
        'invoice_guid', p_invoice_guid,
        'financing_mode', p_financing_mode,
        'reserved_at', reserved_at
      )
    ), updated_at = reserved_at
    WHERE id = p_invoice_export_item_id AND company_id = p_company_id AND export_run_id = p_export_run_id;
  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION public.gridex_reserve_manual_capway_purchase_v1(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_reserve_manual_capway_purchase_v1(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)
  TO service_role;
