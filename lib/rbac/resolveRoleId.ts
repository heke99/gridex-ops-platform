import { supabaseService } from '@/lib/supabase/service'
import { normalizeRoleKey } from '@/lib/rbac/roleKeys'

export async function resolveRoleIdByKeyOrName(roleKey: string): Promise<string | null> {
  const normalized = normalizeRoleKey(roleKey)
  if (!normalized) return null

  const byKey = await supabaseService
    .from('roles')
    .select('id,key,name')
    .eq('key', normalized)
    .limit(1)

  if (byKey.error) throw byKey.error
  if (byKey.data?.[0]?.id) return String(byKey.data[0].id)

  const byName = await supabaseService
    .from('roles')
    .select('id,key,name')
    .ilike('name', normalized)
    .limit(1)

  if (byName.error) throw byName.error
  return byName.data?.[0]?.id ? String(byName.data[0].id) : null
}

export async function requireRoleIdByKeyOrName(roleKey: string): Promise<string> {
  const roleId = await resolveRoleIdByKeyOrName(roleKey)
  if (!roleId) throw new Error(`Rollen hittades inte: ${roleKey}`)
  return roleId
}
