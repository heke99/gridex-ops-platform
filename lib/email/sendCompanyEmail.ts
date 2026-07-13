import { supabaseService } from '@/lib/supabase/service'
import { getEffectiveSender } from './companyEmailSettings'
import {
  createCommunicationLog,
  findCommunicationLogByIdempotencyKey,
  markCommunicationFailed,
  replaceCommunicationLog,
} from './communicationLogs'
import { getCompanyEmailTemplate } from './emailTemplates'
import { enqueueTenantEmail } from './emailOutbox'
import { renderEmailTemplate, type EmailTemplateVariables } from './templateRenderer'
import type { EmailAttachment } from './providers/types'

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
  idempotencyKey?: string | null
  legalOrCritical?: boolean
  metadata?: Record<string, unknown>
  delayMinutes?: number
  attachments?: EmailAttachment[]
}

function cleanError(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Utskicket kunde inte skickas. Kontrollera e-postinställningarna och försök igen.'
}

function defaultEmailIdempotencyKey(input: SendCompanyEmailInput) {
  const subject = input.customerId ?? input.to.toLowerCase()
  return [input.companyId, input.eventKey ?? 'manual_email', input.templateKey, subject, input.idempotencyKey ?? 'default']
    .map((part) => String(part).replace(/[:\s]+/g, '_'))
    .join(':')
}


function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function communicationTraceFields(input: SendCompanyEmailInput) {
  return {
    customerNumber: metadataString(input.metadata, 'customer_number'),
    externalCustomerId: metadataString(input.metadata, 'external_customer_id'),
    contractId: metadataString(input.metadata, 'contract_id'),
  }
}

function isLegalOrCritical(input: SendCompanyEmailInput) {
  if (input.legalOrCritical) return true
  return ['contract.confirmation_sent', 'contract.cooling_off_sent', 'switch.started', 'switch.confirmed', 'switch.action_required', 'customer.welcome_active']
    .includes(input.eventKey ?? input.templateKey)
}

async function communicationLogHasActiveOutbox(logId: string) {
  const { data, error } = await supabaseService
    .from('tenant_email_outbox')
    .select('id')
    .eq('communication_log_id', logId)
    .in('status', ['queued', 'processing', 'sent'])
    .limit(1)

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return false
    throw error
  }

  return Boolean(data?.length)
}

async function isEventRuleEnabled(companyId: string, eventKey: string | null | undefined, templateKey: string) {
  if (!eventKey || eventKey === 'test_email') return true

  const { data, error } = await supabaseService
    .from('email_event_rules')
    .select('enabled')
    .eq('company_id', companyId)
    .eq('event_key', eventKey)
    .eq('template_key', templateKey)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return true
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data
  return row ? row.enabled === true : true
}

