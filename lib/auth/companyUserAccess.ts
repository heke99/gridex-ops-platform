import { supabaseService } from '@/lib/supabase/service'
import { requireRoleIdByKeyOrName } from '@/lib/rbac/resolveRoleId'
import { normalizeRoleKey } from '@/lib/rbac/roleKeys'
import { COMPANY_PRIMARY_USER_ROLE_KEYS } from '@/lib/tenant/companyUserRoles'

const PRIMARY_COMPANY_ROLE_KEYS = COMPANY_PRIMARY_USER_ROLE_KEYS

type DbErrorLike = { code?: string | null; message?: string | null }

export type GrantCompanyUserAccessInput = {
  companyId: string
  userId: string
  email?: string | null
  fullName?: string | null
  membershipRole: string
  roleKey: string
  actorUserId?: string | null
  source: string
  passwordVerified?: boolean
  createdAuthUser?: boolean
  invitationId?: string | null
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function isIgnorableSchemaError(error: DbErrorLike | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')
}

function isUniqueViolationError(error: DbErrorLike | null | undefined) {
  return error?.code === '23505'
}

function missingColumnName(error: DbErrorLike | null | undefined): string | null {
  if (!error || !['42703', 'PGRST204'].includes(error.code ?? '')) return null
  const message = error.message ?? ''
  return (
    message.match(/column\s+"([^"]+)"\s+does not exist/i)?.[1] ??
    message.match(/'([^']+)'\s+column/i)?.[1] ??
    message.match(/column\s+([^\s]+)\s+does not exist/i)?.[1] ??
    null
  )
}

function dropMissingOptionalColumn(
  payload: Record<string, unknown>,
  error: DbErrorLike | null | undefined,
  requiredColumns: string[] = []
) {
  const missing = missingColumnName(error)
  if (!missing || !(missing in payload)) return false
  if (requiredColumns.includes(missing)) {
    throw new Error(`Databasen saknar obligatoriska kolumnen ${missing}. Kör senaste RBAC-/tenant-migrationen innan användare skapas.`)
  }
  delete payload[missing]
  return true
}

async function getAuthEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseService.auth.admin.getUserById(userId)
  if (error) throw new Error(`Auth-användaren kunde inte läsas: ${error.message}`)
  return data.user?.email ? normalizeEmail(data.user.email) : null
}

async function resolvePrimaryCompanyRoleRows() {
  const { data, error } = await supabaseService.from('roles').select('id,key,name')

  if (error) {
    if (isIgnorableSchemaError(error)) return []
    throw error
  }

  return ((data ?? []) as Array<{ id?: string | null; key?: string | null; name?: string | null }>)
    .map((row) => ({ id: row.id ? String(row.id) : null, key: normalizeRoleKey(row.key ?? row.name) }))
    .filter((row): row is { id: string; key: string } => Boolean(row.id && row.key && PRIMARY_COMPANY_ROLE_KEYS.includes(row.key)))
}

async function updateUserRolesByRoleIds(input: {
  companyId: string
  userId: string
  roleIds: string[]
  payload: Record<string, unknown>
}) {
  if (input.roleIds.length === 0) return

  const payload = { ...input.payload }
  let includeStatusFilter = true

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let query = supabaseService
      .from('user_roles')
      .update(payload)
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)
      .in('role_id', input.roleIds)

    if (includeStatusFilter) query = query.eq('status', 'active')

    const { error } = await query
    if (!error) return

    const missing = missingColumnName(error)
    if (missing === 'status' && includeStatusFilter) {
      includeStatusFilter = false
      continue
    }
    if (dropMissingOptionalColumn(payload, error, ['company_id', 'user_id', 'role_id'])) continue

    if (isIgnorableSchemaError(error)) return
    throw error
  }
}

async function deactivateOtherPrimaryCompanyRoles(input: {
  companyId: string
  userId: string
  keepRoleId: string
  actorUserId?: string | null
}) {
  const roleRows = await resolvePrimaryCompanyRoleRows()
  const roleIdsToDisable = roleRows
    .filter((row) => row.id !== input.keepRoleId)
    .map((row) => row.id)

  await updateUserRolesByRoleIds({
    companyId: input.companyId,
    userId: input.userId,
    roleIds: roleIdsToDisable,
    payload: {
      status: 'disabled',
      is_active: false,
      disabled_at: new Date().toISOString(),
      disabled_by: input.actorUserId ?? null,
      status_reason: 'Ersatt av ny bolagsroll i dashboardflöde.',
    },
  })
}

async function findExistingUserRole(input: { companyId: string; userId: string; roleId: string }) {
  const { data, error } = await supabaseService
    .from('user_roles')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .eq('role_id', input.roleId)
    .limit(1)
    .maybeSingle()

  if (error) {
    if (missingColumnName(error) === 'role_id') {
      throw new Error('Databasen saknar user_roles.role_id. Kan inte koppla systemroll till användaren utan role_id.')
    }
    throw error
  }

  return data?.id ? String(data.id) : null
}

