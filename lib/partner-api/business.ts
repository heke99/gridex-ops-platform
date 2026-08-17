import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import { ApiInputError, executeIdempotentPortalWrite, readJsonObject, requireIsoDate } from '@/lib/api/strictRequest'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
  type IntegrationScopeRequirement,
} from '@/lib/integrations/apiAuth'
import { OfferQuoteError, calculateOfferQuote } from '@/lib/pricing/offerQuote'
import { CurrentMarketPriceError, loadCurrentMarketPrice } from '@/lib/pricing/spot/currentMarketPrice'
import { supabaseService } from '@/lib/supabase/service'
import { stockholmDateForInstant } from '@/lib/time/stockholm'
import { PARTNER_API_VERSION } from './openApi'
import { partnerBusinessOpenApi } from './businessOpenApi'
import {
  PartnerLocationResolutionError,
  resolvePartnerLocation,
  type PartnerLocationInput,
  type PartnerPublicLocation,
} from './businessResolution'

type Json = Record<string, unknown>
type BusinessMethod = 'GET' | 'POST' | 'DELETE'

type AuthContext = {
  client: IntegrationApiClient
  startedAt: number
  requestId: string
}

class PartnerBusinessApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null

  constructor(message: string, code: string, status = 422, field: string | null = null) {
    super(message)
    this.name = 'PartnerBusinessApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Json
    : {}
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function requestId(request: NextRequest): string {
  const candidate = request.headers.get('x-request-id')?.trim()
  return candidate && candidate.length <= 128 ? candidate : randomUUID()
}

function businessJson(body: Json, status: number, id: string): NextResponse {
  const envelope = { ...body, request_id: id, api_version: PARTNER_API_VERSION }
  if (!('error' in envelope)) assertPublicResponsePayload(envelope)
  return NextResponse.json(envelope, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-ID': id,
      'X-Gridex-API-Version': PARTNER_API_VERSION,
    },
  })
}

async function auth(
  request: NextRequest,
  scopes: IntegrationScopeRequirement,
): Promise<{ ok: true; context: AuthContext } | { ok: false; response: NextResponse }> {
  const startedAt = Date.now()
  const id = requestId(request)
  const result = await requireIntegrationApiAccess(request, scopes)
  if (!result.ok) {
    await logIntegrationApiRequest({
      client: result.client ?? null,
      request,
      statusCode: result.status,
      startedAt,
      errorCode: result.errorCode,
      metadata: { request_id: id, api_surface: 'partner_v1_business' },
    }).catch(() => undefined)
    return {
      ok: false,
      response: businessJson({ error: { code: result.errorCode, message: result.error } }, result.status, id),
    }
  }
  return {
    ok: true,
    context: { client: result.client, startedAt, requestId: id },
  }
}

async function successLog(request: NextRequest, context: AuthContext, operation: string, status = 200) {
  await logIntegrationApiRequest({
    client: context.client,
    request,
    statusCode: status,
    startedAt: context.startedAt,
    metadata: { request_id: context.requestId, api_surface: 'partner_v1_business', operation },
  }).catch(() => undefined)
}

function normalizedError(error: unknown): {
  status: number
  code: string
  message: string
  field?: string
  requiredFields?: string[]
} {
  if (error instanceof PartnerLocationResolutionError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.requiredFields.length ? { requiredFields: error.requiredFields } : {}),
    }
  }
  if (error instanceof CurrentMarketPriceError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    }
  }
  if (error instanceof OfferQuoteError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    }
  }
  if (error instanceof ApiInputError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    }
  }
  if (error instanceof PartnerBusinessApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    }
  }
  return { status: 500, code: 'partner_api_internal_error', message: 'The request could not be completed.' }
}

async function failureResponse(request: NextRequest, context: AuthContext, error: unknown) {
  const normalized = normalizedError(error)
  await logIntegrationApiRequest({
    client: context.client,
    request,
    statusCode: normalized.status,
    startedAt: context.startedAt,
    errorCode: normalized.code,
    metadata: { request_id: context.requestId, api_surface: 'partner_v1_business' },
  }).catch(() => undefined)
  if (normalized.status >= 500) {
    console.error('[partner-api] business request failed', {
      requestId: context.requestId,
      path: request.nextUrl.pathname,
      error,
    })
  }
  return businessJson({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.field ? { field: normalized.field } : {}),
      ...(normalized.requiredFields ? { required_fields: normalized.requiredFields } : {}),
    },
  }, normalized.status, context.requestId)
}

