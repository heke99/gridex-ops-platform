-- 20260519_bootstrap_div3rsa_superadmin.sql
-- One-time production bootstrap for the original Gridex owner account.
-- Purpose:
-- 1) Keep platform administration separate from operational company work.
-- 2) Create Div3rsa AB as the user's own operational electricity-supplier company.
-- 3) Connect the existing auth user as platform super admin and Div3rsa company owner.
--
-- Safe to run multiple times. It does not delete or overwrite customer/Ediel data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF to_regclass('public.company_memberships') IS NOT NULL THEN
    ALTER TABLE public.company_memberships
      DROP CONSTRAINT IF EXISTS company_memberships_role_check;

    ALTER TABLE public.company_memberships
      ADD CONSTRAINT company_memberships_role_check
      CHECK (membership_role IN ('owner', 'company_admin', 'member', 'viewer'));
  END IF;
END $$;

DO $$
DECLARE
  v_user_id uuid := '14805078-5af1-466f-9e00-ad0896b02dfa';
  v_user_email text;
  v_company_id uuid;
  v_super_admin_role_id uuid;
  v_company_admin_role_id uuid;
  v_has_roles_is_system boolean := false;
  v_has_user_roles_status boolean := false;
  v_has_user_roles_is_active boolean := false;
  v_insert_columns text;
  v_insert_values text;
  v_update_set text;
