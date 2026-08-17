import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  integrationCredential,
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
  type IntegrationScopeRequirement,
} from '@/lib/integrations/apiAuth'
import { hashIntegrationApiSecret } from '@/lib/integrations/apiClientSecrets'
import { EnergyResolutionBindingError } from '@/lib/energy/resolutionBinding'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import type { EnergyResolverResult } from '@/lib/energy/types'
import { calculateOfferQuote, OfferQuoteError } from '@/lib/pricing/offerQuote'
import {
  CurrentMarketPriceError,
  loadCurrentMarketPrice,
} from '@/lib/pricing/spot/currentMarketPrice'
import { supabaseService } from '@/lib/supabase/service'
import { stockholmDateForInstant } from '@/lib/time/stockholm'
import { PARTNER_API_VERSION } from './openApi'
import { handleSimplePartnerApi } from './simple'

type Json = Record<string, unknown>
type BusinessMethod = 'GET' | 'POST' | 'DELETE'
type PartnerCustomerType = 'private' | 'business'

type LocationInput = {
  postalCode: string
  street: string | null
  city: string | null
  country: string
}

const INTERNAL_INPUT_FIELDS = new Set([
  'company_id',
  'tenant_id',
  'tenant_reference',
  'api_client_id',
  'grid_owner_id',
  'price_area_id',
  'product_id',
  'contract_product_id',
  'contract_product_version_id',
  'publication_version_id',
  'price_plan_id',
  'price_plan_version_id',
  'price_book_id',
  'resolution_id',
  'offer_reference',
])

class BusinessPartnerApiError extends Error {
  status: number
  code: string
  field?: string
  details?: Json

  constructor(message: string, code: string, status = 400, field?: string, details?: Json) {
    super(message)
    this.name = 'BusinessPartnerApiError'
    this.status = status
    this.code = code
    this.field = field
    this.details = details
  }
}

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Json
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePostalCode(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  return /^\d{5}$/.test(digits) ? digits : null
}

function normalizeCustomerType(value: unknown): PartnerCustomerType {
  const normalized = String(value ?? 'PRIVATE').trim().toUpperCase()
  if (normalized === 'PRIVATE') return 'private'
  if (normalized === 'COMPANY' || normalized === 'BUSINESS') return 'business'
  throw new BusinessPartnerApiError(
    'customer_type must be PRIVATE or COMPANY.',
    'customer_type_invalid',
    422,
    'customer_type',
  )
}

function requestId(request: NextRequest): string {
  const candidate = request.headers.get('x-request-id')?.trim()
  return candidate && candidate.length <= 128 ? candidate : randomUUID()
}

function assertBusinessOnlyInput(value: unknown, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertBusinessOnlyInput(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value as Json)) {
    if (INTERNAL_INPUT_FIELDS.has(key)) {
      throw new BusinessPartnerApiError(
        `${key} is managed by Gridex and must not be sent by the partner.`,
        'internal_field_forbidden',
        422,
        `${path}.${key}`,
      )
    }
    assertBusinessOnlyInput(nested, `${path}.${key}`)
  }
}

function locationInputFromValues(input: {
  postalCode?: unknown
  zipCode?: unknown
  address?: unknown
  street?: unknown
  city?: unknown
  country?: unknown
}): LocationInput {
  const postalCode = normalizePostalCode(input.postalCode ?? input.zipCode)
  if (!postalCode) {
    throw new BusinessPartnerApiError(
      'postal_code must contain exactly five Swedish digits.',
      'postal_code_invalid',
      422,
      'postal_code',
    )
  }
  return {
    postalCode,
    street: text(input.address ?? input.street),
    city: text(input.city),
    country: (text(input.country) ?? 'SE').toUpperCase(),
  }
}

function locationInputFromQuery(request: NextRequest): LocationInput {
  return locationInputFromValues({
    postalCode: request.nextUrl.searchParams.get('postal_code'),
    zipCode: request.nextUrl.searchParams.get('zip_code'),
    address: request.nextUrl.searchParams.get('address'),
    street: request.nextUrl.searchParams.get('street'),
    city: request.nextUrl.searchParams.get('city'),
    country: request.nextUrl.searchParams.get('country'),
  })
}

