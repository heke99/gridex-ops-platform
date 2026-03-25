import { supabaseService } from '@/lib/supabase/service'

type AuthUserRow = {
  id: string
  email: string | null
  created_at: string
}

type UserRoleRow = {
  user_id: string
  role_id: string
  is_active: boolean
  roles: {
    key: string
    name: string
  } | null
}

export type AdminUserListItem = {
  id: string
  email: string | null
  created_at: string
  roles: string[]
}

export async function getAdminUsers(): Promise<AdminUserListItem[]> {
  const {
    data: authUsers,
    error: authError,
  } = await supabaseService.auth.admin.listUsers()

  if (authError) throw authError

  const userIds = authUsers.users.map((u) => u.id)

  const { data: roleRows, error: roleError } = await supabaseService
    .from('user_roles')
    .select('user_id, role_id, is_active, roles(key, name)')
    .in('user_id', userIds)
    .eq('is_active', true)

  if (roleError) throw roleError

  const groupedRoles = new Map<string, string[]>()

  for (const row of ((roleRows as unknown as UserRoleRow[]) ?? [])) {
    const list = groupedRoles.get(row.user_id) ?? []
    if (row.roles?.key) list.push(row.roles.key)
    groupedRoles.set(row.user_id, list)
  }

  return authUsers.users.map((user) => ({
    id: user.id,
    email: user.email ?? null,
    created_at: user.created_at,
    roles: groupedRoles.get(user.id) ?? [],
  }))
}