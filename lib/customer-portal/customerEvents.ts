import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'
import { logUsageEvent } from '@/lib/audit/actionLogger'
import { isMissingPortalSchemaError, resolvePortalCustomer } from '@/lib/customer-portal/customerResolver'

export const CustomerEventSchema = z.object({
  event_type: z.string().min(3).regex(/^customer\.[a-z0-9_]+$/),
  external_customer_id: z.string().trim().optional(),
  customer_number: z.string().trim().optional(),
  customer_id: z.string().uuid().optional(),
  auth_user_id: z.string().trim().optional(),
  customer_portal_user_id: z.string().trim().optional(),
  email: z.string().email().optional(),
  aggregate_id: z.string().trim().optional(),
  occurred_at: z.string().trim().optional(),
  payload: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

export type CustomerEventInput = z.infer<typeof CustomerEventSchema>

export function parseCustomerEventPayload(body: unknown) {
  return CustomerEventSchema.safeParse(body)
}

export function isSupportEvent(eventType: string): boolean {
  return /^customer\.(support|case)(?:_|$)/i.test(eventType)
}

async function resolveCustomerIdentity(client: IntegrationApiClient, payload: CustomerEventInput) {
  if (payload.customer_id) {
    const { data, error } = await supabaseService
      .from('customers')
      .select('id,company_id')
      .eq('company_id', client.company_id)
      .eq('id', payload.customer_id)
      .maybeSingle()
    if (error && !isMissingPortalSchemaError(error)) throw error
    if (data?.id) return { customerId: String(data.id), portalIdentityId: null as string | null, externalCustomerId: payload.external_customer_id ?? null }
  }

  const resolution = await resolvePortalCustomer({
    client,
    identifiers: {
      externalCustomerId: payload.external_customer_id ?? null,
      customerNumber: payload.customer_number ?? null,
      email: payload.email ?? null,
      authUserId: payload.auth_user_id ?? null,
      customerPortalUserId: payload.customer_portal_user_id ?? null,
    },
  })

  if (!resolution.ok) {
    return { customerId: null as string | null, portalIdentityId: null as string | null, externalCustomerId: payload.external_customer_id ?? null }
  }

  return {
    customerId: resolution.customer.customer_id,
    portalIdentityId: resolution.customer.id,
    externalCustomerId: resolution.customer.external_customer_id ?? payload.external_customer_id ?? null,
  }
}

export async function recordWebsiteCustomerEvent(input: {
  request: NextRequest
  client: IntegrationApiClient
  payload: CustomerEventInput
  source?: string
}) {
  const identity = await resolveCustomerIdentity(input.client, input.payload)
  const customerId = identity.customerId
  const occurredAt = input.payload.occurred_at ?? new Date().toISOString()
  const aggregateId = input.payload.aggregate_id ?? customerId ?? input.payload.external_customer_id ?? input.payload.customer_number ?? input.client.id
  const idempotencyKey = input.request.headers.get('idempotency-key')?.trim() || null

  const customerEventPayload = {
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    customer_id: customerId,
    portal_identity_id: identity.portalIdentityId,
    external_customer_id: identity.externalCustomerId ?? input.payload.external_customer_id ?? null,
    event_type: input.payload.event_type,
    source: input.source ?? 'website',
    idempotency_key: idempotencyKey,
    payload: input.payload.payload ?? {},
    metadata: input.payload.metadata ?? {},
    occurred_at: occurredAt,
  }

  const customerEventResult = idempotencyKey
    ? await supabaseService
        .from('customer_events')
        .upsert(customerEventPayload, { onConflict: 'company_id,idempotency_key' })
        .select('id')
        .maybeSingle()
    : await supabaseService
        .from('customer_events')
        .insert(customerEventPayload)
        .select('id')
        .maybeSingle()

  if (customerEventResult.error && !isMissingPortalSchemaError(customerEventResult.error)) throw customerEventResult.error
  const customerEventId = customerEventResult.error ? null : customerEventResult.data?.id ?? null

  const event = await emitDomainEvent({
    companyId: input.client.company_id,
    eventType: input.payload.event_type,
    aggregateType: customerId ? 'customer' : 'external_customer',
    aggregateId,
    subjectCustomerId: customerId,
    source: 'website_customer_events',
    idempotencyKey: idempotencyKey ? `website-event:${input.client.company_id}:${idempotencyKey}` : null,
    payload: {
      external_customer_id: identity.externalCustomerId ?? input.payload.external_customer_id ?? null,
      customer_id: customerId,
      customer_event_id: customerEventId,
      occurred_at: occurredAt,
      api_client_id: input.client.id,
      payload: input.payload.payload ?? {},
      metadata: input.payload.metadata ?? {},
    },
  })

  const metadata = { event_id: event?.id ?? null, customer_event_id: customerEventId, event_type: input.payload.event_type, customer_id: customerId }
  await logUsageEvent({
    companyId: input.client.company_id,
    apiClientId: input.client.id,
    customerId,
    entityType: 'customer_event',
    entityId: typeof customerEventId === 'string' ? customerEventId : null,
    eventKey: 'api.customer_event.received',
    actionLabel: 'Tog emot kundevent från hemsida',
    source: 'website_api',
    billable: true,
    billingUnit: 'customer_event',
    metadata,
  })

  return {
    event_id: event?.id ?? null,
    customer_event_id: customerEventId,
    event_type: input.payload.event_type,
    customer_id: customerId,
    status: 'accepted',
  }
}
