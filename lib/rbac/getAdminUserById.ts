import { supabaseService } from '@/lib/supabase/service'

type PermissionRow = {
  id: string
  key: string | null
  name: string | null
}

type RoleRow = {
  id: string
  key: string | null
  name: string | null
}

export type UserRoleRow = {
  id: string
  user_id: string
  is_active: boolean
  granted_at: string | null
  expires_at: string | null
  roles: RoleRow | null
}

export type UserOverrideRow = {
  id: string
  effect: 'allow' | 'deny'
  reason: string | null
  granted_at: string | null
  expires_at: string | null
  permissions: PermissionRow | null
}

type RawUserRoleRow = {
  id: string
  user_id: string
  is_active?: boolean | null
  created_at?: string | null
  updated_at?: string | null
  role_id?: string | null
  roles?: RoleRow | null
}

type RawOverrideRow = {
  id: string
  permission_key?: string | null
  effect?: 'allow' | 'deny' | string | null
  reason?: string | null
  valid_from?: string | null
  valid_to?: string | null
  created_at?: string | null
  updated_at?: string | null
}

function normalizeRoleKey(value: string | null | undefined) {
  return String(value ?? '').trim()
}

export async function getAdminUserById(userId: string) {
  const { data: authUserData, error: authError } =
    await supabaseService.auth.admin.getUserById(userId)

  if (authError) throw authError
  if (!authUserData.user) return null

  const { data: userRoles, error: rolesError } = await supabaseService
    .from('user_roles')
    .select('id, user_id, role_id, is_active, created_at, updated_at, roles(id, key, name)')
    .eq('user_id', userId)
    .eq('is_active', true)

  if (rolesError) throw rolesError

  const rawRoles = (userRoles ?? []) as unknown as RawUserRoleRow[]
  const normalizedRoles: UserRoleRow[] = rawRoles.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    is_active: row.is_active !== false,
    granted_at: row.created_at ?? row.updated_at ?? null,
    expires_at: null,
    roles: row.roles ?? (row.role_id ? {
      id: row.role_id,
      key: normalizeRoleKey(row.role_id),
      name: normalizeRoleKey(row.role_id),
    } : null),
  }))

  const { data: overrides, error: overridesError } = await supabaseService
    .from('user_permission_overrides')
    .select('id, permission_key, effect, reason, valid_from, valid_to, created_at, updated_at')
    .eq('user_id', userId)
    .eq('is_active', true)

  if (overridesError) throw overridesError

  const rawOverrides = (overrides ?? []) as unknown as RawOverrideRow[]
  const permissionKeys = Array.from(new Set(rawOverrides.map((row) => row.permission_key).filter((key): key is string => Boolean(key))))
  const permissionsByKey = new Map<string, PermissionRow>()

  if (permissionKeys.length > 0) {
    const { data: permissions, error: permissionsError } = await supabaseService
      .from('permissions')
      .select('id, key, name')
      .in('key', permissionKeys)

    if (permissionsError) throw permissionsError

    for (const permission of (permissions ?? []) as PermissionRow[]) {
      if (permission.key) permissionsByKey.set(permission.key, permission)
    }
  }

  const normalizedOverrides: UserOverrideRow[] = rawOverrides
    .filter((row) => row.effect === 'allow' || row.effect === 'deny')
    .map((row) => {
      const key = row.permission_key ?? ''
      return {
        id: row.id,
        effect: row.effect as 'allow' | 'deny',
        reason: row.reason ?? null,
        granted_at: row.valid_from ?? row.created_at ?? row.updated_at ?? null,
        expires_at: row.valid_to ?? null,
        permissions: permissionsByKey.get(key) ?? (key ? { id: key, key, name: key } : null),
      }
    })

  return {
    authUser: authUserData.user,
    roles: normalizedRoles,
    overrides: normalizedOverrides,
  }
}