function ensureKeys(body: Json, allowed: readonly string[]) {
  const allow = new Set(allowed)
  const unsupported = Object.keys(body).find((key) => !allow.has(key))
  if (unsupported) {
    throw new PartnerBusinessApiError(
      `Unsupported field: ${unsupported}. Gridex resolves internal IDs automatically.`,
      'unsupported_field',
      422,
      unsupported,
    )
  }
}

function queryLocation(request: NextRequest): PartnerLocationInput {
  return {
    postalCode: request.nextUrl.searchParams.get('postal_code'),
    address: request.nextUrl.searchParams.get('address'),
    city: request.nextUrl.searchParams.get('city'),
    country: request.nextUrl.searchParams.get('country') ?? 'SE',
  }
}

function bodyLocation(body: Json): PartnerLocationInput {
  return {
    postalCode: text(body.postal_code),
    address: text(body.address),
    city: text(body.city),
    country: text(body.country) ?? 'SE',
  }
}

function normalizeCustomerType(value: unknown): 'private' | 'business' {
  const normalized = (text(value) ?? 'PRIVATE').toUpperCase()
  if (normalized === 'PRIVATE') return 'private'
  if (normalized === 'COMPANY' || normalized === 'BUSINESS') return 'business'
  throw new PartnerBusinessApiError(
    'customer_type must be PRIVATE or COMPANY.',
    'customer_type_invalid',
    422,
    'customer_type',
  )
}

async function defaultOfferReference(client: IntegrationApiClient, customerType: 'private' | 'business') {
  const metadata = client.metadata ?? {}
  const configured = text(metadata.partner_default_offer_reference ?? metadata.default_offer_reference)
  if (configured) return configured

  const candidates = await supabaseService
    .from('canonical_public_contract_diagnostics_v')
    .select('offer_reference,customer_type')
    .eq('company_id', client.company_id)
    .eq('channel', 'api')
    .eq('visible', true)
    .limit(20)
  if (candidates.error) throw candidates.error

  const references = Array.from(new Set(
    (candidates.data ?? [])
      .filter((row) => {
        const type = String(row.customer_type ?? '').toLowerCase()
        return type === 'both' || type === customerType
      })
      .map((row) => text(row.offer_reference))
      .filter((value): value is string => Boolean(value)),
  ))
  if (references.length === 1) return references[0]
  if (references.length === 0) {
    throw new PartnerBusinessApiError('No published API offer is available.', 'offer_not_found', 404)
  }
  throw new PartnerBusinessApiError(
    'Several API offers are available. Gridex must configure one default offer for this API credential.',
    'default_offer_not_configured',
    409,
  )
}

function publicMarketPrice(price: Awaited<ReturnType<typeof loadCurrentMarketPrice>>) {
  return {
    value: price.price_sek_per_kwh,
    currency: 'SEK',
    unit: 'kWh',
    includes_vat: false,
    resolution: price.selected_resolution,
    valid_from: price.time_start,
    valid_to: price.time_end,
    source_as_of: price.source_as_of,
  }
}

async function getLocation(request: NextRequest) {
  const access = await auth(request, ['website_energy_area.resolve'])
  if (!access.ok) return access.response
  const { context } = access
  try {
    const resolved = await resolvePartnerLocation({
      companyId: context.client.company_id,
      location: queryLocation(request),
      purpose: 'location',
    })
    await successLog(request, context, 'location.resolve')
    return businessJson(resolved.location as unknown as Json, 200, context.requestId)
  } catch (error) {
    return failureResponse(request, context, error)
  }
}

async function getCurrentPrice(request: NextRequest) {
  const access = await auth(request, ['website_market_prices.read'])
  if (!access.ok) return access.response
  const { context } = access
  try {
    const resolved = await resolvePartnerLocation({
      companyId: context.client.company_id,
      location: queryLocation(request),
      purpose: 'pricing',
    })
    const price = await loadCurrentMarketPrice({
      client: context.client,
      resolutionId: resolved.resolutionId,
    })
    await successLog(request, context, 'price.current')
    return businessJson({
      location: resolved.location,
      market_price: publicMarketPrice(price),
    }, 200, context.requestId)
  } catch (error) {
    return failureResponse(request, context, error)
  }
}

function publicPriceComponents(quote: Json) {
  const lines = Array.isArray(quote.lines) ? quote.lines : []
  return lines.map((line) => {
    const item = record(line)
    return {
      name: text(item.name) ?? 'Price component',
      quantity: numberValue(item.quantity),
      unit: text(item.unit),
      unit_price_ex_vat: numberValue(item.unit_price_ex_vat),
      amount_inc_vat: numberValue(item.amount_inc_vat),
      vat_rate: numberValue(item.vat_rate),
    }
  })
}

