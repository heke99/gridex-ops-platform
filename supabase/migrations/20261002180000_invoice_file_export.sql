-- Invoice file export: a tenant can choose "file" as invoice provider and hand its approved
-- invoices to its invoice provider as a file instead of through an API.
--
-- Approved invoices are claimed into an immutable export file in one transaction: the file row
-- stores the exact rows (the file content is rendered from them, so every download of the same
-- file is byte-identical), and the claimed items and customer invoices are marked sent with a
-- reference to the file. An invoice can only ever be in one file. Files are append-only.
-- Forward-only; no existing data changes.
BEGIN;

INSERT INTO public.invoice_provider_catalog (provider, label, selectable, unavailable_reason, sort_order)
VALUES ('file_export', 'Fil till fakturaleverantör', true, NULL, 30)
ON CONFLICT (provider) DO NOTHING;

ALTER TABLE public.billing_provider_connections DROP CONSTRAINT IF EXISTS billing_provider_connections_provider_check;
ALTER TABLE public.billing_provider_connections ADD CONSTRAINT billing_provider_connections_provider_check
  CHECK (provider IN ('capway_aptic', 'nordfin', 'file_export', 'fortnox', 'billogram', 'manual_export', 'custom'));

CREATE TABLE public.invoice_export_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_month text NOT NULL CHECK (billing_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  row_count integer NOT NULL CHECK (row_count > 0),
  total_inc_vat numeric NOT NULL,
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
  rows_sha256 text NOT NULL CHECK (rows_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_export_files_company_id_key UNIQUE (company_id, id)
);

COMMENT ON TABLE public.invoice_export_files IS
  'Immutable invoice files handed to the tenant''s invoice provider. rows is the exact file content source.';

CREATE INDEX invoice_export_files_company_month_idx ON public.invoice_export_files (company_id, billing_month, created_at DESC);

CREATE FUNCTION public.gridex_invoice_export_files_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'invoice_export_files_append_only' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER invoice_export_files_no_update
  BEFORE UPDATE OR DELETE ON public.invoice_export_files
  FOR EACH ROW EXECUTE FUNCTION public.gridex_invoice_export_files_append_only();

ALTER TABLE public.invoice_export_items ADD COLUMN IF NOT EXISTS export_file_id uuid;
ALTER TABLE public.invoice_export_items DROP CONSTRAINT IF EXISTS invoice_export_items_export_file_fkey;
ALTER TABLE public.invoice_export_items ADD CONSTRAINT invoice_export_items_export_file_fkey
  FOREIGN KEY (company_id, export_file_id) REFERENCES public.invoice_export_files(company_id, id);
CREATE INDEX IF NOT EXISTS invoice_export_items_export_file_idx
  ON public.invoice_export_items (company_id, export_file_id) WHERE export_file_id IS NOT NULL;

-- A file provider needs no credentials: its connection is ready as soon as it is selected.
CREATE OR REPLACE FUNCTION public.gridex_select_invoice_provider_v1(
  p_company_id uuid, p_provider text, p_environment text, p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  c record;
  cat record;
  v_open integer;
  v_connection_id uuid;
  v_file boolean := p_provider = 'file_export';
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

-- Claim approved, unsent file-provider invoices into one immutable file. All-or-nothing: if any
-- item is no longer approved/pending, belongs to another provider/environment or is already in a
-- file, nothing is written.
CREATE FUNCTION public.gridex_create_invoice_export_file_v1(
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
  IF c.invoice_export_target_system IS DISTINCT FROM 'file_export'
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
       AND run.provider = 'file_export'
       AND run.environment = p_environment
       AND run.billing_month = p_billing_month
     FOR UPDATE OF i
  ) locked;
  IF v_locked <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'invoice_file_items_changed' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(sum((x->>'amount_inc_vat')::numeric), 0) INTO v_total FROM jsonb_array_elements(p_rows) x;

  INSERT INTO public.invoice_export_files (id, company_id, billing_month, environment, row_count, total_inc_vat, rows, rows_sha256, created_by)
  VALUES (v_file_id, p_company_id, p_billing_month, p_environment, cardinality(v_ids), v_total, p_rows, p_rows_sha256, p_actor_user_id);

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
          jsonb_build_object('environment', p_environment, 'rows_sha256', p_rows_sha256),
          'invoice_export_file', v_file_id::text);

  RETURN v_file_id;
END $$;

ALTER TABLE public.invoice_export_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_export_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.invoice_export_files TO service_role;
REVOKE ALL ON FUNCTION public.gridex_invoice_export_files_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gridex_create_invoice_export_file_v1(uuid, text, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_create_invoice_export_file_v1(uuid, text, text, uuid, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_select_invoice_provider_v1(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_select_invoice_provider_v1(uuid, text, text, uuid) TO service_role;

INSERT INTO public.platform_table_classification(table_name, kind, rationale, null_company_meaning, classified_by)
VALUES ('invoice_export_files', 'tenant',
  'Immutable invoice files a tenant hands to its invoice provider. Service-role read only, RLS enabled.',
  NULL, 'migration:invoice_file_export')
ON CONFLICT (table_name) DO UPDATE SET
  kind = EXCLUDED.kind, rationale = EXCLUDED.rationale, null_company_meaning = EXCLUDED.null_company_meaning,
  classified_by = EXCLUDED.classified_by, classified_at = now();

COMMIT;
