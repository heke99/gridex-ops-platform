DO $gridex_invoice_migration$
BEGIN

-- Read only. The intent ID names an already committed receipt; it confers no
-- access by itself and cannot reach file creation or outbox reconciliation.
CREATE FUNCTION public.gridex_recover_invoice_file_receipt_v2(
  p_company_id uuid,p_actor_user_id uuid,p_billing_month text,p_intent_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  saved record;
  receipt jsonb;
BEGIN
  SELECT f.provider,f.environment,r.selection INTO saved
  FROM gridex_invoice_file_archive.receipts r
  JOIN public.invoice_export_files f ON f.company_id=r.company_id AND f.id=r.file_id
  WHERE r.company_id=p_company_id AND r.actor_user_id=p_actor_user_id
    AND r.intent_id=p_intent_id AND f.billing_month=p_billing_month
    AND f.artifact_archive_version=2;
  IF NOT FOUND THEN RETURN NULL; END IF;

  receipt:=public.gridex_read_invoice_file_intent_v2(p_company_id,p_actor_user_id,p_billing_month,p_intent_id,
    saved.provider,saved.environment,saved.selection);
  IF receipt IS NULL THEN
    RAISE EXCEPTION 'invoice_file_frozen_artifact_invalid' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('fileId',receipt->>'fileId','rowsSha256',receipt->>'rowsSha256');
END
$$;

REVOKE ALL ON FUNCTION public.gridex_recover_invoice_file_receipt_v2(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_recover_invoice_file_receipt_v2(uuid,uuid,text,uuid) TO service_role;
END
$gridex_invoice_migration$;
