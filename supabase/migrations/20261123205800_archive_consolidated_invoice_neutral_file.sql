DO $gridex_invoice_migration$
BEGIN

-- An issued group already is an invoice. A neutral export points to its frozen
-- body, without creating a singleton invoice/export item or a sent event.
CREATE TABLE gridex_invoice_groups.neutral_files (
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  file_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issue_hash text NOT NULL CHECK (issue_hash ~ '^[0-9a-f]{64}$'),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,invoice_id),
  UNIQUE (company_id,file_id),
  FOREIGN KEY (company_id,invoice_id)
    REFERENCES gridex_invoice_groups.customer_documents(company_id,invoice_id)
);
ALTER TABLE gridex_invoice_groups.neutral_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_invoice_groups.neutral_files FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_invoice_groups.verified_neutral_file_source(p_company uuid,p_invoice uuid,p_issue_hash text)
RETURNS gridex_invoice_groups.customer_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE source_id uuid;
DECLARE evidence_count integer;
DECLARE body_source_count integer;
DECLARE copy gridex_invoice_groups.customer_documents%ROWTYPE;
DECLARE parsed jsonb;
DECLARE witness record;
BEGIN
  SELECT d AS document, i.invoice_number, i.invoice_reference, i.currency, i.amount_inc_vat INTO witness
  FROM gridex_invoice_groups.customer_documents d
  JOIN gridex_invoice_groups.issue_outcomes o ON o.company_id=d.company_id AND o.invoice_id=d.invoice_id
  JOIN public.customer_invoices i ON i.company_id=d.company_id AND i.id=d.invoice_id AND i.customer_id=d.customer_id
  WHERE d.company_id=p_company AND d.invoice_id=p_invoice AND o.outcome='issued'
    AND o.review_hash=p_issue_hash AND o.number=i.invoice_number AND i.source_system='invoice_group_v1'
    AND i.status IN ('issued','sent','paid','overdue','credited');
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_file_not_issued' USING ERRCODE='23514'; END IF;

  copy:=witness.document;
  PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,NULL,p_invoice);
  FOR source_id IN SELECT s.billing_underlay_id FROM gridex_invoice_groups.sources s
    WHERE s.company_id=p_company AND s.invoice_id=p_invoice ORDER BY s.billing_underlay_id LOOP
    PERFORM public.ediel_require_invoice_source_copies_available_v1(p_company,source_id);
  END LOOP;
  parsed:=convert_from(copy.body,'UTF8')::jsonb;
  IF copy.body_sha256 IS DISTINCT FROM encode(sha256(copy.body),'hex') OR
    parsed->>'format' IS DISTINCT FROM 'gridex_customer_group_invoice_v1' OR
    parsed->>'invoiceNumber' IS DISTINCT FROM witness.invoice_number OR
    parsed->>'invoiceReference' IS DISTINCT FROM witness.invoice_reference OR
    parsed->>'currency' IS DISTINCT FROM witness.currency OR
    parsed->>'amountIncVat' IS DISTINCT FROM witness.amount_inc_vat::text OR
    jsonb_typeof(parsed->'sites') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invoice_group_file_source_invalid' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer INTO evidence_count FROM gridex_invoice_groups.sources s
    WHERE s.company_id=p_company AND s.invoice_id=p_invoice;
  SELECT count(DISTINCT part->>'sourceReference')::integer INTO body_source_count
    FROM jsonb_array_elements(parsed->'sites') part
    JOIN gridex_invoice_groups.sources s ON s.company_id=p_company AND s.invoice_id=p_invoice
      AND part->>'sourceReference'=gridex_invoice_groups.public_source_reference(p_company,s.billing_underlay_id)
      AND part->>'periodStart'=s.snapshot->>'periodStart' AND part->>'periodEnd'=s.snapshot->>'periodEnd'
      AND part->>'quantityKwh'=s.snapshot#>>'{calculation,total_kwh}'
      AND part->>'amountIncVat'=s.snapshot#>>'{calculation,total_sek_inc_vat}';
  IF evidence_count<2 OR evidence_count<>body_source_count OR evidence_count<>jsonb_array_length(parsed->'sites') THEN
    RAISE EXCEPTION 'invoice_group_file_source_invalid' USING ERRCODE='23514';
  END IF;
  RETURN copy;
END
$$;
REVOKE ALL ON FUNCTION gridex_invoice_groups.verified_neutral_file_source(uuid,uuid,text)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_create_consolidated_invoice_neutral_file_v1(
  p_company_id uuid,p_invoice_id uuid,p_actor_user_id uuid,p_review_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE file gridex_invoice_groups.neutral_files%ROWTYPE;
DECLARE source gridex_invoice_groups.customer_documents%ROWTYPE;
DECLARE existing_file boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_group_file_forbidden' USING ERRCODE='42501';
  END IF;
  IF coalesce(p_review_hash,'') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invoice_group_file_scope_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM gridex_invoice_groups.drafts
    WHERE company_id=p_company_id AND invoice_id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_group_file_not_issued' USING ERRCODE='23514'; END IF;
  source:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,p_invoice_id,p_review_hash);
  SELECT * INTO file FROM gridex_invoice_groups.neutral_files WHERE company_id=p_company_id AND invoice_id=p_invoice_id;
  existing_file:=FOUND;
  IF existing_file THEN
    IF file.issue_hash IS DISTINCT FROM p_review_hash OR file.body_sha256 IS DISTINCT FROM source.body_sha256 THEN
      RAISE EXCEPTION 'invoice_group_file_receipt_invalid' USING ERRCODE='23514';
    END IF;
  ELSE
    INSERT INTO gridex_invoice_groups.neutral_files(company_id,invoice_id,issue_hash,body_sha256,created_by)
    VALUES(p_company_id,p_invoice_id,p_review_hash,source.body_sha256,p_actor_user_id) RETURNING * INTO file;
    INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,metadata)
    VALUES(p_company_id,p_actor_user_id,'invoice_group_neutral_file',file.file_id::text,
      'invoice_group_neutral_file_created',jsonb_build_object('invoiceId',p_invoice_id,'sha256',file.body_sha256));
  END IF;
  RETURN jsonb_build_object('fileId',file.file_id,'invoiceId',file.invoice_id,
    'sha256',file.body_sha256,'existing',existing_file);
END
$$;

CREATE FUNCTION public.gridex_read_consolidated_invoice_neutral_file_v1(
  p_company_id uuid,p_file_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE file gridex_invoice_groups.neutral_files%ROWTYPE;
DECLARE source gridex_invoice_groups.customer_documents%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR
    public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'billing_underlay.export') IS NOT TRUE THEN
    RAISE EXCEPTION 'invoice_group_file_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO file FROM gridex_invoice_groups.neutral_files WHERE company_id=p_company_id AND file_id=p_file_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  source:=gridex_invoice_groups.verified_neutral_file_source(p_company_id,file.invoice_id,file.issue_hash);
  IF file.body_sha256 IS DISTINCT FROM source.body_sha256 THEN
    RAISE EXCEPTION 'invoice_group_file_receipt_invalid' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('fileId',file.file_id,'invoiceId',file.invoice_id,'sha256',file.body_sha256,
    'bodyBase64',replace(encode(source.body,'base64'),E'\n',''));
END
$$;
REVOKE ALL ON FUNCTION public.gridex_create_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid,text),
  public.gridex_read_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_create_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid,text),
  public.gridex_read_consolidated_invoice_neutral_file_v1(uuid,uuid,uuid) TO service_role;
END
$gridex_invoice_migration$;
