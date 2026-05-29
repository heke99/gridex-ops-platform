import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  hasPermissionRequirement,
  type PermissionRequirement,
} from '@/lib/admin/accessModel'
import {
  isPlatformAdminContext,
  type GuardResult,
} from '@/lib/admin/guards'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'
import { normalizeRoleKey, resolveRoleKey } from '@/lib/rbac/roleKeys'

type UserRoleRpcRow = string | {
  role_id?: string | null
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

type ApiGuardResult =
  | { guard: GuardResult; response?: never }
  | { guard?: never; response: NextResponse }

function roleFromRpcRow(row: UserRoleRpcRow): string | null {
  if (typeof row === 'string') return normalizeRoleKey(row)
  if (!row || typeof row !== 'object') return null
  return resolveRoleKey(row)
}

function normalizeRequirement(
  input: string[] | PermissionRequirement
): PermissionRequirement {
  return Array.isArray(input) ? { anyOf: input } : input
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export function apiErrorResponse(error: unknown, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : 'Internt serverfel'
  const status =
    /behörighet|forbidden|åtkomst/i.test(message) ? 403 :
    /hittades inte|not found/i.test(message) ? 404 :
    fallbackStatus

  return jsonError(message, status)
}

export async function requireAdminApiAccess(
  requiredPermissions: string[] | PermissionRequirement = []
): Promise<ApiGuardResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: jsonError('Ej inloggad', 401) }
  }

  let permissions: string[] = []

  try {
    permissions = await getUserPermissions(user.id)
  } catch (error) {
    console.warn('[admin-api] Could not load permissions', error)
    return { response: jsonError('Kunde inte verifiera behörighet', 503) }
  }

  const { data: rolesData, error: rolesError } = await supabase.rpc(
    'gridex_get_user_roles',
    {
      p_user_id: user.id,
    }
  )

  if (rolesError) {
    console.warn('[admin-api] Could not load roles', rolesError)
    return { response: jsonError('Kunde inte verifiera roller', 503) }
  }

  const roles = (Array.isArray(rolesData) ? (rolesData as UserRoleRpcRow[]) : [])
    .map(roleFromRpcRow)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  const base: GuardResult = {
    userId: user.id,
    email: user.email ?? null,
    permissions,
    roles,
    isAdmin:
      (permissions.length > 0 || roles.some((role) => role === 'super_admin' || role === 'platform_admin')) &&
      !(roles.length === 1 && roles[0] === 'customer'),
    isPlatformAdmin: false,
  }
  const guard: GuardResult = {
    ...base,
    isPlatformAdmin: isPlatformAdminContext(base),
  }

  if (!guard.isAdmin) {
    return { response: jsonError('Ej behörig', 403) }
  }

  if (!guard.isPlatformAdmin) {
    const requirement = normalizeRequirement(requiredPermissions)
    if (!hasPermissionRequirement(guard.permissions, requirement)) {
      return { response: jsonError('Saknar behörighet', 403) }
    }
  }

  return { guard }
}
