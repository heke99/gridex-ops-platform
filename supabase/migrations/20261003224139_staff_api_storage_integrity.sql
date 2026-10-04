-- Classify private staff infrastructure and make integration-client tenant
-- binding a storage invariant in addition to every runtime authorization guard.
BEGIN;

INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
VALUES
 ('staff_api_sessions','tenant','Company/client-bound encrypted native Auth credentials for the separate OPS staff API.',NULL,'migration:staff_api_storage_integrity'),
 ('staff_api_session_operations','system','Private Auth leases and encrypted replay receipts, transitively bound to the company/client through staff_api_sessions.',NULL,'migration:staff_api_storage_integrity'),
 ('staff_api_auth_budgets','system','Private opaque account/client/IP and resource quota windows; keys contain hashes, not business identifiers.',NULL,'migration:staff_api_storage_integrity')
ON CONFLICT(table_name) DO UPDATE SET kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,
 null_company_meaning=EXCLUDED.null_company_meaning,classified_by=EXCLUDED.classified_by,classified_at=now();

ALTER TABLE public.staff_api_sessions ADD CONSTRAINT staff_api_sessions_company_client_fkey
 FOREIGN KEY(company_id,api_client_id) REFERENCES public.integration_api_clients(company_id,id) ON DELETE CASCADE;
ALTER TABLE public.staff_api_support_receipts ADD CONSTRAINT staff_api_support_receipts_company_client_fkey
 FOREIGN KEY(company_id,api_client_id) REFERENCES public.integration_api_clients(company_id,id);
ALTER TABLE public.staff_api_attachment_receipts ADD CONSTRAINT staff_api_attachment_receipts_company_client_fkey
 FOREIGN KEY(company_id,api_client_id) REFERENCES public.integration_api_clients(company_id,id);

COMMIT;
