import { NextRequest } from 'next/server'
import { z } from 'zod'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { supabaseService } from '@/lib/supabase/service'
import { logUsageEvent } from '@/lib/audit/actionLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CustomerEventSchema = z.object({
  event_type: z.string().min(3).regex(/^customer\.[a-z0-9_]+$/),
  external_customer_id: z.string().trim().optional(),
  customer_id: z.string().uuid().optional(),
  aggregate_id: z.string().trim().optional(),
  occurred_at: z.string().trim().optional(),
  payload: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

async function resolveCustomerIdentity(companyId: string, payload: z.infer<typeof CustomerEventSchema>) {
  if (payload.customer_id) return { customerId: payload.customer_id, portalIdentityId: null as string | null }
  if (!payload.external_customer_id) return { customerId: null as string | null, portalIdentityId: null as string | null }

  const { data, error } = await supabaseService
    .from('customer_portal_identities')
    .select('id,customer_id')
    .eq('company_id', companyId)
    .eq('external_customer_id', payload.external_customer_id)
    .not('customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && !missingSchema(error)) throw error
  return {
    customerId: typeof data?.customer_id === 'string' ? data.customer_id : null,
    portalIdentityId: typeof data?.id === 'string' ? data.id : null,
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, ['website_events.write'])

  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = CustomerEventSchema.safeParse(body)
    if (!parsed.success) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: 422, startedAt, errorCode: 'validation_error' })
      return customerPortalJson({ error: 'Ogiltigt kundevent.', details: parsed.error.issues }, { status: 422 })
    }

    if (/^customer\.(support|case)_/i.test(parsed.data.event_type)) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: 422, startedAt, errorCode: 'support_out_of_scope' })
      return customerPortalJson({
        error: 'Supporthantering ligger utanför Gridex Ops API.',
        code: 'support_out_of_scope',
        hint: 'Elbolaget hanterar support i sina egna kanaler. Skicka inte support- eller case-events till Ops.',
      }, { status: 422 })
    }

    const identity = await resolveCustomerIdentity(auth.client.company_id, parsed.data)
    const customerId = identity.customerId
    const aggregateId = parsed.data.aggregate_id ?? customerId ?? parsed.data.external_customer_id ?? auth.client.id
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null


    const customerEventPayload = {
      company_id: auth.client.company_id,
      api_client_id: auth.client.id,
      customer_id: customerId,
      portal_identity_id: identity.portalIdentityId,
      external_customer_id: parsed.data.external_customer_id ?? null,
      event_type: parsed.data.event_type,
      source: 'website',
      idempotency_key: idempotencyKey,
      payload: parsed.data.payload ?? {},
      metadata: parsed.data.metadata ?? {},
      occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
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

    if (customerEventResult.error && !missingSchema(customerEventResult.error)) {
      throw customerEventResult.error
    }
    const customerEventId = customerEventResult.error ? null : customerEventResult.data?.id ?? null

    const event = await emitDomainEvent({
      companyId: auth.client.company_id,
      eventType: parsed.data.event_type,
      aggregateType: customerId ? 'customer' : 'external_customer',
      aggregateId,
      subjectCustomerId: customerId,
      source: 'website_customer_events',
      idempotencyKey: idempotencyKey ? `website-event:${auth.client.company_id}:${idempotencyKey}` : null,
      payload: {
        external_customer_id: parsed.data.external_customer_id ?? null,
        customer_id: customerId,
        customer_event_id: customerEventId,
        occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
        api_client_id: auth.client.id,
        payload: parsed.data.payload ?? {},
        metadata: parsed.data.metadata ?? {},
      },
    })

    const eventMetadata = { event_id: event?.id ?? null, customer_event_id: customerEventId, event_type: parsed.data.event_type, customer_id: customerId }
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: eventMetadata,
    })
    await logUsageEvent({
      companyId: auth.client.company_id,
      apiClientId: auth.client.id,
      customerId,
      entityType: 'customer_event',
      entityId: typeof customerEventId === 'string' ? customerEventId : null,
      eventKey: 'api.customer_event.received',
      actionLabel: 'Tog emot kundevent från hemsida',
      source: 'website_api',
      billable: true,
      billingUnit: 'customer_event',
      metadata: eventMetadata,
    })

    return customerPortalJson({
      data: {
        event_id: event?.id ?? null,
        customer_event_id: customerEventId,
        event_type: parsed.data.event_type,
        customer_id: customerId,
        status: 'accepted',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kundevent kunde inte behandlas.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: message })
    return customerPortalJson({ error: message }, { status: 500 })
  }
}
