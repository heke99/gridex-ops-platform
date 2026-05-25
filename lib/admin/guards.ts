// lib/admin/guards.ts
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getAdminPageRequirement,
  hasPermissionRequirement,
  type AdminPageKey,
  type PermissionRequirement,
} from '@/lib/admin/accessModel'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'
import { listOperationalCompaniesForUser } from '@/lib/tenant/scope'
import { normalizeRoleKey, resolveRoleKey } from '@/lib/rbac/roleKeys'

export type GuardResult = {
  userId: string
  email: string | null
  permissions: string[]
  roles: string[]
  isAdmin: boolean
  isPlatformAdmin: boolean
}

type UserRoleRpcRow = string | {
  role_id?: string | null
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

const PLATFORM_ADMIN_ROLES = new Set(['super_admin', 'superadmin', 'platform_admin'])
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

export function isPlatformAdminContext(input: Pick<GuardResult, 'roles' | 'permissions'>): boolean {
  // Platform access must be based on explicit platform roles, not broad permissions.
  // Some company-level roles may carry tenant/user permissions for their own company,
  // but that must never unlock /admin/companies, /admin/users, /admin/roles or /admin/platform/*.
  return input.roles.some((role) => {
    const normalized = normalizeRoleKey(role)
    return Boolean(normalized && PLATFORM_ADMIN_ROLES.has(normalized))
  })
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

  const permissions = await getUserPermissions(user.id)

  const { data: rolesData, error: rolesError } = await supabase.rpc(
    'gridex_get_user_roles',
    {
      p_user_id: user.id,
    }
  )

  if (rolesError) {
    throw rolesError
  }

  const roles = (Array.isArray(rolesData) ? (rolesData as UserRoleRpcRow[]) : [])
    .map(roleFromRpcRow)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  const isAdmin =
    (permissions.length > 0 || roles.some((role) => PLATFORM_ADMIN_ROLES.has(role))) &&
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

  // Platform admins must be able to open tenant-operational pages for support and troubleshooting,
  // even when old role_permissions rows are incomplete in the database. Platform-only pages are still
  // guarded separately by requirePlatformAdminAccess via requireAdminPageKeyAccess().
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
      Boolean(normalizeRoleKey(membership.membershipRole) && COMPANY_ADMIN_MEMBERSHIP_ROLES.has(normalizeRoleKey(membership.membershipRole) as string))
  )

  if (!allowed) {
    throw new Error('Du saknar behörighet för valt bolag.')
  }

  return base
}
