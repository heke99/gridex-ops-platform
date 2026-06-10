import { Resend, type WebhookEventPayload } from 'resend'
import { supabaseService } from '@/lib/supabase/service'
import {
  markCommunicationBounced,
  markCommunicationDelivered,
  markCommunicationComplained,
  markCommunicationFailed,
  type CommunicationLog,
} from './communicationLogs'

type ResendWebhookHeaders = {
  id: string
  timestamp: string
  signature: string
}

type ProcessResult = {
  ok: true
  eventType: string
  providerMessageId: string | null
  matchedLogId: string | null
  tracked: boolean
}

function readWebhookSecret() {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET saknas i servermiljön.')
  return secret
}

export function verifyResendWebhook(payload: string, headers: ResendWebhookHeaders): WebhookEventPayload {
  return new Resend().webhooks.verify({
    payload,
    headers,
    webhookSecret: readWebhookSecret(),
  })
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
      company_id: input.log?.company_id ?? null,
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

async function applyCommunicationStatus(event: WebhookEventPayload, log: CommunicationLog | null) {
  if (!log) return

  const occurredAt = event.created_at
  const eventType = String(event.type)

  if (eventType === 'email.sent') {
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

export async function processResendWebhookEvent(
  event: WebhookEventPayload,
  headers: ResendWebhookHeaders
): Promise<ProcessResult> {
  const providerMessageId = emailIdFromEvent(event)
  const log = await findCommunicationLog(providerMessageId)

  await storeProviderEvent({ event, headers, providerMessageId, log })
  await applyCommunicationStatus(event, log)

  return {
    ok: true,
    eventType: String(event.type),
    providerMessageId,
    matchedLogId: log?.id ?? null,
    tracked: Boolean(log),
  }
}

export function getResendWebhookHeaders(headers: Headers): ResendWebhookHeaders | null {
  const id = headers.get('webhook-id') ?? headers.get('svix-id')
  const timestamp = headers.get('webhook-timestamp') ?? headers.get('svix-timestamp')
  const signature = headers.get('webhook-signature') ?? headers.get('svix-signature')

  if (!id || !timestamp || !signature) return null
  return { id, timestamp, signature }
}
