import { Resend, type WebhookEventPayload } from 'resend'
import { supabaseService } from '@/lib/supabase/service'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import {
  markCommunicationBounced,
  markCommunicationDelivered,
  markCommunicationComplained,
  markCommunicationFailed,
  markCommunicationSent,
  type CommunicationLog,
} from './communicationLogs'

type ResendWebhookHeaders = {
  id: string
  timestamp: string
  signature: string
}

export type ResendWebhookDiagnosticCode =
  | 'missing_secret'
  | 'missing_headers'
  | 'invalid_signature'
  | 'event_processing_failed'

export class ResendWebhookError extends Error {
  code: ResendWebhookDiagnosticCode
  constructor(code: ResendWebhookDiagnosticCode, message: string) {
    super(message)
    this.name = 'ResendWebhookError'
    this.code = code
  }
}

type ProcessResult = {
  ok: true
  eventType: string
  providerMessageId: string | null
  matchedLogId: string | null
  matchedManualOutboxId: string | null
  tracked: boolean
  known: boolean
  // Non-fatal post-processing problems are reported here, never surfaced as an
  // auth failure. The event is always stored once the signature is valid.
  processingWarning: string | null
}

const KNOWN_EVENT_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
  'email.opened',
  'email.clicked',
  'email.scheduled',
])

export function getResendWebhookSecret(): string | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  return typeof secret === 'string' && secret.trim() ? secret.trim() : null
}

