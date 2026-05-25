import { supabaseService } from '@/lib/supabase/service'
import { resolveRoleKey } from '@/lib/rbac/roleKeys'

export type AllRoleRow = {
  id: string
  key: string
  name: string
}

type RoleListRow = {
  id: string
  key?: string | null
  name?: string | null
}

function normalizeRoleName(role: RoleListRow, resolvedKey: string): string {
  const name = typeof role.name === 'string' ? role.name.trim() : ''
  if (name) return name

  const key = typeof role.key === 'string' ? role.key.trim() : ''
  if (key) return key

  return resolvedKey || role.id
}

export async function getAllRoles(): Promise<AllRoleRow[]> {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id, key, name')
    .order('name')

  if (error) throw error

  return ((data ?? []) as RoleListRow[]).map((role) => {
    const key = resolveRoleKey(role) ?? String(role.key ?? role.name ?? role.id)

    return {
      id: String(role.id),
      key,
      name: normalizeRoleName(role, key),
    }
  })
}
