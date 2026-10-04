-- 20261001070000 binds the finance-copy retention classes to
-- ediel.retention.billing_source_evidence, ediel.retention.invoice_copy_evidence
-- and ediel.retention.settlement_copy_evidence, but never registered those keys
-- in public.permissions. No actor could be granted them, so these classes were
-- unreachable. Register them exactly like the sibling classes (064500/070700):
-- explicit own original-byte classes, active, with no role/default assignment,
-- issuer or deadline. Nothing is granted here.
BEGIN;
INSERT INTO public.permissions(key,name,category,description,is_active) VALUES
 ('ediel.retention.billing_source_evidence','Retention finance copy: billing source','ediel','Explicit own original-byte class; no role/default assignment, issuer or deadline',true),
 ('ediel.retention.invoice_copy_evidence','Retention finance copy: invoice','ediel','Explicit own original-byte class; no role/default assignment, issuer or deadline',true),
 ('ediel.retention.settlement_copy_evidence','Retention finance copy: settlement','ediel','Explicit own original-byte class; no role/default assignment, issuer or deadline',true)
ON CONFLICT(key) DO NOTHING;
DO $verify$BEGIN
 IF (SELECT count(*) FROM public.permissions WHERE is_active AND key IN('ediel.retention.billing_source_evidence','ediel.retention.invoice_copy_evidence','ediel.retention.settlement_copy_evidence'))<>3 THEN RAISE EXCEPTION 'finance_copy_retention_permission_catalog_incomplete';END IF;
 IF EXISTS(SELECT FROM public.role_permissions WHERE permission_key IN('ediel.retention.billing_source_evidence','ediel.retention.invoice_copy_evidence','ediel.retention.settlement_copy_evidence')) THEN RAISE EXCEPTION 'finance_copy_retention_default_assignment_forbidden';END IF;
END$verify$;
COMMIT;