async function updateUserRoleById(id: string, payload: Record<string, unknown>) {
  const currentPayload = { ...payload }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabaseService.from('user_roles').update(currentPayload).eq('id', id)
    if (!error) return
    if (dropMissingOptionalColumn(currentPayload, error, ['user_id', 'company_id', 'role_id'])) continue
    throw error
  }
}

async function insertUserRole(payload: Record<string, unknown>) {
  const currentPayload = { ...payload }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabaseService.from('user_roles').insert(currentPayload).select('id').single()
    if (!error) return String(data.id)

    if (isUniqueViolationError(error)) throw error
    if (dropMissingOptionalColumn(currentPayload, error, ['user_id', 'company_id', 'role_id'])) continue
    throw error
  }

  throw new Error('Kunde inte skapa user_roles-rad efter schema-kompatibla försök.')
}

async function upsertActiveUserRole(input: {
  companyId: string
  userId: string
  roleId: string
}) {
  const existingId = await findExistingUserRole(input)
  const payload = {
    user_id: input.userId,
    role_id: input.roleId,
    company_id: input.companyId,
    status: 'active',
    is_active: true,
  }

  if (existingId) {
    await updateUserRoleById(existingId, payload)
    return existingId
  }

  try {
    return await insertUserRole(payload)
  } catch (error) {
    if (isUniqueViolationError(error as DbErrorLike)) {
      const retryExistingId = await findExistingUserRole(input)
      if (retryExistingId) return retryExistingId
    }
    throw error
  }
}

async function upsertCompanyMembership(input: GrantCompanyUserAccessInput & { email: string | null }) {
  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    company_id: input.companyId,
    user_id: input.userId,
    membership_role: input.membershipRole,
    role_key: input.roleKey,
    status: 'active',
    invited_email: input.email,
    invited_by: input.actorUserId ?? null,
    invited_at: now,
    accepted_at: now,
    disabled_at: null,
    disabled_by: null,
    removed_at: null,
    removed_by: null,
    status_reason: null,
    metadata: {
      account_flow: input.source,
      password_verified: Boolean(input.passwordVerified),
      created_auth_user: Boolean(input.createdAuthUser),
      login_ready: true,
    },
  }

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const { data, error } = await supabaseService
      .from('company_memberships')
      .upsert(payload, { onConflict: 'company_id,user_id' })
      .select('id')
      .single()

    if (!error) return String(data.id)

    if (dropMissingOptionalColumn(payload, error, ['company_id', 'user_id'])) continue

    if (error.code === '42P10') break
    throw error
  }

  const existing = await supabaseService
    .from('company_memberships')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .limit(1)
    .maybeSingle()

  if (existing.error) throw existing.error

  if (existing.data?.id) {
    const updatePayload = { ...payload }
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const { data, error } = await supabaseService
        .from('company_memberships')
        .update(updatePayload)
        .eq('id', existing.data.id)
        .select('id')
        .single()

      if (!error) return String(data.id)
      if (dropMissingOptionalColumn(updatePayload, error, ['company_id', 'user_id'])) continue
      throw error
    }
  }

  const insertPayload = { ...payload }
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const { data, error } = await supabaseService.from('company_memberships').insert(insertPayload).select('id').single()
    if (!error) return String(data.id)
    if (dropMissingOptionalColumn(insertPayload, error, ['company_id', 'user_id'])) continue
    throw error
  }

  throw new Error('Kunde inte skapa bolagskoppling efter schema-kompatibla försök.')
}

async function upsertAcceptedInvitation(input: GrantCompanyUserAccessInput & { email: string | null }) {
  if (!input.email) return null

  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    email: input.email,
    invited_email: input.email,
    full_name: input.fullName ?? null,
    membership_role: input.membershipRole,
    role_key: input.roleKey,
    status: 'accepted',
    invited_by: input.actorUserId ?? null,
    invited_user_id: input.userId,
    expires_at: null,
    accepted_at: now,
    revoked_at: null,
    updated_at: now,
    metadata: {
      account_flow: input.source,
      password_verified: Boolean(input.passwordVerified),
      created_auth_user: Boolean(input.createdAuthUser),
      login_ready: true,
    },
  }

  if (input.invitationId) {
    const byId = await supabaseService
      .from('company_invitations')
      .update(payload)
      .eq('id', input.invitationId)
      .select('id')
      .maybeSingle()

    if (byId.data?.id) return String(byId.data.id)
    if (byId.error && !isIgnorableSchemaError(byId.error)) throw byId.error
  }

  for (const emailColumn of ['email', 'invited_email']) {
    const existing = await supabaseService
      .from('company_invitations')
      .select('id')
      .eq('company_id', input.companyId)
      .eq(emailColumn, input.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing.error && !isIgnorableSchemaError(existing.error)) throw existing.error

    if (existing.data?.id) {
      const updated = await supabaseService
        .from('company_invitations')
        .update(payload)
        .eq('id', existing.data.id)
        .select('id')
        .maybeSingle()

      if (updated.error && !isIgnorableSchemaError(updated.error)) throw updated.error
      if (updated.data?.id) return String(updated.data.id)
    }
  }

  const insert = await supabaseService
    .from('company_invitations')
    .insert({ company_id: input.companyId, ...payload })
    .select('id')
    .single()

  if (insert.error) {
    if (isIgnorableSchemaError(insert.error)) return null
    throw insert.error
  }
  return String(insert.data.id)
}

