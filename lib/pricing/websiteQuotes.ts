import { randomBytes } from 'node:crypto'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { PublicContractOffer } from '@/lib/website/publicContracts'

export type WebsiteQuoteRecord = {
  id: string
  company_id: string
  api_client_id: string | null
  quote_reference: string
  offer_reference: string
  contract_product_version_id: string | null
  contract_publication_version_id: string | null
  price_plan_version_id: string | null
  legal_bundle_version_id: string | null
  customer_type: 'private' | 'business'
  price_area: string
  grid_area_code: string | null
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
  quoteSnapshot: Record<string, unknown>
}): Promise<{ quoteReference: string; validUntil: string }> {
  const quoteReference = newQuoteReference()
  const validUntil = new Date(Date.now() + quoteLifetimeMinutes() * 60_000).toISOString()
  const { error } = await supabaseService.from('website_contract_quotes').insert({
    company_id: input.client.company_id,
    api_client_id: input.client.id,
    quote_reference: quoteReference,
    offer_reference: input.offerReference,
    contract_product_version_id: input.offer.contract_product_version_id ?? null,
    contract_publication_version_id: input.offer.contract_publication_version_id ?? null,
    price_plan_version_id: input.offer.price_plan_version_id ?? null,
    legal_bundle_version_id: input.offer.legal_bundle_version_id ?? null,
    customer_type: input.customerType,
    price_area: input.priceArea,
    grid_area_code: input.gridAreaCode ?? null,
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
  })
  if (error) throw error
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
      code: 'quote_already_consumed',
      status: 409,
      details: { consumed_application_id: quote.consumed_application_id },
    })
  }

  const mismatches: string[] = []
  if (quote.offer_reference !== input.offerReference) mismatches.push('offer_reference')
  if (quote.customer_type !== input.customerType) mismatches.push('customer_type')
  if (quote.price_area !== input.priceArea) mismatches.push('price_area')
  if (input.gridAreaCode && quote.grid_area_code && quote.grid_area_code !== input.gridAreaCode) mismatches.push('grid_area_code')
  if (input.postalCode && quote.postal_code && quote.postal_code !== input.postalCode) mismatches.push('postal_code')
  if (input.annualConsumptionKwh === null || !sameNumber(quote.annual_consumption_kwh, input.annualConsumptionKwh)) mismatches.push('annual_consumption_kwh')
  if (quote.start_date !== input.startDate) mismatches.push('start_date')
  if ((quote.contract_product_version_id ?? null) !== (input.publicOffer.contract_product_version_id ?? null)) mismatches.push('contract_product_version_id')
  if ((quote.contract_publication_version_id ?? null) !== (input.publicOffer.contract_publication_version_id ?? null)) mismatches.push('contract_publication_version_id')
  if ((quote.price_plan_version_id ?? null) !== (input.publicOffer.price_plan_version_id ?? null)) mismatches.push('price_plan_version_id')
  if ((quote.legal_bundle_version_id ?? null) !== (input.publicOffer.legal_bundle_version_id ?? null)) mismatches.push('legal_bundle_version_id')

  if (mismatches.length > 0) {
    throw new WebsiteQuoteValidationError({
      message: 'Quote matchar inte kundansökans avtals- eller beräkningsunderlag.',
      code: 'quote_mismatch',
      status: 409,
      field: mismatches[0],
      details: { mismatches },
    })
  }

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
