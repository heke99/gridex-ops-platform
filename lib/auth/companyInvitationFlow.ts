import crypto from 'node:crypto'
import type { User } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import {
  findAuthUserByEmail,
  getBaseAppUrl,
  recordAuthEmailEvent,
  upsertAuthUserProfile,
} from '@/lib/auth/authEmailFlow'
import { sendTransactionalEmail } from '@/lib/auth/smtpTransactionalEmail'

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

function escapeHtml(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function companyNameFromJoin(row: CompanyInvitationRow) {
  return row.company_name ?? 'Gridex'
}

function inviteEmailHtml(input: {
  companyName: string
  email: string
  fullName: string | null
  acceptUrl: string
  temporaryPassword: string | null
}) {
  const safeCompanyName = escapeHtml(input.companyName)
  const safeFullName = escapeHtml(input.fullName || input.email)
  const safeEmail = escapeHtml(input.email)
  const safePassword = escapeHtml(input.temporaryPassword)

  return `
<div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 20px 32px;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#047857;">Gridex</div>
              <h1 style="margin:16px 0 0 0;font-size:26px;line-height:1.25;color:#0f172a;">Du har fått åtkomst till ${safeCompanyName}</h1>
              <p style="margin:14px 0 0 0;font-size:15px;line-height:1.7;color:#475569;">Hej ${safeFullName}. En administratör har skapat ett konto eller kopplat ditt konto till bolaget i Gridex.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px 32px;">
              <a href="${escapeHtml(input.acceptUrl)}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 22px;border-radius:14px;">Öppna åtkomst</a>
              <div style="margin-top:24px;padding:18px;border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;">
                <p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">Inloggning</p>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#334155;"><strong>E-post:</strong> ${safeEmail}</p>
                ${input.temporaryPassword ? `<p style="margin:6px 0 0 0;font-size:14px;line-height:1.7;color:#334155;"><strong>Temporärt lösenord:</strong> <span style="font-family:Consolas,Monaco,monospace;">${safePassword}</span></p>` : ''}
              </div>
              ${input.temporaryPassword ? '<p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:#b45309;">Du blir ombedd att byta lösenord första gången du loggar in.</p>' : '<p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:#64748b;">Logga in med ditt befintliga konto. Om du inte minns lösenordet kan du använda glömt lösenord.</p>'}
              <p style="margin:20px 0 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">Länken är personlig och ska inte vidarebefordras.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`.trim()
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

  const companyQuery = await supabaseService.from('companies').select('id, name').eq('id', input.companyId).maybeSingle()
  if (companyQuery.error) throw companyQuery.error
  const companyName = input.companyName ?? (companyQuery.data as { name?: string | null } | null)?.name ?? 'Gridex'

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
      status: 'pending',
      invited_by: input.actorUserId,
      invited_user_id: user.id,
      expires_at: expiresAt,
      accepted_at: null,
      revoked_at: null,
      accept_token_hash: tokenHash,
      temporary_password_issued_at: temporaryPassword ? now : null,
      temporary_password_expires_at: temporaryPassword ? expiresAt : null,
      metadata: {
        invite_source: input.source,
        force_password_change: Boolean(temporaryPassword),
        login_ready: true,
        admin_supplied_temporary_password: Boolean(input.temporaryPassword),
      },
    }

    const { error: inviteError } = await supabaseService.from('company_invitations').insert(invitationPayload)
    if (inviteError) throw inviteError

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
    let emailSent = false
    let emailError: string | null = null

    if (input.sendEmail !== false) {
      try {
        await sendTransactionalEmail({
          to: email,
          subject: `Åtkomst till ${companyName} i Gridex`,
          html: inviteEmailHtml({
            companyName,
            email,
            fullName: input.fullName ?? null,
            acceptUrl,
            temporaryPassword,
          }),
          text: temporaryPassword
            ? `Du har fått åtkomst till ${companyName} i Gridex. Länk: ${acceptUrl}\nE-post: ${email}\nTemporärt lösenord: ${temporaryPassword}\nDu blir ombedd att byta lösenord när du loggar in.`
            : `Du har fått åtkomst till ${companyName} i Gridex. Länk: ${acceptUrl}\nLogga in med ditt befintliga konto.`,
        })
        emailSent = true
      } catch (mailError) {
        emailError = mailError instanceof Error ? mailError.message : String(mailError)
      }
    }

    await recordAuthEmailEvent({
      userId: user.id,
      email,
      eventType: 'invite_sent',
      status: emailSent ? 'sent' : 'failed',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        membershipRole: input.membershipRole,
        roleKey: input.roleKey,
        temporaryPasswordIssued: Boolean(temporaryPassword),
        existingUser: !createdAuthUserId,
        acceptUrl,
        emailSent,
        emailError,
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
    await recordAuthEmailEvent({
      userId,
      email,
      eventType: 'invite_sent',
      status: 'failed',
      source: input.source,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })

    if (userId) {
      await supabaseService.from('company_invitations').delete().eq('company_id', input.companyId).eq('invited_user_id', userId).eq('status', 'pending')
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
    companyName: companyNameFromJoin(invitation),
  }
}
