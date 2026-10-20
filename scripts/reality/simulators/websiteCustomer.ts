// Tenant-website simulator: behaves like an electricity supplier's own public
// website (its backend) onboarding a private customer through the platform's
// public Website Integration API v1. It uses ONLY public HTTP (fetch) with the
// tenant's API key, exactly as an external website would: no database access
// and no imports from the application. Every field name below is taken from the
// route handlers under app/api/v1/website/**, lib/website/customerApplicationSchemas.ts
// and docs/openapi/website-integration-v1.json.
//
// Sequence (the real checkout flow):
//   1. GET  /api/v1/website/public-contracts?customer_type=private
//   2. POST /api/v1/website/energy-area/resolve            -> resolution_id
//   3. POST /api/v1/website/quote          (Idempotency-Key) -> quote_reference + settlement
//   4. GET  /api/v1/website/legal-bundle?offer_reference=...  -> bundle_version + requirements
//   5. POST /api/v1/website/customer-applications (Idempotency-Key)
//
// The first non-2xx response stops the flow and is returned as-is, so a caller
// sees exactly where a real website would fail. Simulator-side failures (no
// usable offer, network error, unexpected response shape) use status 0.
import { createHash, randomUUID } from 'node:crypto'

export type SimulatedPerson = {
  firstName: string
  lastName: string
  /** Swedish test personnummer YYYYMMDDNNNN */
  personalNumber: string
  email: string
  phone: string
  address: { street: string; postalCode: string; city: string }
}

export type SimulatedSite = {
  /** 18-digit GSRN */
  facilityId: string
  gridAreaCode?: string
  priceArea: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  annualConsumptionKwh: number
  address?: { street: string; postalCode: string; city: string }
  /** YYYY-MM-DD, makes it a move-in */
  moveInDate?: string
}

export type WebsiteApplicationResult = {
  step: string
  status: number
  body: unknown
  applicationNumber?: string
  requests: Array<{ method: string; path: string; status: number; ms: number }>
}

type RequestLog = WebsiteApplicationResult['requests']
type JsonRecord = Record<string, unknown>
type ApiResponse = { status: number; body: unknown }

const REQUEST_TIMEOUT_MS = 60_000
const SWITCH_LEAD_BUSINESS_DAYS = 15

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function is2xx(status: number): boolean {
  return status >= 200 && status < 300
}

