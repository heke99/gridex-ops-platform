import type { EmailOtpType, User } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import { sendTenantBrandedPasswordResetEmail } from '@/lib/tenant/passwordResetEmail'

export type AuthEmailActionType =
  | 'email'
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'

export type AuthEmailEventType =
  | 'invite_sent'
  | 'password_reset_sent'
  | 'confirmation_sent'
  | 'email_action_verified'
  | 'password_updated'
  | 'company_invitation_accepted'
  | 'direct_user_created'

const AUTH_EMAIL_TYPES = new Set<AuthEmailActionType>([
  'email',
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
])

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')
}

export function getBaseAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.SITE_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

export function getSafeNextPath(value: string | null | undefined, fallback = '/login'): string {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback

  if (raw.startsWith('/') && !raw.startsWith('//')) return raw

  try {
    const url = new URL(raw)
    const appUrl = new URL(getBaseAppUrl())
    if (url.origin === appUrl.origin) {
      return `${url.pathname}${url.search}${url.hash}` || fallback
    }
  } catch {
    return fallback
  }

  return fallback
}

export function normalizeAuthEmailType(value: string | null | undefined): AuthEmailActionType | null {
  const type = String(value ?? '').trim().toLowerCase() as AuthEmailActionType
  return AUTH_EMAIL_TYPES.has(type) ? type : null
}

export function getDefaultNextPathForAuthType(type: AuthEmailActionType | null): string {
  if (type === 'recovery' || type === 'invite') return '/login/update-password'
  if (type === 'magiclink') return '/admin'
  return '/login'
}

export function buildAuthCallbackRedirect(nextPath: string) {
  const safeNext = getSafeNextPath(nextPath, '/login')
  return `${getBaseAppUrl()}/auth/callback?next=${encodeURIComponent(safeNext)}`
}

export async function findAuthUserByEmail(emailInput: string): Promise<User | null> {
  const email = normalizeEmail(emailInput)
  if (!email) return null

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseService.auth.admin.listUsers({
      page,
      perPage: 1000,
    })

    if (error) throw error

    const users = data.users ?? []
    const match = users.find((user) => normalizeEmail(user.email) === email)
    if (match) return match
    if (users.length < 1000) return null
  }

  return null
}

export async function recordAuthEmailEvent(input: {
  userId?: string | null
  email: string
  eventType: AuthEmailEventType
  status?: 'sent' | 'verified' | 'accepted' | 'failed' | 'created'
  source?: string
  actorUserId?: string | null
  companyId?: string | null
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseService.from('auth_email_events').insert({
    user_id: input.userId ?? null,
    email: normalizeEmail(input.email),
    event_type: input.eventType,
    status: input.status ?? 'sent',
    source: input.source ?? 'app',
    actor_user_id: input.actorUserId ?? null,
    company_id: input.companyId ?? null,
    metadata: input.metadata ?? {},
  })

  if (error && !isIgnorableSchemaError(error)) throw error
}

export async function upsertAuthUserProfile(input: {
  userId: string
  email: string
  fullName?: string | null
  emailConfirmedAt?: string | null
  lastAction?: string | null
  lastInviteSentAt?: string | null
  lastPasswordResetSentAt?: string | null
  lastConfirmationEmailSentAt?: string | null
}) {
  const now = new Date().toISOString()
  const payload: Record<string, unknown> = {
    id: input.userId,
    email: normalizeEmail(input.email),
    updated_at: now,
  }

  if (input.fullName !== undefined) payload.full_name = input.fullName
  if (input.emailConfirmedAt !== undefined) payload.auth_email_confirmed_at = input.emailConfirmedAt
  if (input.lastInviteSentAt !== undefined) payload.last_invite_sent_at = input.lastInviteSentAt
  if (input.lastPasswordResetSentAt !== undefined) payload.last_password_reset_sent_at = input.lastPasswordResetSentAt
  if (input.lastConfirmationEmailSentAt !== undefined) payload.last_confirmation_email_sent_at = input.lastConfirmationEmailSentAt
  if (input.lastAction !== undefined) {
    payload.last_auth_email_action = input.lastAction
    payload.last_auth_email_action_at = now
  }

  const { error } = await supabaseService.from('user_profiles').upsert(payload, {
    onConflict: 'id',
  })

  if (!error) return

  if (error.code === '23514' && 'last_auth_email_action' in payload) {
    delete payload.last_auth_email_action
    delete payload.last_auth_email_action_at

    const retry = await supabaseService.from('user_profiles').upsert(payload, {
      onConflict: 'id',
    })

    if (!retry.error || isIgnorableSchemaError(retry.error)) return
    throw retry.error
  }

  if (!isIgnorableSchemaError(error)) throw error
}

export async function sendPasswordResetEmailForKnownUser(input: {
  email: string
  actorUserId?: string | null
  source?: string
}) {
  const email = normalizeEmail(input.email)
  const user = await findAuthUserByEmail(email)

  if (!user) {
    throw new Error('Den här e-postadressen finns inte som användare i Gridex.')
  }

  const sentAt = new Date().toISOString()
  await sendTenantBrandedPasswordResetEmail({
    email,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? 'admin_password_reset',
  })

  await upsertAuthUserProfile({
    userId: user.id,
    email,
    lastPasswordResetSentAt: sentAt,
    lastAction: 'password_reset_sent',
  })

  return user
}

export async function sendConfirmationEmailForKnownUser(input: {
  email: string
  actorUserId?: string | null
  source?: string
}) {
  const email = normalizeEmail(input.email)
  const user = await findAuthUserByEmail(email)

  if (!user) {
    throw new Error('Den här e-postadressen finns inte som användare i Gridex.')
  }

  if (user.email_confirmed_at) {
    throw new Error('Användarens e-post är redan bekräftad.')
  }

  const sentAt = new Date().toISOString()
  const { error } = await supabaseService.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: buildAuthCallbackRedirect('/login'),
    },
  })

  if (error) throw error

  await upsertAuthUserProfile({
    userId: user.id,
    email,
    lastConfirmationEmailSentAt: sentAt,
    lastAction: 'confirmation_sent',
  })

  await recordAuthEmailEvent({
    userId: user.id,
    email,
    eventType: 'confirmation_sent',
    status: 'sent',
    source: input.source ?? 'confirmation',
    actorUserId: input.actorUserId ?? null,
  })

  return user
}

export async function syncVerifiedAuthEmailAction(input: {
  user: User
  type: AuthEmailActionType
  nextPath: string
}) {
  const email = normalizeEmail(input.user.email)
  if (!email) return

  const confirmedAt = input.user.email_confirmed_at ?? new Date().toISOString()

  await upsertAuthUserProfile({
    userId: input.user.id,
    email,
    emailConfirmedAt: confirmedAt,
    lastAction: `verified_${input.type}`,
  })

  await recordAuthEmailEvent({
    userId: input.user.id,
    email,
    eventType: 'email_action_verified',
    status: 'verified',
    source: 'auth_action',
    metadata: {
      type: input.type,
      nextPath: input.nextPath,
    },
  })

}

export function toSupabaseEmailOtpType(type: AuthEmailActionType): EmailOtpType {
  return type as EmailOtpType
}
