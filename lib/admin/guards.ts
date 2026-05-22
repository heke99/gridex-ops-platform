// lib/admin/guards.ts
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  ROLE_PERMISSION_PROFILES,
  getAdminPageRequirement,
  hasPermissionRequirement,
  type AdminPageKey,
  type PermissionRequirement,
} from '@/lib/admin/accessModel'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'
import { listOperationalCompaniesForUser } from '@/lib/tenant/scope'

export type GuardResult = {
  userId: string
  email: string | null
  permissions: string[]
  roles: string[]
  isAdmin: boolean
  isPlatformAdmin: boolean
}

type UserRoleRpcRow = {
  role_id?: string | null
  role_key?: string | null
}

const PLATFORM_ADMIN_ROLES = new Set(['super_admin', 'superadmin', 'platform_admin'])
const COMPANY_ADMIN_MEMBERSHIP_ROLES = new Set(['owner', 'admin'])
const COMPANY_READ_MEMBERSHIP_ROLES = new Set(['owner', 'admin', 'operations', 'support', 'viewer', 'member'])

function normalizeRequirement(
  input: string[] | PermissionRequirement
): PermissionRequirement {
  if (Array.isArray(input)) {
    return { anyOf: input }
  }

  return input
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)))
}

function tenantMembershipFallbackRole(membershipRole: string | null | undefined): string | null {
  switch (membershipRole) {
    case 'owner':
    case 'admin':
    case 'company_admin':
      return 'company_admin'
    case 'operations':
      return 'operations_manager'
    case 'support':
      return 'customer_service_agent'
    case 'viewer':
    case 'member':
      return 'executive_readonly'
    default:
      return null
  }
}

function mergeCodeProfilePermissions(permissions: string[], roleKeys: string[]): string[] {
  const next = new Set(permissions)

  for (const roleKey of roleKeys) {
    const profile = ROLE_PERMISSION_PROFILES[roleKey]
    if (!profile) continue

    for (const permission of profile.permissions) {
      next.add(permission)
    }
  }

  return Array.from(next)
}

export function isPlatformAdminContext(input: Pick<GuardResult, 'roles' | 'permissions'>): boolean {
  // Platform access must be based on explicit platform roles, not broad permissions.
  // Some company-level roles may carry tenant/user permissions for their own company,
  // but that must never unlock /admin/companies, /admin/users, /admin/roles or /admin/platform/*.
  return input.roles.some((role) => PLATFORM_ADMIN_ROLES.has(role))
}

async function loadBaseAdminContext(): Promise<GuardResult> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  const permissionRows = await getUserPermissions(user.id)

  const { data: rolesData, error: rolesError } = await supabase.rpc(
    'gridex_get_user_roles',
    {
      p_user_id: user.id,
    }
  )

  if (rolesError) {
    throw rolesError
  }

  const rpcRoles = ((rolesData ?? []) as UserRoleRpcRow[])
    .map((row) => row.role_key ?? null)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  // Production safety fallback: some existing tenants can have company_memberships
  // backfilled before role_permissions/user_roles were fully normalized. A user who
  // is active owner/admin/company_admin for a tenant must still be treated as a
  // tenant admin for tenant-scoped pages such as /admin/customers and control tower.
  const memberships = await listOperationalCompaniesForUser(user.id)
  const membershipRoles = memberships
    .map((membership) => tenantMembershipFallbackRole(membership.membershipRole))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  const roles = uniqueStrings([...rpcRoles, ...membershipRoles])
  const permissions = mergeCodeProfilePermissions(permissionRows, roles)

  const isAdmin =
    permissions.length > 0 &&
    !(roles.length === 1 && roles[0] === 'customer')

  const base = {
    userId: user.id,
    email: user.email ?? null,
    permissions,
    roles,
    isAdmin,
    isPlatformAdmin: false,
  }

  return {
    ...base,
    isPlatformAdmin: isPlatformAdminContext(base),
  }
}

export async function requireAdminAccess(): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
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
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  // Superadmin/platform-admin can access tenant operation pages for support/debug
  // even if an older DB has stale role_permissions. Platform-only pages are still
  // gated separately by requirePlatformAdminAccess through requireAdminPageKeyAccess.
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
  // Platform pages are gated by explicit platform roles, never by broad tenant/report permissions.
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
      COMPANY_READ_MEMBERSHIP_ROLES.has(membership.membershipRole)
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
      COMPANY_ADMIN_MEMBERSHIP_ROLES.has(membership.membershipRole)
  )

  if (!allowed) {
    throw new Error('Du saknar behörighet för valt bolag.')
  }

  return base
}
