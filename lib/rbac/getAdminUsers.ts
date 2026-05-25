import { supabaseService } from '@/lib/supabase/service'
import { resolveRoleKey } from '@/lib/rbac/roleKeys'

type UserRoleRow = {
  user_id: string
  role_id: string
  is_active?: boolean | null
  status?: string | null
  roles: {
    key?: string | null
    name?: string | null
  } | null
}

type ListedAuthUser = {
  id: string
  email?: string | null
  created_at: string
  email_confirmed_at?: string | null
  last_sign_in_at?: string | null
}

type UserProfileRow = {
  id: string
  auth_email_confirmed_at?: string | null
  last_invite_sent_at?: string | null
  last_password_reset_sent_at?: string | null
  last_confirmation_email_sent_at?: string | null
  last_auth_email_action?: string | null
  last_auth_email_action_at?: string | null
}

export type AdminUserListItem = {
  id: string
  email: string | null
  created_at: string
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  last_invite_sent_at: string | null
  last_password_reset_sent_at: string | null
  last_confirmation_email_sent_at: string | null
  last_auth_email_action: string | null
  last_auth_email_action_at: string | null
  roles: string[]
}

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')
}

export async function getAdminUsers(): Promise<AdminUserListItem[]> {
  const { data: authUsers, error: authError } = await supabaseService.auth.admin.listUsers()

  if (authError) throw authError

  const typedUsers = (authUsers?.users ?? []) as ListedAuthUser[]
  const userIds = typedUsers.map((user) => user.id)

  if (userIds.length === 0) return []

  const roleQuery = await supabaseService
    .from('user_roles')
    .select('user_id, role_id, is_active, status, roles(key, name)')
    .in('user_id', userIds)

  if (roleQuery.error && !isIgnorableSchemaError(roleQuery.error)) throw roleQuery.error

  const profileQuery = await supabaseService
    .from('user_profiles')
    .select(
      'id, auth_email_confirmed_at, last_invite_sent_at, last_password_reset_sent_at, last_confirmation_email_sent_at, last_auth_email_action, last_auth_email_action_at'
    )
    .in('id', userIds)

  if (profileQuery.error && !isIgnorableSchemaError(profileQuery.error)) throw profileQuery.error

  const groupedRoles = new Map<string, string[]>()

  for (const row of ((roleQuery.data ?? []) as unknown as UserRoleRow[])) {
    const isActive = row.status ? row.status === 'active' : row.is_active !== false
    if (!isActive) continue

    const list = groupedRoles.get(row.user_id) ?? []
    const roleKey = resolveRoleKey(row.roles)
    if (roleKey) list.push(roleKey)
    groupedRoles.set(row.user_id, list)
  }

  const profilesById = new Map(
    ((profileQuery.data ?? []) as UserProfileRow[]).map((profile) => [profile.id, profile])
  )

  return typedUsers.map((user) => {
    const profile = profilesById.get(user.id)
    return {
      id: user.id,
      email: user.email ?? null,
      created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at ?? profile?.auth_email_confirmed_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
      last_invite_sent_at: profile?.last_invite_sent_at ?? null,
      last_password_reset_sent_at: profile?.last_password_reset_sent_at ?? null,
      last_confirmation_email_sent_at: profile?.last_confirmation_email_sent_at ?? null,
      last_auth_email_action: profile?.last_auth_email_action ?? null,
      last_auth_email_action_at: profile?.last_auth_email_action_at ?? null,
      roles: groupedRoles.get(user.id) ?? [],
    }
  })
}
