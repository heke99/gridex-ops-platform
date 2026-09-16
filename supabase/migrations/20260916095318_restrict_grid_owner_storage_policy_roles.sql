-- Forward candidate: narrow only the two legacy agreement policies' role list.
-- PUBLIC policies plan their public.roles/user_roles subqueries for anon too,
-- even when the requested bucket is customer-documents. Do not grant anon
-- access to those tables and do not change any policy predicate or function.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $storage_policy_scope$
DECLARE
  target oid := to_regclass('storage.objects');
  auth_role oid := to_regrole('authenticated');
  item record;
  old_policy jsonb;
  new_policy jsonb;
BEGIN
  IF target IS NULL OR auth_role IS NULL OR NOT EXISTS (
    SELECT FROM pg_class WHERE oid=target AND relkind='r' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='STORAGE_POLICY_SCOPE_TARGET_REQUIRED';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('grid_owner_agreements_platform_read','r'),
    ('grid_owner_agreements_platform_write','a')
  ) AS expected(name,command)
  LOOP
    SELECT to_jsonb(p) INTO old_policy FROM pg_policy p
    WHERE p.polrelid=target AND p.polname=item.name
      AND p.polcmd::text=item.command AND p.polpermissive
      AND (p.polroles=ARRAY[0::oid] OR p.polroles=ARRAY[auth_role])
      AND ((item.command='r' AND p.polqual IS NOT NULL AND p.polwithcheck IS NULL)
        OR (item.command='a' AND p.polqual IS NULL AND p.polwithcheck IS NOT NULL));
    IF old_policy IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='STORAGE_POLICY_SCOPE_PREIMAGE_REQUIRED';
    END IF;
    EXECUTE format('ALTER POLICY %I ON storage.objects TO authenticated',item.name);
    SELECT to_jsonb(p) INTO new_policy FROM pg_policy p
    WHERE p.polrelid=target AND p.polname=item.name;
    IF new_policy IS NULL OR (new_policy-'polroles') IS DISTINCT FROM (old_policy-'polroles')
      OR new_policy->'polroles' IS DISTINCT FROM to_jsonb(ARRAY[auth_role]) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='STORAGE_POLICY_SCOPE_PRESERVATION_REQUIRED';
    END IF;
  END LOOP;
END
$storage_policy_scope$;
COMMIT;
