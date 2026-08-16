import { createHash, createHmac } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'
import type { DomainEventRow } from '@/lib/events/domainEvents'
import { loadExternalTenantReference } from '@/lib/integrations/tenantContext'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import { postPublicWebhook } from '@/lib/integrations/publicWebhookTransport'
import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'

type WebhookSubscriptionRow = {
  id: string
  company_id: string
  api_client_id?: string | null
  name: string
  endpoint_url: string
  event_types: string[]
  status: string
  custom_headers: Record<string, unknown>
  timeout_ms: number
  max_attempts: number
  signing_secret_ref: string | null
  failure_count?: number | null
  metadata?: Record<string, unknown> | null
}

type WebhookDeliveryRow = {
  id: string
  company_id: string
  webhook_subscription_id: string
  domain_event_id: string
  event_type: string
  status: string
  attempts: number
  max_attempts: number
  payload: Record<string, unknown>
  target_url?: string | null
  locked_at?: string | null
  locked_by?: string | null
  delivery_uncertain_at?: string | null
  public_delivery_id?: string | null
  request_body_hash?: string | null
}

type EnqueueOptions = {
  subscriptionIds?: string[]
  force?: boolean
  strict?: boolean
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: unknown } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205', 'PGRST204', '42P10'].includes(code) || /schema cache|does not exist|column .* does not exist|no unique or exclusion constraint/i.test(String(message))
}

function eventMatchesSubscription(eventType: string, subscriptionTypes: string[]): boolean {
  return subscriptionTypes.includes('*') || subscriptionTypes.includes(eventType)
}

function signingSecret(subscription: WebhookSubscriptionRow): string | null {
  const byRef = subscription.signing_secret_ref
    ? process.env[`WEBHOOK_SIGNING_SECRET_${subscription.signing_secret_ref}`]
    : null
  return byRef ?? null
}

function eventEnvironment(data: Record<string, unknown>): 'test' | 'production' | null {
  const value = String(data.environment ?? '').trim().toLowerCase()
  return value === 'test' || value === 'production' ? value : null
}

