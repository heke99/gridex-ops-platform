-- Nordfin reads invoices from a file (their XML import), like the generic file export. Make it a
-- selectable file provider: selecting it creates a ready connection without API credentials, and
-- approved invoices are claimed into an immutable invoice file. Each file records which provider it
-- was created for, so a Nordfin file is always rendered as Nordfin XML.
BEGIN;

UPDATE public.invoice_provider_catalog
   SET selectable = true, unavailable_reason = NULL
 WHERE provider = 'nordfin';

ALTER TABLE public.invoice_export_files
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'file_export';
ALTER TABLE public.invoice_export_files
  DROP CONSTRAINT IF EXISTS invoice_export_files_provider_check;
ALTER TABLE public.invoice_export_files
  ADD CONSTRAINT invoice_export_files_provider_check CHECK (provider IN ('file_export', 'nordfin'));

CREATE OR REPLACE FUNCTION public.gridex_select_invoice_provider_v1(
  p_company_id uuid, p_provider text, p_environment text, p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  c record;
  cat record;
  v_open integer;
  v_connection_id uuid;
  v_file boolean := p_provider IN ('file_export', 'nordfin');
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
  VALUES (p_company_id, p_provider, p_environment,
          CASE WHEN v_file THEN 'ready' ELSE 'incomplete' END, cat.label,
          CASE WHEN v_file THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('code', 'connection_test_required')) END)
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

CREATE OR REPLACE FUNCTION public.gridex_create_invoice_export_file_v1(
  p_company_id uuid, p_billing_month text, p_environment text, p_actor_user_id uuid,
  p_rows jsonb, p_rows_sha256 text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  c record;
  v_ids uuid[];
  v_locked integer;
  v_file_id uuid := gen_random_uuid();
  v_total numeric;
  r jsonb;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invoice_file_actor_required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'invoice_file_empty' USING ERRCODE = '22023';
  END IF;

  SELECT invoice_export_target_system, billing_provider_environment, invoice_export_enabled
    INTO c FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.invoice_export_target_system IS NULL
     OR c.invoice_export_target_system NOT IN ('file_export', 'nordfin')
     OR c.billing_provider_environment IS DISTINCT FROM p_environment
     OR c.invoice_export_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_file_provider_not_active' USING ERRCODE = '55000';
  END IF;

  SELECT array_agg((x->>'invoice_export_item_id')::uuid) INTO v_ids FROM jsonb_array_elements(p_rows) x;
  IF v_ids IS NULL OR cardinality(v_ids) <> (SELECT count(DISTINCT u) FROM unnest(v_ids) u) THEN
    RAISE EXCEPTION 'invoice_file_rows_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_locked FROM (
    SELECT i.id FROM public.invoice_export_items i
      JOIN public.invoice_export_runs run ON run.id = i.export_run_id AND run.company_id = i.company_id
     WHERE i.company_id = p_company_id
       AND i.id = ANY (v_ids)
       AND i.status = 'pending'
       AND i.export_file_id IS NULL
       AND i.metadata->'approval'->>'status' = 'approved'
       AND run.provider = c.invoice_export_target_system
       AND run.environment = p_environment
       AND run.billing_month = p_billing_month
     FOR UPDATE OF i
  ) locked;
  IF v_locked <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'invoice_file_items_changed' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(sum((x->>'amount_inc_vat')::numeric), 0) INTO v_total FROM jsonb_array_elements(p_rows) x;

  INSERT INTO public.invoice_export_files (id, company_id, billing_month, environment, provider, row_count, total_inc_vat, rows, rows_sha256, created_by)
  VALUES (v_file_id, p_company_id, p_billing_month, p_environment, c.invoice_export_target_system, cardinality(v_ids), v_total, p_rows, p_rows_sha256, p_actor_user_id);

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    UPDATE public.invoice_export_items
       SET status = 'sent', export_file_id = v_file_id, provider_status = 'exported_to_file',
           sent_at = now(), next_retry_at = NULL, error_code = NULL, updated_at = now()
     WHERE company_id = p_company_id AND id = (r->>'invoice_export_item_id')::uuid;
    UPDATE public.customer_invoices
       SET status = 'sent', issued_at = (r->>'invoice_date')::date, due_date = (r->>'due_date')::date,
           partner_invoice_reference = 'file:' || v_file_id::text, updated_at = now()
     WHERE company_id = p_company_id AND invoice_export_item_id = (r->>'invoice_export_item_id')::uuid
       AND status = 'draft';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoice_file_invoice_mirror_missing' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  UPDATE public.invoice_export_runs run
     SET status = 'sent', sent_items = (SELECT count(*) FROM public.invoice_export_items i
                                         WHERE i.company_id = run.company_id AND i.export_run_id = run.id AND i.status = 'sent'),
         finished_at = now(), updated_at = now()
   WHERE run.company_id = p_company_id
     AND run.id IN (SELECT export_run_id FROM public.invoice_export_items WHERE company_id = p_company_id AND id = ANY (v_ids))
     AND NOT EXISTS (SELECT 1 FROM public.invoice_export_items i
                      WHERE i.company_id = run.company_id AND i.export_run_id = run.id AND i.status <> 'sent');

  INSERT INTO public.audit_logs (company_id, actor_user_id, actor_type, entity_type, entity_id, action,
                                 new_values, metadata, resource_type, resource_id)
  VALUES (p_company_id, p_actor_user_id, 'user', 'invoice_export_file', v_file_id::text, 'invoice_file_created',
          jsonb_build_object('billing_month', p_billing_month, 'row_count', cardinality(v_ids), 'total_inc_vat', v_total),
          jsonb_build_object('environment', p_environment, 'provider', c.invoice_export_target_system, 'rows_sha256', p_rows_sha256),
          'invoice_export_file', v_file_id::text);

  RETURN v_file_id;
END $$;

REVOKE ALL ON FUNCTION public.gridex_create_invoice_export_file_v1(uuid, text, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_create_invoice_export_file_v1(uuid, text, text, uuid, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_select_invoice_provider_v1(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_select_invoice_provider_v1(uuid, text, text, uuid) TO service_role;

COMMIT;
