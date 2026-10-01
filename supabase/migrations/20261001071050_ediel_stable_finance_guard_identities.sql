-- Stable semantic trigger identities, including clean/ancestor-upgrade replay.
-- ALTER RENAME preserves each installed OID, trigger binding, body, owner and
-- ACL; dump normalization and replay comparator exceptions are not used.
BEGIN;
DO $$DECLARE f record;name text;other oid;BEGIN
 FOR f IN SELECT DISTINCT p.oid,p.proname,n.nspname,tn.nspname source_schema,c.relname source_table,t.tgname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_trigger t ON t.tgfoid=p.oid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace tn ON tn.oid=c.relnamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname~'^finance_guard_[0-9]+$' AND NOT t.tgisinternal ORDER BY tn.nspname,c.relname,t.tgname LOOP
  IF (SELECT count(*) FROM pg_trigger WHERE tgfoid=f.oid AND NOT tgisinternal)<>1 THEN RAISE EXCEPTION 'finance_guard_semantic_binding_review_required';END IF;
  name:='finance_guard_v1_'||md5(jsonb_build_array(f.source_schema,f.source_table,f.tgname)::text);other:=to_regprocedure(format('%I.%I()',f.nspname,name));IF other IS NOT NULL AND other<>f.oid THEN RAISE EXCEPTION 'finance_guard_semantic_identity_collision';END IF;
  EXECUTE format('ALTER FUNCTION %I.%I() RENAME TO %I',f.nspname,f.proname,name);
 END LOOP;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname~'^finance_guard_[0-9]+$') THEN RAISE EXCEPTION 'finance_guard_unbound_dynamic_identity_review_required';END IF;
END$$;
COMMIT;
