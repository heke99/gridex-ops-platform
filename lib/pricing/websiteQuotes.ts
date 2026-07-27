import { createHash, randomBytes } from 'node:crypto'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { PublicContractOffer } from '@/lib/website/publicContracts'
import { recordCanonicalEnergyEvent } from '@/lib/energy/canonicalEnergyEvents'
import { EnergyResolutionBindingError, loadQuoteEnergyResolution } from '@/lib/energy/resolutionBinding'

export type WebsiteQuoteRecord = {
  id: string
  company_id: string
  api_client_id: string | null
  quote_reference: string
  offer_reference: string
  contract_product_id: string | null
  contract_product_version_id: string | null
  contract_publication_version_id: string | null
  price_plan_id: string | null
  price_plan_version_id: string | null
  price_book_id: string | null
  legal_bundle_version_id: string | null
  energy_direction: 'consumption' | 'production'
  customer_type: 'private' | 'business'
  price_area: string
  grid_area_code: string | null
  energy_resolution_id: string | null
  resolution_snapshot: Record<string, unknown>
  resolver_version: string | null
  geodata_version: string | null
  market_reference: Record<string, unknown>
  quote_hash: string | null
  resolution_binding_status: 'verified' | 'legacy_unverified'
  postal_code: string | null
  annual_consumption_kwh: number
  start_date: string
  market_data_timestamp: string | null
  market_sources: unknown
  assumptions: unknown
  pricing_snapshot_schema_version: string
  quote_snapshot: Record<string, unknown>
  valid_until: string
  status: 'active' | 'consumed' | 'expired' | 'revoked'
  consumed_at: string | null
  consumed_application_id: string | null
  created_at: string
}

export class WebsiteQuoteValidationError extends Error {
  readonly code: string
  readonly status: number
  readonly field: string
  readonly details?: Record<string, unknown>

  constructor(input: { message: string; code: string; status?: number; field?: string; details?: Record<string, unknown> }) {
    super(input.message)
    this.name = 'WebsiteQuoteValidationError'
    this.code = input.code
    this.status = input.status ?? 422
    this.field = input.field ?? 'quote_reference'
    this.details = input.details
  }
}

function quoteLifetimeMinutes(): number {
  const configured = Number(process.env.WEBSITE_QUOTE_VALIDITY_MINUTES ?? '15')
  if (!Number.isFinite(configured)) return 15
  return Math.min(Math.max(Math.trunc(configured), 5), 120)
}

