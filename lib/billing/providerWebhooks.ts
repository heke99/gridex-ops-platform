import { createHmac, timingSafeEqual } from 'node:crypto'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'
import { processPendingInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'

type JsonRecord = Record<string, unknown>

export type BillingProviderWebhookResult = {
  provider: string
  eventId: string
  environment: 'test' | 'production'
  eventType: string
  signatureValid: true
  duplicate: boolean
  status: 'received'
}

export class BillingProviderWebhookAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingProviderWebhookAuthError'
  }
}

/**
 * Non-retryable request/routing failure. Mapped to a 4xx response so providers
 * stop retrying payloads that can never succeed (instead of a 500 retry loop).
 */
export class BillingProviderWebhookRequestError extends Error {
  readonly status: 400 | 404 | 413 | 422
  readonly code: string
  constructor(status: 400 | 404 | 413 | 422, code: string, message: string) {
    super(message)
    this.name = 'BillingProviderWebhookRequestError'
    this.status = status
    this.code = code
  }
}

function badRequest(message: string): BillingProviderWebhookRequestError {
  return new BillingProviderWebhookRequestError(400, 'billing_webhook_invalid_payload', message)
}

function normalizedProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!normalized) throw badRequest('Provider saknas.')
  return normalized
}

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function eventType(payload: JsonRecord): string {
  return text(payload.event_type) ?? text(payload.eventType) ?? text(payload.type) ?? text(payload.status) ?? 'billing.webhook.received'
}

function eventId(payload: JsonRecord): string {
  const id = text(payload.id) ?? text(payload.event_id) ?? text(payload.eventId) ?? text(payload.webhook_id)
  if (!id) throw badRequest('Providerwebhooken saknar stabilt event-ID.')
  if (id.length > 250) throw badRequest('Providerwebhookens event-ID är för långt.')
  return id
}

function invoiceGuid(payload: JsonRecord): string {
  const guid = text(payload.invoiceGuid) ?? text(payload.invoice_guid) ?? text(payload.provider_invoice_guid) ?? text(object(payload.invoice).invoiceGuid)
  if (!guid) throw badRequest('Providerwebhooken saknar invoiceGuid.')
  return guid
}

function timestampSeconds(headers: Headers): number {
  const raw = headers.get('x-gridex-timestamp') ?? headers.get('x-capway-timestamp') ?? headers.get('x-timestamp')
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new BillingProviderWebhookAuthError('Providerwebhooken saknar giltig signaturtimestamp.')
  const now = Math.floor(Date.now() / 1_000)
  if (Math.abs(now - value) > 300) throw new BillingProviderWebhookAuthError('Providerwebhookens signaturtimestamp ligger utanför replayfönstret.')
  return value
}

function signatureHex(signature: string | null): string {
  const provided = signature?.replace(/^sha256=/i, '').trim() ?? ''
  if (!/^[a-f0-9]{64}$/i.test(provided)) throw new BillingProviderWebhookAuthError('Providerwebhookens signaturformat är ogiltigt.')
  return provided
}

function verifySignature(input: { body: string; signature: string; timestamp: number; secret: string }): true {
  const provided = input.signature
  const expected = createHmac('sha256', input.secret).update(`${input.timestamp}.${input.body}`).digest('hex')
  const left = Buffer.from(expected, 'hex')
  const right = Buffer.from(provided, 'hex')
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new BillingProviderWebhookAuthError('Providerwebhookens signatur kunde inte verifieras.')
  return true
}

async function resolveTarget(input: { provider: string; invoiceGuid: string }) {
  const query = supabaseService
    .from('invoice_export_items')
    .select('id,company_id,environment,provider,provider_invoice_guid')
    .eq('provider', input.provider)
    .eq('provider_invoice_guid', input.invoiceGuid)
    .limit(3)
  const itemResult = await query
  if (itemResult.error) throw itemResult.error
  const items = (itemResult.data ?? []) as JsonRecord[]
  if (items.length === 0) {
    throw new BillingProviderWebhookRequestError(404, 'billing_webhook_unknown_invoice', 'Providerfakturan kan inte kopplas till exakt en tenant.')
  }
  if (items.length !== 1) {
    throw new BillingProviderWebhookRequestError(422, 'billing_webhook_unroutable', 'Providerfakturan matchar flera tenants.')
  }
  const item = items[0]
  const companyId = text(item.company_id)
  const itemId = text(item.id)
  const environment = text(item.environment)
  if (!companyId || !itemId || !['test', 'production'].includes(environment ?? '')) {
    throw new BillingProviderWebhookRequestError(422, 'billing_webhook_unroutable', 'Providerfakturan saknar entydig tenant eller miljö.')
  }

  const connectionResult = await supabaseService
    .from('billing_provider_connections')
    .select('id,company_id,provider,environment,status,settings,secret_reference')
    .eq('company_id', companyId)
    .eq('provider', input.provider)
    .eq('environment', environment)
    .eq('status', 'active')
    .limit(2)
  if (connectionResult.error) throw connectionResult.error
  const connections = (connectionResult.data ?? []) as JsonRecord[]
  if (connections.length !== 1) {
    throw new BillingProviderWebhookRequestError(422, 'billing_webhook_unroutable', 'Exakt en aktiv provideranslutning krävs för webhookens tenant och miljö.')
  }
  const connection = connections[0]
  const secretReference = object(connection.secret_reference)
  const envName = text(secretReference.webhook_secret_env)
  const secret = envName ? process.env[envName] : null
  if (!secret) {
    throw new BillingProviderWebhookRequestError(422, 'billing_webhook_unroutable', 'Tenantens provideranslutning saknar webhook-hemlighet.')
  }
  return {
    itemId,
    companyId,
    environment: environment as 'test' | 'production',
    connectionId: String(connection.id),
    secret,
  }
}

