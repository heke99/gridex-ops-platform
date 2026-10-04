-- Composed defect: the bilateral H switch owners (20260930211852,
-- 20261001031053 and later) and the TS switch adapter model national H as an
-- explicit prodat_variant='H' with prodat_reason='Z25' on the switch request.
-- The canonical schema (20260821140500) only allowed L/LK and its BEFORE
-- trigger rewrote every 'switch' row to L/Z22 on insert and on each
-- metadata/validation update, so an H request could not exist (insert fails
-- the check) or silently became L. Only an explicit, consistent H/Z25
-- decision is preserved; every other row keeps the unchanged canonicalization.
BEGIN;
ALTER TABLE public.supplier_switch_requests DROP CONSTRAINT supplier_switch_requests_prodat_variant_check,
 ADD CONSTRAINT supplier_switch_requests_prodat_variant_check CHECK (prodat_variant IS NULL OR prodat_variant = ANY (ARRAY['L','LK','H']));
ALTER TABLE public.supplier_switch_requests DROP CONSTRAINT supplier_switch_requests_z03_variant_check,
 ADD CONSTRAINT supplier_switch_requests_z03_variant_check CHECK (z03_variant IS NULL OR z03_variant = ANY (ARRAY['L','LK','H']));
DO $variant$DECLARE f record;body text;needle text;BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_materialize_supplier_switch_process_variant()'::regprocedure;
 needle:=E'      v_variant := ''L'';\n      v_reason := ''Z22'';\n      v_expected_z02 := ''L'';\n      v_z03_variant := ''L'';';
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'supplier_switch_variant_predecessor_required';END IF;
 body:=replace(f.prosrc,needle,E'      v_variant := CASE WHEN new.prodat_variant = ''H'' AND new.prodat_reason = ''Z25'' THEN ''H'' ELSE ''L'' END;\n      v_reason := CASE WHEN v_variant = ''H'' THEN ''Z25'' ELSE ''Z22'' END;\n      v_expected_z02 := ''L'';\n      v_z03_variant := v_variant;');
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'supplier_switch_variant_metadata_changed';END IF;
END$variant$;
COMMIT;
