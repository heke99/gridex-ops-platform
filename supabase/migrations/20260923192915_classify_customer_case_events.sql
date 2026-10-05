-- Created with Supabase CLI 2.101.0: migration new classify_customer_case_events.
-- C1: the forward-restored case history must participate in the tenant gates.
BEGIN;
INSERT INTO public.platform_table_classification(table_name,kind,rationale,null_company_meaning,classified_by)
VALUES('customer_case_events','tenant',
 'Tenant-owned customer case history. Required company/customer/case composite ownership; service-role-only access with RLS enabled.',
 NULL,'migration:classify_customer_case_events')
ON CONFLICT(table_name) DO UPDATE SET
 kind=EXCLUDED.kind,rationale=EXCLUDED.rationale,null_company_meaning=EXCLUDED.null_company_meaning,
 classified_by=EXCLUDED.classified_by,classified_at=now();
COMMIT;