BEGIN
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id
  LIMIT 1;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Bootstrap stopped: auth user % was not found. Create/login with the account first, then run this migration.', v_user_id;
  END IF;

  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'Bootstrap stopped: public.companies is missing. Run 20260519_saas_ui_tenant_admin.sql before this bootstrap migration.';
  END IF;

  IF to_regclass('public.company_memberships') IS NULL THEN
    RAISE EXCEPTION 'Bootstrap stopped: public.company_memberships is missing. Run 20260519_saas_ui_tenant_admin.sql before this bootstrap migration.';
  END IF;

  IF to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'Bootstrap stopped: public.roles is missing. Run the RBAC base migration before this bootstrap migration.';
  END IF;

  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'Bootstrap stopped: public.user_roles is missing. Run the RBAC base migration before this bootstrap migration.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'roles'
      AND column_name = 'is_system'
  ) INTO v_has_roles_is_system;

  IF v_has_roles_is_system THEN
    INSERT INTO public.roles (key, name, description, is_system)
    VALUES
      ('super_admin', 'Superadmin', 'Full plattformsåtkomst för SaaS-administration.', true),
      ('company_admin', 'Bolagsansvarig', 'Administrerar användare och dagliga flöden inom ett bolag.', true)
    ON CONFLICT (key) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          is_system = true;
  ELSE
    INSERT INTO public.roles (key, name, description)
    VALUES
      ('super_admin', 'Superadmin', 'Full plattformsåtkomst för SaaS-administration.'),
      ('company_admin', 'Bolagsansvarig', 'Administrerar användare och dagliga flöden inom ett bolag.')
    ON CONFLICT (key) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description;
  END IF;

  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE key = 'super_admin' LIMIT 1;
  SELECT id INTO v_company_admin_role_id FROM public.roles WHERE key = 'company_admin' LIMIT 1;

  IF v_super_admin_role_id IS NULL OR v_company_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Bootstrap stopped: could not resolve super_admin/company_admin roles.';
  END IF;

  IF to_regclass('public.permissions') IS NOT NULL THEN
    INSERT INTO public.permissions (key, name, description)
    VALUES
      ('tenants.read', 'Läsa företag', 'Kan se bolagskonton och bolagskopplingar.'),
      ('tenants.write', 'Skapa eller ändra företag', 'Kan skapa och uppdatera bolagskonton i plattformen.'),
      ('tenants.invite', 'Bjuda in till företag', 'Kan bjuda in användare till ett bolag och sätta bolagsroll.'),
      ('customers.read', 'Läsa kunder', 'Kan se kundregister och kundkort.'),
      ('customers.write', 'Ändra kunder', 'Kan skapa och ändra kunddata.'),
      ('contracts.read', 'Läsa avtal', 'Kan se avtal, kampanjer och prisplaner.'),
      ('contracts.write', 'Ändra avtal', 'Kan skapa och ändra avtal, kampanjer och prisplaner.'),
      ('switching.read', 'Läsa switchärenden', 'Kan se leverantörsbyten och relaterade händelser.'),
      ('switching.write', 'Ändra switchärenden', 'Kan skapa eller ändra leverantörsbyten och relaterade händelser.'),
      ('metering.read', 'Läsa mätdata', 'Kan se mätvärden och mätdata.'),
      ('metering.write', 'Ändra mätdata', 'Kan skapa eller ändra mätdata.'),
      ('sites.read', 'Läsa anläggningar', 'Kan se anläggningar.'),
      ('sites.write', 'Ändra anläggningar', 'Kan skapa eller ändra anläggningar.'),
      ('metering_points.read', 'Läsa mätpunkter', 'Kan se mätpunkter.'),
      ('metering_points.write', 'Ändra mätpunkter', 'Kan skapa eller ändra mätpunkter.'),
      ('poa.read', 'Läsa fullmakter', 'Kan se fullmakter.'),
      ('poa.write', 'Ändra fullmakter', 'Kan skapa eller ändra fullmakter.'),
      ('users.read', 'Läsa användare', 'Kan se användarlistan och användarkort.'),
      ('users.write', 'Ändra användare', 'Kan bjuda in eller ändra användare.'),
      ('roles.manage', 'Hantera roller', 'Kan hantera användarroller.'),
      ('permissions.manage', 'Hantera behörigheter', 'Kan hantera behörighetsöverskridningar.'),
      ('audit.read', 'Läsa revisionslogg', 'Kan se revisionslogg.'),
      ('reports.read', 'Läsa rapporter', 'Kan se rapporter och översikter.')
    ON CONFLICT (key) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description;
  END IF;

  IF to_regclass('public.role_permissions') IS NOT NULL
     AND to_regclass('public.permissions') IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_super_admin_role_id, p.id
    FROM public.permissions p
    ON CONFLICT DO NOTHING;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_company_admin_role_id, p.id
    FROM public.permissions p
    WHERE p.key IN (
      'users.read', 'users.write',
      'tenants.read', 'tenants.invite',
      'customers.read', 'customers.write',
      'contracts.read', 'contracts.write',
      'switching.read', 'switching.write',
      'metering.read', 'metering.write',
      'sites.read', 'sites.write',
      'metering_points.read', 'metering_points.write',
      'poa.read', 'poa.write',
      'audit.read', 'reports.read'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'status'
  ) INTO v_has_user_roles_status;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'is_active'
  ) INTO v_has_user_roles_is_active;

  -- Assign platform superadmin role to the existing account.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_user_id AND role_id = v_super_admin_role_id) THEN
    v_update_set := '';
    IF v_has_user_roles_status THEN
      v_update_set := v_update_set || 'status = ''active''';
    END IF;
    IF v_has_user_roles_is_active THEN
      v_update_set := v_update_set || CASE WHEN length(v_update_set) > 0 THEN ', ' ELSE '' END || 'is_active = true';
    END IF;
    IF length(v_update_set) > 0 THEN
      EXECUTE format('UPDATE public.user_roles SET %s WHERE user_id = $1 AND role_id = $2', v_update_set)
      USING v_user_id, v_super_admin_role_id;
    END IF;
  ELSE
    v_insert_columns := 'user_id, role_id';
    v_insert_values := '$1, $2';
    IF v_has_user_roles_status THEN
      v_insert_columns := v_insert_columns || ', status';
      v_insert_values := v_insert_values || ', ''active''';
    END IF;
    IF v_has_user_roles_is_active THEN
      v_insert_columns := v_insert_columns || ', is_active';
      v_insert_values := v_insert_values || ', true';
    END IF;
    EXECUTE format('INSERT INTO public.user_roles (%s) VALUES (%s)', v_insert_columns, v_insert_values)
    USING v_user_id, v_super_admin_role_id;
  END IF;

  -- Also assign company_admin global permissions. The actual company scope is controlled by company_memberships.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_user_id AND role_id = v_company_admin_role_id) THEN
    v_insert_columns := 'user_id, role_id';
    v_insert_values := '$1, $2';
    IF v_has_user_roles_status THEN
      v_insert_columns := v_insert_columns || ', status';
      v_insert_values := v_insert_values || ', ''active''';
    END IF;
    IF v_has_user_roles_is_active THEN
      v_insert_columns := v_insert_columns || ', is_active';
      v_insert_values := v_insert_values || ', true';
    END IF;
    EXECUTE format('INSERT INTO public.user_roles (%s) VALUES (%s)', v_insert_columns, v_insert_values)
    USING v_user_id, v_company_admin_role_id;
  END IF;

  SELECT id INTO v_company_id
  FROM public.companies
  WHERE slug = 'div3rsa-ab'
     OR replace(coalesce(org_number, ''), '-', '') = '5594167149'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (
      name,
      slug,
      org_number,
      status,
      primary_contact_email,
      primary_contact_name,
      industry,
      metadata,
      created_by
    ) VALUES (
      'Div3rsa AB',
      'div3rsa-ab',
      '559416-7149',
      'active',
      v_user_email,
      'Hekmat',
      'electricity_supplier',
      jsonb_build_object(
        'bootstrap', true,
        'bootstrap_reason', 'Original platform owner operational company',
        'operational_company', true
      ),
      v_user_id
    )
    RETURNING id INTO v_company_id;
  ELSE
    UPDATE public.companies
    SET name = 'Div3rsa AB',
        slug = COALESCE(slug, 'div3rsa-ab'),
        org_number = COALESCE(org_number, '559416-7149'),
        status = 'active',
        primary_contact_email = COALESCE(primary_contact_email, v_user_email),
        primary_contact_name = COALESCE(primary_contact_name, 'Hekmat'),
        industry = COALESCE(industry, 'electricity_supplier'),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'operational_company', true,
          'bootstrap_confirmed_at', now()
        ),
        updated_at = now()
    WHERE id = v_company_id;
  END IF;

  INSERT INTO public.company_memberships (
    company_id,
    user_id,
    membership_role,
    status,
    invited_email,
    invited_by,
    invited_at,
    accepted_at,
    metadata
  ) VALUES (
    v_company_id,
    v_user_id,
    'owner',
    'active',
    v_user_email,
    v_user_id,
    now(),
    now(),
    jsonb_build_object(
      'bootstrap', true,
      'role_note', 'Platform owner and operational owner for Div3rsa AB'
    )
  )
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET membership_role = 'owner',
        status = 'active',
        accepted_at = COALESCE(public.company_memberships.accepted_at, now()),
        suspended_at = NULL,
        metadata = COALESCE(public.company_memberships.metadata, '{}'::jsonb) || jsonb_build_object(
          'bootstrap_confirmed_at', now(),
          'role_note', 'Platform owner and operational owner for Div3rsa AB'
        );

  IF to_regclass('public.user_profiles') IS NOT NULL THEN
    ALTER TABLE public.user_profiles
      ADD COLUMN IF NOT EXISTS active_company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL;

    INSERT INTO public.user_profiles (id, email, full_name, active_company_id)
    VALUES (v_user_id, v_user_email, 'Hekmat', v_company_id)
    ON CONFLICT (id) DO UPDATE
      SET email = COALESCE(public.user_profiles.email, EXCLUDED.email),
          full_name = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
          active_company_id = EXCLUDED.active_company_id;
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'company_id'
    ) THEN
      INSERT INTO public.audit_logs (
        actor_user_id,
        entity_type,
        entity_id,
        action,
        new_values,
        metadata,
        company_id
      ) VALUES (
        v_user_id,
        'company',
        v_company_id::text,
        'bootstrap_operational_company',
        jsonb_build_object('company_name', 'Div3rsa AB', 'user_id', v_user_id),
        jsonb_build_object('source', '20260519_bootstrap_div3rsa_superadmin'),
        v_company_id
      );
    ELSE
      INSERT INTO public.audit_logs (
        actor_user_id,
        entity_type,
        entity_id,
        action,
        new_values,
        metadata
      ) VALUES (
        v_user_id,
        'company',
        v_company_id::text,
        'bootstrap_operational_company',
        jsonb_build_object('company_name', 'Div3rsa AB', 'user_id', v_user_id),
        jsonb_build_object('source', '20260519_bootstrap_div3rsa_superadmin')
      );
    END IF;
  END IF;
END $$;
