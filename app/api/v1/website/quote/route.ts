import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { scheduleUsageEvent } from '@/lib/audit/actionLogger'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import {
  claimIntegrationWriteIdempotency,
  completeIntegrationWriteIdempotency,
  failIntegrationWriteIdempotency,
  IntegrationWriteIdempotencyError,
} from '@/lib/integrations/writeIdempotency'
import { calculateOfferQuote, OfferQuoteError } from '@/lib/pricing/offerQuote'
import { canonicalApiError } from '@/lib/api/apiError'
import {
  INVOICE_DELIVERY_METHODS,
  type InvoiceDeliveryMethod,
} from '@/lib/pricing/commercialModel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QUOTE_ROUTE = '/api/v1/website/quote'

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
    const parsed =
      typeof value === 'number'
        ? value
        : Number(String(value).replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function stringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    throw new OfferQuoteError(
      `${key} måste vara en lista med stabila referenser.`,
      'invalid_quote_input',
      400,
      key,
    )
  }
  return value.map((entry) => String(entry).trim())
}

function retryableErrorCode(code: string): boolean {
  return [
    'market_price_unavailable',
    'market_price_stale',
    'market_price_provider_unavailable',
    'market_reference_window_incomplete',
    'current_market_price_unavailable',
    'idempotency_store_unavailable',
    'idempotency_in_progress',
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
  return canonicalApiError({
    code: input.code,
    message: input.message,
    requestId: input.requestId,
    field: input.field,
    details: input.details,
    retryable: input.retryable ?? retryableErrorCode(input.code),
  })
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, [
    'website_quotes.write',
  ])
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

  let idempotencyRecordId: string | null = null

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
          message:
            status === 413
              ? 'Förfrågans innehåll är för stort.'
              : 'Ogiltig JSON i förfrågan.',
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
      'price_option_reference',
      'invoice_delivery_method',
      'selected_component_references',
      'site_count',
    ])
    const unknownFields = Object.keys(body).filter(
      (key) => !allowedFields.has(key),
    )
    if (unknownFields.length > 0) {
      return customerPortalJson(
        errorBody({
          code: 'unknown_field',
          message:
            'Förfrågan innehåller fält som inte ingår i API-kontraktet.',
          requestId,
          field: unknownFields[0],
          details: { unknown_fields: unknownFields },
          retryable: false,
        }),
        { status: 400 },
      )
    }

    const requiredCommercialFields = [
      'invoice_delivery_method',
      'selected_component_references',
      'site_count',
    ].filter((key) => !Object.prototype.hasOwnProperty.call(body, key))
    if (requiredCommercialFields.length > 0) {
      return customerPortalJson(
        errorBody({
          code: 'missing_field',
          message: 'Förfrågan saknar obligatoriska kommersiella fält.',
          requestId,
          field: requiredCommercialFields[0],
          details: { missing_fields: requiredCommercialFields },
          retryable: false,
        }),
        { status: 400 },
      )
    }

    const invoiceDeliveryMethod = text(body, 'invoice_delivery_method')
    if (
      !invoiceDeliveryMethod ||
      !INVOICE_DELIVERY_METHODS.includes(
        invoiceDeliveryMethod as InvoiceDeliveryMethod,
      )
    ) {
      throw new OfferQuoteError(
        'invoice_delivery_method är ogiltigt.',
        'invalid_invoice_delivery_method',
        400,
        'invoice_delivery_method',
      )
    }

    const quoteInput = {
      resolution_id: text(body, 'resolution_id'),
      offer_reference: text(body, 'offer_reference') ?? '',
      customer_type: text(body, 'customer_type'),
      annual_consumption_kwh:
        numeric(body, 'annual_consumption_kwh') ?? Number.NaN,
      start_date: text(body, 'start_date'),
      price_option_reference: text(body, 'price_option_reference'),
      invoice_delivery_method:
        invoiceDeliveryMethod as InvoiceDeliveryMethod,
      selected_component_references: stringArray(
        body,
        'selected_component_references',
      ),
      site_count: numeric(body, 'site_count') ?? Number.NaN,
    }

    const claim = await claimIntegrationWriteIdempotency({
      companyId: auth.context.companyId,
      apiClientId: auth.client.id,
      route: QUOTE_ROUTE,
      idempotencyKey: request.headers.get('idempotency-key'),
      payload: quoteInput,
      required: true,
    })

    if (claim.outcome === 'replay') {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: claim.statusCode,
        startedAt,
        metadata: {
          request_id: requestId,
          idempotency_replayed: true,
          idempotency_record_id: claim.recordId,
        },
      })
      return customerPortalJson(claim.responseBody, {
        status: claim.statusCode,
        headers: {
          'Cache-Control': 'no-store',
          'Idempotency-Replayed': 'true',
        },
      })
    }
    if (claim.outcome === 'claimed') {
      idempotencyRecordId = claim.recordId
    }

    const result = await calculateOfferQuote({
      client: auth.client,
      offerReference: quoteInput.offer_reference,
      resolutionId: quoteInput.resolution_id,
      resolutionBindingRequired: true,
      priceArea: null,
      annualConsumptionKwh: quoteInput.annual_consumption_kwh,
      startDate: quoteInput.start_date,
      customerType: quoteInput.customer_type,
      gridAreaCode: null,
      postalCode: null,
      priceOptionReference: quoteInput.price_option_reference,
      invoiceDeliveryMethod: quoteInput.invoice_delivery_method,
      selectedComponentReferences: quoteInput.selected_component_references,
      siteCount: quoteInput.site_count,
    })

    const responseBody = { data: result, request_id: requestId }
    await completeIntegrationWriteIdempotency({
      recordId: idempotencyRecordId,
      companyId: auth.context.companyId,
      statusCode: 201,
      responseBody,
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
        idempotency_record_id: idempotencyRecordId,
        idempotency_replayed: false,
      },
    })
    await scheduleUsageEvent({
      companyId: auth.context.companyId,
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
        quote_reference: result.quote_reference,
        price_area: (result.input as Record<string, unknown>).price_area,
        idempotency_record_id: idempotencyRecordId,
      },
    })

    return customerPortalJson(responseBody, {
      status: 201,
      headers: {
        'Cache-Control': 'no-store',
        'Idempotency-Replayed': 'false',
      },
    })
  } catch (error) {
    if (error instanceof IntegrationWriteIdempotencyError) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: error.status,
        startedAt,
        errorCode: error.code,
        metadata: { request_id: requestId, field: error.field },
      })
      return customerPortalJson(
        errorBody({
          code: error.code,
          message: error.message,
          requestId,
          field: error.field,
          retryable: error.retryable,
        }),
        {
          status: error.status,
          headers: { 'Cache-Control': 'no-store' },
        },
      )
    }

    if (error instanceof OfferQuoteError) {
      const responseBody = errorBody({
        code: error.code,
        message: error.message,
        requestId,
        field: error.field ?? null,
        details: error.details,
      })
      await completeIntegrationWriteIdempotency({
        recordId: idempotencyRecordId,
        companyId: auth.context.companyId,
        statusCode: error.status,
        responseBody,
      })
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: error.status,
        startedAt,
        errorCode: error.code,
        metadata: {
          request_id: requestId,
          field: error.field ?? null,
          idempotency_record_id: idempotencyRecordId,
        },
      })
      return customerPortalJson(responseBody, {
        status: error.status,
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    await failIntegrationWriteIdempotency({
      recordId: idempotencyRecordId,
      companyId: auth.context.companyId,
      errorCode: 'website_quote_failed',
    })
    console.error('[website-quote] failed', { requestId, error })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 500,
      startedAt,
      errorCode: 'website_quote_failed',
      metadata: {
        request_id: requestId,
        idempotency_record_id: idempotencyRecordId,
      },
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
