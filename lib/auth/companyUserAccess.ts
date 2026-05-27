import { supabaseService } from '@/lib/supabase/service'
import {
  provisionDirectTemporaryPasswordUser,
  type ProvisionDirectTemporaryPasswordUserResult,
} from '@/lib/auth/directAccountProvisioning'
import { requireRoleIdByKeyOrName } from '@/lib/rbac/resolveRoleId'
import { normalizeRoleKey } from '@/lib/rbac/roleKeys'
import { COMPANY_PRIMARY_USER_ROLE_KEYS } from '@/lib/tenant/companyUserRoles'

const PRIMARY_COMPANY_ROLE_KEYS = COMPANY_PRIMARY_USER_ROLE_KEYS

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

export type ProvisionCompanyUserWithTemporaryPasswordInput = Omit<
  GrantCompanyUserAccessInput,
  'userId' | 'passwordVerified' | 'createdAuthUser' | 'source'
> & {
  email: string
  temporaryPassword: string
  companyName?: string | null
  source?: string
}

export type ProvisionCompanyUserResult = ProvisionDirectTemporaryPasswordUserResult & {
  companyId: string
  membershipId: string
  roleId: string
  invitationId: string | null
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function isIgnorableSchemaError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')
}

function isUniqueViolationError(error: { code?: string | null } | null | undefined) {
  return error?.code === '23505'
}

async function getAuthEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseService.auth.admin.getUserById(userId)
  if (error) throw new Error(`Auth-användaren kunde inte läsas: ${error.message}`)
  return data.user?.email ? normalizeEmail(data.user.email) : null
}

async function resolvePrimaryCompanyRoleRows() {
  const { data, error } = await supabaseService
    .from('roles')
    .select('id,key,name')

  if (error) {
    if (isIgnorableSchemaError(error)) return []
    throw error
  }

  return ((data ?? []) as Array<{ id?: string | null; key?: string | null; name?: string | null }>)
    .map((row) => ({ id: row.id ? String(row.id) : null, key: normalizeRoleKey(row.key ?? row.name) }))
    .filter((row): row is { id: string; key: string } => Boolean(row.id && row.key && PRIMARY_COMPANY_ROLE_KEYS.includes(row.key)))
}

async function deactivateOtherPrimaryCompanyRoles(input: {
  companyId: string
  userId: string
  keepRoleId: string
  keepRoleKey: string
  actorUserId?: string | null
}) {
  const roleRows = await resolvePrimaryCompanyRoleRows()
  const roleIdsToDisable = roleRows
    .filter((row) => row.id !== input.keepRoleId)
    .map((row) => row.id)

  const roleKeysToDisable = PRIMARY_COMPANY_ROLE_KEYS.filter((key) => key !== input.keepRoleKey)
  const now = new Date().toISOString()

  if (roleIdsToDisable.length > 0) {
    const byRoleId = await supabaseService
      .from('user_roles')
      .update({
        status: 'disabled',
        is_active: false,
        disabled_at: now,
        disabled_by: input.actorUserId ?? null,
        status_reason: 'Ersatt av ny bolagsroll i dashboardflöde.',
      })
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)
      .eq('status', 'active')
      .in('role_id', roleIdsToDisable)

    if (byRoleId.error && !isIgnorableSchemaError(byRoleId.error)) throw byRoleId.error
  }

  const byRoleKey = await supabaseService
    .from('user_roles')
    .update({
      status: 'disabled',
      is_active: false,
      disabled_at: now,
      disabled_by: input.actorUserId ?? null,
      status_reason: 'Ersatt av ny bolagsroll i dashboardflöde.',
    })
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .eq('status', 'active')
    .in('role', roleKeysToDisable)

  if (byRoleKey.error && !isIgnorableSchemaError(byRoleKey.error)) throw byRoleKey.error
}

