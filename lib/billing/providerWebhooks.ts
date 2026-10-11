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
 * Request/routing failure raised only for bodies that cannot be parsed, or
 * AFTER the signature was verified. 4xx (400/413) are permanent; 409/503 are
 * retryable so a provider redelivers a verified event that cannot be routed
 * yet (e.g. the webhook raced the persistence of provider_invoice_guid).
 * Unsigned/unverifiable requests never reach this class: they always get the
 * same BillingProviderWebhookAuthError (401) regardless of routing outcome.
 */
export class BillingProviderWebhookRequestError extends Error {
  readonly status: 400 | 409 | 413 | 503
  readonly code: string
  readonly retryable: boolean
  constructor(status: 400 | 409 | 413 | 503, code: string, message: string) {
    super(message)
    this.name = 'BillingProviderWebhookRequestError'
    this.status = status
    this.code = code
    this.retryable = status === 409 || status === 503
  }
}

const UNVERIFIED_MESSAGE = 'Providerwebhookens signatur kunde inte verifieras.'

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

function signatureMatches(input: { body: string; signature: string; timestamp: number; secret: string }): boolean {
  const expected = createHmac('sha256', input.secret).update(`${input.timestamp}.${input.body}`).digest('hex')
  const left = Buffer.from(expected, 'hex')
  const right = Buffer.from(input.signature, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function connectionSecret(connection: JsonRecord): string | null {
  const envName = text(object(connection.secret_reference).webhook_secret_env)
  const secret = envName ? process.env[envName] : null
  return secret || null
}

type ResolvedTarget = {
  itemId: string
  companyId: string
  environment: 'test' | 'production'
  connectionId: string
  secret: string
}

/**
 * Resolves the tenant target AND authenticates the request in one step, so the
 * routing outcome is never observable before a valid signature:
 *
 * - routable invoice + exactly one active connection with a secret: verify
 *   against that tenant secret only; mismatch -> uniform 401.
 * - anything else (unknown GUID, ambiguous GUID, missing connection/secret):
 *   the request is checked against every active connection secret of the
 *   provider. No match -> the same uniform 401. Match -> the event is genuine
 *   but cannot be routed yet, so a retryable 503 (409 for an ambiguous GUID)
 *   makes the provider redeliver instead of dropping it permanently.
 *
 * At most two indexed lookups run before verification (the per-tenant secret
 * design makes a pre-DB check impossible); their results are not reflected in
 * any unauthenticated response.
 */
async function resolveVerifiedTarget(input: {
  provider: string
  invoiceGuid: string
  body: string
  signature: string
  timestamp: number
}): Promise<ResolvedTarget> {
  const verify = (secret: string) => signatureMatches({ body: input.body, signature: input.signature, timestamp: input.timestamp, secret })
  const itemResult = await supabaseService
    .from('invoice_export_items')
    .select('id,company_id,environment,provider,provider_invoice_guid')
    .eq('provider', input.provider)
    .eq('provider_invoice_guid', input.invoiceGuid)
    .limit(3)
  if (itemResult.error) throw itemResult.error
  const items = (itemResult.data ?? []) as JsonRecord[]
  let unroutable: { status: 409 | 503; code: string; message: string } | null = null
  if (items.length === 0) {
    unroutable = { status: 503, code: 'billing_webhook_target_pending', message: 'Providerfakturan är ännu inte kopplad; försök igen senare.' }
  } else if (items.length !== 1) {
    unroutable = { status: 409, code: 'billing_webhook_ambiguous_target', message: 'Providerfakturan matchar flera mål; händelsen kräver avstämning.' }
  } else {
    const item = items[0]
    const companyId = text(item.company_id)
    const itemId = text(item.id)
    const environment = text(item.environment)
    if (companyId && itemId && (environment === 'test' || environment === 'production')) {
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
      const secret = connections.length === 1 ? connectionSecret(connections[0]) : null
      if (secret) {
        if (!verify(secret)) throw new BillingProviderWebhookAuthError(UNVERIFIED_MESSAGE)
        return { itemId, companyId, environment, connectionId: String(connections[0].id), secret }
      }
    }
    unroutable = { status: 503, code: 'billing_webhook_target_pending', message: 'Providerfakturans tenantanslutning är inte redo; försök igen senare.' }
  }

  // Unroutable: authenticate against any active connection of this provider
  // before revealing anything. Verified events are retried, never dropped.
  const providerConnections = await supabaseService
    .from('billing_provider_connections')
    .select('id,secret_reference')
    .eq('provider', input.provider)
    .eq('status', 'active')
    .limit(200)
  if (providerConnections.error) throw providerConnections.error
  const authentic = ((providerConnections.data ?? []) as JsonRecord[]).some((connection) => {
    const secret = connectionSecret(connection)
    return secret ? verify(secret) : false
  })
  if (!authentic) throw new BillingProviderWebhookAuthError(UNVERIFIED_MESSAGE)
  console.warn('[billing-webhook] verified event is not routable yet; provider will retry', {
    provider: input.provider,
    code: unroutable.code,
  })
  throw new BillingProviderWebhookRequestError(unroutable.status, unroutable.code, unroutable.message)
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
  const target = await resolveVerifiedTarget({ provider, invoiceGuid: providerInvoiceGuid, body: input.body, signature, timestamp })
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
