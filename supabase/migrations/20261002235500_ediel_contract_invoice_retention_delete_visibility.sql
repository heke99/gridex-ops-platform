-- Same defect as 20261001142690 (ediel-files), for the other two qualified
-- retention purges: customer-contract-documents (contract signed PDF bytes,
-- lib/ediel/retention/contractDocumentPurge.ts) and the invoice-file target
-- (ediel_invoice_file_storage_delete_target_v1). Storage removes objects with
-- DELETE ... RETURNING, which PostgreSQL also filters by SELECT policies. With
-- only a DELETE policy the purging actor could not see the row, so the API
-- answered {data:[],error:null}, nothing was deleted and the readback then
-- refused the purge (contract_pdf_retention_actual_unavailability_readback_required).
--
-- Add the same narrowest visibility: SELECT only while the storage server is
-- executing an object delete (storage.operation() = 'storage.object.delete_many'),
-- only for a target the existing DELETE predicate already authorizes for the
-- current purge actor. Download/list/sign stay invisible; the DELETE policies
-- and storage guards are unchanged.
BEGIN;
DO $pre$BEGIN
 IF to_regprocedure('storage.operation()') IS NULL
  OR to_regprocedure('public.ediel_contract_retention_storage_target_v1(text)') IS NULL
  OR to_regprocedure('public.ediel_invoice_file_storage_delete_target_v1(text,text)') IS NULL
  OR NOT EXISTS(SELECT FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='contract_qualified_retention_storage_delete' AND polcmd='d')
  OR NOT EXISTS(SELECT FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='invoice_file_qualified_retention_storage_delete' AND polcmd='d')
  OR EXISTS(SELECT FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname IN('contract_qualified_retention_storage_delete_visibility','invoice_file_qualified_retention_storage_delete_visibility'))
 THEN RAISE EXCEPTION 'ediel_contract_invoice_retention_delete_visibility_predecessor_required';END IF;
END$pre$;
CREATE POLICY contract_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='customer-contract-documents' AND storage.operation()='storage.object.delete_many'
  AND EXISTS(SELECT FROM public.ediel_contract_retention_storage_target_v1(objects.name)));
CREATE POLICY invoice_file_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated
 USING (storage.operation()='storage.object.delete_many'
  AND public.ediel_invoice_file_storage_delete_target_v1(bucket_id,name));
COMMIT;