export async function sendCompanyEmail(input: SendCompanyEmailInput) {
  const legalOrCritical = isLegalOrCritical(input)
  const traceFields = communicationTraceFields(input)
  const idempotencyKey = defaultEmailIdempotencyKey(input)
  const existingLog = await findCommunicationLogByIdempotencyKey(input.companyId, idempotencyKey)

  if (existingLog && ['sent', 'delivered'].includes(existingLog.status)) {
    return { ok: true, duplicate: true, log: existingLog, senderMode: existingLog.sender_mode ?? 'unknown' }
  }

  if (existingLog?.status === 'queued' && await communicationLogHasActiveOutbox(existingLog.id)) {
    return { ok: true, duplicate: true, log: existingLog, senderMode: existingLog.sender_mode ?? 'unknown' }
  }

  const reusableLog = existingLog && !['sent', 'delivered'].includes(existingLog.status) ? existingLog : null
  const writeLog = (payload: Parameters<typeof createCommunicationLog>[0]) => reusableLog
    ? replaceCommunicationLog(reusableLog.id, payload)
    : createCommunicationLog(payload)

  let sender: Awaited<ReturnType<typeof getEffectiveSender>>
  try {
    sender = await getEffectiveSender(input.companyId, { legalOrCritical, requireSendReady: true })
  } catch (error) {
    const message = cleanError(error)
    const log = await writeLog({
      companyId: input.companyId,
      customerId: input.customerId ?? null,
      siteId: input.siteId ?? null,
      meteringPointId: input.meteringPointId ?? null,
      eventKey: input.eventKey ?? null,
      templateKey: input.templateKey,
      recipientEmail: input.to,
      senderEmail: null,
      replyToEmail: null,
      subject: null,
      senderMode: 'missing_sender',
      status: 'failed',
      provider: 'resend',
      createdBy: input.createdBy ?? null,
      ...traceFields,
      errorMessage: message,
      idempotencyKey,
      metadata: {
        ...(input.metadata ?? {}),
        blocked_reason: 'missing_or_blocked_sender',
      },
    })
    return { ok: false, log, senderMode: 'missing_sender', error: message }
  }

  const allowed = await isEventRuleEnabled(input.companyId, input.eventKey, input.templateKey)

  if (!allowed) {
    const log = await writeLog({
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
      senderMode: sender.mode,
      fromName: sender.fromName ?? null,
      domainVerifiedAt: sender.domainVerifiedAt ?? null,
      status: 'cancelled',
      provider: 'resend',
      createdBy: input.createdBy ?? null,
      ...traceFields,
      errorMessage: 'Automatiskt utskick är avstängt.',
      idempotencyKey,
      metadata: {
        ...(input.metadata ?? {}),
        blocked_reason: 'email_event_rule_disabled',
      },
    })
    return { ok: false, skipped: true, log, senderMode: sender.mode }
  }

  const template = await getCompanyEmailTemplate(input.companyId, input.templateKey)
  if (!template) {
    const message = `E-postmallen ${input.templateKey} hittades inte eller är inaktiv.`
    const log = await writeLog({
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
      senderMode: sender.mode,
      fromName: sender.fromName ?? null,
      domainVerifiedAt: sender.domainVerifiedAt ?? null,
      status: 'failed',
      provider: 'resend',
      createdBy: input.createdBy ?? null,
      ...traceFields,
      errorMessage: message,
      idempotencyKey,
      metadata: {
        ...(input.metadata ?? {}),
        blocked_reason: 'missing_or_inactive_template',
      },
    })
    return { ok: false, log, senderMode: sender.mode, error: message }
  }

  const rendered = renderEmailTemplate(template, input.variables ?? {})
  const templateSnapshot = {
    template_id: template.id,
    template_key: template.template_key,
    template_name: template.name,
    subject: template.subject,
    body_html: template.body_html,
    body_text: template.body_text,
    language: template.language,
    updated_at: template.updated_at,
  }

  const log = await writeLog({
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
    senderMode: sender.mode,
    fromName: sender.fromName ?? null,
    domainVerifiedAt: sender.domainVerifiedAt ?? null,
    templateVersion: String(template.updated_at ?? template.created_at ?? ''),
    status: 'queued',
    provider: 'resend',
    createdBy: input.createdBy ?? null,
    ...traceFields,
    idempotencyKey,
    metadata: {
      ...(input.metadata ?? {}),
      idempotency_key: idempotencyKey,
      sender_snapshot: {
        from: sender.from,
        sender_email: sender.senderEmail,
        reply_to: sender.replyTo ?? null,
        mode: sender.mode,
        domain_verified_at: sender.domainVerifiedAt ?? null,
      },
      template_snapshot: templateSnapshot,
      rendered_snapshot: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
    },
  })
  // Queue the email for asynchronous delivery. This ensures that the
  // customer intake does not fail if the mail provider is unavailable. The
  // communication log remains in status `queued` until a background worker
  // updates it. Any errors encountered when enqueuing should cause the
  // function to fail so that the caller can handle them accordingly.
  try {
    await enqueueTenantEmail({
      companyId: input.companyId,
      customerId: input.customerId ?? null,
      communicationLogId: log.id,
      to: input.to,
      from: sender.from,
      replyTo: sender.replyTo ?? null,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      emailType: input.eventKey ?? input.templateKey,
      brandingSnapshot: {
        sender_mode: sender.mode,
        sender_email: sender.senderEmail,
        from_name: sender.fromName ?? null,
        domain_verified_at: sender.domainVerifiedAt ?? null,
      },
      requestId: null,
      traceId: null,
      delayMinutes: input.delayMinutes ?? 0,
      attachments: input.attachments ?? [],
    })
    // In this model we do not mark the communication as sent immediately.
    return { ok: true, log, senderMode: sender.mode }
  } catch (error) {
    console.warn('[email] enqueueTenantEmail failed', error)
    const message = cleanError(error)
    const failedLog = await markCommunicationFailed(log.id, message)
    return { ok: false, log: failedLog, senderMode: sender.mode, error: message }
  }
}
