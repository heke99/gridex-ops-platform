import { supabaseService } from '@/lib/supabase/service'
import { getEffectiveSender } from './companyEmailSettings'
import {
  createCommunicationLog,
  markCommunicationFailed,
  markCommunicationSent,
} from './communicationLogs'
import { getCompanyEmailTemplate } from './emailTemplates'
import { getEmailProvider } from './providers'
import { renderEmailTemplate, type EmailTemplateVariables } from './templateRenderer'

type SendCompanyEmailInput = {
  companyId: string
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  eventKey?: string | null
  templateKey: string
  to: string
  variables?: EmailTemplateVariables
  createdBy?: string | null
}

const CLEAN_FAILURE = 'Utskicket kunde inte skickas. Kontrollera e-postinställningarna och försök igen.'

async function isEventRuleEnabled(companyId: string, eventKey: string | null | undefined, templateKey: string) {
  if (!eventKey || eventKey === 'test_email') return true

  const { data, error } = await supabaseService
    .from('email_event_rules')
    .select('enabled')
    .eq('company_id', companyId)
    .eq('event_key', eventKey)
    .eq('template_key', templateKey)
    .maybeSingle()

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return true
    throw error
  }

  return data ? data.enabled === true : true
}

export async function sendCompanyEmail(input: SendCompanyEmailInput) {
  const sender = await getEffectiveSender(input.companyId)
  const allowed = await isEventRuleEnabled(input.companyId, input.eventKey, input.templateKey)

  if (!allowed) {
    const log = await createCommunicationLog({
      companyId: input.companyId,
      customerId: input.customerId ?? null,
      siteId: input.siteId ?? null,
      meteringPointId: input.meteringPointId ?? null,
      eventKey: input.eventKey ?? null,
      templateKey: input.templateKey,
      recipientEmail: input.to,
      senderEmail: sender.senderEmail,
      replyToEmail: sender.replyTo ?? null,
      subject: null,
      status: 'cancelled',
      provider: 'resend',
      createdBy: input.createdBy ?? null,
      errorMessage: 'Automatiskt utskick är avstängt.',
    })
    return { ok: false, skipped: true, log, senderMode: sender.mode }
  }

  const template = await getCompanyEmailTemplate(input.companyId, input.templateKey)
  if (!template) throw new Error('E-postmallen hittades inte eller är inaktiv.')

  const rendered = renderEmailTemplate(template, input.variables ?? {})
  const log = await createCommunicationLog({
    companyId: input.companyId,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    eventKey: input.eventKey ?? null,
    templateKey: input.templateKey,
    recipientEmail: input.to,
    senderEmail: sender.senderEmail,
    replyToEmail: sender.replyTo ?? null,
    subject: rendered.subject,
    status: 'queued',
    provider: 'resend',
    createdBy: input.createdBy ?? null,
  })

  try {
    const result = await getEmailProvider().sendEmail({
      from: sender.from,
      to: input.to,
      replyTo: sender.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    const sentLog = await markCommunicationSent(log.id, result.providerMessageId)
    return { ok: true, log: sentLog, senderMode: sender.mode }
  } catch (error) {
    console.warn('[email] sendCompanyEmail failed', error)
    const failedLog = await markCommunicationFailed(log.id, CLEAN_FAILURE)
    return { ok: false, log: failedLog, senderMode: sender.mode, error: CLEAN_FAILURE }
  }
}
