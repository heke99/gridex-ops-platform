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

const PLATFORM_ADMIN_ROLES = new Set(['super_admin', 'platform_admin'])
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

export function isPlatformAdminContext(input: Pick<GuardResult, 'roles' | 'permissions'>): boolean {
  return (
    input.roles.some((role) => PLATFORM_ADMIN_ROLES.has(role)) ||
    input.permissions.includes('permissions.manage') ||
    input.permissions.includes('roles.manage') ||
    input.permissions.includes('tenants.write')
  )
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

  const roles = ((rolesData ?? []) as UserRoleRpcRow[])
    .map((row) => row.role_key ?? null)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

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

  const requirement = normalizeRequirement(requiredPermissions)

  if (!hasPermissionRequirement(base.permissions, requirement)) {
    redirect('/admin')
  }

  return base
}

export async function requireAdminPageKeyAccess(
  pageKey: AdminPageKey
): Promise<GuardResult> {
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
