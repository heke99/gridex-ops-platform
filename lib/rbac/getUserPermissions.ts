import { createSupabaseServerClient } from '@/lib/supabase/server'

type RoleRow = {
  role_id: string
  role_key: string
}

type PermissionRow = {
  permission_key: string
}

type OverrideRow = {
  permission_key: string
  effect: 'allow' | 'deny'
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient()

  const { data: roleRows, error: rolesError } = await supabase.rpc(
    'gridex_get_user_roles',
    { p_user_id: userId }
  )

  if (rolesError) throw rolesError

  const { data: permissionRows, error: permissionsError } = await supabase.rpc(
    'gridex_get_user_permissions',
    { p_user_id: userId }
  )

  if (permissionsError) throw permissionsError

  const { data: overrideRows, error: overridesError } = await supabase.rpc(
    'gridex_get_user_permission_overrides',
    { p_user_id: userId }
  )

  if (overridesError) throw overridesError

  const allowed = new Set(
    ((permissionRows as PermissionRow[] | null) ?? []).map((r) => r.permission_key)
  )

  for (const row of ((overrideRows as OverrideRow[] | null) ?? [])) {
    if (row.effect === 'allow') allowed.add(row.permission_key)
    if (row.effect === 'deny') allowed.delete(row.permission_key)
  }

  return Array.from(allowed)
}