function publicLocation(input: LocationInput, resolved: EnergyResolverResult) {
  const assurance = resolved.priceAreaAssurance
  const suggestedOnly = resolved.resolutionStatus === 'postal_suggested'
  const gridAreaCode = suggestedOnly
    ? resolved.suggestedGridAreaCode ?? null
    : resolved.gridAreaCode
  const gridOwnerName = suggestedOnly
    ? resolved.suggestedGridOwnerName ?? null
    : resolved.gridOwnerName
  const status = assurance.status === 'ambiguous'
    ? 'ambiguous'
    : resolved.priceArea && !suggestedOnly && resolved.gridAreaCode && resolved.gridOwnerName
      ? 'resolved'
      : resolved.priceArea
        ? 'partial'
        : 'unresolved'
  const needsAddress = status === 'ambiguous' || status === 'unresolved'
  return {
    postal_code: input.postalCode,
    city: input.city,
    status,
    price_area: resolved.priceArea,
    grid_area: gridAreaCode
      ? {
          code: gridAreaCode,
          name: suggestedOnly ? null : resolved.gridAreaName,
          verified: !suggestedOnly && Boolean(resolved.gridAreaCode),
        }
      : null,
    grid_owner: gridOwnerName
      ? {
          name: gridOwnerName,
          verified: !suggestedOnly && Boolean(resolved.gridOwnerId),
        }
      : null,
    confidence: resolved.confidence,
    price_area_confidence: assurance.confidence,
    resolution_method: assurance.source ?? resolved.sourceChain.at(-1) ?? null,
    requires_address: needsAddress,
    required_fields: needsAddress ? ['address', 'city'] : [],
    warnings: resolved.warnings,
  }
}

function ensurePricingReady(input: LocationInput, resolved: EnergyResolverResult) {
  const location = publicLocation(input, resolved)
  if (resolved.priceAreaAssurance.status === 'ambiguous') {
    throw new BusinessPartnerApiError(
      'The postal code spans more than one electricity price area. Send address and city so Gridex can resolve the correct area.',
      'location_ambiguous',
      409,
      'postal_code',
      { location },
    )
  }
  if (
    !resolved.resolutionId ||
    !resolved.priceArea ||
    !['verified', 'estimated'].includes(resolved.priceAreaAssurance.status)
  ) {
    throw new BusinessPartnerApiError(
      'Gridex could not resolve the electricity price area with sufficient confidence. Send address and city.',
      'location_not_resolved',
      422,
      'postal_code',
      { location },
    )
  }
  return location
}

async function resolveBusinessLocation(input: {
  client: IntegrationApiClient
  location: LocationInput
  customerId?: string | null
  customerSiteId?: string | null
}) {
  return resolveEnergyContext({
    companyId: input.client.company_id,
    customerId: input.customerId ?? null,
    customerSiteId: input.customerSiteId ?? null,
    street: input.location.street,
    postalCode: input.location.postalCode,
    city: input.location.city,
    country: input.location.country,
    metadata: {
      source_channel: 'partner_api',
      partner_surface: 'business_v1',
    },
  })
}

async function defaultOfferReference(
  client: IntegrationApiClient,
  customerType: PartnerCustomerType,
): Promise<string> {
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
    throw new BusinessPartnerApiError(
      'No published API offer is available for this customer type.',
      'offer_not_found',
      404,
    )
  }
  throw new BusinessPartnerApiError(
    'Several API offers are available. Gridex must bind one default offer to this credential.',
    'default_offer_not_configured',
    409,
  )
}

function normalizeError(error: unknown): BusinessPartnerApiError {
  if (error instanceof BusinessPartnerApiError) return error
  if (error instanceof EnergyResolutionBindingError) {
    return new BusinessPartnerApiError(
      error.message,
      error.code,
      error.status,
      error.field,
      error.details,
    )
  }
  if (error instanceof OfferQuoteError) {
    return new BusinessPartnerApiError(
      error.message,
      error.code,
      error.status,
      error.field,
      error.details,
    )
  }
  if (error instanceof CurrentMarketPriceError) {
    return new BusinessPartnerApiError(
      error.message,
      error.code,
      error.status,
      error.field ?? undefined,
      error.details,
    )
  }
  return new BusinessPartnerApiError(
    'The request could not be completed.',
    'partner_api_internal_error',
    500,
  )
}

