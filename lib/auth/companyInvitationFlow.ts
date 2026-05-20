import crypto from 'node:crypto'
import type { User } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import {
  findAuthUserByEmail,
  recordAuthEmailEvent,
  upsertAuthUserProfile,
} from '@/lib/auth/authEmailFlow'

export type CompanyInviteProvisionResult = {
  userId: string
  email: string
  temporaryPassword: string | null
  wasCreated: boolean
  invitationToken: string
  acceptUrl: string
  emailSent: boolean
  emailError: string | null
}

type CompanyInviteInput = {
  companyId: string
  companyName?: string | null
  email: string
  fullName?: string | null
  membershipRole: string
  roleKey: string
  actorUserId: string | null
  source: string
  issueTemporaryPassword?: boolean
  temporaryPassword?: string | null
  sendEmail?: boolean
}

type CompanyInvitationRow = {
  id: string
  company_id: string
  email: string
  full_name?: string | null
  membership_role: string | null
  role_key?: string | null
  status: string | null
  invited_user_id?: string | null
  expires_at?: string | null
  company_name?: string | null
}

type SupabaseLikeError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function isSupabaseLikeError(error: unknown): error is SupabaseLikeError {
  return Boolean(error && typeof error === 'object' && ('message' in error || 'code' in error))
}

function errorMessage(error: unknown, fallback = 'Okänt fel') {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (isSupabaseLikeError(error)) {
    const parts = [error.message, error.details, error.hint, error.code ? `kod: ${error.code}` : null]
      .filter((part): part is string => Boolean(part && String(part).trim()))
    if (parts.length > 0) return parts.join(' · ')
  }
  try {
    const json = JSON.stringify(error)
    if (json && json !== '{}') return json
  } catch {
    // ignore
  }
  return fallback
}

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')
}

function isConflictTargetError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return error.code === '42P10' || /conflict/i.test(error.message ?? '')
}

function createTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  const bytes = crypto.randomBytes(18)
  let password = ''
  for (const byte of bytes) password += alphabet[byte % alphabet.length]
  return `${password}9!`
}

function assertValidTemporaryPassword(password: string) {
  if (password.length < 8) {
    throw new Error('Temporärt lösenord måste vara minst 8 tecken.')
  }
}

function createInvitationToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashCompanyInvitationToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}


function companyNameFromJoin(row: CompanyInvitationRow) {
  return row.company_name ?? 'Gridex'
}

async function safeRecordAuthEvent(input: Parameters<typeof recordAuthEmailEvent>[0]) {
  try {
    await recordAuthEmailEvent(input)
  } catch (error) {
    if (!isIgnorableSchemaError(error as SupabaseLikeError)) {
      console.warn('Could not record auth email event', errorMessage(error))
    }
  }
}

async function upsertUserProfileWithTemporaryState(input: {
  user: User
  email: string
  fullName: string | null
  temporaryPassword: string | null
  source: string
}) {
  const now = new Date().toISOString()

  await upsertAuthUserProfile({
    userId: input.user.id,
    email: input.email,
    fullName: input.fullName,
    emailConfirmedAt: input.user.email_confirmed_at ?? now,
    lastInviteSentAt: now,
    lastAction: input.source,
  })

  const payload: Record<string, unknown> = {
    id: input.user.id,
    email: input.email,
    full_name: input.fullName,
    updated_at: now,
  }

  if (input.temporaryPassword) {
    payload.must_change_password = true
    payload.temporary_password_set_at = now
    payload.temporary_password_expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
  }

  const { error } = await supabaseService.from('user_profiles').upsert(payload, { onConflict: 'id' })
  if (error && !isIgnorableSchemaError(error)) throw new Error(`Kunde inte synka användarprofil: ${errorMessage(error)}`)
}