export function publicPartnerPriceFromCanonicalQuote(input: {
  quote: Json
  location: PartnerPublicLocation
  annualConsumptionKwh: number
  currentMarketPrice: number | null
}) {
  const estimate = record(input.quote.estimate)
  const offer = record(input.quote.offer)
  const annualIncVat = numberValue(estimate.annual_inc_vat)
  const monthlyIncVat = numberValue(estimate.monthly_inc_vat)
  if (annualIncVat === null || monthlyIncVat === null) {
    throw new PartnerBusinessApiError('Canonical quote is missing customer totals.', 'quote_calculation_failed', 500)
  }

  return {
    quote_reference: text(input.quote.quote_reference),
    valid_until: text(input.quote.valid_until),
    location: input.location,
    current_market_price: input.currentMarketPrice,
    offer: {
      name: text(offer.public_name) ?? 'Electricity agreement',
      contract_type: text(offer.contract_type) ?? 'variable',
    },
    customer_price: {
      estimated_unit_price_inc_vat: Math.round((annualIncVat / input.annualConsumptionKwh) * 100000) / 100000,
      currency: 'SEK',
      unit: 'kWh',
    },
    estimated_cost: {
      monthly_inc_vat: monthlyIncVat,
      annual_inc_vat: annualIncVat,
    },
    price_components: publicPriceComponents(input.quote),
    is_binding: input.quote.is_binding === true,
  }
}

async function createPrice(request: NextRequest) {
  const access = await auth(request, ['website_quotes.write'])
  if (!access.ok) return access.response
  const { context } = access
  try {
    const body = await readJsonObject(request)
    ensureKeys(body, [
      'postal_code', 'address', 'city', 'country', 'annual_consumption_kwh', 'customer_type', 'start_date',
    ])
    const annualConsumptionKwh = numberValue(body.annual_consumption_kwh)
    if (annualConsumptionKwh === null || annualConsumptionKwh <= 0) {
      throw new PartnerBusinessApiError(
        'annual_consumption_kwh must be greater than 0.',
        'annual_consumption_invalid',
        422,
        'annual_consumption_kwh',
      )
    }
    const customerType = normalizeCustomerType(body.customer_type)
    const startDate = body.start_date
      ? requireIsoDate(body.start_date, 'start_date')
      : stockholmDateForInstant(new Date())

    const write = await executeIdempotentPortalWrite<Json>({
      request,
      companyId: context.client.company_id,
      clientId: context.client.id,
      customerId: null,
      operation: '/api/partner/v1/price',
      payload: body,
      execute: async () => {
        const resolved = await resolvePartnerLocation({
          companyId: context.client.company_id,
          location: bodyLocation(body),
          purpose: 'pricing',
        })
        const offerReference = await defaultOfferReference(context.client, customerType)
        const canonicalQuote = await calculateOfferQuote({
          client: context.client,
          offerReference,
          resolutionId: resolved.resolutionId,
          resolutionBindingRequired: true,
          annualConsumptionKwh,
          startDate,
          customerType,
          postalCode: resolved.location.postal_code,
        }) as unknown as Json

        let currentMarketPrice: number | null = null
        try {
          const current = await loadCurrentMarketPrice({
            client: context.client,
            resolutionId: resolved.resolutionId,
          })
          currentMarketPrice = current.price_sek_per_kwh
        } catch (error) {
          // A fixed/portfolio quote can be valid even when the current spot
          // interval is unavailable. /price/current remains the strict source
          // for callers that explicitly require the current interval.
          if (!(error instanceof CurrentMarketPriceError)) throw error
        }

        const publicQuote = publicPartnerPriceFromCanonicalQuote({
          quote: canonicalQuote,
          location: resolved.location,
          annualConsumptionKwh,
          currentMarketPrice,
        })
        return { statusCode: 200, body: publicQuote as unknown as Json }
      },
    })
    await successLog(request, context, 'price.calculate', write.statusCode)
    return businessJson(write.body, write.statusCode, context.requestId)
  } catch (error) {
    return failureResponse(request, context, error)
  }
}

export async function handlePartnerBusinessApi(
  request: NextRequest,
  method: BusinessMethod,
  path: string[] | undefined,
): Promise<NextResponse | null> {
  const segments = (path ?? []).filter(Boolean)

  if (method === 'GET' && segments.length === 1 && segments[0] === 'openapi.json') {
    return NextResponse.json(partnerBusinessOpenApi, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Gridex-API-Version': PARTNER_API_VERSION,
      },
    })
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'location') return getLocation(request)
  if (method === 'GET' && segments.length === 2 && segments[0] === 'price' && segments[1] === 'current') return getCurrentPrice(request)
  if (method === 'POST' && segments.length === 1 && segments[0] === 'price') return createPrice(request)
  return null
}