function businessJson(body: Json, status: number, id: string) {
  return NextResponse.json(
    status >= 400 ? { ...body, request_id: id } : body,
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-ID': id,
        'X-Gridex-API-Version': PARTNER_API_VERSION,
      },
    },
  )
}

async function auth(
  request: NextRequest,
  scopes: IntegrationScopeRequirement,
): Promise<
  | { ok: true; client: IntegrationApiClient; startedAt: number; id: string }
  | { ok: false; response: NextResponse }
> {
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
      response: businessJson(
        { error: { code: result.errorCode, message: result.error } },
        result.status,
        id,
      ),
    }
  }
  return { ok: true, client: result.client, startedAt, id }
}

async function successLog(input: {
  request: NextRequest
  client: IntegrationApiClient
  startedAt: number
  status: number
  operation: string
  id: string
}) {
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: input.status,
    startedAt: input.startedAt,
    metadata: {
      request_id: input.id,
      api_surface: 'partner_v1_business',
      operation: input.operation,
    },
  }).catch(() => undefined)
}

async function failureResponse(input: {
  request: NextRequest
  client: IntegrationApiClient | null
  startedAt: number
  id: string
  error: unknown
}) {
  const error = normalizeError(input.error)
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: error.status,
    startedAt: input.startedAt,
    errorCode: error.code,
    metadata: { request_id: input.id, api_surface: 'partner_v1_business' },
  }).catch(() => undefined)
  if (error.status >= 500) {
    console.error('[partner-api-business] request failed', {
      requestId: input.id,
      path: input.request.nextUrl.pathname,
      error: input.error,
    })
  }
  return businessJson({
    error: {
      code: error.code,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
      ...(error.details ?? {}),
    },
  }, error.status, input.id)
}

async function getLocation(request: NextRequest) {
  const context = await auth(request, {
    anyOf: ['website_energy_area.resolve', 'customer_sites.read', 'partner_sites.write', 'partner_contracts.write'],
  })
  if (!context.ok) return context.response
  try {
    const locationInput = locationInputFromQuery(request)
    const resolved = await resolveBusinessLocation({
      client: context.client,
      location: locationInput,
    })
    const location = publicLocation(locationInput, resolved)
    if (location.status === 'ambiguous') {
      throw new BusinessPartnerApiError(
        'The postal code is ambiguous. Send address and city to resolve the correct grid area.',
        'location_ambiguous',
        409,
        'postal_code',
        { location },
      )
    }
    if (location.status === 'unresolved') {
      throw new BusinessPartnerApiError(
        'The location could not be resolved. Send address and city.',
        'location_not_resolved',
        422,
        'postal_code',
        { location },
      )
    }
    await successLog({
      request,
      client: context.client,
      startedAt: context.startedAt,
      status: 200,
      operation: 'location.resolve',
      id: context.id,
    })
    return businessJson({ location }, 200, context.id)
  } catch (error) {
    return failureResponse({
      request,
      client: context.client,
      startedAt: context.startedAt,
      id: context.id,
      error,
    })
  }
}

async function getCurrentPrice(request: NextRequest) {
  const context = await auth(request, {
    anyOf: ['website_market_prices.read', 'customer_contracts.read', 'partner_contracts.write'],
  })
  if (!context.ok) return context.response
  try {
    const locationInput = locationInputFromQuery(request)
    const resolved = await resolveBusinessLocation({
      client: context.client,
      location: locationInput,
    })
    const location = ensurePricingReady(locationInput, resolved)
    const current = await loadCurrentMarketPrice({
      client: context.client,
      resolutionId: resolved.resolutionId as string,
    })
    const marketPrice = {
      provider: current.provider,
      price_area: current.price_area,
      resolution: current.selected_resolution,
      available_resolutions: current.available_resolutions,
      valid_from: current.time_start,
      valid_to: current.time_end,
      price_sek_per_kwh_ex_vat: current.price_ex_vat_sek_per_kwh,
      price_ore_per_kwh_ex_vat: current.price_ex_vat_ore_per_kwh,
      currency: 'SEK',
      includes_vat: false,
      includes_supplier_fees: false,
      includes_grid_fees: false,
      source_as_of: current.source_as_of,
      next_update_at: current.next_update_at,
    }
    await successLog({
      request,
      client: context.client,
      startedAt: context.startedAt,
      status: 200,
      operation: 'price.current',
      id: context.id,
    })
    return businessJson({ location, market_price: marketPrice }, 200, context.id)
  } catch (error) {
    return failureResponse({
      request,
      client: context.client,
      startedAt: context.startedAt,
      id: context.id,
      error,
    })
  }
}

