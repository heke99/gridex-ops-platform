import crypto from 'node:crypto'
import type { User } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import { acceptCompanyInvitationAccess } from '@/lib/auth/companyUserAccess'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  findAuthUserByEmail,
  getBaseAppUrl,
  recordAuthEmailEvent,
  upsertAuthUserProfile,
} from '@/lib/auth/authEmailFlow'

export type CompanyInviteProvisionResult = {
  userId: string | null
  email: string
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

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')
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

async function upsertInvitedUserProfile(input: {
  user: User
  email: string
  fullName: string | null
  source: string
}) {
  const now = new Date().toISOString()

  await upsertAuthUserProfile({
    userId: input.user.id,
    email: input.email,
    fullName: input.fullName,
    emailConfirmedAt: input.user.email_confirmed_at ?? undefined,
    lastInviteSentAt: now,
    lastAction: 'invite_sent',
  })

  const payload: Record<string, unknown> = {
    id: input.user.id,
    email: input.email,
    full_name: input.fullName,
    updated_at: now,
  }

  const { error } = await supabaseService.from('user_profiles').upsert(payload, { onConflict: 'id' })
  if (error && !isIgnorableSchemaError(error)) throw error
}

async function createOrResolveInvitedAuthUser(input: {
  email: string
  fullName: string | null
  redirectTo: string
  sendEmail: boolean
}): Promise<{ user: User; wasCreated: boolean; emailSent: boolean }> {
  const existing = await findAuthUserByEmail(input.email)

  if (existing) {
    const { data, error } = await supabaseService.auth.admin.updateUserById(existing.id, {
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        full_name: input.fullName ?? existing.user_metadata?.full_name ?? null,
      },
    })
    if (error) throw error
    if (input.sendEmail) {
      const otp = await supabaseService.auth.signInWithOtp({
        email: input.email,
        options: { emailRedirectTo: input.redirectTo, shouldCreateUser: false },
      })
      if (otp.error) throw otp.error
    }
    return { user: data.user ?? existing, wasCreated: false, emailSent: input.sendEmail }
  }

  if (!input.sendEmail) {
    throw new Error('Nya användare måste få en verifierad inbjudningslänk.')
  }
  const { data, error } = await supabaseService.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: input.redirectTo,
    data: { full_name: input.fullName ?? null },
  })

  if (error) throw error
  if (!data.user) throw new Error('Auth-kontot skapades inte korrekt.')

  return { user: data.user, wasCreated: true, emailSent: true }
}

export async function deliverCompanyInvitationIntent(input: {
  invitationId: string
  companyId: string
  email: string
  fullName: string | null
  token: string
  actorUserId: string | null
  source: string
  membershipRole: string
  roleKey: string
  sendEmail?: boolean
}) {
  const acceptUrl = buildAcceptUrl(input.token)
  const authRedirectTo = `${getBaseAppUrl()}/auth/callback?next=${encodeURIComponent(`/auth/company-invite?token=${encodeURIComponent(input.token)}`)}`
  try {
    const authResult = await createOrResolveInvitedAuthUser({
      email: input.email,
      fullName: input.fullName,
      redirectTo: authRedirectTo,
      sendEmail: input.sendEmail !== false,
    })
    await upsertInvitedUserProfile({
      user: authResult.user,
      email: input.email,
      fullName: input.fullName,
      source: input.source,
    })
    const { error: updateError } = await supabaseService
      .from('company_invitations')
      .update({
        invited_user_id: authResult.user.id,
        metadata: {
          invite_source: input.source,
          access_source: 'verified_auth_invitation_link',
          provider_delivery_status: authResult.emailSent ? 'sent' : 'created',
          login_ready: false,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.invitationId)
      .eq('company_id', input.companyId)
      .eq('status', 'pending')
    if (updateError) throw updateError

    await safeRecordAuthEmailEvent({
      userId: authResult.user.id,
      email: input.email,
      eventType: 'invite_sent',
      status: authResult.emailSent ? 'sent' : 'created',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        invitationId: input.invitationId,
        membershipRole: input.membershipRole,
        roleKey: input.roleKey,
        existingUser: !authResult.wasCreated,
        loginReady: false,
        inviteLinkRequired: true,
      },
    })
    return {
      userId: authResult.user.id,
      wasCreated: authResult.wasCreated,
      emailSent: authResult.emailSent,
      acceptUrl,
    }
  } catch (error) {
    await supabaseService
      .from('company_invitations')
      .update({
        metadata: {
          invite_source: input.source,
          access_source: 'verified_auth_invitation_link',
          provider_delivery_status: 'failed',
          provider_error: error instanceof Error ? error.message : String(error),
          login_ready: false,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.invitationId)
      .eq('company_id', input.companyId)
      .eq('status', 'pending')

    await safeRecordAuthEmailEvent({
      userId: null,
      email: input.email,
      eventType: 'invite_sent',
      status: 'failed',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        invitationId: input.invitationId,
        error: error instanceof Error ? error.message : String(error),
        durableIntentRetained: true,
      },
    })
    throw error
  }
}

export async function provisionCompanyInvitation(input: CompanyInviteInput): Promise<CompanyInviteProvisionResult> {
  const email = normalizeEmail(input.email)
  if (!email) throw new Error('E-post saknas.')
  if (!input.actorUserId) throw new Error('Verifierad aktör krävs för tenantinbjudan.')

  const idempotencyKey = `tenant-invitation:${input.companyId}:${hashCompanyInvitationToken(`${email}:${input.roleKey}`)}`
  const { data, error } = await supabaseService.rpc('canonical_create_tenant_invitation', {
    p_command: {
      company_id: input.companyId,
      actor_user_id: input.actorUserId,
      email,
      full_name: input.fullName ?? null,
      membership_role: input.membershipRole,
      role_key: input.roleKey,
      source: input.source,
      idempotency_key: idempotencyKey,
    },
  })
  if (error) throw error
  const intent = data as {
    invitation_id?: string | null
    company_id?: string | null
    token?: string | null
    status?: string | null
  } | null
  if (!intent?.invitation_id || !intent.token) {
    throw new Error('Canonical tenantinbjudan returnerade inte ett komplett durable intent.')
  }

  // Provider delivery is owned exclusively by the leased provisioning worker.
  // Returning after the durable intent commits removes the race where the
  // request and cron worker could send competing, non-idempotent Auth emails.
  return {
    userId: null,
    email,
    wasCreated: false,
    invitationToken: intent.token,
    acceptUrl: buildAcceptUrl(intent.token),
    emailSent: false,
    emailError: null,
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
  const supabase = await createSupabaseServerClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) throw new Error('Logga in via den verifierade inbjudningslänken innan du accepterar.')
  if (normalizeEmail(auth.user.email) !== email) {
    throw new Error('Den inloggade användaren matchar inte inbjudans e-postadress.')
  }
  if (invitation.invited_user_id && invitation.invited_user_id !== auth.user.id) {
    throw new Error('Den inloggade användaren matchar inte inbjudans Auth-identitet.')
  }

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

  const authUser = auth.user

  await acceptCompanyInvitationAccess({
    companyId: invitation.company_id,
    invitationId: invitation.id,
    userId: authUser.id,
    email,
    idempotencyKey: `tenant-invitation-accept:${invitation.company_id}:${invitation.id}:${authUser.id}`,
  })

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
