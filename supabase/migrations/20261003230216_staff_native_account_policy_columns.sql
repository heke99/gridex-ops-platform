-- Preserve the existing native account policy when rebuilding OPS from its
-- committed migration history. These fields exist in the authoritative live
-- OPS schema; IF NOT EXISTS leaves existing account values and expiry intact.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_password_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporary_password_set_by uuid,
  ADD COLUMN IF NOT EXISTS temporary_password_company_id uuid,
  ADD COLUMN IF NOT EXISTS temporary_password_company_name text;

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
