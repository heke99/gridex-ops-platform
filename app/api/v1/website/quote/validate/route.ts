import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'
import { projectPublicMarketReference } from '@/lib/pricing/publicMarketReference'
import {
  validateWebsiteQuote,
  WebsiteQuoteValidationError,
} from '@/lib/pricing/websiteQuotes'
import { resolvePublicContractOffer } from '@/lib/website/publicContracts'
import { canonicalApiError } from '@/lib/api/apiError'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_FIELDS = new Set([
  'quote_reference',
  'offer_reference',
  'customer_type',
  'resolution_id',
  'annual_consumption_kwh',
  'start_date',
  'price_area',
  'grid_area_code',
  'postal_code',
  'application_number',
  'price_option_reference',
  'invoice_delivery_method',
  'selected_component_references',
  'site_count',
])

function text(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numeric(body: Record<string, unknown>, key: string): number | null {
  const value = body[key]
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function stringArray(
  body: Record<string, unknown>,
  key: string,
): string[] | null {
  const value = body[key]
  if (value === undefined) return null
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    throw new WebsiteQuoteValidationError({
      message: `${key} måste vara en lista med stabila referenser.`,
      code: 'invalid_quote_assertion',
      status: 400,
      field: key,
    })
  }
  return value.map((entry) => String(entry).trim())
}

async function resolveInternalApplicationId(input: {
  companyId: string
  applicationNumber: string | null
}): Promise<string | null> {
  if (!input.applicationNumber) return null
  const result = await supabaseService
    .from('website_customer_applications')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('application_number', input.applicationNumber)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data?.id) {
    throw new WebsiteQuoteValidationError({
      message: 'Kundansökan hittades inte för aktuell tenant.',
      code: 'application_not_found',
      status: 404,
      field: 'application_number',
    })
  }
  return String(result.data.id)
}

function retryableErrorCode(code: string): boolean {
  return ['market_price_unavailable', 'market_price_stale', 'website_quote_validation_failed'].includes(code)
}

function responseError(input: {
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
  const auth = await requireIntegrationApiAccess(request, ['website_quotes.validate'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson(responseError({ code: auth.errorCode, message: auth.error, requestId }), { status: auth.status })
  }

  try {
    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) {
      const status = parsed.code === 'payload_too_large' ? 413 : 400
      return customerPortalJson(
        responseError({
          code: parsed.code,
          message: status === 413 ? 'Förfrågans innehåll är för stort.' : 'Ogiltig JSON i förfrågan.',
          requestId,
        }),
        { status },
      )
    }
    const body = (parsed.body ?? {}) as Record<string, unknown>
    const unknownFields = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key))
    if (unknownFields.length > 0) {
      return customerPortalJson(
        responseError({
          code: 'unknown_field',
          message: 'Payloaden innehåller okända eller felplacerade fält.',
          requestId,
          field: unknownFields[0],
          details: { fields: unknownFields },
          retryable: false,
        }),
        { status: 400 },
      )
    }
    const requiredFields = [
      'quote_reference',
      'offer_reference',
      'customer_type',
      'resolution_id',
      'annual_consumption_kwh',
      'start_date',
      'price_option_reference',
      'invoice_delivery_method',
      'selected_component_references',
      'site_count',
    ].filter(
      (key) => !Object.prototype.hasOwnProperty.call(body, key),
    )
    if (requiredFields.length > 0) {
      return customerPortalJson(
        responseError({
          code: 'missing_field',
          message: 'Payloaden saknar obligatoriska quote-assertioner.',
          requestId,
          field: requiredFields[0],
          details: { missing_fields: requiredFields },
          retryable: false,
        }),
        { status: 400 },
      )
    }
    const quoteReference = text(body, 'quote_reference') ?? ''
    const offerReference = text(body, 'offer_reference') ?? ''
    const normalizedCustomerType = normalizeExternalCustomerType(text(body, 'customer_type'))
    if (!normalizedCustomerType.ok || !normalizedCustomerType.value) {
      return customerPortalJson(
        responseError({
          code: 'invalid_customer_type',
          message: 'customer_type måste vara private eller business.',
          requestId,
          field: 'customer_type',
        }),
        { status: 400 },
      )
    }
    const publicOffer = await resolvePublicContractOffer({
      client: auth.client,
      offerReference,
      customerType: normalizedCustomerType.value,
    })
    if (!publicOffer) {
      return customerPortalJson(
        responseError({
          code: 'offer_not_found',
          message: 'Avtalet hittades inte eller är inte publicerat för denna tenant.',
          requestId,
          field: 'offer_reference',
        }),
        { status: 404 },
      )
    }

    const applicationId = await resolveInternalApplicationId({
      companyId: auth.context.companyId,
      applicationNumber: text(body, 'application_number'),
    })
    const quote = await validateWebsiteQuote({
      client: auth.client,
      quoteReference,
      offerReference,
      publicOffer,
      customerType: normalizedCustomerType.value,
      priceArea: text(body, 'price_area')?.toUpperCase() ?? null,
      resolutionId: text(body, 'resolution_id'),
      gridAreaCode: text(body, 'grid_area_code'),
      postalCode: text(body, 'postal_code'),
      annualConsumptionKwh: numeric(body, 'annual_consumption_kwh'),
      startDate: text(body, 'start_date'),
      applicationId,
      priceOptionReference: text(body, 'price_option_reference'),
      invoiceDeliveryMethod: text(body, 'invoice_delivery_method'),
      selectedComponentReferences: stringArray(
        body,
        'selected_component_references',
      ),
      siteCount: numeric(body, 'site_count'),
    })

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: { request_id: requestId, quote_reference: quote.quote_reference, offer_reference: quote.offer_reference },
    })
    return customerPortalJson(
      {
        data: {
          valid: true,
          quote_reference: quote.quote_reference,
          offer_reference: quote.offer_reference,
          valid_until: quote.valid_until,
          status: quote.status,
          resolution_id: quote.energy_resolution_id,
          resolver_version: quote.resolver_version,
          geodata_version: quote.geodata_version,
          market_reference: projectPublicMarketReference(quote.market_reference),
          energy_direction: quote.energy_direction,
          selected_area_price: (quote.quote_snapshot as Record<string, unknown>).selected_area_price ?? null,
          price_option_reference: quote.price_option_reference,
          area_price_reference: quote.area_price_reference,
          invoice_delivery_method: quote.invoice_delivery_method,
          selected_component_references:
            quote.selected_component_references,
          mandatory_component_references:
            quote.mandatory_component_references,
          conditional_component_references:
            quote.conditional_component_references,
          site_count: quote.site_count,
        },
        request_id: requestId,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof WebsiteQuoteValidationError) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: error.status,
        startedAt,
        errorCode: error.code,
        metadata: {
          request_id: requestId,
          field: error.field,
          details: error.details ?? null,
        },
      })
      return customerPortalJson(
        responseError({
          code: error.code,
          message: error.message,
          requestId,
          field: error.field,
          details: error.details,
        }),
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    console.error('[website-quote-validate] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'website_quote_validation_failed', metadata: { request_id: requestId } })
    return customerPortalJson(
      responseError({ code: 'website_quote_validation_failed', message: 'Prisquote kunde inte valideras just nu.', requestId }),
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