export async function receiveBillingProviderWebhook(input: {
  provider: string
  body: string
  headers: Headers
}): Promise<BillingProviderWebhookResult> {
  await assertPlatformSchemaReady()
  if (Buffer.byteLength(input.body, 'utf8') > 512_000) {
    throw new BillingProviderWebhookRequestError(413, 'billing_webhook_payload_too_large', 'Providerwebhookens payload är för stor.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input.body)
  } catch {
    throw badRequest('Providerwebhookens JSON är ogiltig.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw badRequest('Providerwebhookens payload måste vara ett objekt.')
  const payload = parsed as JsonRecord
  const provider = normalizedProvider(input.provider)
  const externalEventId = eventId(payload)
  const providerInvoiceGuid = invoiceGuid(payload)
  // Cheap, secret-independent checks (replay window, signature format) run
  // before any database lookup so unsigned noise never touches the database.
  const timestamp = timestampSeconds(input.headers)
  const signature = signatureHex(
    input.headers.get('x-gridex-signature') ?? input.headers.get('x-capway-signature') ?? input.headers.get('x-signature'),
  )
  // Tenant claims in headers or payload are intentionally ignored. The tenant is
  // resolved exclusively from the persisted provider invoice relation.
  const target = await resolveTarget({ provider, invoiceGuid: providerInvoiceGuid })
  verifySignature({
    body: input.body,
    signature,
    timestamp,
    secret: target.secret,
  })
  const normalizedEventType = eventType(payload)
  const idempotencyKey = `${provider}:${target.environment}:${externalEventId}`
  const now = new Date().toISOString()

  const webhookInsert = await supabaseService
    .from('billing_provider_webhook_events')
    .upsert({
      provider,
      company_id: target.companyId,
      environment: target.environment,
      billing_provider_connection_id: target.connectionId,
      external_event_id: externalEventId,
      idempotency_key: idempotencyKey,
      event_type: normalizedEventType,
      signature_valid: true,
      signature_timestamp: new Date(timestamp * 1_000).toISOString(),
      status: 'received',
      headers_snapshot: {
        'content-type': input.headers.get('content-type'),
        'user-agent': input.headers.get('user-agent'),
        'x-request-id': input.headers.get('x-request-id'),
      },
      payload,
      received_at: now,
    }, { onConflict: 'company_id,provider,environment,idempotency_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle()
  if (webhookInsert.error) throw webhookInsert.error

  const providerEvent = await supabaseService
    .from('invoice_provider_events')
    .upsert({
      company_id: target.companyId,
      provider,
      environment: target.environment,
      provider_event_id: externalEventId,
      provider_invoice_guid: providerInvoiceGuid,
      event_type: normalizedEventType,
      status: 'received',
      payload,
      matched_invoice_export_item_id: target.itemId,
      idempotency_hash: idempotencyKey,
      received_at: now,
    }, { onConflict: 'company_id,provider,environment,idempotency_hash', ignoreDuplicates: true })
    .select('id')
    .maybeSingle()
  if (providerEvent.error) throw providerEvent.error

  // Always drain 'received' events: a provider retry after a crash between the
  // insert and processing hits the duplicate path, and must still finish the work.
  await processPendingInvoiceProviderEvents({ companyId: target.companyId, limit: 25 })

  await emitDomainEvent({
    companyId: target.companyId,
    eventType: `billing.${provider}.${normalizedEventType}`.replace(/[^a-z0-9_.]/g, '_'),
    aggregateType: 'billing_provider_webhook',
    aggregateId: String(webhookInsert.data?.id ?? providerEvent.data?.id ?? externalEventId),
    source: `webhook:${provider}`,
    payload: { provider, environment: target.environment, event_id: externalEventId, invoice_guid: providerInvoiceGuid },
    idempotencyKey: `billing-provider-webhook:${idempotencyKey}`,
  })

  return {
    provider,
    eventId: externalEventId,
    environment: target.environment,
    eventType: normalizedEventType,
    signatureValid: true,
    duplicate: !webhookInsert.data && !providerEvent.data,
    status: 'received',
  }
}
