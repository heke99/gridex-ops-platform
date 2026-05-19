import { supabaseService } from '@/lib/supabase/service'

const HIGH_ACCESS_ROLES = new Set(['super_admin', 'admin', 'company_admin'])

type UserRoleRow = {
  user_id: string
  role_id: string
  is_active?: boolean | null
  status?: string | null
  roles: {
    key: string
    name: string
  } | null
}

type ListedAuthUser = {
  id: string
  email?: string | null
  created_at: string
  banned_until?: string | null
}

type UserProfileRow = {
  id: string
  email?: string | null
  full_name?: string | null
  user_status?: string | null
  disabled_at?: string | null
}

export type AdminUserListItem = {
  id: string
  email: string | null
  fullName: string | null
  created_at: string
  roles: string[]
  userStatus: string
  disabledAt: string | null
  isBanned: boolean
  companyCount: number
  highAccess: boolean
}

function isActiveRole(row: UserRoleRow) {
  if (typeof row.is_active === 'boolean') return row.is_active
  return (row.status ?? 'active') === 'active'
}

export async function getAdminUsers(): Promise<AdminUserListItem[]> {
  const {
    data: authUsers,
    error: authError,
  } = await supabaseService.auth.admin.listUsers()

  if (authError) throw authError

  const typedUsers = (authUsers?.users ?? []) as ListedAuthUser[]
  const userIds = typedUsers.map((user) => user.id)

  if (userIds.length === 0) {
    return []
  }

  const { data: roleRows, error: roleError } = await supabaseService
    .from('user_roles')
    .select('user_id, role_id, is_active, status, roles(key, name)')
    .in('user_id', userIds)

  if (roleError) throw roleError

  const groupedRoles = new Map<string, string[]>()

  for (const row of ((roleRows ?? []) as unknown as UserRoleRow[])) {
    if (!isActiveRole(row)) continue
    const list = groupedRoles.get(row.user_id) ?? []
    if (row.roles?.key) list.push(row.roles.key)
    groupedRoles.set(row.user_id, list)
  }

  const profileById = new Map<string, UserProfileRow>()
  try {
    const { data: profiles } = await supabaseService
      .from('user_profiles')
      .select('id, email, full_name, user_status, disabled_at')
      .in('id', userIds)

    for (const profile of ((profiles ?? []) as unknown as UserProfileRow[])) {
      profileById.set(profile.id, profile)
    }
  } catch {
    // user_profiles is optional in some installs.
  }

  const companyCountByUserId = new Map<string, number>()
  try {
    const { data: memberships } = await supabaseService
      .from('company_memberships')
      .select('user_id, status')
      .in('user_id', userIds)
      .eq('status', 'active')

    for (const membership of ((memberships ?? []) as Array<{ user_id: string }>)) {
      companyCountByUserId.set(membership.user_id, (companyCountByUserId.get(membership.user_id) ?? 0) + 1)
    }
  } catch {
    // Tenant memberships are optional in partial installs.
  }

  return typedUsers.map((user) => {
    const profile = profileById.get(user.id)
    const roles = groupedRoles.get(user.id) ?? []
    const bannedUntil = user.banned_until ? new Date(user.banned_until) : null
    const isBanned = Boolean(bannedUntil && bannedUntil.getTime() > Date.now())

    return {
      id: user.id,
      email: profile?.email ?? user.email ?? null,
      fullName: profile?.full_name ?? null,
      created_at: user.created_at,
      roles,
      userStatus: profile?.user_status ?? (isBanned ? 'disabled' : 'active'),
      disabledAt: profile?.disabled_at ?? null,
      isBanned,
      companyCount: companyCountByUserId.get(user.id) ?? 0,
      highAccess: roles.some((role) => HIGH_ACCESS_ROLES.has(role)),
    }
  })
}