async function createOrUpdateAuthUser(input: {
  email: string
  fullName: string | null
  issueTemporaryPassword: boolean
  temporaryPassword?: string | null
}): Promise<{ user: User; temporaryPassword: string | null; wasCreated: boolean }> {
  const existing = await findAuthUserByEmail(input.email)
  const manualTemporaryPassword = normalizeText(input.temporaryPassword)
  const temporaryPassword = input.issueTemporaryPassword
    ? manualTemporaryPassword || createTemporaryPassword()
    : null

  if (temporaryPassword) assertValidTemporaryPassword(temporaryPassword)

  if (existing) {
    const updatePayload: {
      user_metadata: Record<string, unknown>
      password?: string
      email_confirm?: boolean
    } = {
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        full_name: input.fullName ?? existing.user_metadata?.full_name ?? null,
        must_change_password: Boolean(temporaryPassword) || Boolean(existing.user_metadata?.must_change_password),
        temporary_password_set_at: temporaryPassword ? new Date().toISOString() : existing.user_metadata?.temporary_password_set_at ?? null,
      },
    }

    if (temporaryPassword) {
      updatePayload.password = temporaryPassword
      updatePayload.email_confirm = true
    }

    const { data, error } = await supabaseService.auth.admin.updateUserById(existing.id, updatePayload)
    if (error) throw new Error(`Auth-kontot kunde inte uppdateras: ${errorMessage(error)}`)

    return { user: data.user ?? existing, temporaryPassword, wasCreated: false }
  }

  const finalPassword = temporaryPassword ?? createTemporaryPassword()
  const { data, error } = await supabaseService.auth.admin.createUser({
    email: input.email,
    password: finalPassword,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName ?? null,
      must_change_password: Boolean(temporaryPassword),
      temporary_password_set_at: temporaryPassword ? new Date().toISOString() : null,
    },
  })

  if (error) throw new Error(`Auth-kontot kunde inte skapas: ${errorMessage(error)}`)
  if (!data.user) throw new Error('Auth-kontot skapades inte korrekt.')

  return { user: data.user, temporaryPassword, wasCreated: true }
}

async function upsertActiveCompanyMembership(input: {
  companyId: string
  userId: string
  email: string
  membershipRole: string
  actorUserId: string | null
  source: string
  temporaryPassword: string | null
}) {
  const now = new Date().toISOString()
  const basePayload: Record<string, unknown> = {
    company_id: input.companyId,
    user_id: input.userId,
    membership_role: input.membershipRole,
    status: 'active',
    invited_email: input.email,
    invited_by: input.actorUserId,
    invited_at: now,
    accepted_at: now,
    disabled_at: null,
    disabled_by: null,
    removed_at: null,
    removed_by: null,
    status_reason: null,
    metadata: {
      invite_source: input.source,
      force_password_change: Boolean(input.temporaryPassword),
      login_ready: true,
      direct_account_flow: true,
    },
  }

  const direct = await supabaseService.from('company_memberships').upsert(basePayload, {
    onConflict: 'company_id,user_id',
  })

  if (!direct.error) return

  if (isConflictTargetError(direct.error)) {
    const { data: existing, error: findError } = await supabaseService
      .from('company_memberships')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)
      .maybeSingle()

    if (findError && !isIgnorableSchemaError(findError)) {
      throw new Error(`Kunde inte kontrollera befintlig bolagskoppling: ${errorMessage(findError)}`)
    }

    if ((existing as { id?: string } | null)?.id) {
      const { error: updateError } = await supabaseService
        .from('company_memberships')
        .update(basePayload)
        .eq('id', (existing as { id: string }).id)
      if (!updateError) return
      throw new Error(`Bolagskopplingen kunde inte uppdateras: ${errorMessage(updateError)}`)
    }

    const { error: insertError } = await supabaseService.from('company_memberships').insert(basePayload)
    if (!insertError) return
    throw new Error(`Bolagskopplingen kunde inte skapas: ${errorMessage(insertError)}`)
  }

  if (direct.error.code === '42703') {
    const minimalPayload = {
      company_id: input.companyId,
      user_id: input.userId,
      membership_role: input.membershipRole,
      status: 'active',
    }
    const retry = await supabaseService.from('company_memberships').upsert(minimalPayload, {
      onConflict: 'company_id,user_id',
    })
    if (!retry.error) return

    const insert = await supabaseService.from('company_memberships').insert(minimalPayload)
    if (!insert.error) return

    throw new Error(`Bolagskopplingen kunde inte sparas med förenklat schema: ${errorMessage(insert.error)}`)
  }

  throw new Error(`Bolagskopplingen kunde inte sparas: ${errorMessage(direct.error)}`)
}