// Verifies the raw request body against RESEND_WEBHOOK_SECRET. Throws a typed
// ResendWebhookError so the route can produce safe diagnostics that never leak
// the secret. The header shape { id, timestamp, signature } is what the Resend
// SDK expects (it maps to svix-id / svix-timestamp / svix-signature).
export function verifyResendWebhook(
  payload: string,
  headers: ResendWebhookHeaders,
  secret?: string,
): WebhookEventPayload {
  const webhookSecret = secret ?? getResendWebhookSecret()
  if (!webhookSecret) {
    throw new ResendWebhookError('missing_secret', 'RESEND_WEBHOOK_SECRET saknas i servermiljön.')
  }
  try {
    // The Resend SDK constructor requires an API key even though webhook
    // verification only needs the signing secret (svix). Without a key the SDK
    // throws "Missing API key" BEFORE checking the signature, which surfaces as
    // a misleading "invalid signature". Pass the real key when present, else a
    // verification-only placeholder.
    const apiKey = process.env.RESEND_API_KEY?.trim() || 'verification-only'
    return new Resend(apiKey).webhooks.verify({
      payload,
      headers,
      webhookSecret,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown'
    throw new ResendWebhookError('invalid_signature', `Webhook-signaturen kunde inte verifieras (${detail}).`)
  }
}

function emailIdFromEvent(event: WebhookEventPayload): string | null {
  const eventType = String(event.type)
  if (!eventType.startsWith('email.')) return null
  const data = event.data as { email_id?: unknown }
  return typeof data.email_id === 'string' && data.email_id.trim() ? data.email_id : null
}

function eventErrorMessage(event: WebhookEventPayload) {
  const eventType = String(event.type)
  const data = event.data as {
    bounce?: { message?: string | null }
    failed?: { reason?: string | null }
    suppressed?: { message?: string | null }
  }

  if (eventType === 'email.bounced') {
    return data.bounce?.message || 'E-post studsade hos mottagaren.'
  }

  if (eventType === 'email.failed') {
    return data.failed?.reason || 'Resend kunde inte leverera e-post.'
  }

  if (eventType === 'email.suppressed') {
    return data.suppressed?.message || 'Mottagaren är spärrad hos leverantören.'
  }

  if (eventType === 'email.complained') {
    return 'Mottagaren markerade e-postmeddelandet som skräppost/klagomål.'
  }

  return null
}

async function findCommunicationLog(providerMessageId: string | null): Promise<CommunicationLog | null> {
  if (!providerMessageId) return null

  const { data, error } = await supabaseService
    .from('communication_logs')
    .select('*')
    .eq('provider', 'resend')
    .eq('provider_message_id', providerMessageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as CommunicationLog | null
}

async function storeProviderEvent(input: {
  event: WebhookEventPayload
  headers: ResendWebhookHeaders
  providerMessageId: string | null
  log: CommunicationLog | null
  // Fallback tenant when there is no communication_log (manual grid-owner email
  // matched only by provider_message_id in manual_email_outbox).
  fallbackCompanyId?: string | null
}) {
  const { data: existing, error: existingError } = await supabaseService
    .from('communication_log_events')
    .select('id')
    .eq('provider', 'resend')
    .eq('provider_event_id', input.headers.id)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return

  const { error } = await supabaseService
    .from('communication_log_events')
    .insert({
      company_id: input.log?.company_id ?? input.fallbackCompanyId ?? null,
      communication_log_id: input.log?.id ?? null,
      provider: 'resend',
      provider_message_id: input.providerMessageId,
      provider_event_id: input.headers.id,
      event_type: input.event.type,
      event_payload: input.event,
      occurred_at: input.event.created_at,
    })

  if (error && error.code !== '23505') throw error
}

async function emitCommunicationSentDomainEvents(log: CommunicationLog) {
  const emittedTypes = log.event_key === 'contract.application_received'
    ? ['contract.confirmation_sent', 'contract.cooling_off_sent']
    : []

  for (const eventType of emittedTypes) {
    await emitDomainEvent({
      companyId: log.company_id,
      eventType,
      aggregateType: log.contract_id ? 'customer_contract' : 'communication_log',
      aggregateId: log.contract_id ?? (typeof log.metadata?.contract_id === 'string' ? log.metadata.contract_id : null) ?? log.id,
      subjectCustomerId: log.customer_id,
      source: 'email_provider_webhook',
      idempotencyKey: `communication:${eventType}:${log.id}`,
      payload: {
        communication_log_id: log.id,
        customer_number: log.customer_number ?? (typeof log.metadata?.customer_number === 'string' ? log.metadata.customer_number : null),
        external_customer_id: log.external_customer_id ?? (typeof log.metadata?.external_customer_id === 'string' ? log.metadata.external_customer_id : null),
        contract_id: log.contract_id ?? (typeof log.metadata?.contract_id === 'string' ? log.metadata.contract_id : null),
        provider: log.provider,
        provider_message_id: log.provider_message_id,
        event_key: log.event_key,
        template_key: log.template_key,
      },
    }).catch((error) => console.warn('[email] domain event after sent mail skipped', error))
  }
}

async function applyCommunicationStatus(event: WebhookEventPayload, log: CommunicationLog | null) {
  if (!log) return

  const occurredAt = event.created_at
  const eventType = String(event.type)

  if (eventType === 'email.sent') {
    const sentLog = log.provider_message_id ? await markCommunicationSent(log.id, log.provider_message_id) : log
    await emitCommunicationSentDomainEvents(sentLog)
    return
  }

  if (eventType === 'email.delivered') {
    await markCommunicationDelivered(log.id, occurredAt)
    return
  }

  if (eventType === 'email.bounced') {
    await markCommunicationBounced(log.id, eventErrorMessage(event) ?? 'E-post studsade hos mottagaren.', occurredAt)
    return
  }

  if (eventType === 'email.complained') {
    await markCommunicationComplained(log.id, eventErrorMessage(event) ?? 'Mottagaren markerade e-postmeddelandet som klagomål.', occurredAt)
    return
  }

  if (eventType === 'email.failed' || eventType === 'email.suppressed') {
    await markCommunicationFailed(log.id, eventErrorMessage(event) ?? 'Resend kunde inte leverera e-post.')
  }
}

type ManualOutboxRow = {
  id: string
  company_id: string | null
  request_id: string | null
  status: string | null
}

// Looks up the manual_email_outbox row for a provider message id. Tolerant of
// missing schema so the webhook never fails in older environments.
async function findManualOutboxByProviderMessageId(
  providerMessageId: string | null,
): Promise<ManualOutboxRow | null> {
  if (!providerMessageId) return null
  const { data, error } = await supabaseService
    .from('manual_email_outbox')
    .select('id,company_id,request_id,status')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data as ManualOutboxRow | null) ?? null
}

// Maps a Resend email event to a manual_email_outbox delivery status update and
// (on negative delivery) flags the linked grid-owner information request for
// review so the tenant knows the contact path must be checked.
async function applyManualOutboxStatus(
  event: WebhookEventPayload,
  row: ManualOutboxRow | null,
): Promise<string | null> {
  if (!row) return null

  const eventType = String(event.type)
  const occurredAt = event.created_at ?? new Date().toISOString()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let negativeDelivery = false

  switch (eventType) {
    case 'email.sent':
      update.delivery_status = 'sent'
      break
    case 'email.delivered':
      update.delivery_status = 'delivered'
      update.delivered_at = occurredAt
      break
    case 'email.delivery_delayed':
      update.delivery_status = 'delivery_delayed'
      break
    case 'email.bounced':
      update.delivery_status = 'bounced'
      update.bounced_at = occurredAt
      update.last_error_code = 'delivery_failed'
      update.last_error = eventErrorMessage(event)
      negativeDelivery = true
      break
    case 'email.complained':
      update.delivery_status = 'complained'
      update.complained_at = occurredAt
      update.last_error_code = 'recipient_complaint'
      update.last_error = eventErrorMessage(event)
      negativeDelivery = true
      break
    case 'email.failed':
    case 'email.suppressed':
      update.delivery_status = eventType === 'email.suppressed' ? 'suppressed' : 'failed'
      update.failed_at = occurredAt
      update.last_error_code = 'delivery_failed'
      update.last_error = eventErrorMessage(event)
      negativeDelivery = true
      break
    default:
      return row.id
  }

  const result = await supabaseService.from('manual_email_outbox').update(update).eq('id', row.id)
  if (result.error && !isMissingSchema(result.error)) throw result.error

  if (negativeDelivery && row.request_id) {
    await flagRequestDeliveryFailed(row.request_id, eventErrorMessage(event))
  }

  return row.id
}

async function flagRequestDeliveryFailed(requestId: string, message: string | null) {
  const now = new Date().toISOString()
  const tenantMessage =
    'E-post till nätägaren kunde inte levereras. Kontrollera kontaktväg.'

  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,customer_site_id,metadata')
    .eq('id', requestId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return
    throw error
  }
  const request = (data as Record<string, unknown> | null) ?? null
  if (!request) return

  const baseMetadata =
    request.metadata && typeof request.metadata === 'object' && !Array.isArray(request.metadata)
      ? (request.metadata as Record<string, unknown>)
      : {}

  const update = await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'needs_review',
      dispatch_status: 'failed',
      last_error_code: 'delivery_failed',
      last_error_message: message ?? tenantMessage,
      metadata: { ...baseMetadata, delivery_failed: true },
      updated_at: now,
    })
    .eq('id', requestId)
  if (update.error && !isMissingSchema(update.error)) throw update.error

  const siteId = typeof request.customer_site_id === 'string' ? request.customer_site_id : null
  const companyId = typeof request.company_id === 'string' ? request.company_id : null
  if (siteId && companyId) {
    await supabaseService
      .from('customer_sites')
      .update({ facility_data_status: 'needs_review', next_action: tenantMessage, updated_at: now })
      .eq('company_id', companyId)
      .eq('id', siteId)
      .then(() => undefined, () => undefined)
  }
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

export async function processResendWebhookEvent(
  event: WebhookEventPayload,
  headers: ResendWebhookHeaders
): Promise<ProcessResult> {
  const eventType = String(event.type)
  const known = KNOWN_EVENT_TYPES.has(eventType)
  const providerMessageId = emailIdFromEvent(event)

  let log: CommunicationLog | null = null
  let processingWarning: string | null = null

  try {
    log = await findCommunicationLog(providerMessageId)
  } catch (error) {
    processingWarning = `communication_log_lookup_failed: ${error instanceof Error ? error.message : 'unknown'}`
  }

  // Resolve the manual outbox row up-front so the stored provider event can be
  // attributed to a company even when there is no communication_log.
  let manualOutbox: ManualOutboxRow | null = null
  try {
    manualOutbox = await findManualOutboxByProviderMessageId(providerMessageId)
  } catch (error) {
    processingWarning = `manual_outbox_lookup_failed: ${error instanceof Error ? error.message : 'unknown'}`
  }

  // Always store the provider event idempotently first, even for unknown event
  // types. Storage failure is the only thing that should bubble up.
  await storeProviderEvent({
    event,
    headers,
    providerMessageId,
    log,
    fallbackCompanyId: manualOutbox?.company_id ?? null,
  })

  // Post-processing (status application) must never turn a valid, stored event
  // into an error response. Collect warnings instead.
  let matchedManualOutboxId: string | null = null
  if (known) {
    try {
      await applyCommunicationStatus(event, log)
    } catch (error) {
      processingWarning = `communication_status_failed: ${error instanceof Error ? error.message : 'unknown'}`
    }
    try {
      matchedManualOutboxId = await applyManualOutboxStatus(event, manualOutbox)
    } catch (error) {
      processingWarning = `manual_outbox_status_failed: ${error instanceof Error ? error.message : 'unknown'}`
    }
  }

  return {
    ok: true,
    eventType,
    providerMessageId,
    matchedLogId: log?.id ?? null,
    matchedManualOutboxId,
    tracked: Boolean(log) || Boolean(matchedManualOutboxId),
    known,
    processingWarning,
  }
}

export function getResendWebhookHeaders(headers: Headers): ResendWebhookHeaders | null {
  const id = headers.get('webhook-id') ?? headers.get('svix-id')
  const timestamp = headers.get('webhook-timestamp') ?? headers.get('svix-timestamp')
  const signature = headers.get('webhook-signature') ?? headers.get('svix-signature')

  if (!id || !timestamp || !signature) return null
  return { id, timestamp, signature }
}
