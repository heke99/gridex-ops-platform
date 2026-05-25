import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ROLE_PERMISSION_PROFILES } from '@/lib/admin/accessModel'
import { normalizeRoleKey, resolveRoleKey } from '@/lib/rbac/roleKeys'



type UserRoleRpcRow = string | {
  role_key?: string | null
  key?: string | null
  code?: string | null
  name?: string | null
}

type CompanyMembershipPermissionRow = {
  membership_role?: string | null
  status?: string | null
}

const MEMBERSHIP_ROLE_PERMISSION_PROFILE: Record<string, string> = {
  owner: 'company_admin',
  admin: 'company_admin',
  company_admin: 'company_admin',
  operations: 'operations_manager',
  operations_manager: 'operations_manager',
  operations_agent: 'operations_agent',
  support: 'customer_service_agent',
  customer_service: 'customer_service_agent',
  customer_service_agent: 'customer_service_agent',
  finance: 'finance_readonly',
  finance_readonly: 'finance_readonly',
  viewer: 'executive_readonly',
  member: 'customer_service_agent',
  company_owner: 'company_admin',
  tenant_admin: 'company_admin',
  bolagsansvarig: 'company_admin',
  kundservice: 'customer_service_agent',
  ekonomi: 'finance_readonly',
}

function addRoleProfilePermissions(target: Set<string>, roleKey: string | null | undefined) {
  const normalized = normalizeRoleKey(roleKey)
  if (!normalized) return
  const profileKey = ROLE_PERMISSION_PROFILES[normalized]
    ? normalized
    : MEMBERSHIP_ROLE_PERMISSION_PROFILE[normalized]

  const profile = profileKey ? ROLE_PERMISSION_PROFILES[profileKey] : null
  if (!profile) return

  for (const permission of profile.permissions) {
    target.add(permission)
  }
}

async function addRoleFallbackPermissions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  target: Set<string>
) {
  const { data: roleRows, error: rolesError } = await supabase.rpc('gridex_get_user_roles', {
    p_user_id: userId,
  })

  if (!rolesError && Array.isArray(roleRows)) {
    for (const row of roleRows as UserRoleRpcRow[]) {
      if (typeof row === 'string') {
        addRoleProfilePermissions(target, row)
      } else if (row && typeof row === 'object') {
        addRoleProfilePermissions(target, resolveRoleKey(row))
      }
    }
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from('company_memberships')
    .select('membership_role, status')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (!membershipsError && Array.isArray(memberships)) {
    for (const membership of memberships as CompanyMembershipPermissionRow[]) {
      addRoleProfilePermissions(target, membership.membership_role)
    }
  }
}

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

  const basePermissionRows = permissionsError ? [] : permissionRows

  const { data: overrideRows, error: overridesError } = await supabase.rpc(
    'gridex_get_user_permission_overrides',
    { p_user_id: userId }
  )

  const safeOverrideRows = overridesError ? [] : overrideRows

  const allowed = new Set(normalizePermissionRows(basePermissionRows))

  // DB permissions are the source of truth, but older tenants can miss role_permission rows
  // after schema repairs. Use the coded role profiles as a safe allow-fallback, then apply
  // explicit user overrides below so deny still wins.
  await addRoleFallbackPermissions(supabase, userId, allowed)

  for (const row of ((safeOverrideRows as OverrideRow[] | null) ?? [])) {
    const permissionKey = normalizeOverridePermissionKey(row)
    const effect = row.effect

    if (!permissionKey || !effect) continue

    if (effect === 'allow') allowed.add(permissionKey)
    if (effect === 'deny') allowed.delete(permissionKey)
  }

  return Array.from(allowed)
}