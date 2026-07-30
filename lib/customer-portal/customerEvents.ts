import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'
import { logUsageEvent } from '@/lib/audit/actionLogger'
import { isMissingPortalSchemaError, resolvePortalCustomer } from '@/lib/customer-portal/customerResolver'

const CustomerEventIdentitySchema = z.object({
  external_customer_id: z.string().trim().min(1).optional(),
  customer_number: z.string().trim().min(1).optional(),
  auth_user_id: z.string().uuid().optional(),
  customer_portal_user_id: z.string().uuid().optional(),
  email: z.string().email().optional(),
}).strict().superRefine((value, context) => {
  if (
    Boolean(value.auth_user_id) !== Boolean(value.customer_portal_user_id) ||
    (
      value.auth_user_id &&
      value.customer_portal_user_id &&
      value.auth_user_id !== value.customer_portal_user_id
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customer_portal_user_id'],
      message: 'auth_user_id and customer_portal_user_id must be the same UUID or both omitted',
    })
  }
})

export const CustomerEventSchema = z.object({
  event_type: z.string().min(3).regex(/^customer\.[a-z0-9_]+$/),
  event_reference: z.string().trim().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  customer: CustomerEventIdentitySchema,
  subject: z.object({
    type: z.string().trim().min(1),
    reference: z.string().trim().min(1).optional(),
  }).strict(),
  data: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
}).strict()

export type CustomerEventInput = z.infer<typeof CustomerEventSchema>

export function parseCustomerEventPayload(body: unknown) {
  return CustomerEventSchema.safeParse(body)
}

export function isSupportEvent(eventType: string): boolean {
  return /^customer\.(support|case)(?:_|$)/i.test(eventType)
}

class CustomerEventResolutionError extends Error {
  status = 422
  code = 'customer_identity_required'
}

async function resolveCustomerIdentity(client: IntegrationApiClient, payload: CustomerEventInput) {
  const resolution = await resolvePortalCustomer({
    client,
    identifiers: {
      externalCustomerId: payload.customer.external_customer_id ?? null,
      customerNumber: payload.customer.customer_number ?? null,
      email: payload.customer.email ?? null,
      authUserId: payload.customer.auth_user_id ?? null,
      customerPortalUserId: payload.customer.customer_portal_user_id ?? null,
    },
  })

  if (!resolution.ok) {
    return { customerId: null as string | null, portalIdentityId: null as string | null, externalCustomerId: payload.customer.external_customer_id ?? null }
  }

  return {
    customerId: resolution.customer.customer_id,
    portalIdentityId: resolution.customer.id,
    externalCustomerId: resolution.customer.external_customer_id ?? payload.customer.external_customer_id ?? null,
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
  if (!customerId) {
    throw new CustomerEventResolutionError('Kundevent kräver en verifierad kundlänk. Skicka customer_portal_user_id/auth_user_id och kundnummer eller external_customer_id enligt Customer Portal sync.')
  }
  const occurredAt = input.payload.occurred_at ?? new Date().toISOString()
  const aggregateId = input.payload.subject.reference ?? input.payload.event_reference
  const idempotencyKey = input.request.headers.get('idempotency-key')?.trim() || null

  const customerEventPayload = {
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    customer_id: customerId,
    portal_identity_id: identity.portalIdentityId,
    external_customer_id: identity.externalCustomerId ?? input.payload.customer.external_customer_id ?? null,
    event_type: input.payload.event_type,
    source: input.source ?? 'website',
    idempotency_key: idempotencyKey,
    payload: input.payload.data,
    metadata: {
      ...(input.payload.metadata ?? {}),
      event_reference: input.payload.event_reference,
      subject: input.payload.subject,
    },
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
      external_customer_id: identity.externalCustomerId ?? input.payload.customer.external_customer_id ?? null,
      customer_id: customerId,
      customer_event_id: customerEventId,
      event_reference: input.payload.event_reference,
      subject: input.payload.subject,
      occurred_at: occurredAt,
      api_client_id: input.client.id,
      data: input.payload.data,
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
    event_reference: input.payload.event_reference,
    event_type: input.payload.event_type,
    customer_reference:
      identity.externalCustomerId ??
      input.payload.customer.customer_number ??
      null,
    status: 'accepted',
    _internal_customer_id: customerId,
  }
}