async function upsertUserRole(input: { userId: string; roleKey: string }) {
  const { data: role, error: roleError } = await supabaseService
    .from('roles')
    .select('id,key')
    .eq('key', input.roleKey)
    .maybeSingle()

  if (roleError) {
    if (isIgnorableSchemaError(roleError)) return
    throw new Error(`Rollen kunde inte hämtas: ${errorMessage(roleError)}`)
  }

  if (!role?.id) {
    throw new Error(`Rollen hittades inte i databasen: ${input.roleKey}. Lägg till rollen eller välj en befintlig roll.`)
  }

  const fullPayload = {
    user_id: input.userId,
    role_id: role.id,
    status: 'active',
    is_active: true,
  }
  const upsert = await supabaseService.from('user_roles').upsert(fullPayload, {
    onConflict: 'user_id,role_id',
  })

  if (!upsert.error) return

  if (upsert.error.code === '42703') {
    const retry = await supabaseService.from('user_roles').upsert(
      {
        user_id: input.userId,
        role_id: role.id,
      },
      { onConflict: 'user_id,role_id' }
    )
    if (!retry.error) return
    throw new Error(`Användarrollen kunde inte sparas: ${errorMessage(retry.error)}`)
  }

  if (isConflictTargetError(upsert.error)) {
    const insert = await supabaseService.from('user_roles').insert(fullPayload)
    if (!insert.error) return
    if (insert.error.code === '23505') return
    throw new Error(`Användarrollen kunde inte skapas: ${errorMessage(insert.error)}`)
  }

  throw new Error(`Användarrollen kunde inte sparas: ${errorMessage(upsert.error)}`)
}

async function writeAcceptedCompanyInvitationSnapshot(input: {
  companyId: string
  email: string
  fullName: string | null
  membershipRole: string
  roleKey: string
  actorUserId: string | null
  userId: string
  temporaryPassword: string | null
  source: string
}) {
  const now = new Date().toISOString()
  const token = createInvitationToken()
  const tokenHash = hashCompanyInvitationToken(token)

  const payload: Record<string, unknown> = {
    company_id: input.companyId,
    email: input.email,
    full_name: input.fullName,
    membership_role: input.membershipRole,
    role_key: input.roleKey,
    status: 'accepted',
    invited_by: input.actorUserId,
    invited_user_id: input.userId,
    accepted_at: now,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
    accept_token_hash: tokenHash,
    temporary_password_issued_at: input.temporaryPassword ? now : null,
    temporary_password_expires_at: input.temporaryPassword
      ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
      : null,
    metadata: {
      invite_source: input.source,
      direct_account_flow: true,
      force_password_change: Boolean(input.temporaryPassword),
      login_ready: true,
    },
  }

  const { error } = await supabaseService.from('company_invitations').insert(payload)
  if (error && !isIgnorableSchemaError(error)) {
    console.warn('Could not write company invitation snapshot', errorMessage(error))
  }
}

export async function provisionCompanyInvitation(input: CompanyInviteInput): Promise<CompanyInviteProvisionResult> {
  const email = normalizeEmail(input.email)
  if (!email) throw new Error('E-post saknas.')

  const companyQuery = await supabaseService.from('companies').select('id, name').eq('id', input.companyId).maybeSingle()
  if (companyQuery.error) throw new Error(`Bolaget kunde inte hämtas: ${errorMessage(companyQuery.error)}`)
  const companyName = input.companyName ?? (companyQuery.data as { name?: string | null } | null)?.name ?? 'Gridex'

  let createdAuthUserId: string | null = null
  let userId: string | null = null

  try {
    const authResult = await createOrUpdateAuthUser({
      email,
      fullName: input.fullName ?? null,
      issueTemporaryPassword: input.issueTemporaryPassword !== false,
      temporaryPassword: input.temporaryPassword ?? null,
    })

    const { user, wasCreated, temporaryPassword } = authResult
    userId = user.id
    if (wasCreated) createdAuthUserId = user.id

    await upsertUserProfileWithTemporaryState({
      user,
      email,
      fullName: input.fullName ?? null,
      temporaryPassword,
      source: input.source,
    })

    await upsertActiveCompanyMembership({
      companyId: input.companyId,
      userId: user.id,
      email,
      membershipRole: input.membershipRole,
      actorUserId: input.actorUserId,
      source: input.source,
      temporaryPassword,
    })

    await upsertUserRole({ userId: user.id, roleKey: input.roleKey })

    await writeAcceptedCompanyInvitationSnapshot({
      companyId: input.companyId,
      email,
      fullName: input.fullName ?? null,
      membershipRole: input.membershipRole,
      roleKey: input.roleKey,
      actorUserId: input.actorUserId,
      userId: user.id,
      temporaryPassword,
      source: input.source,
    })

    await safeRecordAuthEvent({
      userId: user.id,
      email,
      eventType: 'direct_user_created',
      status: 'created',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        companyName,
        membershipRole: input.membershipRole,
        roleKey: input.roleKey,
        temporaryPasswordIssued: Boolean(temporaryPassword),
        existingUser: !createdAuthUserId,
        directAccountFlow: true,
        emailSent: false,
      },
    })

    return {
      userId: user.id,
      email,
      temporaryPassword,
      wasCreated: Boolean(createdAuthUserId),
      invitationToken: '',
      acceptUrl: '',
      emailSent: false,
      emailError: null,
    }
  } catch (error) {
    await safeRecordAuthEvent({
      userId,
      email,
      eventType: 'direct_user_created',
      status: 'failed',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: { error: errorMessage(error), directAccountFlow: true },
    })

    if (userId) {
      await supabaseService.from('company_memberships').delete().eq('company_id', input.companyId).eq('user_id', userId)
    }

    if (createdAuthUserId) {
      await supabaseService.from('user_roles').delete().eq('user_id', createdAuthUserId)
      await supabaseService.from('user_profiles').delete().eq('id', createdAuthUserId)
      await supabaseService.auth.admin.deleteUser(createdAuthUserId)
    }

    throw new Error(errorMessage(error, 'Bolagsansvarig eller användare kunde inte skapas/kopplas.'))
  }
}

