-- The Supabase CLI records this migration in the same transaction as this block.
DO $gridex_migration$
BEGIN

-- Restricted lookup after the server authenticates the portal identity.
-- The report's older path is used only when a current, captured PDF document
-- binds the exact native storage object to this invoice and customer.
CREATE FUNCTION public.gridex_read_portal_captured_invoice_pdf_v1(
  p_company_id uuid, p_customer_id uuid, p_invoice_id uuid, p_document_ids uuid[], p_include_invoice_pdf boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  copy gridex_ediel_retention.invoice_file_sources%ROWTYPE;
  locator jsonb;
BEGIN
  IF p_company_id IS NULL OR p_customer_id IS NULL OR p_invoice_id IS NULL
    OR coalesce(cardinality(p_document_ids), 0) > 100
    OR (p_include_invoice_pdf IS NOT TRUE AND coalesce(cardinality(p_document_ids), 0) = 0) THEN
    RETURN NULL;
  END IF;

  PERFORM i.id FROM public.customer_invoices i
    JOIN public.customers c ON c.company_id = i.company_id AND c.id = i.customer_id
    WHERE i.company_id = p_company_id AND i.customer_id = p_customer_id AND i.id = p_invoice_id
      AND i.status IN ('issued', 'sent', 'paid', 'overdue', 'cancelled', 'credited');
  IF NOT FOUND THEN RETURN NULL; END IF;

  FOR copy IN
    WITH candidates AS (
      SELECT p_invoice_id AS target_id, 'customer_invoice_pdf_bytes' AS retention_class, 0 AS precedence,
        NULL::timestamptz AS created_at
      WHERE p_include_invoice_pdf IS TRUE
      UNION ALL
      SELECT d.id, 'customer_invoice_document_pdf_bytes', 1, d.created_at
      FROM public.customer_invoice_documents d
      WHERE d.company_id = p_company_id AND d.invoice_id = p_invoice_id
        AND (d.customer_id = p_customer_id OR d.customer_id IS NULL)
        AND d.document_type = 'invoice_pdf' AND d.id = ANY(p_document_ids)
    )
    SELECT s.*
    FROM candidates candidate
    JOIN gridex_ediel_retention.invoice_file_sources s
      ON s.retention_class = candidate.retention_class AND s.target_id = candidate.target_id
    WHERE s.company_id = p_company_id AND s.storage_bucket = 'customer-documents'
      AND s.storage_path ~ '^[A-Za-z0-9_./-]+$'
      AND s.storage_path LIKE 'companies/' || p_company_id::text || '/customers/' || p_customer_id::text || '/%'
      AND NOT EXISTS (
        SELECT FROM gridex_ediel_retention.invoice_file_tombstones retired
        WHERE retired.source_id = s.id
      )
    ORDER BY candidate.precedence, candidate.created_at DESC NULLS LAST, candidate.target_id DESC
  LOOP
    BEGIN
      locator := gridex_ediel_retention.invoice_file_locator_v1(
        copy.company_id, copy.retention_class, copy.target_id
      );
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IN (
        'invoice_file_actual_scoped_target_required',
        'invoice_file_bucket_path_conflict',
        'invoice_file_owned_storage_locator_required',
        'invoice_file_actual_parent_customer_required',
        'invoice_file_customer_document_scope_required',
        'invoice_file_actual_customer_site_tuple_required',
        'invoice_file_native_storage_object_required'
      ) THEN CONTINUE; END IF;
      RAISE;
    END;

    IF locator->>'invoiceId' IS DISTINCT FROM p_invoice_id::text
      OR locator->>'customerId' IS DISTINCT FROM p_customer_id::text
      OR locator->>'storageBucket' IS DISTINCT FROM copy.storage_bucket
      OR locator->>'storagePath' IS DISTINCT FROM copy.storage_path
      OR locator->>'storageObjectId' IS DISTINCT FROM copy.storage_object_id::text
      OR locator->>'storageByteLength' IS DISTINCT FROM copy.byte_length::text
      OR locator->>'targetHash' IS DISTINCT FROM copy.target_hash
      OR EXISTS (
        SELECT FROM gridex_ediel_retention.invoice_file_tombstones retired
        JOIN gridex_ediel_retention.invoice_file_sources peer ON peer.id = retired.source_id
        WHERE peer.storage_bucket = copy.storage_bucket AND peer.storage_path = copy.storage_path
      )
      OR NOT EXISTS (
        SELECT FROM public.customer_invoices i
        JOIN public.customers c ON c.company_id = i.company_id AND c.id = i.customer_id
        WHERE i.company_id = p_company_id AND i.customer_id = p_customer_id AND i.id = p_invoice_id
          AND i.status IN ('issued', 'sent', 'paid', 'overdue', 'cancelled', 'credited')
      )
    THEN CONTINUE; END IF;

    RETURN jsonb_build_object(
      'copyId', copy.id, 'targetId', copy.target_id, 'retentionClass', copy.retention_class,
      'objectId', copy.storage_object_id,
      'bucket', copy.storage_bucket, 'path', copy.storage_path,
      'sha256', copy.source_hash, 'byteLength', copy.byte_length
    );
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.gridex_read_portal_captured_invoice_pdf_v1(uuid, uuid, uuid, uuid[], boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_portal_captured_invoice_pdf_v1(uuid, uuid, uuid, uuid[], boolean)
  TO service_role;

-- Keep the same definer as the existing negative-copy gate. The target
-- owner requires CREATE on public during the ownership transfer only.
DO $owner_scope$
DECLARE
  owner_role regrole := to_regrole('gridex_ediel_retention_owner');
  scalar_gate regprocedure := to_regprocedure('public.ediel_require_invoice_file_copy_available_v1(uuid,text,uuid)');
  portal_gate regprocedure := 'public.gridex_read_portal_captured_invoice_pdf_v1(uuid,uuid,uuid,uuid[],boolean)'::regprocedure;
  qualified_locator regprocedure := to_regprocedure('gridex_ediel_retention.invoice_file_locator_v1(uuid,text,uuid)');
  owner_can_create boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = owner_role AND rolbypassrls AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'gridex_ediel_retention' AND nspowner = owner_role
  ) OR (SELECT count(*) FROM pg_class
    WHERE oid IN ('gridex_ediel_retention.invoice_file_sources'::regclass, 'gridex_ediel_retention.invoice_file_tombstones'::regclass)
      AND relowner = owner_role AND relrowsecurity AND relforcerowsecurity) <> 2
  OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = scalar_gate AND proowner = owner_role AND prosecdef
      AND proconfig = ARRAY['search_path=pg_catalog']
      AND encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') = '4d228b1d33232583d710f53b9019e2285cfcc7a3e0e474d2291700b09631ca88'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = qualified_locator AND proowner = owner_role AND prosecdef
      AND proconfig = ARRAY['search_path=pg_catalog']
  ) OR EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS caller(role_name)
    WHERE has_table_privilege(caller.role_name, 'gridex_ediel_retention.invoice_file_sources', 'SELECT')
      OR has_table_privilege(caller.role_name, 'gridex_ediel_retention.invoice_file_tombstones', 'SELECT')
  ) THEN
    RAISE EXCEPTION 'invoice_pdf_portal_owner_contract_required' USING ERRCODE = '42501';
  END IF;

  owner_can_create := has_schema_privilege(owner_role, 'public', 'CREATE');
  IF NOT owner_can_create THEN
    GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner;
  END IF;
  ALTER FUNCTION public.gridex_read_portal_captured_invoice_pdf_v1(uuid, uuid, uuid, uuid[], boolean)
    OWNER TO gridex_ediel_retention_owner;
  IF NOT owner_can_create THEN
    REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = portal_gate
      AND proowner = owner_role AND prosecdef AND provolatile = 'v' AND proconfig = ARRAY['search_path=pg_catalog']
  ) OR has_schema_privilege(owner_role, 'public', 'CREATE') IS DISTINCT FROM owner_can_create
    OR NOT has_function_privilege('service_role', portal_gate, 'EXECUTE')
    OR has_function_privilege('anon', portal_gate, 'EXECUTE')
    OR has_function_privilege('authenticated', portal_gate, 'EXECUTE')
    OR has_function_privilege('public', portal_gate, 'EXECUTE') THEN
    RAISE EXCEPTION 'invoice_pdf_portal_owner_install_failed' USING ERRCODE = '42501';
  END IF;
END
$owner_scope$;

END
$gridex_migration$;
