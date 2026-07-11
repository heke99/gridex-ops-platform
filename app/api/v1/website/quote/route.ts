import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { calculateOfferQuote, OfferQuoteError } from '@/lib/pricing/offerQuote'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_contracts.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  try {
    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) {
      const status = parsed.code === 'payload_too_large' ? 413 : 400
      return customerPortalJson({ error: { code: parsed.code, message: 'Ogiltig eller för stor JSON-payload.', request_id: requestId } }, { status })
    }
    const body = (parsed.body ?? {}) as Record<string, unknown>
    const result = await calculateOfferQuote({
      client: auth.client,
      offerReference: text(body.offer_reference),
      priceArea: text(body.price_area),
      annualConsumptionKwh: Number(body.annual_consumption_kwh),
      startDate: text(body.start_date) || null,
      customerType: text(body.customer_type) || null,
    })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        request_id: requestId,
        offer_reference: text(body.offer_reference),
        price_area: text(body.price_area),
      },
    })
    return customerPortalJson({ data: result, request_id: requestId }, { status: 200 })
  } catch (error) {
    const known = error instanceof OfferQuoteError
    const status = known ? error.status : 500
    const code = known ? error.code : 'quote_calculation_failed'
    const message = known ? error.message : 'Prisberäkningen kunde inte genomföras.'
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: status, startedAt, errorCode: code, metadata: { request_id: requestId } })
    return customerPortalJson({ error: { code, message, field: known ? error.field ?? null : null, request_id: requestId } }, { status })
  }
}
