import { createHmac } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { DomainEventRow } from '@/lib/events/domainEvents'

type WebhookSubscriptionRow = {
  id: string
  company_id: string
  name: string
  endpoint_url: string
  event_types: string[]
  status: string
  custom_headers: Record<string, unknown>
  timeout_ms: number
  max_attempts: number
  signing_secret_ref: string | null
  failure_count?: number | null
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
}

type EnqueueOptions = {
  subscriptionIds?: string[]
  force?: boolean
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205', 'PGRST204', '42P10'].includes(code) || /schema cache|does not exist|column .* does not exist|no unique or exclusion constraint/i.test(message)
}

function eventMatchesSubscription(eventType: string, subscriptionTypes: string[]): boolean {
  return subscriptionTypes.includes('*') || subscriptionTypes.includes(eventType)
}

function signingSecret(subscription: WebhookSubscriptionRow): string | null {
  const byRef = subscription.signing_secret_ref
    ? process.env[`WEBHOOK_SIGNING_SECRET_${subscription.signing_secret_ref}`]
    : null
  return byRef ?? process.env.WEBHOOK_SIGNING_SECRET_FALLBACK ?? null
}

function canonicalPayload(event: DomainEventRow) {
  const data = event.payload ?? {}
  return {
    id: event.id,
    type: event.event_type,
    event_id: event.id,
    event_type: event.event_type,
    created_at: event.occurred_at,
    company_id: event.company_id,
    customer_id: event.subject_customer_id,
    customer_number: typeof data.customer_number === 'string' ? data.customer_number : null,
    external_customer_id: typeof data.external_customer_id === 'string' ? data.external_customer_id : null,
    aggregate: {
      type: event.aggregate_type,
      id: event.aggregate_id,
    },
    data,
  }
}

function signedHeaders(subscription: WebhookSubscriptionRow, delivery: WebhookDeliveryRow, body: string, secret: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': 'Gridex-Webhooks/1.0',
    'x-gridex-event-id': String(delivery.payload.id ?? delivery.domain_event_id),
    'x-gridex-event-type': delivery.event_type,
    'x-gridex-delivery-id': delivery.id,
  })

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

function nextAttempt(attempts: number): string {
  const retrySeconds = [0, 300, 1800, 7200, 21600]
  const delaySeconds = retrySeconds[Math.min(Math.max(attempts, 1), retrySeconds.length - 1)] ?? 21600
  return new Date(Date.now() + delaySeconds * 1000).toISOString()
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
    .then((result) => {
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
    .then((result) => {
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
    if (missingSchema(error)) return 0
    throw error
  }

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
    payload: canonicalPayload(event),
  }))

  const { error: insertError } = await supabaseService
    .from('webhook_deliveries')
    .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })

  if (insertError) {
    if (missingSchema(insertError)) {
      console.warn('[webhooks] webhook delivery enqueue skipped because live schema is incomplete', insertError)
      return 0
    }
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
      status: 'failed',
      failure_reason: 'stale_processing_lock_recovered',
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
  const ids = (due.data ?? []).map((row) => row.id).filter(Boolean)
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
  return (claimed.data ?? []) as WebhookDeliveryRow[]
}

export async function dispatchDueWebhookDeliveries(limit = 25) {
  const deliveries = await claimDueDeliveries(limit)
  if (deliveries.length === 0) return { processed: 0, sent: 0, failed: 0 }

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

  for (const delivery of deliveries) {
    const subscription = subscriptions.get(delivery.webhook_subscription_id)
    const attempts = delivery.attempts + 1
    const targetUrl = delivery.target_url || subscription?.endpoint_url || null

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

    const body = JSON.stringify(delivery.payload)
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
      await updateSubscriptionFailure(subscription, deadLetter).catch(() => null)
      failed += 1
      continue
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), subscription.timeout_ms)

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: signedHeaders(subscription, delivery, body, secret),
        body,
        signal: controller.signal,
      })
      const responseBody = await response.text()

      if (response.ok) {
        await finalizeClaimedDelivery(delivery, {
          status: 'sent',
          attempts,
          last_attempt_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
          response_status: response.status,
          response_body: responseBody.slice(0, 4000),
          failure_reason: null,
          locked_at: null,
          locked_by: null,
          target_url: targetUrl,
        })
        await updateSubscriptionSuccess(subscription.id).catch(() => null)
        sent += 1
      } else {
        const deadLetter = attempts >= delivery.max_attempts
        await finalizeClaimedDelivery(delivery, {
          status: deadLetter ? 'dead_letter' : 'failed',
          attempts,
          last_attempt_at: new Date().toISOString(),
          failed_at: new Date().toISOString(),
          next_attempt_at: deadLetter ? new Date().toISOString() : nextAttempt(attempts),
          response_status: response.status,
          response_body: responseBody.slice(0, 4000),
          failure_reason: `HTTP ${response.status}`,
          locked_at: null,
          locked_by: null,
          target_url: targetUrl,
        })
        await updateSubscriptionFailure(subscription, deadLetter).catch(() => null)
        failed += 1
      }
    } catch (error) {
      const deadLetter = attempts >= delivery.max_attempts
      await finalizeClaimedDelivery(delivery, {
        status: deadLetter ? 'dead_letter' : 'failed',
        attempts,
        last_attempt_at: new Date().toISOString(),
        failed_at: new Date().toISOString(),
        next_attempt_at: deadLetter ? new Date().toISOString() : nextAttempt(attempts),
        failure_reason: error instanceof Error ? error.message : String(error),
        locked_at: null,
        locked_by: null,
        target_url: targetUrl,
      })
      await updateSubscriptionFailure(subscription, deadLetter).catch(() => null)
      failed += 1
    } finally {
      clearTimeout(timeout)
    }
  }

  return { processed: deliveries.length, sent, failed }
}