async function upsertActiveUserRole(input: {
  companyId: string
  userId: string
  roleId: string
  roleKey: string
}) {
  async function findExisting() {
    const byRoleId = await supabaseService
      .from('user_roles')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)
      .eq('role_id', input.roleId)
      .limit(1)
      .maybeSingle()

    if (byRoleId.error && !isIgnorableSchemaError(byRoleId.error)) throw byRoleId.error
    if (byRoleId.data?.id) return String(byRoleId.data.id)

    const byRole = await supabaseService
      .from('user_roles')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)
      .eq('role', input.roleKey)
      .limit(1)
      .maybeSingle()

    if (byRole.error && !isIgnorableSchemaError(byRole.error)) throw byRole.error
    return byRole.data?.id ? String(byRole.data.id) : null
  }

  const existingId = await findExisting()
  if (existingId) {
    const update = await supabaseService
      .from('user_roles')
      .update({
        role_id: input.roleId,
        role: input.roleKey,
        company_id: input.companyId,
        status: 'active',
        is_active: true,
      })
      .eq('id', existingId)

    if (update.error && !isIgnorableSchemaError(update.error)) throw update.error
    return existingId
  }

  const insert = await supabaseService
    .from('user_roles')
    .insert({
      user_id: input.userId,
      role_id: input.roleId,
      role: input.roleKey,
      company_id: input.companyId,
      status: 'active',
      is_active: true,
    })
    .select('id')
    .single()

  if (insert.error) {
    if (isUniqueViolationError(insert.error)) {
      const retryExistingId = await findExisting()
      if (retryExistingId) return retryExistingId
    }
    throw insert.error
  }

  return String(insert.data.id)
}

async function upsertCompanyMembership(input: GrantCompanyUserAccessInput & { roleId: string; email: string | null }) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('company_memberships')
    .upsert(
      {
        company_id: input.companyId,
        user_id: input.userId,
        role: input.membershipRole,
        role_id: input.roleId,
        role_key: input.roleKey,
        membership_role: input.membershipRole,
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
      },
      { onConflict: 'company_id,user_id' }
    )
    .select('id')
    .single()

  if (error) throw error
  return String(data.id)
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

  if (insert.error) throw insert.error
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
    keepRoleKey: roleKey,
    actorUserId: input.actorUserId ?? null,
  })

  const membershipId = await upsertCompanyMembership({ ...input, roleKey, roleId, email })
  const roleRowId = await upsertActiveUserRole({ companyId: input.companyId, userId: input.userId, roleId, roleKey })
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

export async function provisionCompanyUserWithTemporaryPassword(
  input: ProvisionCompanyUserWithTemporaryPasswordInput
): Promise<ProvisionCompanyUserResult> {
  const provisioned = await provisionDirectTemporaryPasswordUser({
    email: input.email,
    fullName: input.fullName ?? null,
    temporaryPassword: input.temporaryPassword,
    companyId: input.companyId,
    companyName: input.companyName ?? null,
    actorUserId: input.actorUserId ?? null,
  })

  const access = await grantCompanyUserAccess({
    companyId: input.companyId,
    userId: provisioned.userId,
    email: provisioned.email,
    fullName: input.fullName ?? null,
    membershipRole: input.membershipRole,
    roleKey: input.roleKey,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? 'direct_temporary_password',
    passwordVerified: provisioned.passwordVerified,
    createdAuthUser: provisioned.createdAuthUser,
  })

  return { ...provisioned, companyId: input.companyId, ...access }
}

export async function deactivateCompanyUserAccess(input: {
  companyId: string
  userId: string
  actorUserId?: string | null
  reason?: string | null
}) {
  const now = new Date().toISOString()
  const payload = {
    status: 'removed_from_company',
    is_active: false,
    disabled_at: now,
    disabled_by: input.actorUserId ?? null,
    status_reason: input.reason ?? 'Användaren togs bort från bolaget.',
  }

  const byCompany = await supabaseService
    .from('user_roles')
    .update(payload)
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .eq('status', 'active')

  if (byCompany.error && !isIgnorableSchemaError(byCompany.error)) throw byCompany.error
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

  const membership = await supabaseService
    .from('company_memberships')
    .select('id,status,role_key,membership_role,invited_email')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .eq('status', 'active')
    .maybeSingle()

  if (membership.error) throw membership.error
  if (!membership.data?.id) {
    throw new Error('Verifiering misslyckades: aktiv bolagskoppling saknas efter skapande.')
  }

  const roleRows = await supabaseService
    .from('user_roles')
    .select('id,role,role_id,status,is_active')
    .eq('company_id', input.companyId)
    .eq('user_id', input.userId)
    .eq('status', 'active')
    .eq('is_active', true)

  if (roleRows.error) throw roleRows.error

  const roleKey = normalizeRoleKey(input.roleKey)
  const hasRole = ((roleRows.data ?? []) as Array<Record<string, unknown>>).some((row) => {
    const normalizedRole = normalizeRoleKey(typeof row.role === 'string' ? row.role : null)
    return normalizedRole === roleKey || String(row.role_id ?? '') === input.roleId
  })
  if (!hasRole) {
    throw new Error('Verifiering misslyckades: aktiv tenant-scopad systemroll saknas efter skapande.')
  }
}