function opaqueReference(
  prefix: string,
  tenantReference: string,
  internalId: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantReference}:${prefix}:${internalId}`)
    .digest('hex')
    .slice(0, 32)
  return `${prefix}_${digest}`
}

function publicText(
  data: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

type WebhookEventProjection = {
  dataKeys: readonly string[]
}

export const WEBHOOK_EVENT_REGISTRY: Readonly<Record<string, WebhookEventProjection>> = Object.freeze({
  'contracts.publication.changed': { dataKeys: ['channel', 'publication_revision', 'reason', 'tenant_reference', 'timestamp'] },
  'contract.closed': { dataKeys: ['contract_reference', 'offer_reference', 'reason'] },
  'contract.application_received': { dataKeys: ['application_number', 'status', 'offer_reference'] },
  'contract.created': { dataKeys: ['contract_reference', 'application_number', 'offer_reference', 'status'] },
  'contract.status_changed': { dataKeys: ['contract_reference', 'status', 'previous_status', 'offer_reference'] },
  'customer.created': { dataKeys: ['customer_reference', 'customer_number', 'status'] },
  'customer.updated': { dataKeys: ['customer_reference', 'customer_number', 'status'] },
  'site.created': { dataKeys: ['site_reference', 'status', 'data_quality_status'] },
  'site.updated': { dataKeys: ['site_reference', 'status', 'data_quality_status'] },
  'power_of_attorney.created': { dataKeys: ['power_of_attorney_reference', 'status', 'scope'] },
  'customer_application.accepted': { dataKeys: ['application_number', 'status'] },
  'customer_application.needs_information': { dataKeys: ['application_number', 'status', 'reason'] },
  'customer_application.status_changed': { dataKeys: ['application_number', 'status', 'previous_status'] },
  'invoice.created': { dataKeys: ['invoice_reference', 'invoice_number', 'status', 'due_date'] },
  'invoice.updated': { dataKeys: ['invoice_reference', 'invoice_number', 'status', 'due_date'] },
  'invoice.sent': { dataKeys: ['invoice_reference', 'invoice_number', 'status'] },
  'metering_values.updated': { dataKeys: ['facility_reference', 'period_start', 'period_end', 'resolution'] },
  'quote.created': { dataKeys: ['quote_reference', 'offer_reference', 'price_area', 'expires_at'] },
  'quote.validated': { dataKeys: ['quote_reference', 'offer_reference', 'valid'] },
  'supplier_switch.status_changed': { dataKeys: ['application_number', 'status', 'previous_status'] },
  'webhook.test': { dataKeys: ['message', 'test_reference'] },
})

function projectWebhookData(eventType: string, source: Record<string, unknown>): Record<string, unknown> {
  const projection = WEBHOOK_EVENT_REGISTRY[eventType]
  if (!projection) throw new Error(`webhook_event_type_not_registered:${eventType}`)
  const data = Object.fromEntries(
    projection.dataKeys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  )
  assertPublicResponsePayload(data)
  return data
}

function aggregateReference(
  event: DomainEventRow,
  data: Record<string, unknown>,
  tenantReference: string,
): string {
  return (
    publicText(
      data,
      `${event.aggregate_type}_reference`,
      'contract_reference',
      'application_number',
      'offer_reference',
      'quote_reference',
      'site_reference',
      'invoice_reference',
      'document_reference',
      'event_reference',
    ) ??
    opaqueReference(
      event.aggregate_type.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
      tenantReference,
      event.aggregate_id,
    )
  )
}

export function buildPublicWebhookPayload(
  event: DomainEventRow,
  tenantReference: string,
) {
  const sourceData = event.payload ?? {}
  const data = projectWebhookData(event.event_type, sourceData)
  const customerNumber = publicText(sourceData, 'customer_number')
  const externalCustomerReference = publicText(
    sourceData,
    'customer_reference',
    'external_customer_id',
  )
  const customerReference =
    externalCustomerReference ??
    (event.subject_customer_id
      ? opaqueReference(
          'customer',
          tenantReference,
          event.subject_customer_id,
        )
      : null)

  return {
    event_id: opaqueReference('event', tenantReference, event.id),
    event_type: event.event_type,
    created_at: event.occurred_at,
    tenant_reference: tenantReference,
    environment: eventEnvironment(sourceData),
    aggregate: {
      type: event.aggregate_type,
      reference: aggregateReference(event, sourceData, tenantReference),
    },
    ...(customerReference || customerNumber
      ? {
          customer: {
            customer_reference: customerReference,
            customer_number: customerNumber,
          },
        }
      : {}),
    data,
    contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION,
  }
}

function signedHeaders(
  subscription: WebhookSubscriptionRow,
  delivery: WebhookDeliveryRow,
  publicPayload: Record<string, unknown>,
  publicDeliveryId: string,
  body: string,
  secret: string,
) {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': 'Gridex-Webhooks/1.0',
    'x-gridex-event-id': String(publicPayload.event_id),
    'x-gridex-event-type': delivery.event_type,
    'x-gridex-delivery-id': publicDeliveryId,
  })

  const deliveryEnvironment = publicPayload.environment
  if (deliveryEnvironment === 'test' || deliveryEnvironment === 'production') {
    headers.set('x-gridex-environment', deliveryEnvironment)
  }

  for (const [key, value] of Object.entries(subscription.custom_headers ?? {})) {
    if (typeof value === 'string' && key.toLowerCase() !== 'authorization') headers.set(key, value)
  }

  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  headers.set('x-gridex-timestamp', timestamp)
  headers.set('x-gridex-signature', `sha256=${signature}`)
  // Legacy headers are kept during transition for already connected receivers.
  headers.set('x-gridex-webhook-timestamp', timestamp)
  headers.set('x-gridex-webhook-signature', `sha256=${signature}`)

  return headers
}

function isCanonicalStoredPayload(
  payload: Record<string, unknown>,
): boolean {
  const aggregate =
    payload.aggregate &&
    typeof payload.aggregate === 'object' &&
    !Array.isArray(payload.aggregate)
      ? (payload.aggregate as Record<string, unknown>)
      : null
  return (
    typeof payload.event_id === 'string' &&
    payload.event_id.startsWith('event_') &&
    typeof payload.event_type === 'string' &&
    typeof payload.tenant_reference === 'string' &&
    typeof payload.contract_schema_version === 'string' &&
    typeof aggregate?.reference === 'string' &&
    payload.id === undefined &&
    payload.type === undefined
  )
}

async function publicPayloadForDelivery(
  delivery: WebhookDeliveryRow,
): Promise<Record<string, unknown>> {
  if (isCanonicalStoredPayload(delivery.payload)) return delivery.payload

  const { data, error } = await supabaseService
    .from('domain_events')
    .select('*')
    .eq('id', delivery.domain_event_id)
    .eq('company_id', delivery.company_id)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('webhook_domain_event_missing')

  const tenantReference = await loadExternalTenantReference(delivery.company_id)
  return buildPublicWebhookPayload(
    data as DomainEventRow,
    tenantReference,
  ) as Record<string, unknown>
}

function isPartnerSubscription(subscription: WebhookSubscriptionRow): boolean {
  return String(subscription.metadata?.source ?? '').toLowerCase() === 'partner_api'
}

function partnerWebhookPayload(publicPayload: Record<string, unknown>): Record<string, unknown> {
  const aggregate = publicPayload.aggregate && typeof publicPayload.aggregate === 'object' && !Array.isArray(publicPayload.aggregate)
    ? publicPayload.aggregate as Record<string, unknown>
    : null
  const payload = {
    event_id: publicPayload.event_id,
    event_type: publicPayload.event_type,
    created_at: publicPayload.created_at,
    ...(publicPayload.environment ? { environment: publicPayload.environment } : {}),
    resource: aggregate
      ? {
          type: aggregate.type,
          reference: aggregate.reference,
        }
      : undefined,
    ...(publicPayload.customer ? { customer: publicPayload.customer } : {}),
    data: publicPayload.data ?? {},
    api_version: PARTNER_API_VERSION,
  }
  assertPublicResponsePayload(payload)
  return payload
}

function nextAttempt(attempts: number): string {
  const retrySeconds = [0, 300, 1800, 7200, 21600]
  const delaySeconds = retrySeconds[Math.min(Math.max(attempts, 1), retrySeconds.length - 1)] ?? 21600
  return new Date(Date.now() + delaySeconds * 1000).toISOString()
}

function providerAcceptedWebhook(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300
}

async function updateSubscriptionSuccess(subscriptionId: string) {
  await supabaseService
    .from('webhook_subscriptions')
    .update({
      last_success_at: new Date().toISOString(),
      failure_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId)
    .then((result: { error: unknown | null }) => {
      if (result.error && !missingSchema(result.error)) throw result.error
    })
}

async function updateSubscriptionFailure(subscription: WebhookSubscriptionRow, deadLetter: boolean) {
  await supabaseService
    .from('webhook_subscriptions')
    .update({
      last_failure_at: new Date().toISOString(),
      failure_count: Number(subscription.failure_count ?? 0) + 1,
      status: deadLetter && Number(subscription.failure_count ?? 0) + 1 >= 10 ? 'paused' : subscription.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id)
    .then((result: { error: unknown | null }) => {
      if (result.error && !missingSchema(result.error)) throw result.error
    })
}

export async function enqueueWebhookDeliveriesForEvent(event: DomainEventRow, options: EnqueueOptions = {}): Promise<number> {
  if (!event.company_id) return 0

  let query = supabaseService
    .from('webhook_subscriptions')
    .select('*')
    .eq('company_id', event.company_id)
    .eq('status', 'active')

  if (options.subscriptionIds?.length) query = query.in('id', options.subscriptionIds)

  const { data, error } = await query

  if (error) {
    if (missingSchema(error) && !options.strict) return 0
    if (missingSchema(error)) throw new Error('webhook_schema_not_ready')
    throw error
  }

  const tenantReference = await loadExternalTenantReference(event.company_id)

  const subscriptions = ((data ?? []) as WebhookSubscriptionRow[])
    .filter((subscription) => options.force || eventMatchesSubscription(event.event_type, subscription.event_types ?? []))

  if (subscriptions.length === 0) return 0

  const rows = subscriptions.map((subscription) => ({
    company_id: event.company_id,
    webhook_subscription_id: subscription.id,
    domain_event_id: event.id,
    event_type: event.event_type,
    max_attempts: subscription.max_attempts,
    target_url: subscription.endpoint_url,
    idempotency_key: `webhook:${subscription.id}:${event.id}`,
    payload: buildPublicWebhookPayload(event, tenantReference),
  }))

  const { error: insertError } = await supabaseService
    .from('webhook_deliveries')
    .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })

  if (insertError) {
    if (missingSchema(insertError) && !options.strict) {
      console.warn('[webhooks] webhook delivery enqueue skipped because live schema is incomplete', insertError)
      return 0
    }
    if (missingSchema(insertError)) throw new Error('webhook_schema_not_ready')
    throw insertError
  }
  return rows.length
}

async function recoverStaleDeliveries() {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString()
  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('webhook_deliveries')
    .update({
      status: 'delivery_uncertain',
      failure_reason: 'delivery_uncertain_after_stale_processing_lock',
      delivery_uncertain_at: now,
      next_attempt_at: now,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('status', 'processing')
    .lt('locked_at', staleBefore)
  if (error && !missingSchema(error)) throw error
}

async function finalizeClaimedDelivery(delivery: WebhookDeliveryRow, patch: Record<string, unknown>) {
  const { data, error } = await supabaseService
    .from('webhook_deliveries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', delivery.id)
    .eq('status', 'processing')
    .eq('locked_by', delivery.locked_by ?? '')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('webhook_delivery_lock_lost')
}

async function markDeliveryUncertain(input: {
  delivery: WebhookDeliveryRow
  publicDeliveryId: string | null
  requestBodyHash: string | null
  responseStatus: number | null
  responseBody: string | null
  reason: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('webhook_deliveries')
    .update({
      status: 'delivery_uncertain',
      delivery_uncertain_at: now,
      public_delivery_id: input.publicDeliveryId,
      request_body_hash: input.requestBodyHash,
      response_status: input.responseStatus,
      response_body: input.responseBody?.slice(0, 4000) ?? null,
      failure_reason: input.reason.slice(0, 1000),
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('id', input.delivery.id)
    .eq('company_id', input.delivery.company_id)
    .in('status', ['processing', 'failed'])
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('webhook_delivery_uncertain_status_not_persisted')
}

async function claimDueDeliveries(limit: number) {
  await recoverStaleDeliveries()
  const now = new Date().toISOString()
  const batchId = randomUUID()
  const due = await supabaseService
    .from('webhook_deliveries')
    .select('id')
    .in('status', ['queued', 'failed'])
    .lte('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100))

  if (due.error) throw due.error
  const ids = (due.data ?? []).map((row: { id?: string | null }) => row.id).filter((id: string | null | undefined): id is string => Boolean(id))
  if (ids.length === 0) return [] as WebhookDeliveryRow[]

  const claimed = await supabaseService
    .from('webhook_deliveries')
    .update({
      status: 'processing',
      locked_at: now,
      locked_by: batchId,
      updated_at: now,
    })
    .in('id', ids)
    .in('status', ['queued', 'failed'])
    .lte('next_attempt_at', now)
    .select('*')

  if (claimed.error) throw claimed.error
  const allowed: WebhookDeliveryRow[] = []
  for (const delivery of (claimed.data ?? []) as WebhookDeliveryRow[]) {
    const decision = await getTenantOperationDecision(delivery.company_id, 'webhook.deliver')
    if (!decision.allowed) {
      await finalizeClaimedDelivery(delivery, {
        status: 'blocked_tenant_state',
        blocked_reason: decision.reason_code,
        blocked_at: new Date().toISOString(),
        company_status_snapshot: decision.company_status,
        operation_decision_snapshot: decision,
        locked_at: null, locked_by: null,
      })
      continue
    }
    allowed.push(delivery)
  }
  return allowed
}

export async function dispatchDueWebhookDeliveries(limit = 25) {
  const deliveries = await claimDueDeliveries(limit)
  if (deliveries.length === 0) return { processed: 0, sent: 0, failed: 0, deliveryUncertain: 0 }

  const subscriptionIds = Array.from(new Set(deliveries.map((delivery) => delivery.webhook_subscription_id)))
  const { data: subscriptionRows, error: subscriptionError } = await supabaseService
    .from('webhook_subscriptions')
    .select('*')
    .in('id', subscriptionIds)

  if (subscriptionError) throw subscriptionError

  const subscriptions = new Map(
    ((subscriptionRows ?? []) as WebhookSubscriptionRow[]).map((subscription) => [subscription.id, subscription])
  )
  let sent = 0
  let failed = 0
  let deliveryUncertain = 0

  for (const delivery of deliveries) {
    const subscription = subscriptions.get(delivery.webhook_subscription_id)
    const attempts = delivery.attempts + 1
    const targetUrl = delivery.target_url || subscription?.endpoint_url || null
    const tenantDecision = await getTenantOperationDecision(delivery.company_id, 'webhook.deliver')
    if (!tenantDecision.allowed) {
      await finalizeClaimedDelivery(delivery, {
        status: 'blocked_tenant_state', blocked_reason: tenantDecision.reason_code,
        blocked_at: new Date().toISOString(), company_status_snapshot: tenantDecision.company_status,
        operation_decision_snapshot: tenantDecision,
        locked_at: null, locked_by: null,
      })
      failed += 1
      continue
    }

    if (!subscription || subscription.status !== 'active' || !targetUrl) {
      await finalizeClaimedDelivery(delivery, {
        status: 'skipped',
        attempts,
        last_attempt_at: new Date().toISOString(),
        failure_reason: !subscription ? 'Webhook subscription was not found.' : 'Webhook subscription is not active or target URL is missing.',
        locked_at: null,
        locked_by: null,
      })
      failed += 1
      continue
    }

    const secret = signingSecret(subscription)
    if (!secret) {
      const deadLetter = attempts >= delivery.max_attempts
      await finalizeClaimedDelivery(delivery, {
        status: deadLetter ? 'dead_letter' : 'failed',
        attempts,
        last_attempt_at: new Date().toISOString(),
        failed_at: new Date().toISOString(),
        next_attempt_at: deadLetter ? new Date().toISOString() : nextAttempt(attempts),
        failure_reason: 'webhook_signing_secret_missing',
        locked_at: null,
        locked_by: null,
        target_url: targetUrl,
      })
      await updateSubscriptionFailure(subscription, deadLetter)
      failed += 1
      continue
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), subscription.timeout_ms)
    let providerResponded = false
    let publicDeliveryId: string | null = null
    let requestBodyHash: string | null = null
    let responseStatus: number | null = null
    let responseBody: string | null = null

    try {
      const storedPayload = await publicPayloadForDelivery(delivery)
      const tenantReference = String(storedPayload.tenant_reference ?? '')
      if (!tenantReference) throw new Error('webhook_tenant_reference_missing')
      const publicPayload = isPartnerSubscription(subscription)
        ? partnerWebhookPayload(storedPayload)
        : storedPayload
      publicDeliveryId = opaqueReference(
        'delivery',
        tenantReference,
        delivery.id,
      )
      const body = JSON.stringify({
        ...publicPayload,
        delivery_id: publicDeliveryId,
      })
      requestBodyHash = createHash('sha256').update(body).digest('hex')

      const transportDecision = await getTenantOperationDecision(delivery.company_id, 'webhook.deliver')
      if (!transportDecision.allowed) {
        await finalizeClaimedDelivery(delivery, {
          status: 'blocked_tenant_state',
          blocked_reason: transportDecision.reason_code,
          blocked_at: new Date().toISOString(),
          company_status_snapshot: transportDecision.company_status,
          operation_decision_snapshot: transportDecision,
          public_delivery_id: publicDeliveryId,
          request_body_hash: requestBodyHash,
          locked_at: null,
          locked_by: null,
        })
        failed += 1
        continue
      }

      const response = await postPublicWebhook({
        url: targetUrl,
        headers: signedHeaders(
          subscription,
          delivery,
          publicPayload,
          publicDeliveryId,
          body,
          secret,
        ),
        body,
        signal: controller.signal,
      })
      providerResponded = true
      responseStatus = response.status
      responseBody = response.body

      if (response.ok) {
        await finalizeClaimedDelivery(delivery, {
          status: 'sent',
          attempts,
          last_attempt_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
          response_status: responseStatus,
          response_body: responseBody.slice(0, 4000),
          public_delivery_id: publicDeliveryId,
          request_body_hash: requestBodyHash,
          delivery_uncertain_at: null,
          failure_reason: null,
          locked_at: null,
          locked_by: null,
          target_url: targetUrl,
        })
        sent += 1
        try {
          await updateSubscriptionSuccess(subscription.id)
        } catch (subscriptionError) {
          console.error('[webhooks] delivery sent but subscription success projection failed', {
            deliveryId: delivery.id,
            subscriptionId: subscription.id,
            error: subscriptionError,
          })
        }
      } else {
        const deadLetter = attempts >= delivery.max_attempts
        await finalizeClaimedDelivery(delivery, {
          status: deadLetter ? 'dead_letter' : 'failed',
          attempts,
          last_attempt_at: new Date().toISOString(),
          failed_at: new Date().toISOString(),
          next_attempt_at: deadLetter ? new Date().toISOString() : nextAttempt(attempts),
          response_status: responseStatus,
          response_body: responseBody.slice(0, 4000),
          public_delivery_id: publicDeliveryId,
          request_body_hash: requestBodyHash,
          failure_reason: `HTTP ${responseStatus}`,
          locked_at: null,
          locked_by: null,
          target_url: targetUrl,
        })
        failed += 1
        try {
          await updateSubscriptionFailure(subscription, deadLetter)
        } catch (subscriptionError) {
          console.error('[webhooks] rejected delivery persisted but subscription failure projection failed', {
            deliveryId: delivery.id,
            subscriptionId: subscription.id,
            error: subscriptionError,
          })
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (providerResponded && providerAcceptedWebhook(responseStatus)) {
        await markDeliveryUncertain({
          delivery,
          publicDeliveryId,
          requestBodyHash,
          responseStatus,
          responseBody,
          reason: `delivery_uncertain_after_provider_acceptance: ${errorMessage}`,
        })
        deliveryUncertain += 1
      } else {
        const deadLetter = attempts >= delivery.max_attempts
        await finalizeClaimedDelivery(delivery, {
          status: deadLetter ? 'dead_letter' : 'failed',
          attempts,
          last_attempt_at: new Date().toISOString(),
          failed_at: new Date().toISOString(),
          next_attempt_at: deadLetter ? new Date().toISOString() : nextAttempt(attempts),
          response_status: responseStatus,
          response_body: responseBody?.slice(0, 4000) ?? null,
          public_delivery_id: publicDeliveryId,
          request_body_hash: requestBodyHash,
          failure_reason: errorMessage,
          locked_at: null,
          locked_by: null,
          target_url: targetUrl,
        })
        failed += 1
        try {
          await updateSubscriptionFailure(subscription, deadLetter)
        } catch (subscriptionError) {
          console.error('[webhooks] failure persisted but subscription projection failed', {
            deliveryId: delivery.id,
            subscriptionId: subscription.id,
            error: subscriptionError,
          })
        }
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return { processed: deliveries.length, sent, failed, deliveryUncertain }
}
