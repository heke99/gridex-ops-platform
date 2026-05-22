import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ROLE_PERMISSION_PROFILES } from '@/lib/admin/accessModel'

type OverrideRow =
  | {
      permission_key?: string | null
      effect?: 'allow' | 'deny' | null
    }
  | {
      permissions?: {
        key?: string | null
      } | null
      effect?: 'allow' | 'deny' | null
    }

type PermissionRpcRow =
  | {
      permission_key?: string | null
    }
  | {
      gridex_get_user_permissions?: string[] | null
    }

type UserRoleRpcRow = {
  role_key?: string | null
}

function normalizePermissionRows(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  if (value.every((item) => typeof item === 'string')) {
    return value.filter((item): item is string => typeof item === 'string')
  }

  const firstRow = value[0] as PermissionRpcRow | undefined

  if (
    firstRow &&
    'gridex_get_user_permissions' in firstRow &&
    Array.isArray(firstRow.gridex_get_user_permissions)
  ) {
    return firstRow.gridex_get_user_permissions.filter(
      (item): item is string => typeof item === 'string'
    )
  }

  return (value as PermissionRpcRow[])
    .map((row) => ('permission_key' in row ? row.permission_key : null))
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function normalizeOverridePermissionKey(row: OverrideRow): string | null {
  if ('permission_key' in row && typeof row.permission_key === 'string') {
    return row.permission_key
  }

  if (
    'permissions' in row &&
    row.permissions &&
    typeof row.permissions === 'object' &&
    typeof row.permissions.key === 'string'
  ) {
    return row.permissions.key
  }

  return null
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient()

  const { data: permissionRows, error: permissionsError } = await supabase.rpc(
    'gridex_get_user_permissions',
    { p_user_id: userId }
  )

  if (permissionsError) throw permissionsError

  const { data: roleRows, error: rolesError } = await supabase.rpc(
    'gridex_get_user_roles',
    { p_user_id: userId }
  )

  if (rolesError) throw rolesError

  const { data: overrideRows, error: overridesError } = await supabase.rpc(
    'gridex_get_user_permission_overrides',
    { p_user_id: userId }
  )

  if (overridesError) throw overridesError

  const allowed = new Set(normalizePermissionRows(permissionRows))

  // Defensive RBAC fallback: the database remains source of truth, but older tenants
  // can have roles created before role_permissions were fully backfilled. Merge the
  // code-level role profile first, then apply explicit allow/deny overrides below.
  for (const row of ((roleRows as UserRoleRpcRow[] | null) ?? [])) {
    const roleKey = row.role_key
    if (!roleKey) continue

    const profile = ROLE_PERMISSION_PROFILES[roleKey]
    if (!profile) continue

    for (const permission of profile.permissions) {
      allowed.add(permission)
    }
  }

  for (const row of ((overrideRows as OverrideRow[] | null) ?? [])) {
    const permissionKey = normalizeOverridePermissionKey(row)
    const effect = row.effect

    if (!permissionKey || !effect) continue

    if (effect === 'allow') allowed.add(permissionKey)
    if (effect === 'deny') allowed.delete(permissionKey)
  }

  return Array.from(allowed)
}