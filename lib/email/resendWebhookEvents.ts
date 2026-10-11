import { Resend, type WebhookEventPayload } from 'resend'
import { supabaseService } from '@/lib/supabase/service'
import {
  markCommunicationBounced,
  markCommunicationDelivered,
  markCommunicationComplained,
  markCommunicationFailed,
  markCommunicationSent,
  type CommunicationLog,
} from './communicationLogs'
import { emitCommunicationSentDomainEvents } from './emailDomainEvents'

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
  // True when the provider event was already stored AND fully processed; the
  // replay is acknowledged without re-applying anything.
  duplicate: boolean
}

export type ResendWebhookProcessingStage =
  | 'communication_log_lookup_failed'
  | 'manual_outbox_lookup_failed'
  | 'event_store_failed'
  | 'communication_status_failed'
  | 'manual_outbox_status_failed'
  | 'event_mark_processed_failed'

// Thrown when a verified event could not be fully processed. The route turns it
// into a 5xx so Resend retries; the stored-but-unprocessed event is then
// re-processed on the retry. Only the stage code is exposed to the caller.
export class ResendWebhookProcessingError extends Error {
  stage: ResendWebhookProcessingStage
  constructor(stage: ResendWebhookProcessingStage, cause: unknown) {
    super(stage, { cause })
    this.name = 'ResendWebhookProcessingError'
    this.stage = stage
  }
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

type StoredProviderEvent = { id: string; processed: boolean } | null

// Returns the stored provider event (if any) and whether it was fully
// processed. Pre-migration schemas without processed_at treat every stored
// event as processed (legacy at-most-once behaviour).
async function findStoredProviderEvent(providerEventId: string): Promise<StoredProviderEvent> {
  const { data, error } = await supabaseService
    .from('communication_log_events')
    .select('id,processed_at')
    .eq('provider', 'resend')
    .eq('provider_event_id', providerEventId)
    .maybeSingle()
  if (error) {
    if (!isMissingSchema(error)) throw error
    const legacy = await supabaseService
      .from('communication_log_events')
      .select('id')
      .eq('provider', 'resend')
      .eq('provider_event_id', providerEventId)
      .maybeSingle()
    if (legacy.error) throw legacy.error
    return legacy.data ? { id: String((legacy.data as { id: unknown }).id), processed: true } : null
  }
  if (!data) return null
  const row = data as { id: unknown; processed_at?: unknown }
  return { id: String(row.id), processed: Boolean(row.processed_at) }
}

async function storeProviderEvent(input: {
  event: WebhookEventPayload
  headers: ResendWebhookHeaders
  providerMessageId: string | null
  log: CommunicationLog | null
  // Fallback tenant when there is no communication_log (manual grid-owner email
  // matched only by provider_message_id in manual_email_outbox).
  fallbackCompanyId?: string | null
  existing: StoredProviderEvent
}): Promise<string | null> {
  const companyId = input.log?.company_id ?? input.fallbackCompanyId ?? null
  const logId = input.log?.id ?? null

  if (input.existing) {
    // Stored by an earlier, failed delivery attempt: refresh the links that
    // may have been unavailable then. Never overwrite existing links with null.
    if (companyId || logId) {
      const patch: Record<string, unknown> = {}
      if (companyId) patch.company_id = companyId
      if (logId) patch.communication_log_id = logId
      const { error } = await supabaseService
        .from('communication_log_events')
        .update(patch)
        .eq('id', input.existing.id)
      if (error) throw error
    }
    return input.existing.id
  }

  const { data, error } = await supabaseService
    .from('communication_log_events')
    .insert({
      company_id: companyId,
      communication_log_id: logId,
      provider: 'resend',
      provider_message_id: input.providerMessageId,
      provider_event_id: input.headers.id,
      event_type: input.event.type,
      event_payload: input.event,
      occurred_at: input.event.created_at,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code !== '23505') throw error
    // A concurrent delivery stored it first; continue processing idempotently.
    const raced = await findStoredProviderEvent(input.headers.id)
    return raced?.id ?? null
  }
  return data ? String((data as { id: unknown }).id) : null
}

async function markProviderEventProcessed(eventRowId: string | null) {
  if (!eventRowId) return
  const { error } = await supabaseService
    .from('communication_log_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', eventRowId)
  if (error && !isMissingSchema(error)) throw error
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
  let target: ManualDeliveryStatus

  switch (eventType) {
    case 'email.sent':
      target = 'sent'
      break
    case 'email.delivered':
      target = 'delivered'
      update.delivered_at = occurredAt
      break
    case 'email.delivery_delayed':
      target = 'delivery_delayed'
      break
    case 'email.bounced':
      target = 'bounced'
      update.bounced_at = occurredAt
      update.last_error_code = 'delivery_failed'
      update.last_error = eventErrorMessage(event)
      negativeDelivery = true
      break
    case 'email.complained':
      target = 'complained'
      update.complained_at = occurredAt
      update.last_error_code = 'recipient_complaint'
      update.last_error = eventErrorMessage(event)
      negativeDelivery = true
      break
    case 'email.failed':
    case 'email.suppressed':
      target = eventType === 'email.suppressed' ? 'suppressed' : 'failed'
      update.failed_at = occurredAt
      update.last_error_code = 'delivery_failed'
      update.last_error = eventErrorMessage(event)
      negativeDelivery = true
      break
    default:
      return row.id
  }
  update.delivery_status = target

  // Monotonic guard: only move forward from an allowed predecessor so an
  // out-of-order event never downgrades delivered/terminal state or clears an
  // error. NULL (never reported) is always an allowed predecessor.
  const result = await supabaseService
    .from('manual_email_outbox')
    .update(update)
    .eq('id', row.id)
    .or(`delivery_status.is.null,delivery_status.in.(${MANUAL_ALLOWED_PREDECESSORS[target].join(',')})`)
    .select('id')
  if (result.error) {
    if (isMissingSchema(result.error)) return row.id
    throw result.error
  }
  const transitioned = Array.isArray(result.data) && result.data.length > 0

  if (transitioned && negativeDelivery && row.request_id && row.company_id) {
    await flagRequestDeliveryFailed(row.company_id, row.request_id, eventErrorMessage(event))
  }

  return row.id
}

type ManualDeliveryStatus =
  | 'sent'
  | 'delivery_delayed'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'

const MANUAL_NON_TERMINAL: ManualDeliveryStatus[] = ['sent', 'delivery_delayed', 'delivered']
const MANUAL_ALLOWED_PREDECESSORS: Record<ManualDeliveryStatus, ManualDeliveryStatus[]> = {
  sent: ['sent'],
  delivery_delayed: ['sent', 'delivery_delayed'],
  delivered: ['sent', 'delivery_delayed', 'delivered'],
  bounced: [...MANUAL_NON_TERMINAL, 'bounced'],
  complained: [...MANUAL_NON_TERMINAL, 'complained'],
  failed: [...MANUAL_NON_TERMINAL, 'failed'],
  suppressed: [...MANUAL_NON_TERMINAL, 'suppressed'],
}

// A negative delivery event only reopens a request that is still waiting on
// this dispatch. A late bounce/complaint must never flip a completed, received
// or already reviewed request, nor overwrite the site's facility state.
const DELIVERY_FAILURE_FLAGGABLE_REQUEST_STATUSES = [
  'queued',
  'ready_to_send',
  'sent',
  'waiting_response',
  'ready_to_send_manual_email',
  'manual_email_queued',
  'manual_email_sent',
  'waiting_manual_response',
]

async function flagRequestDeliveryFailed(companyId: string, requestId: string, message: string | null) {
  const now = new Date().toISOString()
  const tenantMessage =
    'E-post till nätägaren kunde inte levereras. Kontrollera kontaktväg.'

  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,customer_site_id,metadata,status')
    .eq('company_id', companyId)
    .eq('id', requestId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return
    throw error
  }
  const request = (data as Record<string, unknown> | null) ?? null
  if (!request) return
  if (!DELIVERY_FAILURE_FLAGGABLE_REQUEST_STATUSES.includes(String(request.status ?? ''))) return

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
    .eq('company_id', companyId)
    .eq('id', requestId)
    .in('status', DELIVERY_FAILURE_FLAGGABLE_REQUEST_STATUSES)
    .select('id')
  if (update.error) {
    if (isMissingSchema(update.error)) return
    throw update.error
  }
  // Raced with a completion: the guard matched nothing, leave the site alone.
  if (!Array.isArray(update.data) || update.data.length === 0) return

  const siteId = typeof request.customer_site_id === 'string' ? request.customer_site_id : null
  if (siteId) {
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

async function stage<T>(name: ResendWebhookProcessingStage, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new ResendWebhookProcessingError(name, error)
  }
}

export async function processResendWebhookEvent(
  event: WebhookEventPayload,
  headers: ResendWebhookHeaders
): Promise<ProcessResult> {
  const eventType = String(event.type)
  const known = KNOWN_EVENT_TYPES.has(eventType)
  const providerMessageId = emailIdFromEvent(event)

  const existing = await stage('event_store_failed', () => findStoredProviderEvent(headers.id))
  if (existing?.processed) {
    return {
      ok: true,
      eventType,
      providerMessageId,
      matchedLogId: null,
      matchedManualOutboxId: null,
      tracked: false,
      known,
      duplicate: true,
    }
  }

  // Lookup failures must NOT store an unlinked event and answer 200 (the event
  // would be lost for good). They bubble up as a 5xx so Resend retries.
  const log = await stage('communication_log_lookup_failed', () => findCommunicationLog(providerMessageId))
  // Resolve the manual outbox row up-front so the stored provider event can be
  // attributed to a company even when there is no communication_log.
  const manualOutbox = await stage('manual_outbox_lookup_failed', () => findManualOutboxByProviderMessageId(providerMessageId))

  const eventRowId = await stage('event_store_failed', () => storeProviderEvent({
    event,
    headers,
    providerMessageId,
    log,
    fallbackCompanyId: manualOutbox?.company_id ?? null,
    existing,
  }))

  // Status application is idempotent (monotonic guards), so a retry after a
  // partial failure safely re-applies it. The processed marker is written last.
  let matchedManualOutboxId: string | null = null
  if (known) {
    await stage('communication_status_failed', () => applyCommunicationStatus(event, log))
    matchedManualOutboxId = await stage('manual_outbox_status_failed', () => applyManualOutboxStatus(event, manualOutbox))
  }
  await stage('event_mark_processed_failed', () => markProviderEventProcessed(eventRowId))

  return {
    ok: true,
    eventType,
    providerMessageId,
    matchedLogId: log?.id ?? null,
    matchedManualOutboxId,
    tracked: Boolean(log) || Boolean(matchedManualOutboxId),
    known,
    duplicate: false,
  }
}

export function getResendWebhookHeaders(headers: Headers): ResendWebhookHeaders | null {
  const id = headers.get('webhook-id') ?? headers.get('svix-id')
  const timestamp = headers.get('webhook-timestamp') ?? headers.get('svix-timestamp')
  const signature = headers.get('webhook-signature') ?? headers.get('svix-signature')

  if (!id || !timestamp || !signature) return null
  return { id, timestamp, signature }
}
