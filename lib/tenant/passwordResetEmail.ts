import { supabaseService } from '@/lib/supabase/service'
import { getTenantEmailBranding, queueAndTrySendTenantEmail, renderTenantEmailLayout } from '@/lib/tenant/emailBranding'

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase()
}

function getBaseAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.SITE_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

function authCallbackRedirect() {
  return `${getBaseAppUrl()}/auth/callback?next=${encodeURIComponent('/login/update-password')}`
}

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && ['42P01', '42703', 'PGRST205'].includes(error.code ?? ''))
}

type PasswordResetUser = {
  id: string
  email?: string | null
}

export async function findAuthUserForTenantPasswordReset(emailInput: string): Promise<PasswordResetUser | null> {
  const email = normalizeEmail(emailInput)
  if (!email) return null

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseService.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error

    const users = data.users ?? []
    const match = users.find((user) => normalizeEmail(user.email) === email)
    if (match) return { id: match.id, email: match.email }
    if (users.length < 1000) return null
  }

  return null
}

async function getPreferredCompanyIdForUser(userId: string): Promise<string | null> {
  const profile = await supabaseService
    .from('user_profiles')
    .select('active_company_id')
    .eq('id', userId)
    .maybeSingle()

  if (!profile.error && typeof profile.data?.active_company_id === 'string') {
    const membership = await supabaseService
      .from('company_memberships')
      .select('company_id,status')
      .eq('company_id', profile.data.active_company_id)
      .eq('user_id', userId)
      .neq('status', 'removed')
      .maybeSingle()

    if (!membership.error && membership.data?.company_id) return String(membership.data.company_id)
  }

  const membership = await supabaseService
    .from('company_memberships')
    .select('company_id,status,created_at')
    .eq('user_id', userId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (membership.error) {
    if (isIgnorableSchemaError(membership.error)) return null
    throw membership.error
  }

  return typeof membership.data?.company_id === 'string' ? membership.data.company_id : null
}

async function generateRecoveryActionLink(email: string): Promise<string | null> {
  const admin = supabaseService.auth.admin as unknown as {
    generateLink?: (params: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> | null; error?: Error | null }>
  }

  if (typeof admin.generateLink !== 'function') return null

  const { data, error } = await admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: authCallbackRedirect() },
  })

  if (error) throw error

  const properties = data?.properties && typeof data.properties === 'object' ? data.properties as Record<string, unknown> : {}
  const actionLink = properties.action_link ?? properties.actionLink ?? data?.action_link
  return typeof actionLink === 'string' && actionLink.trim() ? actionLink : null
}

async function recordPasswordResetEvent(input: {
  userId: string
  email: string
  companyId: string | null
  status: 'sent' | 'failed'
  source: string
  actorUserId?: string | null
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseService.from('auth_email_events').insert({
    user_id: input.userId,
    email: input.email,
    event_type: 'password_reset_sent',
    status: input.status,
    source: input.source,
    actor_user_id: input.actorUserId ?? null,
    company_id: input.companyId,
    metadata: input.metadata ?? {},
  })

  if (error && !isIgnorableSchemaError(error)) throw error
}

export async function sendTenantBrandedPasswordResetEmail(input: {
  email: string
  actorUserId?: string | null
  source?: string
}): Promise<{ userId: string; companyId: string | null; branded: boolean; fallback: boolean }> {
  const email = normalizeEmail(input.email)
  const user = await findAuthUserForTenantPasswordReset(email)
  if (!user) throw new Error('Den här e-postadressen finns inte som användare.')

  const companyId = await getPreferredCompanyIdForUser(user.id)
  const actionLink = await generateRecoveryActionLink(email)

  if (companyId && actionLink) {
    const branding = await getTenantEmailBranding(companyId)
    const html = renderTenantEmailLayout({
      branding,
      title: 'Återställ ditt lösenord',
      intro: `Du får detta meddelande eftersom någon begärt lösenordsåterställning för ditt konto hos ${branding.displayName}.`,
      body: '<p>Klicka på knappen nedan för att välja ett nytt lösenord. Länken ska endast användas av dig.</p><p>Om du inte begärt detta kan du ignorera meddelandet.</p>',
      ctaLabel: 'Välj nytt lösenord',
      ctaUrl: actionLink,
    })

    await queueAndTrySendTenantEmail({
      companyId,
      emailType: 'password_reset',
      toEmail: email,
      subject: `${branding.displayName}: Återställ lösenord`,
      htmlBody: html,
      textBody: `Återställ lösenord: ${actionLink}`,
      redirectUrl: actionLink,
      actorUserId: input.actorUserId ?? null,
    })

    await recordPasswordResetEvent({
      userId: user.id,
      email,
      companyId,
      status: 'sent',
      source: input.source ?? 'tenant_password_reset',
      actorUserId: input.actorUserId ?? null,
      metadata: { branded: true },
    })

    await supabaseService.from('user_profiles').update({
      last_password_reset_sent_at: new Date().toISOString(),
      last_auth_email_action: 'password_reset_sent',
      last_auth_email_action_at: new Date().toISOString(),
    }).eq('id', user.id)

    return { userId: user.id, companyId, branded: true, fallback: false }
  }

  const { error } = await supabaseService.auth.resetPasswordForEmail(email, {
    redirectTo: authCallbackRedirect(),
  })
  if (error) throw error

  await recordPasswordResetEvent({
    userId: user.id,
    email,
    companyId,
    status: 'sent',
    source: input.source ?? 'password_reset_fallback',
    actorUserId: input.actorUserId ?? null,
    metadata: { branded: false, reason: companyId ? 'recovery_action_link_unavailable' : 'company_scope_missing' },
  })

  return { userId: user.id, companyId, branded: false, fallback: true }
}