async function createPrice(request: NextRequest) {
  const context = await auth(request, {
    anyOf: ['website_quotes.write', 'customer_contracts.read', 'partner_contracts.write'],
  })
  if (!context.ok) return context.response
  try {
    const body = record(await request.json())
    assertBusinessOnlyInput(body)
    const allowed = new Set([
      'postal_code', 'zip_code', 'address', 'street', 'city', 'country',
      'annual_consumption_kwh', 'customer_type', 'start_date',
      'invoice_delivery_method',
    ])
    const unsupported = Object.keys(body).find((key) => !allowed.has(key))
    if (unsupported) {
      throw new BusinessPartnerApiError(
        `Unsupported field: ${unsupported}`,
        'unsupported_field',
        422,
        unsupported,
      )
    }
    const locationInput = locationInputFromValues({
      postalCode: body.postal_code,
      zipCode: body.zip_code,
      address: body.address,
      street: body.street,
      city: body.city,
      country: body.country,
    })
    const annualConsumptionKwh = numberValue(body.annual_consumption_kwh)
    if (annualConsumptionKwh === null || annualConsumptionKwh <= 0) {
      throw new BusinessPartnerApiError(
        'annual_consumption_kwh must be greater than 0.',
        'annual_consumption_invalid',
        422,
        'annual_consumption_kwh',
      )
    }
    const customerType = normalizeCustomerType(body.customer_type)
    const resolved = await resolveBusinessLocation({
      client: context.client,
      location: locationInput,
    })
    const location = ensurePricingReady(locationInput, resolved)
    const offerReference = await defaultOfferReference(context.client, customerType)
    const quote = await calculateOfferQuote({
      client: context.client,
      offerReference,
      resolutionId: resolved.resolutionId as string,
      resolutionBindingRequired: true,
      annualConsumptionKwh,
      startDate: text(body.start_date) ?? stockholmDateForInstant(new Date()),
      customerType,
      postalCode: locationInput.postalCode,
      invoiceDeliveryMethod: text(body.invoice_delivery_method) as 'email' | 'e_invoice' | 'paper' | null,
    })
    const estimate = record(quote.estimate)
    const monthlyConsumptionKwh = annualConsumptionKwh / 12
    const monthlyIncVat = numberValue(estimate.monthly_inc_vat)
    const estimatedUnitPrice = monthlyIncVat === null || monthlyConsumptionKwh <= 0
      ? null
      : Math.round((monthlyIncVat / monthlyConsumptionKwh) * 100000) / 100000
    const lines = Array.isArray(quote.lines)
      ? quote.lines.map((line) => {
          const row = record(line)
          return {
            code: row.component_code ?? null,
            name: row.name ?? null,
            quantity: row.quantity ?? null,
            unit: row.unit ?? null,
            unit_price_ex_vat: row.unit_price_ex_vat ?? null,
            amount_ex_vat: row.amount_ex_vat ?? null,
            vat_rate: row.vat_rate ?? null,
            vat_amount: row.vat_amount ?? null,
            amount_inc_vat: row.amount_inc_vat ?? null,
          }
        })
      : []
    const offer = record(quote.offer)
    const response = {
      quote_reference: quote.quote_reference,
      valid_until: quote.valid_until,
      location,
      offer: {
        name: offer.public_name ?? null,
        code: offer.product_code ?? null,
        contract_type: offer.contract_type ?? null,
      },
      customer_price: {
        estimated_sek_per_kwh_inc_vat: estimatedUnitPrice,
        currency: 'SEK',
        unit: 'kWh',
      },
      estimated_cost: {
        monthly_ex_vat: estimate.monthly_ex_vat ?? null,
        monthly_vat: estimate.monthly_vat ?? null,
        monthly_inc_vat: estimate.monthly_inc_vat ?? null,
        annual_ex_vat: estimate.annual_ex_vat ?? null,
        annual_vat: estimate.annual_vat ?? null,
        annual_inc_vat: estimate.annual_inc_vat ?? null,
        currency: 'SEK',
      },
      price_components: lines,
      is_binding: false,
      warnings: quote.warnings,
      assumptions: quote.assumptions,
    }
    await successLog({
      request,
      client: context.client,
      startedAt: context.startedAt,
      status: 200,
      operation: 'price.quote',
      id: context.id,
    })
    return businessJson(response, 200, context.id)
  } catch (error) {
    return failureResponse({
      request,
      client: context.client,
      startedAt: context.startedAt,
      id: context.id,
      error,
    })
  }
}

