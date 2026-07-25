import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { logUsageEvent } from '@/lib/audit/actionLogger'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { calculateOfferQuote, OfferQuoteError } from '@/lib/pricing/offerQuote'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function numeric(body: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = body[key]
    if (value === null || value === undefined || value === '') continue
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function retryableErrorCode(code: string): boolean {
  return [
    'market_price_unavailable',
    'market_price_stale',
    'market_price_provider_unavailable',
    'market_reference_window_incomplete',
    'current_market_price_unavailable',
    'website_quote_failed',
  ].includes(code)
}

function errorBody(input: {
  code: string
  message: string
  requestId: string
  field?: string | null
  details?: Record<string, unknown>
  retryable?: boolean
}) {
  return {
    error: {
      code: input.code,
      message: input.message,
      field: input.field ?? null,
      request_id: input.requestId,
      correlation_id: input.requestId,
      retryable: input.retryable ?? retryableErrorCode(input.code),
      ...(input.details ? { details: input.details } : {}),
    },
    code: input.code,
    error_code: input.code,
    message: input.message,
    field: input.field ?? null,
    request_id: input.requestId,
    correlation_id: input.requestId,
    retryable: input.retryable ?? retryableErrorCode(input.code),
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_quotes.write'])
  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    })
    return customerPortalJson(
      errorBody({ code: auth.errorCode, message: auth.error, requestId }),
      { status: auth.status },
    )
  }

  try {
    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) {
      const status = parsed.code === 'payload_too_large' ? 413 : 400
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: status,
        startedAt,
        errorCode: parsed.code,
      })
      return customerPortalJson(
        errorBody({
          code: parsed.code,
          message: status === 413 ? 'Förfrågans innehåll är för stort.' : 'Ogiltig JSON i förfrågan.',
          requestId,
        }),
        { status },
      )
    }

    const body = (parsed.body ?? {}) as Record<string, unknown>
    const allowedFields = new Set([
      'resolution_id',
      'offer_reference',
      'customer_type',
      'annual_consumption_kwh',
      'start_date',
    ])
    const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key))
    if (unknownFields.length > 0) {
      return customerPortalJson(
        errorBody({
          code: 'unknown_field',
          message: 'Förfrågan innehåller fält som inte ingår i API-kontraktet.',
          requestId,
          field: unknownFields[0],
          details: { unknown_fields: unknownFields },
          retryable: false,
        }),
        { status: 400 },
      )
    }
    const result = await calculateOfferQuote({
      client: auth.client,
      offerReference: text(body, 'offer_reference') ?? '',
      resolutionId: text(body, 'resolution_id'),
      resolutionBindingRequired: true,
      priceArea: null,
      annualConsumptionKwh: numeric(body, 'annual_consumption_kwh') ?? Number.NaN,
      startDate: text(body, 'start_date'),
      customerType: text(body, 'customer_type'),
      gridAreaCode: null,
      postalCode: null,
    })

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 201,
      startedAt,
      metadata: {
        request_id: requestId,
        offer_reference: result.offer_reference,
        quote_reference: result.quote_reference,
        price_area: (result.input as Record<string, unknown>).price_area,
      },
    })
    await logUsageEvent({
      companyId: auth.client.company_id,
      apiClientId: auth.client.id,
      entityType: 'website_contract_quote',
      entityId: result.quote_reference,
      eventKey: 'api.website_quote.created',
      actionLabel: 'Skapade canonical prisquote',
      source: 'website_api',
      billable: true,
      billingUnit: 'api_request',
      metadata: {
        offer_reference: result.offer_reference,
        price_area: (result.input as Record<string, unknown>).price_area,
      },
    })

    return customerPortalJson(
      { data: result, quote: result, request_id: requestId },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof OfferQuoteError) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: error.status,
        startedAt,
        errorCode: error.code,
        metadata: { request_id: requestId, field: error.field ?? null },
      })
      return customerPortalJson(
        errorBody({
          code: error.code,
          message: error.message,
          requestId,
          field: error.field ?? null,
          details: error.details,
        }),
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    console.error('[website-quote] failed', { requestId, error })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 500,
      startedAt,
      errorCode: 'website_quote_failed',
      metadata: { request_id: requestId },
    })
    return customerPortalJson(
      errorBody({
        code: 'website_quote_failed',
        message: 'Prisquote kunde inte skapas just nu.',
        requestId,
      }),
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