export async function grantCompanyUserAccess(input: GrantCompanyUserAccessInput) {
  const roleKey = normalizeRoleKey(input.roleKey)
  if (!roleKey) throw new Error('Systemrollen saknas.')

  const suppliedEmail = normalizeEmail(input.email)
  const email = suppliedEmail || (await getAuthEmail(input.userId))
  const roleId = await requireRoleIdByKeyOrName(roleKey)

  await deactivateOtherPrimaryCompanyRoles({
    companyId: input.companyId,
    userId: input.userId,
    keepRoleId: roleId,
    actorUserId: input.actorUserId ?? null,
  })

  const membershipId = await upsertCompanyMembership({ ...input, roleKey, email })
  const roleRowId = await upsertActiveUserRole({ companyId: input.companyId, userId: input.userId, roleId })
  const invitationId = await upsertAcceptedInvitation({ ...input, roleKey, email })

  await verifyCompanyUserAccess({
    companyId: input.companyId,
    userId: input.userId,
    email,
    roleKey,
    membershipId,
    roleId,
    roleRowId,
    invitationId,
  })

  return { membershipId, roleId, roleRowId, invitationId }
}

async function deactivateAllTenantUserRoles(input: {
  companyId: string
  userId: string
  actorUserId?: string | null
  reason?: string | null
}) {
  const payload: Record<string, unknown> = {
    status: 'removed_from_company',
    is_active: false,
    disabled_at: new Date().toISOString(),
    disabled_by: input.actorUserId ?? null,
    status_reason: input.reason ?? 'Användaren togs bort från bolaget.',
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabaseService
      .from('user_roles')
      .update(payload)
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)

    if (!error) return

    const missing = missingColumnName(error)
    if (missing === 'company_id') {
      throw new Error('Databasen saknar user_roles.company_id. Kör senaste användar-/RBAC-migrationen innan användare kan kopplas bort säkert från ett enskilt bolag.')
    }

    if (dropMissingOptionalColumn(payload, error, ['user_id'])) continue
    if (isIgnorableSchemaError(error)) return
    throw error
  }
}

export async function deactivateCompanyUserAccess(input: {
  companyId: string
  userId: string
  actorUserId?: string | null
  reason?: string | null
}) {
  await deactivateAllTenantUserRoles(input)
}

async function findActiveMembership(input: { companyId: string; userId: string }) {
  const attempts = [
    { select: 'id,status', useStatusFilter: true },
    { select: 'id', useStatusFilter: false },
  ]

  for (const attempt of attempts) {
    let query = supabaseService
      .from('company_memberships')
      .select(attempt.select)
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)

    if (attempt.useStatusFilter) query = query.eq('status', 'active')

    const { data, error } = await query.limit(1).maybeSingle()
    if (!error) {
      const row = data as unknown as { id?: string | null } | null
      return row?.id ? String(row.id) : null
    }
    if (!isIgnorableSchemaError(error)) throw error
  }

  return null
}

async function hasActiveUserRole(input: { companyId: string; userId: string; roleId: string }) {
  const attempts = [
    { select: 'id,role_id,status,is_active', useStatusFilter: true, useIsActiveFilter: true },
    { select: 'id,role_id,status', useStatusFilter: true, useIsActiveFilter: false },
    { select: 'id,role_id', useStatusFilter: false, useIsActiveFilter: false },
  ]

  for (const attempt of attempts) {
    let query = supabaseService
      .from('user_roles')
      .select(attempt.select)
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)
      .eq('role_id', input.roleId)

    if (attempt.useStatusFilter) query = query.eq('status', 'active')
    if (attempt.useIsActiveFilter) query = query.eq('is_active', true)

    const { data, error } = await query
    if (!error) return (data ?? []).length > 0
    if (!isIgnorableSchemaError(error)) throw error
  }

  return false
}

export async function verifyCompanyUserAccess(input: {
  companyId: string
  userId: string
  email: string | null
  roleKey: string
  membershipId?: string | null
  roleId: string
  roleRowId?: string | null
  invitationId?: string | null
}) {
  const authUser = await supabaseService.auth.admin.getUserById(input.userId)
  if (authUser.error || !authUser.data.user?.id) {
    throw new Error('Verifiering misslyckades: Auth-användaren finns inte efter skapande.')
  }

  if (input.email && normalizeEmail(authUser.data.user.email) !== input.email) {
    throw new Error('Verifiering misslyckades: Auth-användarens e-post matchar inte dashboardflödet.')
  }

  const membershipId = await findActiveMembership({ companyId: input.companyId, userId: input.userId })
  if (!membershipId) {
    throw new Error('Verifiering misslyckades: aktiv bolagskoppling saknas efter skapande.')
  }

  const hasRole = await hasActiveUserRole({ companyId: input.companyId, userId: input.userId, roleId: input.roleId })
  if (!hasRole) {
    throw new Error('Verifiering misslyckades: aktiv tenant-scopad systemroll saknas efter skapande.')
  }
}
