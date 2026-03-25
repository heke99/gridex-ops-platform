import { supabaseService } from '@/lib/supabase/service'

type UserRoleRow = {
  id: string
  user_id: string
  is_active: boolean
  granted_at: string
  expires_at: string | null
  roles: {
    id: string
    key: string
    name: string
  } | null
}

type UserOverrideRow = {
  id: string
  effect: 'allow' | 'deny'
  reason: string | null
  granted_at: string
  expires_at: string | null
  permissions: {
    id: string
    key: string
    name: string
  } | null
}

export async function getAdminUserById(userId: string) {
  const { data: authUserData, error: authError } =
    await supabaseService.auth.admin.getUserById(userId)

  if (authError) throw authError

  const { data: userRoles, error: rolesError } = await supabaseService
    .from('user_roles')
    .select('id, user_id, is_active, granted_at, expires_at, roles(id, key, name)')
    .eq('user_id', userId)
    .eq('is_active', true)

  if (rolesError) throw rolesError

  const { data: overrides, error: overridesError } = await supabaseService
    .from('user_permission_overrides')
    .select(
      'id, effect, reason, granted_at, expires_at, permissions(id, key, name)'
    )
    .eq('user_id', userId)

  if (overridesError) throw overridesError

  return {
    authUser: authUserData.user,
    roles: (userRoles as unknown as UserRoleRow[]) ?? [],
    overrides: (overrides as unknown as UserOverrideRow[]) ?? [],
  }
}