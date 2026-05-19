import { supabaseService } from '@/lib/supabase/service'

const HIGH_ACCESS_ROLES = new Set(['super_admin', 'admin', 'company_admin'])

type UserRoleRow = {
  user_id: string
  role_id: string
  is_active?: boolean | null
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
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  last_sign_in_at?: string | null
}

type UserProfileRow = {
  id: string
  email?: string | null
  full_name?: string | null
  user_status?: string | null
  disabled_at?: string | null
  auth_email_confirmed_at?: string | null
  auth_last_sign_in_at?: string | null
  auth_last_synced_at?: string | null
  last_invite_sent_at?: string | null
  last_password_reset_sent_at?: string | null
  last_confirmation_email_sent_at?: string | null
  last_auth_email_action?: string | null
  last_auth_email_action_at?: string | null
  last_auth_email_message?: string | null
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
  emailConfirmedAt: string | null
  lastSignInAt: string | null
  lastInviteSentAt: string | null
  lastPasswordResetSentAt: string | null
  lastConfirmationEmailSentAt: string | null
  lastAuthEmailAction: string | null
  lastAuthEmailActionAt: string | null
  lastAuthEmailMessage: string | null
}

function isActiveRole(row: UserRoleRow) {
  if (typeof row.is_active === 'boolean') return row.is_active
  return true
}

async function fetchProfiles(userIds: string[]): Promise<Map<string, UserProfileRow>> {
  const profileById = new Map<string, UserProfileRow>()

  try {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .select(
        'id, email, full_name, user_status, disabled_at, auth_email_confirmed_at, auth_last_sign_in_at, auth_last_synced_at, last_invite_sent_at, last_password_reset_sent_at, last_confirmation_email_sent_at, last_auth_email_action, last_auth_email_action_at, last_auth_email_message'
      )
      .in('id', userIds)

    if (error) throw error

    for (const profile of ((data ?? []) as unknown as UserProfileRow[])) {
      profileById.set(profile.id, profile)
    }
    return profileById
  } catch {
    // Older installs can miss the new auth-sync columns until the migration has run.
  }

  try {
    const { data } = await supabaseService
      .from('user_profiles')
      .select('id, email, full_name, user_status, disabled_at')
      .in('id', userIds)

    for (const profile of ((data ?? []) as unknown as UserProfileRow[])) {
      profileById.set(profile.id, profile)
    }
  } catch {
    // user_profiles is optional in partial installs.
  }

  return profileById
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
    .select('user_id, role_id, is_active, roles(key, name)')
    .in('user_id', userIds)

  if (roleError) throw roleError

  const groupedRoles = new Map<string, string[]>()

  for (const row of ((roleRows ?? []) as unknown as UserRoleRow[])) {
    if (!isActiveRole(row)) continue
    const list = groupedRoles.get(row.user_id) ?? []
    if (row.roles?.key) list.push(row.roles.key)
    groupedRoles.set(row.user_id, list)
  }

  const profileById = await fetchProfiles(userIds)

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
    const emailConfirmedAt = profile?.auth_email_confirmed_at ?? user.email_confirmed_at ?? user.confirmed_at ?? null
    const lastSignInAt = profile?.auth_last_sign_in_at ?? user.last_sign_in_at ?? null

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
      emailConfirmedAt,
      lastSignInAt,
      lastInviteSentAt: profile?.last_invite_sent_at ?? null,
      lastPasswordResetSentAt: profile?.last_password_reset_sent_at ?? null,
      lastConfirmationEmailSentAt: profile?.last_confirmation_email_sent_at ?? null,
      lastAuthEmailAction: profile?.last_auth_email_action ?? null,
      lastAuthEmailActionAt: profile?.last_auth_email_action_at ?? null,
      lastAuthEmailMessage: profile?.last_auth_email_message ?? null,
    }
  })
}
