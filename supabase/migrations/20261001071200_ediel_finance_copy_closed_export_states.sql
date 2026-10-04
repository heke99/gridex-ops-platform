-- Completed retry/configuration/review attempts do not close their own item.
-- Preserve actual source/period/hash/grant/receipt guards and historical OIDs.
BEGIN;
DO $$DECLARE f record;body text;needle text:='i.status IN(''pending'',''failed'',''retrying'')';BEGIN
 SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE p.oid='gridex_ediel_retention.finance_basis_v1(uuid,text,text)'::regprocedure;
 IF length(f.prosrc)-length(replace(f.prosrc,needle,''))<>length(needle) THEN RAISE EXCEPTION 'finance_copy_actual_export_closure_review_required';END IF;
 body:=replace(f.prosrc,needle,'(i.status IS NULL OR upper(i.status) NOT IN(''SENT'',''CREDITED'',''CANCELLED'',''REJECTED''))');EXECUTE replace(f.definition,f.prosrc,body);
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=f.oid AND p.proowner=f.proowner AND p.proacl IS NOT DISTINCT FROM f.proacl AND p.proconfig IS NOT DISTINCT FROM f.proconfig) THEN RAISE EXCEPTION 'finance_copy_closure_identity_changed';END IF;
END$$;
COMMIT;
