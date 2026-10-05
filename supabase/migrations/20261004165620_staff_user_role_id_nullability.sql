-- CREATE TABLE IF NOT EXISTS preserved the legacy NOT NULL constraint, while
-- the canonical staff core inserts role text before its wrapper maps role_id.
-- Match the qualified nullable model without rewriting rows or role references.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
DO $normalize$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid=pg_catalog.to_regclass('public.user_roles')
      AND attname='role_id' AND atttypid='uuid'::regtype
      AND NOT attisdropped AND attgenerated=''
  ) THEN
    RAISE EXCEPTION 'staff_user_roles_role_id_schema_mismatch';
  END IF;
  ALTER TABLE public.user_roles ALTER COLUMN role_id DROP NOT NULL;
END;
$normalize$;
COMMIT;
