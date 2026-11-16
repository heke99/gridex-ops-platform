import { supabaseService } from '@/lib/supabase/service'
import { resolveRoleKey } from '@/lib/rbac/roleKeys'

type UserRoleRow = {
  user_id?: string | null
  role_id?: string | null
  is_active?: boolean | null
  status?: string | null
  roles?: {
    key?: string | null
    name?: string | null
  } | null
}

type RoleLookupRow = {
  id?: string | null
  key?: string | null
  name?: string | null
}

type ListedAuthUser = {
  id: string
  email?: string | null
  created_at?: string | null
  email_confirmed_at?: string | null
  last_sign_in_at?: string | null
}

type UserProfileRow = {
  id: string
  email?: string | null
  full_name?: string | null
  created_at?: string | null
  updated_at?: string | null
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

const AUTH_PAGE_SIZE = 1000
const AUTH_MAX_PAGES = 25
const QUERY_CHUNK_SIZE = 500

function isIgnorableSchemaError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code ?? '')
}

function normalizeEmail(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null
}

function normalizeDateValue(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function listAuthUsersPaginated(): Promise<ListedAuthUser[]> {
  const users: ListedAuthUser[] = []

  for (let page = 1; page <= AUTH_MAX_PAGES; page += 1) {
    const { data, error } = await supabaseService.auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE,
    })

    if (error) throw error

    const pageUsers = ((data?.users ?? []) as ListedAuthUser[]).filter((user) => typeof user.id === 'string')
    users.push(...pageUsers)

    if (pageUsers.length < AUTH_PAGE_SIZE) break
  }

  return users
}

async function loadUserProfiles(): Promise<UserProfileRow[]> {
  const selectAttempts = [
    'id, email, full_name, created_at, updated_at, auth_email_confirmed_at, last_invite_sent_at, last_password_reset_sent_at, last_confirmation_email_sent_at, last_auth_email_action, last_auth_email_action_at',
    'id, email, full_name, created_at, updated_at',
    'id, email, full_name',
    'id, email',
    'id',
  ]

  let lastError: unknown = null

  for (const select of selectAttempts) {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .select(select)
      .limit(5000)

    if (!error) return (data ?? []) as unknown as UserProfileRow[]
    if (!isIgnorableSchemaError(error)) throw error
    lastError = error
  }

  if (lastError) return []
  return []
}

async function loadActiveUserRoles(userIds: string[]): Promise<UserRoleRow[]> {
  const ids = uniqueStrings(userIds)
  if (ids.length === 0) return []

  const selectAttempts = [
    'user_id, role_id, is_active, status, roles(key, name)',
    'user_id, role_id, is_active, status',
    'user_id, role_id, status',
    'user_id, role_id',
  ]

  let lastError: unknown = null

  for (const select of selectAttempts) {
    const rows: UserRoleRow[] = []
    let selectWorked = true

    for (const idChunk of chunk(ids, QUERY_CHUNK_SIZE)) {
      const { data, error } = await supabaseService
        .from('user_roles')
        .select(select)
        .in('user_id', idChunk)

      if (error) {
        if (isIgnorableSchemaError(error)) {
          lastError = error
          selectWorked = false
          break
        }
        throw error
      }

      rows.push(...((data ?? []) as unknown as UserRoleRow[]))
    }

    if (selectWorked) return rows
  }

  if (lastError) return []
  return []
}


async function loadRolesById(roleIds: string[]): Promise<Map<string, RoleLookupRow>> {
  const ids = uniqueStrings(roleIds)
  const byId = new Map<string, RoleLookupRow>()
  if (ids.length === 0) return byId

  for (const idChunk of chunk(ids, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabaseService
      .from('roles')
      .select('id,key,name')
      .in('id', idChunk)

    if (error) {
      if (isIgnorableSchemaError(error)) return byId
      throw error
    }

    for (const role of ((data ?? []) as unknown as RoleLookupRow[])) {
      if (role.id) byId.set(String(role.id), role)
    }
  }

  return byId
}

export async function getAdminUsers(): Promise<AdminUserListItem[]> {
  const [authUsers, profiles] = await Promise.all([
    listAuthUsersPaginated(),
    loadUserProfiles(),
  ])

  const authById = new Map(authUsers.map((user) => [user.id, user]))
  const profileById = new Map(profiles.filter((profile) => typeof profile.id === 'string').map((profile) => [profile.id, profile]))

  const orderedIds = uniqueStrings([
    ...authUsers
      .slice()
      .sort((a, b) => normalizeDateValue(b.created_at) - normalizeDateValue(a.created_at))
      .map((user) => user.id),
    ...profiles
      .slice()
      .sort((a, b) => normalizeDateValue(b.updated_at ?? b.created_at) - normalizeDateValue(a.updated_at ?? a.created_at))
      .map((profile) => profile.id),
  ])

  const roleRows = await loadActiveUserRoles(orderedIds)
  const rolesById = await loadRolesById(roleRows.map((row) => row.role_id).filter((value): value is string => typeof value === 'string' && value.length > 0))
  const groupedRoles = new Map<string, string[]>()

  for (const row of roleRows) {
    const userId = typeof row.user_id === 'string' ? row.user_id : null
    if (!userId) continue

    const isActive = row.status ? row.status === 'active' : row.is_active !== false
    if (!isActive) continue

    const roleKey = resolveRoleKey(row.roles ?? (row.role_id ? rolesById.get(row.role_id) : null) ?? null)
    if (!roleKey) continue

    const list = groupedRoles.get(userId) ?? []
    if (!list.includes(roleKey)) list.push(roleKey)
    groupedRoles.set(userId, list)
  }

  return orderedIds
    .map((id) => {
      const authUser = authById.get(id)
      const profile = profileById.get(id)
      const createdAt = authUser?.created_at ?? profile?.created_at ?? profile?.updated_at ?? ''

      return {
        id,
        email: normalizeEmail(authUser?.email) ?? normalizeEmail(profile?.email),
        created_at: createdAt,
        email_confirmed_at: authUser?.email_confirmed_at ?? profile?.auth_email_confirmed_at ?? null,
        last_sign_in_at: authUser?.last_sign_in_at ?? null,
        last_invite_sent_at: profile?.last_invite_sent_at ?? null,
        last_password_reset_sent_at: profile?.last_password_reset_sent_at ?? null,
        last_confirmation_email_sent_at: profile?.last_confirmation_email_sent_at ?? null,
        last_auth_email_action: profile?.last_auth_email_action ?? null,
        last_auth_email_action_at: profile?.last_auth_email_action_at ?? null,
        roles: groupedRoles.get(id) ?? [],
      }
    })
    .sort((a, b) => normalizeDateValue(b.created_at) - normalizeDateValue(a.created_at))
}
