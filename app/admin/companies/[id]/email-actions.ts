'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { seedDefaultCompanyEmailConfiguration } from '@/lib/email/bootstrap'
import { getEffectiveSender, upsertCompanyEmailSettings } from '@/lib/email/companyEmailSettings'
import { createCommunicationLog, markCommunicationFailed, markCommunicationSent } from '@/lib/email/communicationLogs'
import { checkDomainVerification, startDomainVerification } from '@/lib/email/domainVerification'
import { updateEmailEventRule } from '@/lib/email/emailEvents'
import { DEFAULT_EMAIL_TEMPLATES, resetEmailTemplateToDefault, upsertCompanyEmailTemplate } from '@/lib/email/emailTemplates'
import { getEmailProvider } from '@/lib/email/providers'
import { supabaseService } from '@/lib/supabase/service'

function text(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function email(value: FormDataEntryValue | null) {
  return text(value).toLowerCase()
}

function redirectBack(companyId: string, params: { success?: string; error?: string }) {
  const key = params.success ? 'success' : 'error'
  const message = params.success ?? params.error ?? ''
  redirect(`/admin/companies/${companyId}?${key}=${encodeURIComponent(message)}#email`)
}

function isValidEmail(value: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
}

function isRedirectError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  )
}

function isValidDomain(value: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)
}

function assertTemplateKey(value: string) {
  if (!DEFAULT_EMAIL_TEMPLATES.some((template) => template.template_key === value)) {
    throw new Error('Okänd e-postmall.')
  }
}

export async function saveCompanyEmailSettingsAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))

  try {
    if (!companyId) throw new Error('Bolag saknas.')

    const senderName = text(formData.get('sender_name'))
    const senderEmail = email(formData.get('sender_email'))
    const replyToEmail = email(formData.get('reply_to_email'))
    const supportEmail = email(formData.get('support_email'))
    const domain = text(formData.get('domain')).toLowerCase()

    if (!senderName) throw new Error('Avsändarnamn krävs.')
    if (senderEmail && !isValidEmail(senderEmail)) throw new Error('Avsändarmail har ogiltigt format.')
    if (replyToEmail && !isValidEmail(replyToEmail)) throw new Error('Reply-to har ogiltigt format.')
    if (supportEmail && !isValidEmail(supportEmail)) throw new Error('Supportmail har ogiltigt format.')
    if (domain && !isValidDomain(domain)) throw new Error('Domänen har ogiltigt format.')
    if (senderEmail && domain && !senderEmail.endsWith(`@${domain}`)) {
      throw new Error('Avsändarmail måste ligga på samma domän som domänverifieringen.')
    }

    await upsertCompanyEmailSettings(companyId, {
      senderName,
      senderEmail,
      replyToEmail,
      supportEmail,
      domain,
      isActive: true,
    })

    await supabaseService.from('audit_logs').insert({
      company_id: companyId,
      actor_user_id: admin.userId,
      action: 'SUPERADMIN_COMPANY_EMAIL_SETTINGS_SAVED',
      entity_type: 'company_email_settings',
      entity_id: companyId,
      new_values: { senderEmail, replyToEmail, supportEmail, domain },
    }).then(() => null)

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'E-postinställningarna sparades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'E-postinställningarna kunde inte sparas.' })
  }
}

export async function startCompanyDomainVerificationAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  try {
    if (!companyId) throw new Error('Bolag saknas.')
    await startDomainVerification(companyId)
    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Domänverifiering startades. Lägg in DNS-posterna hos domänleverantören.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Domänverifiering kunde inte startas.' })
  }
}

export async function checkCompanyDomainVerificationAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  try {
    if (!companyId) throw new Error('Bolag saknas.')
    await checkDomainVerification(companyId)
    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'DNS-status kontrollerades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: 'Domänen kunde inte verifieras ännu. Kontrollera att DNS-posterna är korrekt inlagda.' })
  }
}

export async function sendCompanyTestEmailAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const to = email(formData.get('to'))

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    if (!isValidEmail(to)) throw new Error('Ange en giltig mottagaradress.')

    const { data: company, error } = await supabaseService
      .from('companies')
      .select('name, support_email, primary_contact_email')
      .eq('id', companyId)
      .maybeSingle()
    if (error) throw error
    if (!company) throw new Error('Bolaget hittades inte.')

    const sender = await getEffectiveSender(companyId)
    const subject = `Testmail från ${String(company.name ?? 'Gridex')}`
    const html = '<p>Detta är ett testutskick från Gridex. Om du har fått detta fungerar e-postkonfigurationen.</p>'
    const log = await createCommunicationLog({
      companyId,
      recipientEmail: to,
      eventKey: 'test_email',
      templateKey: 'test_email',
      senderEmail: sender.senderEmail,
      replyToEmail: sender.replyTo ?? null,
      subject,
      senderMode: sender.mode,
      fromName: sender.fromName ?? null,
      domainVerifiedAt: sender.domainVerifiedAt ?? null,
      provider: 'resend',
      createdBy: admin.userId,
    })

    try {
      const result = await getEmailProvider().sendEmail({
        from: sender.from,
        to,
        replyTo: sender.replyTo,
        subject,
        html,
        text: 'Detta är ett testutskick från Gridex. Om du har fått detta fungerar e-postkonfigurationen.',
      })
      await markCommunicationSent(log.id, result.providerMessageId)
    } catch (error) {
      console.warn('[email] test email failed', error)
      await markCommunicationFailed(log.id, 'Utskicket kunde inte skickas. Kontrollera e-postinställningarna och försök igen.')
      throw new Error('Utskicket kunde inte skickas. Kontrollera e-postinställningarna och försök igen.')
    }

    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: sender.mode === 'verified_domain' ? 'Testmail skickades från bolagets verifierade avsändare.' : 'Testmail skickades via Gridex standardavsändare.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Utskicket kunde inte skickas. Kontrollera e-postinställningarna och försök igen.' })
  }
}

export async function updateEmailEventRuleAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const eventKey = text(formData.get('event_key'))

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    await updateEmailEventRule(companyId, eventKey, { enabled: formData.get('enabled') !== null })
    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Automatiskt utskick uppdaterades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Regeln kunde inte sparas.' })
  }
}

export async function updateEmailTemplateAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const templateKey = text(formData.get('template_key'))

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    assertTemplateKey(templateKey)
    await upsertCompanyEmailTemplate(companyId, templateKey, {
      subject: text(formData.get('subject')),
      bodyHtml: text(formData.get('body_html')),
      bodyText: text(formData.get('body_text')),
      isActive: formData.get('is_active') !== null,
    })
    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Mailmallen sparades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Mailmallen kunde inte sparas.' })
  }
}

export async function resetEmailTemplateAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  const templateKey = text(formData.get('template_key'))

  try {
    if (!companyId) throw new Error('Bolag saknas.')
    assertTemplateKey(templateKey)
    await resetEmailTemplateToDefault(companyId, templateKey)
    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Standardmallen återskapades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Standardmallen kunde inte återskapas.' })
  }
}

export async function seedDefaultCompanyEmailAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const companyId = text(formData.get('company_id'))
  try {
    if (!companyId) throw new Error('Bolag saknas.')
    await seedDefaultCompanyEmailConfiguration(companyId)
    revalidatePath(`/admin/companies/${companyId}`)
    redirectBack(companyId, { success: 'Standardmallar och utskicksregler skapades.' })
  } catch (error) {
    if (isRedirectError(error)) throw error
    redirectBack(companyId || 'unknown', { error: error instanceof Error ? error.message : 'Standardmallar kunde inte skapas.' })
  }
}
