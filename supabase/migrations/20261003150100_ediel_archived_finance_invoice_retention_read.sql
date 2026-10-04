-- F-RET-01 (variant of the customer-record read fix in 20261001000710 era):
-- the finance-copy and invoice-file read RPCs chose the read path with
-- gridex_ediel_retention.permission_v1(...,'ediel.retention.read'), which is
-- false for an archived tenant (company-scoped permission check), so an
-- archived read-only member fell through to the review path and was refused.
-- Use the same archived-aware read scope as ediel_read_customer_record_retention_v1;
-- the exact class permission check and record_read_actor_v1 still apply.
-- Body rewrites with predecessor/metadata guards.
BEGIN;
DO $read$DECLARE f record;
 needle CONSTANT text:=$n$gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,'ediel.retention.read')$n$;
 replacement CONSTANT text:=$n$gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,'__read_scope__')$n$;
BEGIN
 FOR f IN SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition FROM pg_proc p
  WHERE p.oid IN('public.ediel_read_finance_copy_retention_v1(uuid,uuid,uuid)'::regprocedure,'public.ediel_read_invoice_file_retention_v1(uuid,uuid,uuid)'::regprocedure)
 LOOP
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'archived_retention_read_predecessor_required';END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'archived_retention_read_metadata_changed';END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p WHERE p.oid IN('public.ediel_read_finance_copy_retention_v1(uuid,uuid,uuid)'::regprocedure,'public.ediel_read_invoice_file_retention_v1(uuid,uuid,uuid)'::regprocedure)
   AND position(replacement in p.prosrc)>0)<>2 THEN RAISE EXCEPTION 'archived_retention_read_not_applied';END IF;
END$read$;
COMMIT;
