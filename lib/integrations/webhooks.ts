import { createHmac } from 'node:crypto'
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

function signedHeaders(subscription: WebhookSubscriptionRow, body: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': 'Gridex-Webhooks/1.0',
  })

  for (const [key, value] of Object.entries(subscription.custom_headers ?? {})) {
    if (typeof value === 'string' && key.toLowerCase() !== 'authorization') {
      headers.set(key, value)
    }
  }

  const secret = signingSecret(subscription)
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    headers.set('x-gridex-webhook-timestamp', timestamp)
    headers.set('x-gridex-webhook-signature', `sha256=${signature}`)
  }

  return headers
}

function nextAttempt(attempts: number): string {
  const delaySeconds = Math.min(3600, 2 ** Math.max(attempts, 1) * 30)
  return new Date(Date.now() + delaySeconds * 1000).toISOString()
}

export async function enqueueWebhookDeliveriesForEvent(event: DomainEventRow): Promise<number> {
  if (!event.company_id) return 0

  const { data, error } = await supabaseService
    .from('webhook_subscriptions')
    .select('*')
    .eq('company_id', event.company_id)
    .eq('status', 'active')

  if (error) {
    if (['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) return 0
    throw error
  }

  const subscriptions = ((data ?? []) as WebhookSubscriptionRow[])
    .filter((subscription) => eventMatchesSubscription(event.event_type, subscription.event_types ?? []))

  if (subscriptions.length === 0) return 0

  const rows = subscriptions.map((subscription) => {
    const payload = event.payload ?? {}
    return {
      company_id: event.company_id,
      webhook_subscription_id: subscription.id,
      domain_event_id: event.id,
      event_type: event.event_type,
      max_attempts: subscription.max_attempts,
      idempotency_key: `webhook:${subscription.id}:${event.id}`,
      payload: {
        event_id: event.id,
        event_type: event.event_type,
        created_at: event.occurred_at,
        company_id: event.company_id,
        customer_id: event.subject_customer_id,
        customer_number: typeof payload.customer_number === 'string' ? payload.customer_number : null,
        external_customer_id: typeof payload.external_customer_id === 'string' ? payload.external_customer_id : null,
        aggregate: {
          type: event.aggregate_type,
          id: event.aggregate_id,
        },
        data: payload,
      },
    }
  })

  const { error: insertError } = await supabaseService
    .from('webhook_deliveries')
    .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })

  if (insertError) throw insertError
  return rows.length
}

export async function dispatchDueWebhookDeliveries(limit = 25) {
  const { data, error } = await supabaseService
    .from('webhook_deliveries')
    .select('*')
    .in('status', ['queued', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100))

  if (error) throw error

  const deliveries = (data ?? []) as WebhookDeliveryRow[]
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

    if (!subscription || subscription.status !== 'active') {
      await supabaseService.from('webhook_deliveries').update({
        status: 'skipped',
        attempts,
        failure_reason: 'Webhook subscription is not active.',
        updated_at: new Date().toISOString(),
      }).eq('id', delivery.id)
      failed += 1
      continue
    }

    const body = JSON.stringify(delivery.payload)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), subscription.timeout_ms)

    try {
      const response = await fetch(subscription.endpoint_url, {
        method: 'POST',
        headers: signedHeaders(subscription, body),
        body,
        signal: controller.signal,
      })
      const responseBody = await response.text()

      if (response.ok) {
        await supabaseService.from('webhook_deliveries').update({
          status: 'sent',
          attempts,
          last_attempt_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
          response_status: response.status,
          response_body: responseBody.slice(0, 4000),
          failure_reason: null,
          updated_at: new Date().toISOString(),
        }).eq('id', delivery.id)
        sent += 1
      } else {
        const deadLetter = attempts >= delivery.max_attempts
        await supabaseService.from('webhook_deliveries').update({
          status: deadLetter ? 'dead_letter' : 'failed',
          attempts,
          last_attempt_at: new Date().toISOString(),
          failed_at: new Date().toISOString(),
          next_attempt_at: deadLetter ? new Date().toISOString() : nextAttempt(attempts),
          response_status: response.status,
          response_body: responseBody.slice(0, 4000),
          failure_reason: `HTTP ${response.status}`,
          updated_at: new Date().toISOString(),
        }).eq('id', delivery.id)
        failed += 1
      }
    } catch (error) {
      const deadLetter = attempts >= delivery.max_attempts
      await supabaseService.from('webhook_deliveries').update({
        status: deadLetter ? 'dead_letter' : 'failed',
        attempts,
        last_attempt_at: new Date().toISOString(),
        failed_at: new Date().toISOString(),
        next_attempt_at: deadLetter ? new Date().toISOString() : nextAttempt(attempts),
        failure_reason: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      }).eq('id', delivery.id)
      failed += 1
    } finally {
      clearTimeout(timeout)
    }
  }

  return { processed: deliveries.length, sent, failed }
}