function newQuoteReference(): string {
  return `quote_${randomBytes(18).toString('base64url')}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function quoteHash(snapshot: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex')
}

export async function persistWebsiteQuote(input: {
  client: IntegrationApiClient
  offer: PublicContractOffer
  offerReference: string
  customerType: 'private' | 'business'
  priceArea: string
  gridAreaCode?: string | null
  postalCode?: string | null
  annualConsumptionKwh: number
  startDate: string
  marketDataTimestamp?: string | null
  marketSources: unknown
  assumptions: unknown
  pricingSnapshotSchemaVersion: string
  resolutionId?: string | null
  resolutionSnapshot?: Record<string, unknown>
  resolverVersion?: string | null
  geodataVersion?: string | null
  marketReference?: Record<string, unknown>
  resolutionBindingStatus?: 'verified' | 'legacy_unverified'
  quoteSnapshot: Record<string, unknown>
}): Promise<{ quoteReference: string; validUntil: string }> {
  const quoteReference = newQuoteReference()
  const validUntil = new Date(Date.now() + quoteLifetimeMinutes() * 60_000).toISOString()
  const immutableQuoteHash = quoteHash(input.quoteSnapshot)
  const { data: inserted, error } = await supabaseService.from('website_contract_quotes').insert({
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    quote_reference: quoteReference,
    offer_reference: input.offerReference,
    contract_product_id: input.offer.contract_product_id ?? null,
    contract_product_version_id: input.offer.contract_product_version_id ?? null,
    contract_publication_version_id: input.offer.contract_publication_version_id ?? null,
    price_plan_id: input.offer.price_plan_id ?? null,
    price_plan_version_id: input.offer.price_plan_version_id ?? null,
    price_book_id: input.offer.price_book_id ?? null,
    legal_bundle_version_id: input.offer.legal_bundle_version_id ?? null,
    energy_direction: input.offer.energy_direction,
    customer_type: input.customerType,
    price_area: input.priceArea,
    grid_area_code: input.gridAreaCode ?? null,
    energy_resolution_id: input.resolutionId ?? null,
    resolution_snapshot: input.resolutionSnapshot ?? {},
    resolver_version: input.resolverVersion ?? null,
    geodata_version: input.geodataVersion ?? null,
    market_reference: input.marketReference ?? {},
    quote_hash: immutableQuoteHash,
    resolution_binding_status: input.resolutionBindingStatus ?? 'legacy_unverified',
    postal_code: input.postalCode ?? null,
    annual_consumption_kwh: input.annualConsumptionKwh,
    start_date: input.startDate,
    market_data_timestamp: input.marketDataTimestamp ?? null,
    market_sources: input.marketSources ?? [],
    assumptions: input.assumptions ?? [],
    pricing_snapshot_schema_version: input.pricingSnapshotSchemaVersion,
    quote_snapshot: input.quoteSnapshot,
    valid_until: validUntil,
    status: 'active',
  }).select('id').single()
  if (error) throw error
  await recordCanonicalEnergyEvent({
    eventType: 'quote.created',
    companyId: input.client.company_id,
    resolutionId: input.resolutionId ?? null,
    quoteId: inserted?.id ? String(inserted.id) : null,
    correlationId: input.client.id,
    source: 'website_quote_api',
    actorType: 'api_client',
    actorId: input.client.id,
    payload: {
      quote_reference: quoteReference,
      offer_reference: input.offerReference,
      price_area: input.priceArea,
      valid_until: validUntil,
      quote_hash: immutableQuoteHash,
      market_reference: input.marketReference ?? {},
      contract_product_id: input.offer.contract_product_id ?? null,
      contract_product_version_id: input.offer.contract_product_version_id ?? null,
      contract_publication_version_id: input.offer.contract_publication_version_id ?? null,
      price_plan_id: input.offer.price_plan_id ?? null,
      price_plan_version_id: input.offer.price_plan_version_id ?? null,
      price_book_id: input.offer.price_book_id ?? null,
      legal_bundle_version_id: input.offer.legal_bundle_version_id ?? null,
      energy_direction: input.offer.energy_direction,
    },
  })
  return { quoteReference, validUntil }
}

function sameNumber(left: unknown, right: unknown): boolean {
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.0001
}

export async function validateWebsiteQuote(input: {
  client: IntegrationApiClient
  quoteReference: string
  offerReference: string
  publicOffer: PublicContractOffer
  customerType: 'private' | 'business'
  priceArea: string | null
  resolutionId?: string | null
  gridAreaCode?: string | null
  postalCode?: string | null
  annualConsumptionKwh: number | null
  startDate: string | null
  applicationId?: string | null
}): Promise<WebsiteQuoteRecord> {
  const { data, error } = await supabaseService
    .from('website_contract_quotes')
    .select('*')
    .eq('company_id', input.client.company_id)
    .eq('quote_reference', input.quoteReference)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw new WebsiteQuoteValidationError({ message: 'Quote hittades inte för denna tenant.', code: 'quote_not_found', status: 404 })
  }

  const quote = data as WebsiteQuoteRecord
  let canonicalResolution: Awaited<ReturnType<typeof loadQuoteEnergyResolution>> | null = null
  if (input.resolutionId?.trim()) {
    try {
      canonicalResolution = await loadQuoteEnergyResolution({
        client: input.client,
        resolutionId: input.resolutionId,
      })
    } catch (error) {
      if (error instanceof EnergyResolutionBindingError) {
        throw new WebsiteQuoteValidationError({
          message: error.message,
          code: error.code,
          status: error.status,
          field: error.field,
        })
      }
      throw error
    }
  }
  if (canonicalResolution && input.priceArea && input.priceArea.toUpperCase() !== canonicalResolution.priceArea) {
    throw new WebsiteQuoteValidationError({
      message: 'Inskickat price_area motsäger OPS-resolutionen.',
      code: 'price_area_mismatch',
      status: 409,
      field: 'price_area',
    })
  }
  if (
    canonicalResolution?.gridAreaCode
    && input.gridAreaCode
    && input.gridAreaCode.toUpperCase() !== canonicalResolution.gridAreaCode.toUpperCase()
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Inskickad grid_area_code motsäger OPS-resolutionen.',
      code: 'quote_resolution_mismatch',
      status: 409,
      field: 'grid_area_code',
    })
  }
  const canonicalPriceArea = canonicalResolution?.priceArea ?? input.priceArea
  const canonicalGridAreaCode = canonicalResolution?.gridAreaCode ?? input.gridAreaCode ?? null
  const computedQuoteHash = quoteHash(quote.quote_snapshot)
  if (!quote.quote_hash || quote.quote_hash !== computedQuoteHash) {
    throw new WebsiteQuoteValidationError({
      message: 'Quote-underlaget har ändrats efter att det skapades.',
      code: 'quote_reference_mismatch',
      status: 409,
      field: 'quote_reference',
      details: { reason: 'quote_hash_mismatch' },
    })
  }
  if (quote.status === 'revoked') {
    throw new WebsiteQuoteValidationError({ message: 'Quote har återkallats.', code: 'quote_revoked', status: 409 })
  }
  if (new Date(quote.valid_until).getTime() <= Date.now() || quote.status === 'expired') {
    await supabaseService
      .from('website_contract_quotes')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', quote.id)
      .eq('status', 'active')
    throw new WebsiteQuoteValidationError({ message: 'Quote har gått ut. Hämta ett nytt pris.', code: 'quote_expired', status: 409 })
  }
  if (quote.status === 'consumed' && quote.consumed_application_id !== (input.applicationId ?? null)) {
    throw new WebsiteQuoteValidationError({
      message: 'Quote har redan använts av en annan kundansökan.',
      code: 'quote_consumed',
      status: 409,
      details: { consumed_application_id: quote.consumed_application_id },
    })
  }

  const mismatches: string[] = []
  if (quote.offer_reference !== input.offerReference) mismatches.push('offer_reference')
  if (quote.customer_type !== input.customerType) mismatches.push('customer_type')
  if (quote.price_area !== canonicalPriceArea) mismatches.push('price_area')
  if (input.resolutionId && quote.energy_resolution_id !== input.resolutionId) mismatches.push('resolution_id')
  if (quote.resolution_binding_status === 'verified' && !input.resolutionId) mismatches.push('resolution_id')
  if (quote.resolution_binding_status === 'verified' && String(quote.resolution_snapshot?.price_area ?? '') !== quote.price_area) mismatches.push('resolution_snapshot.price_area')
  if (quote.resolution_binding_status === 'verified' && String(quote.resolution_snapshot?.resolution_id ?? '') !== String(quote.energy_resolution_id ?? '')) mismatches.push('resolution_snapshot.resolution_id')
  if (canonicalResolution && quote.energy_resolution_id !== canonicalResolution.id) mismatches.push('resolution_id')
  if (canonicalResolution && quote.resolver_version !== canonicalResolution.resolverVersion) mismatches.push('resolver_version')
  if (canonicalResolution && (quote.geodata_version ?? null) !== (canonicalResolution.geodataVersion ?? null)) mismatches.push('geodata_version')
  if (canonicalResolution && String(quote.resolution_snapshot?.grid_area_code ?? '') !== canonicalResolution.gridAreaCode) mismatches.push('resolution_snapshot.grid_area_code')
  if (canonicalGridAreaCode && quote.grid_area_code !== canonicalGridAreaCode) mismatches.push('grid_area_code')
  if (input.postalCode && quote.postal_code && quote.postal_code !== input.postalCode) mismatches.push('postal_code')
  if (input.annualConsumptionKwh === null || !sameNumber(quote.annual_consumption_kwh, input.annualConsumptionKwh)) mismatches.push('annual_consumption_kwh')
  if (quote.start_date !== input.startDate) mismatches.push('start_date')
  if ((quote.contract_product_id ?? null) !== (input.publicOffer.contract_product_id ?? null)) mismatches.push('contract_product_id')
  if ((quote.contract_product_version_id ?? null) !== (input.publicOffer.contract_product_version_id ?? null)) mismatches.push('contract_product_version_id')
  if ((quote.contract_publication_version_id ?? null) !== (input.publicOffer.contract_publication_version_id ?? null)) mismatches.push('contract_publication_version_id')
  if ((quote.price_plan_id ?? null) !== (input.publicOffer.price_plan_id ?? null)) mismatches.push('price_plan_id')
  if ((quote.price_plan_version_id ?? null) !== (input.publicOffer.price_plan_version_id ?? null)) mismatches.push('price_plan_version_id')
  if ((quote.price_book_id ?? null) !== (input.publicOffer.price_book_id ?? null)) mismatches.push('price_book_id')
  if ((quote.legal_bundle_version_id ?? null) !== (input.publicOffer.legal_bundle_version_id ?? null)) mismatches.push('legal_bundle_version_id')
  if (quote.energy_direction !== input.publicOffer.energy_direction) mismatches.push('energy_direction')

  if (mismatches.length > 0) {
    throw new WebsiteQuoteValidationError({
      message: 'Quote matchar inte kundansökans avtals- eller beräkningsunderlag.',
      code: mismatches.includes('resolution_id') ? 'quote_resolution_mismatch' : 'quote_reference_mismatch',
      status: 409,
      field: mismatches[0],
      details: { mismatches },
    })
  }

  await recordCanonicalEnergyEvent({
    eventType: 'quote.validated',
    companyId: input.client.company_id,
    resolutionId: quote.energy_resolution_id,
    quoteId: quote.id,
    source: 'website_quote_validation',
    actorType: 'api_client',
    actorId: input.client.id,
    payload: { quote_reference: quote.quote_reference, application_id: input.applicationId ?? null },
  })
  return quote
}

export async function markWebsiteQuoteConsumed(input: {
  companyId: string
  quoteReference: string
  applicationId: string
}): Promise<void> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('website_contract_quotes')
    .update({ status: 'consumed', consumed_at: now, consumed_application_id: input.applicationId, updated_at: now })
    .eq('company_id', input.companyId)
    .eq('quote_reference', input.quoteReference)
    .eq('status', 'active')
    .select('id,consumed_application_id')
    .maybeSingle()
  if (error) throw error
  if (data) return

  const { data: current, error: readError } = await supabaseService
    .from('website_contract_quotes')
    .select('status,consumed_application_id')
    .eq('company_id', input.companyId)
    .eq('quote_reference', input.quoteReference)
    .maybeSingle()
  if (readError) throw readError
  if (current?.status === 'consumed' && current.consumed_application_id === input.applicationId) return

  throw new WebsiteQuoteValidationError({
    message: 'Quote har redan reserverats av en annan kundansökan.',
    code: current ? 'quote_already_consumed' : 'quote_not_found',
    status: current ? 409 : 404,
    details: current ? { consumed_application_id: current.consumed_application_id } : undefined,
  })
}
