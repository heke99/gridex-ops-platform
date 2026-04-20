import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'

type GuardResult = {
  userId: string
  email: string | null
  permissions: string[]
  roles: string[]
  isAdmin: boolean
}

type UserRoleRpcRow = {
  role_id?: string | null
  role_key?: string | null
}

function hasAnyPermission(
  currentPermissions: string[],
  requiredPermissions: string[]
): boolean {
  return requiredPermissions.some((permission) =>
    currentPermissions.includes(permission)
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

  return {
    userId: user.id,
    email: user.email ?? null,
    permissions,
    roles,
    isAdmin,
  }
}

export async function requireAdminAccess(): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  return base
}

export async function requireAdminPageAccess(
  requiredPermissions: string[] = []
): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  if (requiredPermissions.length > 0 && !hasAnyPermission(base.permissions, requiredPermissions)) {
    redirect('/admin')
  }

  return base
}

export async function requireAdminActionAccess(
  requiredPermissions: string[] = []
): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    throw new Error('Du saknar adminbehörighet.')
  }

  if (requiredPermissions.length > 0 && !hasAnyPermission(base.permissions, requiredPermissions)) {
    throw new Error('Du saknar behörighet för denna åtgärd.')
  }

  return base
}

export async function requireAdminRole(
  allowedRoles: string[] = []
): Promise<GuardResult> {
  const base = await loadBaseAdminContext()

  if (!base.isAdmin) {
    redirect('/login')
  }

  if (allowedRoles.length > 0) {
    const current = new Set(base.roles)
    const allowed = allowedRoles.some((role) => current.has(role))

    if (!allowed) {
      redirect('/admin')
    }
  }

  return base
}