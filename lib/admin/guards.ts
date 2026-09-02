// lib/admin/guards.ts
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ADMIN_SELECTED_COMPANY_COOKIE } from '@/lib/admin/navigationPreferences'
import {
  getAdminPageRequirement,
  hasPermissionRequirement,
  type AdminPageKey,
  type PermissionRequirement,
} from '@/lib/admin/accessModel'
import { listOperationalCompaniesForUser } from '@/lib/tenant/scope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { isPlatformAdminRole, normalizeRoleKey, resolveRoleKey } from '@/lib/rbac/roleKeys'

export type GuardResult = {
  userId: string
  email: string | null
  permissions: string[]
  roles: string[]
  isAdmin: boolean
  isPlatformAdmin: boolean
  /**
   * The company these permissions were resolved for. F-1: `permissions` is scoped
   * to this company, so a permission held in another company does not apply here.
   */
  companyId: string | null
}

type UserRoleRpcRow = string | {
  role_id?: string | null
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

type CanonicalTenantContext = {
  authorized?: boolean
  reason_code?: string | null
  user_id?: string | null
  user_email?: string | null
  is_platform_admin?: boolean
  selected_company_id?: string | null
  roles?: unknown[]
  permissions?: unknown[]
}

async function readSelectedCompanyIdCookie(): Promise<string | null> {
  const cookieStore = await cookies()
  const value = cookieStore.get(ADMIN_SELECTED_COMPANY_COOKIE)?.value?.trim()
  return value ? value : null
}

const COMPANY_ADMIN_MEMBERSHIP_ROLES = new Set([
  'owner',
  'admin',
  'company_admin',
  'company_owner',
  'tenant_admin',
  'bolagsansvarig',
])
const COMPANY_READ_MEMBERSHIP_ROLES = new Set([
  'owner',
  'admin',
  'company_admin',
  'company_owner',
  'tenant_admin',
  'bolagsansvarig',
  'operations',
  'operations_manager',
  'operations_agent',
  'support',
  'customer_service',
  'customer_service_agent',
  'kundservice',
  'finance',
  'finance_readonly',
  'ekonomi',
  'viewer',
  'member',
])

function roleFromRpcRow(row: UserRoleRpcRow): string | null {
  if (typeof row === 'string') return normalizeRoleKey(row)
  if (!row || typeof row !== 'object') return null
  return resolveRoleKey(row)
}

function normalizeRequirement(
  input: string[] | PermissionRequirement
): PermissionRequirement {
  if (Array.isArray(input)) {
    return { anyOf: input }
  }

  return input
}

/**
 * F-7: platform-admin status is decided by the database, never inferred from role
 * names. `canonical_authenticated_tenant_context` derives `is_platform_admin` from
 * a genuinely global platform role; re-deriving it here from the role list treated
 * any role whose *name* looked like a platform role as one, regardless of whether
 * it was scoped to a single company.
 *
 * The role-name check survives only as a fallback for callers that pass an object
 * without the authoritative flag.
 */
export function isPlatformAdminContext(
  input: Pick<GuardResult, 'roles' | 'permissions'> & { isPlatformAdmin?: boolean }
): boolean {
  if (typeof input.isPlatformAdmin === 'boolean') return input.isPlatformAdmin

  return input.roles.some((role) => {
    const normalized = normalizeRoleKey(role)
    return isPlatformAdminRole(normalized)
  })
}

const loadBaseAdminContext = cache(async function loadBaseAdminContext(): Promise<GuardResult> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  // F-1: permissions are resolved for the company actually being operated, not as
  // a union across every company the user belongs to. The selected company comes
  // from the same cookie the operational scope uses; the database validates the
  // membership and falls back to the user's own company when it is absent or not
  // theirs.
  const selectedCompanyId = await readSelectedCompanyIdCookie()

  const { data: contextData, error: contextError } = await supabase.rpc(
    'canonical_authenticated_tenant_context',
    { p_selected_company_id: selectedCompanyId },
  )
  if (contextError) {
    console.error('[admin-guard] Canonical tenant context failed', {
      code: contextError.code,
      message: contextError.message,
    })
    throw new Error('Behörighetskontrollen kunde inte verifieras.')
  }

  const context = (contextData ?? {}) as CanonicalTenantContext
  if (!context.authorized || context.user_id !== user.id) {
    throw new Error(`Behörighetskontrollen nekades (${context.reason_code ?? 'access_context_invalid'}).`)
  }

  const permissions = (Array.isArray(context.permissions) ? context.permissions : [])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const roles = (Array.isArray(context.roles) ? context.roles : [])
    .map((row) => roleFromRpcRow(row as UserRoleRpcRow))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  const isAdmin =
    (permissions.length > 0 || roles.some(isPlatformAdminRole)) &&
    !(roles.length === 1 && roles[0] === 'customer')

  return {
    userId: user.id,
    email: context.user_email ?? user.email ?? null,
    permissions,
    roles,
    isAdmin,
    // F-7: authoritative, from the database. Never re-derived from role names.
    isPlatformAdmin: Boolean(context.is_platform_admin),
    companyId:
      typeof context.selected_company_id === 'string' && context.selected_company_id
        ? context.selected_company_id
        : null,
  }
})

