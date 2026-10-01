-- Exact customer-document path tuple; no guessed bucket, company or site.
BEGIN;
GRANT SELECT,UPDATE ON public.customer_sites TO gridex_ediel_retention_owner;
DO $$DECLARE f record;body text;needle text:=' SELECT to_jsonb(x) INTO object FROM storage.objects';BEGIN
 SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid='gridex_ediel_retention.invoice_file_locator_v1(uuid,text,uuid)'::regprocedure;
 IF position(needle IN f.prosrc)=0 OR f.prosrc!~'invoice_file_customer_document_scope_required' THEN RAISE EXCEPTION 'invoice_file_actual_locator_scope_review_required';END IF;
 body:=replace(f.prosrc,needle,' IF bucket=''customer-documents'' AND split_part(path,''/'',5)<>customer::text AND NOT EXISTS(SELECT FROM public.customer_sites WHERE id=split_part(path,''/'',5)::uuid AND company_id=c AND customer_id=customer) THEN RAISE EXCEPTION ''invoice_file_actual_customer_site_tuple_required'';END IF;'||chr(10)||needle);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=f.oid AND p.proowner=f.proowner AND p.proacl IS NOT DISTINCT FROM f.proacl AND p.proconfig IS NOT DISTINCT FROM f.proconfig) THEN RAISE EXCEPTION 'invoice_file_locator_identity_changed';END IF;
END$$;
COMMIT;
