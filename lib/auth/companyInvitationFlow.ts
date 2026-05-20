import crypto from 'node:crypto'
import type { User } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import {
  findAuthUserByEmail,
  getBaseAppUrl,
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

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')
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

function buildAcceptUrl(token: string) {
  return `${getBaseAppUrl()}/auth/company-invite?token=${encodeURIComponent(token)}`
}

async function safeRecordAuthEmailEvent(input: Parameters<typeof recordAuthEmailEvent>[0]) {
  try {
    await recordAuthEmailEvent(input)
  } catch (error) {
    console.warn('Could not record auth/company access event', error)
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
  if (error && !isIgnorableSchemaError(error)) throw error
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
    if (error) throw error

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

  if (error) throw error
  if (!data.user) throw new Error('Auth-kontot skapades inte korrekt.')

  return { user: data.user, temporaryPassword, wasCreated: true }
}

export async function provisionCompanyInvitation(input: CompanyInviteInput): Promise<CompanyInviteProvisionResult> {
  const email = normalizeEmail(input.email)
  if (!email) throw new Error('E-post saknas.')

  let createdAuthUserId: string | null = null
  let userId: string | null = null
  let token = ''
  let acceptUrl = ''

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

    token = createInvitationToken()
    const tokenHash = hashCompanyInvitationToken(token)
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
    const now = new Date().toISOString()

    const { error: membershipError } = await supabaseService.from('company_memberships').upsert(
      {
        company_id: input.companyId,
        user_id: user.id,
        membership_role: input.membershipRole,
        status: 'active',
        invited_email: email,
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
          force_password_change: Boolean(temporaryPassword),
          login_ready: true,
        },
      },
      { onConflict: 'company_id,user_id' }
    )
    if (membershipError) throw membershipError

    const invitationPayload: Record<string, unknown> = {
      company_id: input.companyId,
      email,
      full_name: input.fullName ?? null,
      membership_role: input.membershipRole,
      role_key: input.roleKey,
      status: 'accepted',
      invited_by: input.actorUserId,
      invited_user_id: user.id,
      expires_at: expiresAt,
      accepted_at: now,
      revoked_at: null,
      accept_token_hash: tokenHash,
      temporary_password_issued_at: temporaryPassword ? now : null,
      temporary_password_expires_at: temporaryPassword ? expiresAt : null,
      metadata: {
        invite_source: input.source,
        access_source: 'direct_temporary_password',
        force_password_change: Boolean(temporaryPassword),
        login_ready: true,
        invite_mail_skipped: true,
        admin_supplied_temporary_password: Boolean(input.temporaryPassword),
      },
    }

    const { error: inviteError } = await supabaseService.from('company_invitations').insert(invitationPayload)
    if (inviteError && !isIgnorableSchemaError(inviteError) && inviteError.code !== '23514') throw inviteError

    const roleQuery = await supabaseService.from('roles').select('id,key').eq('key', input.roleKey).maybeSingle()
    if (roleQuery.error) throw roleQuery.error
    if (roleQuery.data?.id) {
      const rolePayload = {
        user_id: user.id,
        role_id: roleQuery.data.id,
        status: 'active',
        is_active: true,
      }
      const roleInsert = await supabaseService.from('user_roles').upsert(rolePayload, {
        onConflict: 'user_id,role_id',
      })

      if (roleInsert.error) {
        if (roleInsert.error.code === '42703') {
          const retry = await supabaseService.from('user_roles').upsert(
            {
              user_id: user.id,
              role_id: roleQuery.data.id,
            },
            { onConflict: 'user_id,role_id' }
          )
          if (retry.error) throw retry.error
        } else {
          throw roleInsert.error
        }
      }
    }

    acceptUrl = buildAcceptUrl(token)
    const emailSent = false
    const emailError: string | null = null

    await safeRecordAuthEmailEvent({
      userId: user.id,
      email,
      eventType: 'direct_user_created',
      status: 'created',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        membershipRole: input.membershipRole,
        roleKey: input.roleKey,
        temporaryPasswordIssued: Boolean(temporaryPassword),
        existingUser: !createdAuthUserId,
        loginReady: true,
        inviteMailSkipped: true,
      },
    })

    return {
      userId: user.id,
      email,
      temporaryPassword,
      wasCreated: Boolean(createdAuthUserId),
      invitationToken: token,
      acceptUrl,
      emailSent,
      emailError,
    }
  } catch (error) {
    await safeRecordAuthEmailEvent({
      userId,
      email,
      eventType: 'direct_user_created',
      status: 'failed',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: { error: error instanceof Error ? error.message : String(error), loginReady: false },
    })

    if (userId) {
      await supabaseService.from('company_invitations').delete().eq('company_id', input.companyId).eq('invited_user_id', userId)
      await supabaseService.from('company_memberships').delete().eq('company_id', input.companyId).eq('user_id', userId)
    }

    if (createdAuthUserId) {
      await supabaseService.from('user_roles').delete().eq('user_id', createdAuthUserId)
      await supabaseService.from('user_profiles').delete().eq('id', createdAuthUserId)
      await supabaseService.auth.admin.deleteUser(createdAuthUserId)
    }

    throw error
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
    throw error
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
      companyName: invitation.company_name ?? null,
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

  if (inviteUpdateError) throw inviteUpdateError

  const { error: membershipError } = await supabaseService.from('company_memberships').upsert(
    {
      company_id: invitation.company_id,
      user_id: authUser.id,
      membership_role: invitation.membership_role ?? 'member',
      status: 'active',
      invited_email: email,
      accepted_at: now,
      metadata: {
        accepted_via: 'company_invite_token',
        login_ready: true,
      },
    },
    { onConflict: 'company_id,user_id' }
  )

  if (membershipError) throw membershipError

  await recordAuthEmailEvent({
    userId: authUser.id,
    email,
    eventType: 'company_invitation_accepted',
    status: 'accepted',
    source: 'company_invite_token',
    companyId: invitation.company_id,
  })

  return {
    email,
    companyId: invitation.company_id,
    companyName: invitation.company_name ?? null,
  }
}
