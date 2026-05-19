-- 20260519_saas_ui_tenant_admin.sql
-- Batch 1 + 2: SaaS UI foundation and tenant administration.
-- Guarded and idempotent: safe for partially upgraded environments.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  org_number text NULL,
  status text NOT NULL DEFAULT 'active',
  primary_contact_email text NULL,
  primary_contact_name text NULL,
  phone text NULL,
  website text NULL,
  industry text NOT NULL DEFAULT 'electricity_supplier',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_status_check CHECK (status IN ('active', 'onboarding', 'suspended', 'archived'))
);

CREATE INDEX IF NOT EXISTS companies_status_created_idx
  ON public.companies (status, created_at DESC);

CREATE INDEX IF NOT EXISTS companies_org_number_idx
  ON public.companies (org_number)
  WHERE org_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',
  invited_email text NULL,
  invited_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz NULL,
  suspended_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT company_memberships_role_check CHECK (membership_role IN ('company_admin', 'member', 'viewer')),
  CONSTRAINT company_memberships_status_check CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  CONSTRAINT company_memberships_company_user_key UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS company_memberships_user_status_idx
  ON public.company_memberships (user_id, status);

CREATE INDEX IF NOT EXISTS company_memberships_company_status_idx
  ON public.company_memberships (company_id, status);

CREATE TABLE IF NOT EXISTS public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NULL,
  membership_role text NOT NULL DEFAULT 'member',
  role_key text NULL,
  status text NOT NULL DEFAULT 'pending',
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NULL,
  accepted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_invitations_membership_role_check CHECK (membership_role IN ('company_admin', 'member', 'viewer')),
  CONSTRAINT company_invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);

CREATE INDEX IF NOT EXISTS company_invitations_company_status_idx
  ON public.company_invitations (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS company_invitations_email_status_idx
  ON public.company_invitations (lower(email), status);

DO $$
BEGIN
  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS active_company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS user_profiles_active_company_idx ON public.user_profiles (active_company_id);
  END IF;
END $$;

-- Add company ownership columns to access/audit tables without forcing immediate NOT NULL backfill.
DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'user_profiles',
    'user_roles',
    'user_permissions',
    'audit_logs'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL', target_table);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)', target_table || '_company_id_idx', target_table);
    END IF;
  END LOOP;
END $$;

-- Seed SaaS permissions and Company admin role when the RBAC tables are available.
DO $$
BEGIN
  IF to_regclass('public.permissions') IS NOT NULL THEN
    INSERT INTO public.permissions (key, name, description)
    VALUES
      ('tenants.read', 'Läsa företag', 'Kan se bolagskonton och tenant-kopplingar.'),
      ('tenants.write', 'Skapa eller ändra företag', 'Kan skapa och uppdatera bolagskonton i plattformen.'),
      ('tenants.invite', 'Bjuda in till företag', 'Kan bjuda in användare till ett bolag och sätta bolagsroll.')
    ON CONFLICT (key) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description;
  END IF;
END $$;

DO $$
DECLARE
  has_is_system_column boolean := false;
BEGIN
  IF to_regclass('public.roles') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'roles'
        AND column_name = 'is_system'
    ) INTO has_is_system_column;

    IF has_is_system_column THEN
      INSERT INTO public.roles (key, name, description, is_system)
      VALUES (
        'company_admin',
        'Company admin',
        'Bolagsansvarig som administrerar användare och dagliga flöden inom sitt bolag.',
        true
      )
      ON CONFLICT (key) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            is_system = true;
    ELSE
      INSERT INTO public.roles (key, name, description)
      VALUES (
        'company_admin',
        'Company admin',
        'Bolagsansvarig som administrerar användare och dagliga flöden inom sitt bolag.'
      )
      ON CONFLICT (key) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  v_role_id uuid;
  permission_keys text[] := ARRAY[
    'users.read',
    'users.write',
    'tenants.read',
    'tenants.invite',
    'customers.read',
    'customers.write',
    'contracts.read',
    'contracts.write',
    'documents.read',
    'documents.write',
    'communication.read',
    'communication.send',
    'cases.read',
    'cases.write',
    'switching.read',
    'switching.write',
    'metering.read',
    'metering.write',
    'metering_points.read',
    'metering_points.write',
    'sites.read',
    'sites.write',
    'masterdata.read',
    'masterdata.write',
    'billing_underlay.read',
    'billing_underlay.export',
    'partner_exports.read',
    'partner_exports.write',
    'poa.read',
    'poa.write',
    'pricing.read',
    'pricing.write',
    'reports.read',
    'audit.read'
  ];
BEGIN
  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
  THEN
    RETURN;
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE key = 'company_admin';
  IF v_role_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM public.permissions p
  WHERE p.key = ANY(permission_keys)
  ON CONFLICT DO NOTHING;
END $$;

-- Add tenant permissions to super_admin/admin roles when those roles exist.
DO $$
DECLARE
  role_record record;
  permission_record record;
BEGIN
  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
  THEN
    RETURN;
  END IF;

  FOR role_record IN SELECT id FROM public.roles WHERE key IN ('super_admin', 'admin') LOOP
    FOR permission_record IN SELECT id FROM public.permissions WHERE key IN ('tenants.read', 'tenants.write', 'tenants.invite') LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (role_record.id, permission_record.id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- RLS is prepared but not forced on legacy tables here. The new tenant tables are protected by policies.
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_service_role_all ON public.companies;
CREATE POLICY companies_service_role_all ON public.companies
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS company_memberships_service_role_all ON public.company_memberships;
CREATE POLICY company_memberships_service_role_all ON public.company_memberships
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS company_invitations_service_role_all ON public.company_invitations;
CREATE POLICY company_invitations_service_role_all ON public.company_invitations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.companies IS 'SaaS tenant/company accounts for Gridex Energy Operations.';
COMMENT ON TABLE public.company_memberships IS 'Tenant-safe mapping between auth users and companies.';
COMMENT ON TABLE public.company_invitations IS 'Invitation journal for company admins and tenant users.';
COMMENT ON COLUMN public.companies.status IS 'Operational status for the tenant account: active, onboarding, suspended, archived.';
