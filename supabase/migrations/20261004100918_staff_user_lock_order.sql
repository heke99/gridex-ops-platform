-- Preserve serialization of staff account commands while allowing the company
-- foreign-key KEY SHARE used by API-client catalog revision triggers. Stronger
-- historical locks occur only after actor/client eligibility rows are held.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
DO $patch$
DECLARE
  spec record;
  source text;
  definition text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
      ('public.canonical_change_tenant_user_access(jsonb)','6b81baf87f5f67ca838e965624a435abc025354f9cab7a6ee5432420adfa0c57','PERFORM 1 FROM public.companies WHERE id=v_company_id FOR UPDATE;','PERFORM 1 FROM public.companies WHERE id=v_company_id FOR NO KEY UPDATE;'),
      ('public.canonical_create_tenant_invitation(jsonb)','60cf262d9408ab4660339fcf8fe4869148c5f9deeb193c3f3617487d2cb65ee6','PERFORM 1 FROM public.companies WHERE id=v_company_id FOR UPDATE;','PERFORM 1 FROM public.companies WHERE id=v_company_id FOR NO KEY UPDATE;'),
      ('public.gridex_assert_staff_command_v1(jsonb,boolean)','d98a9102050ca762f3fedcec33cbf159ce10136a8e87e34c43fe73b1e90fdbfc','SELECT status,is_active INTO v_company_status,v_company_active FROM public.companies WHERE id=v_company_id FOR UPDATE;','SELECT status,is_active INTO v_company_status,v_company_active FROM public.companies WHERE id=v_company_id FOR NO KEY UPDATE;')
  ) expected(function_name,source_hash,old_lock,new_lock)
  LOOP
    SELECT proc.prosrc,pg_get_functiondef(proc.oid) INTO source,definition
      FROM pg_proc proc WHERE proc.oid=spec.function_name::regprocedure;
    IF encode(extensions.digest(source,'sha256'),'hex') IS DISTINCT FROM spec.source_hash
       OR (length(source)-length(replace(source,spec.old_lock,'')))/length(spec.old_lock)<>1
    THEN RAISE EXCEPTION 'staff_user_lock_order_function_drift:%',spec.function_name; END IF;
    EXECUTE replace(definition,spec.old_lock,spec.new_lock);
  END LOOP;
END;
$patch$;
-- CREATE OR REPLACE retains the existing entrypoint ACL. Repeat the private
-- guard revoke explicitly; no Auth grants or role-profile changes are involved.
REVOKE ALL ON FUNCTION public.gridex_assert_staff_command_v1(jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