export async function getCompanyInvitationByToken(token: string): Promise<CompanyInvitationRow | null> {
  const hash = hashCompanyInvitationToken(token)
  const { data, error } = await supabaseService
    .from('company_invitations')
    .select('id, company_id, email, full_name, membership_role, role_key, status, invited_user_id, expires_at')
    .eq('accept_token_hash', hash)
    .maybeSingle()

  if (error) {
    if (isIgnorableSchemaError(error)) return null
    throw new Error(errorMessage(error))
  }

  if (!data) return null

  let companyName: string | null = null
  try {
    const { data: company } = await supabaseService
      .from('companies')
      .select('name')
      .eq('id', (data as { company_id: string }).company_id)
      .maybeSingle()
    companyName = typeof company?.name === 'string' ? company.name : null
  } catch {
    companyName = null
  }

  return {
    ...(data as unknown as CompanyInvitationRow),
    company_name: companyName,
  }
}

export async function acceptCompanyInvitationByToken(token: string) {
  const invitation = await getCompanyInvitationByToken(token)
  if (!invitation) throw new Error('Inbjudningslänken är ogiltig eller saknar aktiv token.')

  const email = normalizeEmail(invitation.email)

  if (invitation.status === 'accepted') {
    return {
      email,
      companyId: invitation.company_id,
      companyName: companyNameFromJoin(invitation),
    }
  }

  if (invitation.status !== 'pending') throw new Error('Inbjudan är återkallad eller inte längre giltig.')

  const expiresAt = invitation.expires_at ? new Date(invitation.expires_at).getTime() : null
  if (expiresAt && expiresAt < Date.now()) throw new Error('Inbjudan har gått ut. Be administratören skicka en ny inbjudan.')

  const authUser = invitation.invited_user_id
    ? (await supabaseService.auth.admin.getUserById(invitation.invited_user_id)).data.user
    : await findAuthUserByEmail(email)

  if (!authUser?.id) throw new Error('Auth-kontot för inbjudan hittades inte.')

  const now = new Date().toISOString()

  const { error: inviteUpdateError } = await supabaseService
    .from('company_invitations')
    .update({
      status: 'accepted',
      accepted_at: now,
      invited_user_id: authUser.id,
      metadata: {
        accepted_via: 'company_invite_token',
      },
    })
    .eq('id', invitation.id)

  if (inviteUpdateError) throw new Error(errorMessage(inviteUpdateError))

  await upsertActiveCompanyMembership({
    companyId: invitation.company_id,
    userId: authUser.id,
    email,
    membershipRole: invitation.membership_role ?? 'member',
    actorUserId: null,
    source: 'company_invite_token_accept',
    temporaryPassword: null,
  })

  if (invitation.role_key) {
    await upsertUserRole({ userId: authUser.id, roleKey: invitation.role_key })
  }

  await safeRecordAuthEvent({
    userId: authUser.id,
    email,
    eventType: 'company_invitation_accepted',
    status: 'accepted',
    source: 'company_invite_token_accept',
    companyId: invitation.company_id,
    metadata: {
      invitationId: invitation.id,
      membershipRole: invitation.membership_role,
      roleKey: invitation.role_key,
    },
  })

  return {
    email,
    companyId: invitation.company_id,
    companyName: companyNameFromJoin(invitation),
  }
}
