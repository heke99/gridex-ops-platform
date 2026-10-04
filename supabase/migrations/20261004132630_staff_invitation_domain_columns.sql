-- Close the invitation columns used by the canonical staff intent, delivery
-- worker, verified-user acceptance and disable commands on canonical replay.
-- Existing production columns/defaults/constraints and every legacy row stay
-- unchanged. New columns are nullable with no credential or role backfill.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

ALTER TABLE public.company_invitations
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS membership_role text,
  ADD COLUMN IF NOT EXISTS role_key text,
  ADD COLUMN IF NOT EXISTS token uuid,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accept_token_hash text,
  ADD COLUMN IF NOT EXISTS invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_email text;

-- IF NOT EXISTS must not silently accept a column that the actual domain
-- commands cannot write/read. A mismatch aborts the whole additive transaction;
-- no existing type/default/nullability/constraint is rewritten to converge it.
DO $invitation_schema$
DECLARE
  required record;
BEGIN
  FOR required IN
    SELECT * FROM (VALUES
      ('full_name','text'::regtype),
      ('membership_role','text'::regtype),
      ('role_key','text'::regtype),
      ('token','uuid'::regtype),
      ('invited_by','uuid'::regtype),
      ('accept_token_hash','text'::regtype),
      ('invited_user_id','uuid'::regtype),
      ('revoked_at','timestamptz'::regtype),
      ('invited_email','text'::regtype)
    ) AS expected(column_name,column_type)
  LOOP
    IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid='public.company_invitations'::regclass
        AND attribute.attname=required.column_name
        AND attribute.atttypid=required.column_type
        AND NOT attribute.attisdropped
        AND attribute.attgenerated=''
    ) THEN
      RAISE EXCEPTION USING ERRCODE='22023',
        MESSAGE='staff_invitation_domain_column_type_mismatch:'||required.column_name;
    END IF;
  END LOOP;
END
$invitation_schema$;
COMMIT;
