import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type GuardResult = {
  userId: string
  email: string | null
  permissions: string[]
  roles: string[]
  isAdmin: boolean
}

type RoleRelation =
  | {
      id?: string | null
      name?: string | null
    }
  | {
      id?: string | null
      name?: string | null
    }[]
  | null

type RoleRow = {
  role_id?: string | null
  roles?: RoleRelation
}

function hasAnyPermission(
  currentPermissions: string[],
  requiredPermissions: string[]
): boolean {
  return requiredPermissions.some((permission) =>
    currentPermissions.includes(permission)
  )
}

function normalizeRoleName(row: RoleRow): string | null {
  const relation = row.roles

  if (Array.isArray(relation)) {
    return relation[0]?.name ?? null
  }

  if (relation && typeof relation === 'object') {
    return relation.name ?? null
  }

  return null
}

function normalizePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase()
}

function isAdminRole(role: string): boolean {
  const normalized = normalizeRole(role)

  return [
    'admin',
    'super_admin',
    'super admin',
    'pricing_manager',
    'pricing manager',
    'pricing_approver',
    'pricing approver',
    'compliance_officer',
    'compliance officer',
    'support',
    'operations_manager',
    'operations manager',
  ].includes(normalized)
}

async function loadBaseAdminContext(): Promise<{
  userId: string
  email: string | null
  roles: string[]
  isAdmin: boolean
}> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  const { data: rolesData, error: rolesError } = await supabase
    .from('user_roles')
    .select(
      `
      role_id,
      roles (
        id,
        name
      )
    `
    )
    .eq('user_id', user.id)
    .or('is_active.is.null,is_active.eq.true')

  if (rolesError) {
    throw rolesError
  }

  const roles = ((rolesData ?? []) as RoleRow[])
    .map(normalizeRoleName)
    .filter((value): value is string => Boolean(value))

  const isAdmin = roles.some(isAdminRole)

  return {
    userId: user.id,
    email: user.email ?? null,
    roles,
    isAdmin,
  }
}

async function loadPermissions(userId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('gridex_get_user_permissions', {
    p_user_id: userId,
  })

  if (error) {
    throw error
  }

  return normalizePermissions(data)
}

export async function requireAdminAccess(): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  return {
    ...base,
    permissions: [],
  }
}

export async function requireAdminPageAccess(
  requiredPermissions: string[] = []
): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  if (requiredPermissions.length === 0) {
    return {
      ...base,
      permissions: [],
    }
  }

  const permissions = await loadPermissions(base.userId)

  if (!hasAnyPermission(permissions, requiredPermissions)) {
    redirect('/admin')
  }

  return {
    ...base,
    permissions,
  }
}

export async function requireAdminActionAccess(
  requiredPermissions: string[] = []
): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    throw new Error('Du saknar adminbehörighet.')
  }

  if (requiredPermissions.length === 0) {
    return {
      ...base,
      permissions: [],
    }
  }

  const permissions = await loadPermissions(base.userId)

  if (!hasAnyPermission(permissions, requiredPermissions)) {
    throw new Error('Du saknar behörighet för denna åtgärd.')
  }

  return {
    ...base,
    permissions,
  }
}

export async function requireAdminRole(
  allowedRoles: string[] = []
): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  const normalizedCurrentRoles = base.roles.map(normalizeRole)
  const normalizedAllowedRoles = allowedRoles.map(normalizeRole)

  if (
    normalizedAllowedRoles.length > 0 &&
    !normalizedAllowedRoles.some((role) => normalizedCurrentRoles.includes(role))
  ) {
    redirect('/admin')
  }

  return {
    ...base,
    permissions: [],
  }
}