function simulatorFailure(step: string, requests: RequestLog, code: string, details: JsonRecord = {}): WebsiteApplicationResult {
  return { step, status: 0, body: { simulator_error: code, ...details }, requests }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type HttpContext = { baseUrl: string; apiKey: string; origin?: string; requests: RequestLog }

async function call(
  ctx: HttpContext,
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.apiKey}`,
    Accept: 'application/json',
    'User-Agent': 'gridex-reality-website-simulator/1',
  }
  if (ctx.origin) headers.Origin = ctx.origin
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const url = `${ctx.baseUrl.replace(/\/+$/, '')}${path}`
  const started = performance.now()
  let status = 0
  let body: unknown = null
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'manual',
    })
    status = response.status
    const raw = await response.text()
    if (raw) {
      try {
        body = JSON.parse(raw) as unknown
      } catch {
        body = raw
      }
    }
  } catch (error) {
    status = 0
    body = {
      simulator_error: 'network_error',
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
  ctx.requests.push({ method, path, status, ms: Math.round(performance.now() - started) })
  return { status, body }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Same business-day walk as the platform's calculatedEarliestStartDate (Mon-Fri). */
function addBusinessDays(from: Date, days: number): string {
  const output = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  let remaining = days
  while (remaining > 0) {
    output.setUTCDate(output.getUTCDate() + 1)
    const day = output.getUTCDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return isoDate(output)
}

function maxDate(...values: Array<string | null>): string | null {
  return values.reduce<string | null>((max, value) => (value && (!max || value > max) ? value : max), null)
}

/** Inclusive range, matching lib/pricing/commercialModel.ts dateInRange. */
function inRange(date: string, from: string | null, to: string | null): boolean {
  return (!from || from <= date) && (!to || to >= date)
}

// ---------------------------------------------------------------------------
// Offer selection (public-contracts feed)
// ---------------------------------------------------------------------------

type SelectedOffer = {
  offer: JsonRecord
  offerReference: string
  priceOptionReference: string
  startDate: string
}

function customerTypeAllowsPrivate(value: unknown): boolean {
  return value === 'private' || value === 'both'
}

/**
 * Picks the first published consumption offer a private customer can sign in the
 * given price area on a start date the price option accepts. A move-in start
 * date is fixed; a supplier-switch date is the platform's earliest-start policy
 * moved forward to the option's earliest_start_date / valid_from when needed.
 */
function selectOffer(contracts: JsonRecord[], priceArea: string, moveInDate: string | null): SelectedOffer | null {
  const baselineStart = moveInDate ?? addBusinessDays(new Date(), SWITCH_LEAD_BUSINESS_DAYS)
  for (const offer of contracts) {
    const offerReference = text(offer.offer_reference)
    if (!offerReference) continue
    if (!customerTypeAllowsPrivate(offer.customer_type)) continue
    if (offer.energy_direction !== undefined && offer.energy_direction !== 'consumption') continue
    // The application rejects offers whose price_areas do not contain the
    // verified area (customerApplicationProcess: public_contract_price_area_not_available).
    const offerAreas = strings(offer.price_areas).map((area) => area.toUpperCase())
    if (Array.isArray(offer.price_areas) && !offerAreas.includes(priceArea)) continue

    const options = records(offer.price_options)
    const ordered = [...options.filter((option) => option.is_default === true), ...options.filter((option) => option.is_default !== true)]
    for (const option of ordered) {
      const priceOptionReference = text(option.price_option_reference)
      if (!priceOptionReference) continue
      if (!customerTypeAllowsPrivate(option.customer_type)) continue
      const validFrom = text(option.valid_from)
      const validTo = text(option.valid_to)
      const earliest = text(option.earliest_start_date)
      const latest = text(option.latest_start_date)
      const startDate = moveInDate ?? maxDate(baselineStart, earliest, validFrom) ?? baselineStart
      if (!inRange(startDate, validFrom, validTo)) continue
      if (earliest && startDate < earliest) continue
      if (latest && startDate > latest) continue
      const areaPrices = records(option.area_prices)
      const contractType = text(option.contract_type) ?? text(offer.contract_type)
      const areaPriceAvailable = areaPrices.some(
        (row) => text(row.price_area)?.toUpperCase() === priceArea && inRange(startDate, text(row.valid_from), text(row.valid_to)),
      )
      // Fixed prices need a valid area price row (commercialModel: price_option_area_price_missing).
      if (contractType === 'fixed' && !areaPriceAvailable) continue
      if (areaPrices.length > 0 && !areaPriceAvailable && !Array.isArray(offer.price_areas)) continue
      return { offer, offerReference, priceOptionReference, startDate }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

export async function applyAsWebsiteCustomer(input: {
  baseUrl: string
  apiKey: string
  origin?: string
  person: SimulatedPerson
  site: SimulatedSite
  idempotencyKey?: string
  /**
   * Optional ISO timestamp used as the customer's acceptance time for legal
   * documents and the power of attorney. Pass the same value together with the
   * same idempotencyKey to retry an identical payload (the platform hashes the
   * whole payload for idempotency). Defaults to now.
   */
  acceptedAt?: string
}): Promise<WebsiteApplicationResult> {
  const requests: RequestLog = []
  const ctx: HttpContext = { baseUrl: input.baseUrl, apiKey: input.apiKey, origin: input.origin, requests }
  const { person, site } = input
  const siteAddress = site.address ?? person.address
  const moveInDate = text(site.moveInDate)
  const priceArea = site.priceArea
  const applicationIdempotencyKey = input.idempotencyKey ?? `sim-app-${randomUUID()}`
  const quoteIdempotencyKey = input.idempotencyKey
    ? `${input.idempotencyKey.slice(0, 190)}.quote`
    : `sim-quote-${randomUUID()}`
  const acceptedAt = input.acceptedAt ?? new Date().toISOString()

  // 1. Published offers for private customers.
  const contracts = await call(ctx, 'GET', '/api/v1/website/public-contracts?customer_type=private')
  if (!is2xx(contracts.status)) return { step: 'public_contracts', ...contracts, requests }
  const feed = records(field(contracts.body, 'data'))

  // 2. Resolve the price area -> resolution_id. The route treats facility_id and
  //    metering_point_id as references only; grid_area_code, postal_code or
  //    street+city are what actually resolve an area.
  const resolveBody: JsonRecord = {
    facility_id: site.facilityId,
    metering_point_id: site.facilityId,
  }
  if (site.gridAreaCode) {
    resolveBody.grid_area_code = site.gridAreaCode
  } else {
    resolveBody.street = siteAddress.street
    resolveBody.postal_code = siteAddress.postalCode
    resolveBody.city = siteAddress.city
    resolveBody.country = 'SE'
  }
  const resolved = await call(ctx, 'POST', '/api/v1/website/energy-area/resolve', { body: resolveBody })
  if (!is2xx(resolved.status)) return { step: 'energy_area_resolve', ...resolved, requests }
  const resolution = field(resolved.body, 'data')
  const resolutionId = text(field(resolution, 'resolution_id'))
  const resolvedPriceArea = text(field(resolution, 'price_area'))?.toUpperCase() ?? null
  if (!resolutionId) {
    return simulatorFailure('energy_area_resolve', requests, 'resolution_id_missing', { response: resolved.body })
  }
  if (resolvedPriceArea !== priceArea) {
    return simulatorFailure('energy_area_resolve', requests, 'price_area_mismatch', {
      expected_price_area: priceArea,
      resolved_price_area: resolvedPriceArea,
      response: resolved.body,
    })
  }

  const selected = selectOffer(feed, priceArea, moveInDate)
  if (!selected) {
    return simulatorFailure('select_offer', requests, 'no_usable_private_offer', {
      price_area: priceArea,
      move_in_date: moveInDate,
      offer_references: feed.map((offer) => text(offer.offer_reference)),
    })
  }

  // 3. Authoritative quote (QuoteRequest; app/api/v1/website/quote/route.ts allowedFields).
  const quoteBody = {
    offer_reference: selected.offerReference,
    customer_type: 'private',
    resolution_id: resolutionId,
    annual_consumption_kwh: site.annualConsumptionKwh,
    start_date: selected.startDate,
    price_option_reference: selected.priceOptionReference,
    invoice_delivery_method: 'email',
    selected_component_references: [] as string[],
    site_count: 1,
  }
  const quote = await call(ctx, 'POST', '/api/v1/website/quote', { body: quoteBody, idempotencyKey: quoteIdempotencyKey })
  if (!is2xx(quote.status)) return { step: 'quote', ...quote, requests }
  const quoteData = field(quote.body, 'data')
  const quoteReference = text(field(quoteData, 'quote_reference'))
  const settlement = field(quoteData, 'settlement')
  if (!quoteReference || !isRecord(settlement)) {
    return simulatorFailure('quote', requests, 'quote_response_incomplete', { response: quote.body })
  }
  // The stored quote holds the resolved list (mandatory + conditional + chosen
  // optional components); the application must repeat it exactly.
  const quotedComponents = strings(field(quoteData, 'selected_component_references'))
  const quotedPriceOption = text(field(quoteData, 'price_option_reference')) ?? selected.priceOptionReference
  const quotedInvoiceDelivery = text(field(quoteData, 'invoice_delivery_method')) ?? quoteBody.invoice_delivery_method

  // 4. Exact legal bundle the customer accepts.
  const bundle = await call(
    ctx,
    'GET',
    `/api/v1/website/legal-bundle?offer_reference=${encodeURIComponent(selected.offerReference)}`,
  )
  if (!is2xx(bundle.status)) return { step: 'legal_bundle', ...bundle, requests }
  const bundleData = field(bundle.body, 'data')
  const offerLegal = field(selected.offer, 'legal')
  const legalBundleVersion =
    text(field(bundleData, 'bundle_version')) ?? text(field(offerLegal, 'legal_bundle_reference'))
  const requirements = records(field(bundleData, 'requirements'))
  const legalDocuments = requirements.length > 0 ? requirements : records(field(offerLegal, 'customer_documents'))
  if (!legalBundleVersion || legalDocuments.length === 0) {
    return simulatorFailure('legal_bundle', requests, 'legal_bundle_incomplete', { response: bundle.body })
  }
  const legalAcceptances = legalDocuments.map((document) => ({
    requirement_code: text(document.requirement_code) ?? '',
    document_reference: text(document.document_reference) ?? '',
    document_version: text(document.document_version) ?? '',
    document_hash: text(document.document_hash) ?? '',
    accepted: true as const,
    accepted_at: acceptedAt,
  }))
  const poaRequirement = legalDocuments.find((document) => document.requirement_code === 'power_of_attorney')
  const poaTextVersionId =
    text(poaRequirement?.primary_document_id) ?? text(field(offerLegal, 'power_of_attorney_version_id'))

  // 5. Customer application (CustomerApplicationRequest / ApplicationSchema).
  const externalCustomerReference = `sim-${createHash('sha256').update(person.personalNumber).digest('hex').slice(0, 24)}`
  const applicationSite: JsonRecord = {
    facility_id: site.facilityId,
    street: siteAddress.street,
    postal_code: siteAddress.postalCode,
    city: siteAddress.city,
    country: 'SE',
    annual_consumption_kwh: site.annualConsumptionKwh,
  }
  if (moveInDate) {
    // site.move_in_date classifies the process as move_in.
    applicationSite.move_in_date = moveInDate
  } else {
    // Supplier switch at an existing site: current-supplier evidence makes the
    // platform classify it as supplier_switch_existing_site, not move_in.
    applicationSite.current_supplier_unknown = true
  }
  const powerOfAttorney: JsonRecord = {
    accepted: true,
    scope: ['supplier_switch'],
    signerName: `${person.firstName} ${person.lastName}`,
    signerIdentityNumber: person.personalNumber,
    method: 'website_acceptance',
    acceptedAt,
  }
  if (poaTextVersionId) powerOfAttorney.textVersionId = poaTextVersionId

  const applicationBody = {
    external_customer_reference: externalCustomerReference,
    offer_reference: selected.offerReference,
    quote_reference: quoteReference,
    resolution_id: resolutionId,
    legal_bundle_version: legalBundleVersion,
    price_option_reference: quotedPriceOption,
    invoice_delivery_method: quotedInvoiceDelivery,
    selected_component_references: quotedComponents,
    site_count: 1,
    settlement,
    annual_consumption_kwh: site.annualConsumptionKwh,
    customer: {
      customer_type: 'private',
      first_name: person.firstName,
      last_name: person.lastName,
      personal_number: person.personalNumber,
      email: person.email,
      phone: person.phone,
      billing_street: person.address.street,
      billing_postal_code: person.address.postalCode,
      billing_city: person.address.city,
      billing_country: 'SE',
    },
    site: applicationSite,
    metering_point: {
      metering_point_id: site.facilityId,
      site_facility_id: site.facilityId,
    },
    // Never send top-level start_date: the platform maps it to site.move_in_date.
    contract: {
      requested_start_mode: 'specific_date',
      requested_start_date: selected.startDate,
    },
    legal_acceptances: legalAcceptances,
    powerOfAttorney,
  }
  const application = await call(ctx, 'POST', '/api/v1/website/customer-applications', {
    body: applicationBody,
    idempotencyKey: applicationIdempotencyKey,
  })
  if (!is2xx(application.status)) return { step: 'customer_application', ...application, requests }
  const applicationNumber = text(field(field(application.body, 'data'), 'application_number')) ?? undefined
  return { step: 'customer_application', ...application, applicationNumber, requests }
}
