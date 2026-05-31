import { supabaseService } from '@/lib/supabase/service'
import { getBaseAppUrl } from '@/lib/auth/urls'
import { sendTransactionalEmail } from '@/lib/auth/smtpTransactionalEmail'

export type TenantEmailBranding = {
  companyId: string
  companyName: string
  displayName: string
  supportEmail: string | null
  billingEmail: string | null
  senderEmail: string | null
  customerPortalName: string
  customerPortalUrl: string
  primaryColor: string
  logoUrl: string | null
}

function readString(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isValidHex(value: string | null) {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value))
}

async function getVerifiedSenderProfile(companyId: string): Promise<{
  from_email: string
  reply_to_email: string | null
} | null> {
  const { data, error } = await supabaseService
    .from('tenant_email_sender_profiles')
    .select('from_email, reply_to_email')
    .eq('company_id', companyId)
    .eq('status', 'verified')
    .eq('is_default', true)
    .maybeSingle()

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return null
    throw error
  }

  return data as { from_email: string; reply_to_email: string | null } | null
}

export async function getTenantEmailBranding(companyId: string): Promise<TenantEmailBranding> {
  const [{ data, error }, senderProfile] = await Promise.all([
    supabaseService
    .from('companies')
    .select('id, name, support_email, billing_contact_email, primary_contact_email, website, branding')
    .eq('id', companyId)
    .maybeSingle(),
    getVerifiedSenderProfile(companyId),
  ])

  if (error) throw error
  if (!data) throw new Error('Bolaget hittades inte för e-postprofil.')

  const branding = (data.branding && typeof data.branding === 'object' && !Array.isArray(data.branding)
    ? data.branding
    : {}) as Record<string, unknown>

  const displayName = readString(branding, 'display_name') ?? data.name
  const supportEmail = readString(branding, 'support_email') ?? data.support_email ?? data.primary_contact_email ?? null
  const billingEmail = readString(branding, 'billing_email') ?? data.billing_contact_email ?? supportEmail
  const senderEmail = senderProfile?.from_email ?? readString(branding, 'sender_email') ?? supportEmail ?? null
  const customerPortalName = readString(branding, 'customer_portal_name') ?? displayName
  const primaryColorCandidate = readString(branding, 'primary_color')

  return {
    companyId: String(data.id),
    companyName: data.name,
    displayName,
    supportEmail: senderProfile?.reply_to_email ?? supportEmail,
    billingEmail,
    senderEmail,
    customerPortalName,
    customerPortalUrl: `${getBaseAppUrl()}/login`,
    primaryColor: isValidHex(primaryColorCandidate) ? primaryColorCandidate! : '#047857',
    logoUrl: readString(branding, 'logo_url'),
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderTenantEmailLayout(input: {
  branding: TenantEmailBranding
  title: string
  intro: string
  body: string
  ctaLabel?: string | null
  ctaUrl?: string | null
}) {
  const safeTitle = escapeHtml(input.title)
  const safeIntro = escapeHtml(input.intro)
  const htmlBody = input.body
  const color = input.branding.primaryColor
  const logo = input.branding.logoUrl
    ? `<img src="${escapeHtml(input.branding.logoUrl)}" alt="${escapeHtml(input.branding.displayName)}" style="max-height:44px;max-width:180px;margin-bottom:20px;" />`
    : `<div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:20px;">${escapeHtml(input.branding.displayName)}</div>`
  const cta = input.ctaUrl && input.ctaLabel
    ? `<p style="margin:28px 0;"><a href="${escapeHtml(input.ctaUrl)}" style="background:${color};color:#fff;text-decoration:none;padding:12px 18px;border-radius:14px;font-weight:700;display:inline-block;">${escapeHtml(input.ctaLabel)}</a></p>`
    : ''

  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
  <div style="max-width:680px;margin:0 auto;padding:32px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:24px;padding:28px;">
      ${logo}
      <h1 style="font-size:24px;line-height:1.25;margin:0 0 12px;">${safeTitle}</h1>
      <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px;">${safeIntro}</p>
      <div style="font-size:15px;line-height:1.7;color:#334155;">${htmlBody}</div>
      ${cta}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;" />
      <p style="font-size:12px;line-height:1.5;color:#64748b;margin:0;">Detta meddelande skickades av ${escapeHtml(input.branding.displayName)}. Support: ${escapeHtml(input.branding.supportEmail ?? 'kontakta bolaget')}</p>
    </div>
  </div>
  </body></html>`
}

export async function queueTenantEmail(input: {
  companyId: string
  customerId?: string | null
  customerCaseId?: string | null
  emailType: string
  toEmail: string
  subject: string
  htmlBody: string
  textBody?: string | null
  redirectUrl?: string | null
  actorUserId?: string | null
}) {
  const branding = await getTenantEmailBranding(input.companyId)
  const { data, error } = await supabaseService
    .from('tenant_email_outbox')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId ?? null,
      customer_case_id: input.customerCaseId ?? null,
      email_type: input.emailType,
      to_email: input.toEmail,
      from_email: branding.senderEmail,
      reply_to_email: branding.supportEmail,
      subject: input.subject,
      html_body: input.htmlBody,
      text_body: input.textBody ?? null,
      redirect_url: input.redirectUrl ?? null,
      branding_snapshot: branding,
      created_by: input.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as { id: string }
}

export async function sendTenantEmailNow(outboxId: string) {
  const { data, error } = await supabaseService
    .from('tenant_email_outbox')
    .select('*')
    .eq('id', outboxId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('E-postutskicket hittades inte.')

  try {
    const result = await sendTransactionalEmail({
      to: data.to_email,
      from: data.from_email ?? undefined,
      replyTo: data.reply_to_email ?? undefined,
      subject: data.subject,
      html: data.html_body,
      text: data.text_body ?? undefined,
    })

    await supabaseService
      .from('tenant_email_outbox')
      .update({
        status: 'sent',
        provider_message_id: typeof result.messageId === 'string' ? result.messageId : null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', outboxId)

    return { ok: true, messageId: result.messageId ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabaseService
      .from('tenant_email_outbox')
      .update({
        status: 'failed',
        failure_reason: message,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', outboxId)

    return { ok: false, error: message }
  }
}

export async function queueAndTrySendTenantEmail(input: Parameters<typeof queueTenantEmail>[0]) {
  const row = await queueTenantEmail(input)
  const result = await sendTenantEmailNow(row.id)
  return { outboxId: row.id, ...result }
}