async function clientForSuccessfulRequest(request: NextRequest): Promise<IntegrationApiClient | null> {
  const credential = integrationCredential(request)
  if (!credential.ok) return null
  const token = credential.token
  const result = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,name,status,key_prefix,secret_hash,scopes,allowed_ips,allowed_origins,metadata,rate_limit_per_minute,expires_at')
    .eq('key_prefix', token.slice(0, 12))
    .eq('secret_hash', hashIntegrationApiSecret(token))
    .eq('status', 'active')
    .maybeSingle()
  if (result.error || !result.data) return null
  return result.data as IntegrationApiClient
}

async function ensureCreatedSiteResolution(input: {
  request: NextRequest
  response: NextResponse
  siteReference: string | null
  source: 'site' | 'contract'
}) {
  if (!input.siteReference || input.response.status >= 400) return input.response
  const client = await clientForSuccessfulRequest(input.request)
  if (!client) return input.response

  const siteResult = await supabaseService
    .from('customer_sites')
    .select('id,customer_id,street,postal_code,city,country,resolution_id')
    .eq('company_id', client.company_id)
    .eq('facility_reference', input.siteReference)
    .maybeSingle()
  if (siteResult.error || !siteResult.data) return input.response

  if (siteResult.data.resolution_id) {
    const existing = await supabaseService
      .from('customer_site_resolution')
      .select('expires_at')
      .eq('id', siteResult.data.resolution_id)
      .eq('company_id', client.company_id)
      .maybeSingle()
    if (!existing.error && existing.data?.expires_at && Date.parse(existing.data.expires_at) > Date.now()) {
      return input.response
    }
  }

  const postalCode = normalizePostalCode(siteResult.data.postal_code)
  if (!postalCode) return input.response
  await resolveBusinessLocation({
    client,
    location: {
      postalCode,
      street: text(siteResult.data.street),
      city: text(siteResult.data.city),
      country: (text(siteResult.data.country) ?? 'SE').toUpperCase(),
    },
    customerId: String(siteResult.data.customer_id),
    customerSiteId: String(siteResult.data.id),
  }).catch((error) => {
    console.error('[partner-api-business] automatic site resolution failed', {
      source: input.source,
      siteReference: input.siteReference,
      error,
    })
  })
  return input.response
}

async function createSiteWithResolution(
  request: NextRequest,
  method: BusinessMethod,
  path: string[] | undefined,
) {
  const response = await handleSimplePartnerApi(request, method, path)
  if (!response || response.status >= 400) return response
  const payload = record(await response.clone().json().catch(() => ({})))
  return ensureCreatedSiteResolution({
    request,
    response,
    siteReference: text(payload.entity_id),
    source: 'site',
  })
}

async function createContractWithResolution(
  request: NextRequest,
  method: BusinessMethod,
  path: string[] | undefined,
) {
  const response = await handleSimplePartnerApi(request, method, path)
  if (!response || response.status >= 400) return response
  const payload = record(await response.clone().json().catch(() => ({})))
  return ensureCreatedSiteResolution({
    request,
    response,
    siteReference: text(record(payload.site).entity_id),
    source: 'contract',
  })
}

export async function handleBusinessPartnerApi(
  request: NextRequest,
  method: BusinessMethod,
  path: string[] | undefined,
): Promise<NextResponse | null> {
  const segments = (path ?? []).filter(Boolean)

  if (method === 'GET' && segments.length === 1 && segments[0] === 'location') {
    return getLocation(request)
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'price' && segments[1] === 'current') {
    return getCurrentPrice(request)
  }
  if (method === 'POST' && segments.length === 1 && segments[0] === 'price') {
    return createPrice(request)
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'contract') {
    return createContractWithResolution(request, method, path)
  }
  if (method === 'POST' && segments.length === 3 && segments[0] === 'customer' && segments[2] === 'site') {
    return createSiteWithResolution(request, method, path)
  }

  return null
}