export async function requireAdminAccess(): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  if (!isPlatformAdminContext(base)) {
    const memberships = await listOperationalCompaniesForUser(base.userId)
    if (memberships.length === 0) {
      redirect('/login')
    }
  }

  return base
}

export async function requirePlatformAdminAccess(): Promise<GuardResult> {
  const base = await requireAdminAccess()

  if (!isPlatformAdminContext(base)) {
    redirect('/admin/company-settings')
  }

  return base
}

export async function requirePlatformAdminActionAccess(): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin || !isPlatformAdminContext(base)) {
    throw new Error('Endast platform admin kan utföra den här åtgärden.')
  }

  return base
}

export async function requireAdminPageAccess(
  requiredPermissions: string[] | PermissionRequirement = []
): Promise<GuardResult> {
  const base = await requireAdminAccess()

  if (isPlatformAdminContext(base)) {
    return base
  }

  const requirement = normalizeRequirement(requiredPermissions)

  if (!hasPermissionRequirement(base.permissions, requirement)) {
    redirect('/admin')
  }

  return base
}

export async function requireAdminPageKeyAccess(
  pageKey: AdminPageKey
): Promise<GuardResult> {
  if (String(pageKey).startsWith('platform.')) {
    return requirePlatformAdminAccess()
  }

  return requireAdminPageAccess(getAdminPageRequirement(pageKey))
}

export async function requireAdminActionAccess(
  requiredPermissions: string[] | PermissionRequirement = []
): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    throw new Error('Unauthorized')
  }

  if (isPlatformAdminContext(base)) {
    return base
  }

  const memberships = await listOperationalCompaniesForUser(base.userId)
  if (!memberships.some((membership) => isCompanyWritableInTenantWorkspace(membership.companyStatus))) {
    throw new Error('Bolaget är pausat eller inte operativt. Ändringar är blockerade tills bolaget återaktiveras.')
  }

  const requirement = normalizeRequirement(requiredPermissions)

  if (!hasPermissionRequirement(base.permissions, requirement)) {
    throw new Error('Forbidden')
  }

  return base
}

export async function requireCompanyScopedAdminAccess(
  companyId: string,
  requiredPermissions: string[] | PermissionRequirement = []
): Promise<GuardResult> {
  const base = await requireAdminPageAccess(requiredPermissions)

  if (isPlatformAdminContext(base)) {
    return base
  }

  const memberships = await listOperationalCompaniesForUser(base.userId)
  const allowed = memberships.some(
    (membership) =>
      membership.companyId === companyId &&
      Boolean(normalizeRoleKey(membership.membershipRole) && COMPANY_READ_MEMBERSHIP_ROLES.has(normalizeRoleKey(membership.membershipRole) as string))
  )

  if (!allowed) {
    redirect('/admin')
  }

  return base
}

export async function requireCompanyScopedActionAccess(
  companyId: string,
  requiredPermissions: string[] | PermissionRequirement = []
): Promise<GuardResult> {
  const base = await requireAdminActionAccess(requiredPermissions)

  if (isPlatformAdminContext(base)) {
    return base
  }

  const memberships = await listOperationalCompaniesForUser(base.userId)
  const allowed = memberships.some(
    (membership) =>
      membership.companyId === companyId &&
      isCompanyWritableInTenantWorkspace(membership.companyStatus) &&
      Boolean(normalizeRoleKey(membership.membershipRole) && COMPANY_ADMIN_MEMBERSHIP_ROLES.has(normalizeRoleKey(membership.membershipRole) as string))
  )

  if (!allowed) {
    throw new Error('Du saknar aktiv ändringsbehörighet för valt bolag.')
  }

  return base
}
