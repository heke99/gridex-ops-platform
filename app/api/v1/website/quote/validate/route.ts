import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'
import { validateWebsiteQuote, WebsiteQuoteValidationError } from '@/lib/pricing/websiteQuotes'
import { resolvePublicContractOffer } from '@/lib/website/publicContracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_quotes.validate'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  try {
    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) return customerPortalJson({ error: { code: parsed.code, message: 'Ogiltig JSON.', request_id: requestId } }, { status: parsed.code === 'payload_too_large' ? 413 : 400 })
    const body = (parsed.body ?? {}) as Record<string, unknown>
    const quoteReference = text(body.quote_reference)
    const offerReference = text(body.offer_reference)
    const normalizedCustomerType = normalizeExternalCustomerType(body.customer_type, { allowEmpty: false })
    if (!quoteReference || !offerReference || !normalizedCustomerType.ok || !normalizedCustomerType.value) {
      return customerPortalJson({ error: { code: 'quote_validation_input_invalid', message: 'quote_reference, offer_reference och customer_type krävs.', request_id: requestId } }, { status: 400 })
    }

    const publicOffer = await resolvePublicContractOffer({ client: auth.client, offerReference, customerType: normalizedCustomerType.value })
    if (!publicOffer) {
      return customerPortalJson({ error: { code: 'offer_not_found', message: 'Avtalet är inte publicerat för denna tenant.', request_id: requestId } }, { status: 404 })
    }

    const quote = await validateWebsiteQuote({
      client: auth.client,
      quoteReference,
      offerReference,
      publicOffer,
      customerType: normalizedCustomerType.value,
      priceArea: text(body.price_area),
      gridAreaCode: text(body.grid_area_code),
      postalCode: text(body.postal_code),
      annualConsumptionKwh: numberOrNull(body.annual_consumption_kwh),
      startDate: text(body.start_date),
    })

    const tenant = await loadExternalTenantContext(auth.client)
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: requestId, quote_reference: quoteReference } })
    return customerPortalJson({ data: { quote_reference: quote.quote_reference, offer_reference: quote.offer_reference, valid: true, valid_until: quote.valid_until, status: quote.status }, meta: { tenant_reference: tenant.tenant_reference, api_version: 'v1', channel: 'website' }, request_id: requestId }, { status: 200 })
  } catch (error) {
    if (error instanceof WebsiteQuoteValidationError) {
      await logIntegrationApiRequest({ client: auth.client, request, statusCode: error.status, startedAt, errorCode: error.code })
      return customerPortalJson({ error: { code: error.code, message: error.message, field: error.field, details: error.details ?? null, request_id: requestId } }, { status: error.status })
    }
    console.error('[quote-validate] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'quote_validation_unavailable' })
    return customerPortalJson({ error: { code: 'quote_validation_unavailable', message: 'Quote kunde inte verifieras.', request_id: requestId } }, { status: 500 })
  }
}
