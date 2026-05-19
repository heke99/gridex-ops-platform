-- Batch auth email flow hardening: confirm, invite, recovery and DB sync.
-- Corrected migration: safe if older projects have partially-created tenant tables
-- where company_id/status/membership_role columns are missing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- User/auth lifecycle columns
-- -----------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.user_roles
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

ALTER TABLE IF EXISTS public.user_profiles
  ADD COLUMN IF NOT EXISTS auth_email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_password_reset_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_confirmation_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_auth_email_action text,
  ADD COLUMN IF NOT EXISTS last_auth_email_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_auth_email_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- -----------------------------------------------------------------------------
-- Tenant invitation/membership baseline
-- Some existing databases have these tables from older batches but are missing
-- company_id or other columns. We create/patch them before any indexes/constraints.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,
  user_id uuid NULL,
  membership_role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',
  accepted_at timestamptz NULL,
  invited_at timestamptz NULL,
  invited_by uuid NULL,
  invited_email text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.company_memberships
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS membership_role text DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by uuid,
  ADD COLUMN IF NOT EXISTS invited_email text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE TABLE IF NOT EXISTS public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,
  email text NOT NULL,
  membership_role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid NULL,
  invited_user_id uuid NULL,
  accepted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS public.company_invitations
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS membership_role text DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS invited_by uuid,
  ADD COLUMN IF NOT EXISTS invited_user_id uuid,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Make old nullable/default-less columns safer without failing if values already exist.
ALTER TABLE IF EXISTS public.company_memberships
  ALTER COLUMN membership_role SET DEFAULT 'member',
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS public.company_invitations
  ALTER COLUMN membership_role SET DEFAULT 'member',
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- Auth email event audit trail
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auth_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  company_id uuid NULL,
  actor_user_id uuid NULL,
  email text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  source text NOT NULL DEFAULT 'app',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_email_events_event_type_check CHECK (
    event_type IN (
      'invite_sent',
      'password_reset_sent',
      'confirmation_sent',
      'email_action_verified',
      'password_updated',
      'company_invitation_accepted',
      'direct_user_created'
    )
  ),
  CONSTRAINT auth_email_events_status_check CHECK (
    status IN ('sent', 'verified', 'accepted', 'failed', 'created')
  )
);

ALTER TABLE IF EXISTS public.auth_email_events
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- -----------------------------------------------------------------------------
-- Broad constraints. Keep them permissive enough for existing SaaS roles/statuses.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.company_memberships') IS NOT NULL THEN
    ALTER TABLE public.company_memberships
      DROP CONSTRAINT IF EXISTS company_memberships_status_check;

    ALTER TABLE public.company_memberships
      ADD CONSTRAINT company_memberships_status_check
      CHECK (status IN ('active', 'pending', 'invited', 'suspended', 'revoked', 'removed', 'disabled'));

    ALTER TABLE public.company_memberships
      DROP CONSTRAINT IF EXISTS company_memberships_role_check;

    ALTER TABLE public.company_memberships
      ADD CONSTRAINT company_memberships_role_check
      CHECK (membership_role IN (
        'owner', 'admin', 'company_admin', 'member', 'viewer',
        'operations', 'support', 'platform_admin', 'superadmin', 'super_admin'
      ));
  END IF;

  IF to_regclass('public.company_invitations') IS NOT NULL THEN
    ALTER TABLE public.company_invitations
      DROP CONSTRAINT IF EXISTS company_invitations_status_check;

    ALTER TABLE public.company_invitations
      ADD CONSTRAINT company_invitations_status_check
      CHECK (status IN ('pending', 'accepted', 'revoked', 'expired', 'invited', 'sent', 'failed'));

    ALTER TABLE public.company_invitations
      DROP CONSTRAINT IF EXISTS company_invitations_membership_role_check;

    ALTER TABLE public.company_invitations
      ADD CONSTRAINT company_invitations_membership_role_check
      CHECK (membership_role IN (
        'owner', 'admin', 'company_admin', 'member', 'viewer',
        'operations', 'support', 'platform_admin', 'superadmin', 'super_admin'
      ));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Indexes, created only after the needed columns are guaranteed to exist.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS auth_email_events_email_created_idx
  ON public.auth_email_events (lower(email), created_at DESC);

CREATE INDEX IF NOT EXISTS auth_email_events_user_created_idx
  ON public.auth_email_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_email_events_company_created_idx
  ON public.auth_email_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS company_invitations_email_pending_idx
  ON public.company_invitations (lower(email), status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS company_invitations_company_status_idx
  ON public.company_invitations (company_id, status);

CREATE INDEX IF NOT EXISTS company_memberships_user_company_status_idx
  ON public.company_memberships (user_id, company_id, status);

CREATE INDEX IF NOT EXISTS company_memberships_company_status_idx
  ON public.company_memberships (company_id, status);

-- -----------------------------------------------------------------------------
-- RLS for auth_email_events. Superadmin read policy is created only when the
-- RBAC tables exist; service role always has full access.
-- -----------------------------------------------------------------------------

ALTER TABLE public.auth_email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_email_events_service_role_all ON public.auth_email_events;
CREATE POLICY auth_email_events_service_role_all ON public.auth_email_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DO $$
BEGIN
  IF to_regclass('public.user_roles') IS NOT NULL AND to_regclass('public.roles') IS NOT NULL THEN
    DROP POLICY IF EXISTS auth_email_events_superadmin_read ON public.auth_email_events;

    EXECUTE $policy$
      CREATE POLICY auth_email_events_superadmin_read ON public.auth_email_events
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1
            FROM public.user_roles ur
            JOIN public.roles r ON r.id = ur.role_id
            WHERE ur.user_id = auth.uid()
              AND (coalesce(ur.status, 'active') = 'active')
              AND coalesce(ur.is_active, true) = true
              AND r.key IN ('super_admin', 'superadmin', 'platform_admin', 'admin')
          )
        )
    $policy$;
  END IF;
END $$;

COMMENT ON TABLE public.auth_email_events IS 'Audit trail for Supabase Auth email actions: invite, reset, confirmation and accepted invitation sync.';
