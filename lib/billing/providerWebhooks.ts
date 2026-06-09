import { createHmac, timingSafeEqual } from 'node:crypto'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'

export type BillingProviderWebhookResult = {
  provider: string
  eventId: string | null
  companyId: string | null
  eventType: string
  signatureValid: boolean | null
  duplicate: boolean
  status: 'received' | 'needs_review' | 'rejected'
}

function normalizedProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function providerSecret(provider: string): string | null {
  const key = `BILLING_WEBHOOK_SECRET_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  return process.env[key] ?? process.env.BILLING_WEBHOOK_SECRET_FALLBACK ?? null
}

function verifySignature(input: { provider: string; body: string; signature: string | null; timestamp?: string | null }): boolean | null {
  const secret = providerSecret(input.provider)
  if (!secret) return null
  if (!input.signature) return false

  const signedPayload = input.timestamp ? `${input.timestamp}.${input.body}` : input.body
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')
  const provided = input.signature.replace(/^sha256=/i, '').trim()
  try {
    const expectedBuffer = Buffer.from(expected, 'hex')
    const providedBuffer = Buffer.from(provided, 'hex')
    if (expectedBuffer.length !== providedBuffer.length) return false
    return timingSafeEqual(expectedBuffer, providedBuffer)
  } catch {
    return false
  }
}

function inferEventType(payload: Record<string, unknown>): string {
  return (
    stringValue(payload.event_type) ??
    stringValue(payload.eventType) ??
    stringValue(payload.type) ??
    stringValue(payload.status) ??
    'billing.webhook.received'
  )
}

function inferEventId(payload: Record<string, unknown>): string | null {
  return (
    stringValue(payload.id) ??
    stringValue(payload.event_id) ??
    stringValue(payload.eventId) ??
    stringValue(payload.webhook_id) ??
    null
  )
}

function inferCompanyId(payload: Record<string, unknown>, headers: Headers): string | null {
  return (
    headers.get('x-gridex-company-id') ??
    stringValue(payload.company_id) ??
    stringValue(payload.companyId) ??
    stringValue(isObject(payload.metadata) ? payload.metadata.company_id : null) ??
    null
  )
}

export async function receiveBillingProviderWebhook(input: {
  provider: string
  body: string
  headers: Headers
}): Promise<BillingProviderWebhookResult> {
  const provider = normalizedProvider(input.provider)
  let payload: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(input.body) as unknown
    payload = isObject(parsed) ? parsed : { raw: parsed }
  } catch {
    payload = { raw_text: input.body }
  }

  const signatureValid = verifySignature({
    provider,
    body: input.body,
    signature: input.headers.get('x-gridex-signature') ?? input.headers.get('x-capway-signature') ?? input.headers.get('x-signature'),
    timestamp: input.headers.get('x-gridex-timestamp') ?? input.headers.get('x-capway-timestamp') ?? input.headers.get('x-timestamp'),
  })

  const eventType = inferEventType(payload)
  const eventId = inferEventId(payload)
  const companyId = inferCompanyId(payload, input.headers)
  const idempotencyKey = input.headers.get('idempotency-key') ?? (eventId ? `${provider}:${eventId}` : null)
  const status: BillingProviderWebhookResult['status'] = signatureValid === false ? 'rejected' : companyId ? 'received' : 'needs_review'

  const row = {
    provider,
    company_id: companyId,
    external_event_id: eventId,
    idempotency_key: idempotencyKey,
    event_type: eventType,
    signature_valid: signatureValid,
    status,
    headers_snapshot: Object.fromEntries(input.headers.entries()),
    payload,
    received_at: new Date().toISOString(),
  }

  const mutation = idempotencyKey
    ? supabaseService
        .from('billing_provider_webhook_events')
        .upsert(row, { onConflict: 'provider,idempotency_key', ignoreDuplicates: true })
    : supabaseService
        .from('billing_provider_webhook_events')
        .insert(row)

  const { data, error } = await mutation.select('id').maybeSingle()

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error

  if (companyId && status !== 'rejected') {
    await emitDomainEvent({
      companyId,
      eventType: `billing.${provider}.${eventType}`.replace(/[^a-z0-9_.]/g, '_'),
      aggregateType: 'billing_provider_webhook',
      aggregateId: String(data?.id ?? eventId ?? idempotencyKey ?? Date.now()),
      source: `webhook:${provider}`,
      payload: { provider, event_id: eventId, status, payload },
      idempotencyKey: idempotencyKey ? `billing_provider_webhook:${provider}:${idempotencyKey}` : null,
    })
  }

  return {
    provider,
    eventId,
    companyId,
    eventType,
    signatureValid,
    duplicate: !data,
    status,
  }
}
