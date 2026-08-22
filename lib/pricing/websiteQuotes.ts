import { createHash, randomBytes } from 'node:crypto'
import type { IntegrationApiClient } from '@/lib/integrations/apiAuth'
import { supabaseService } from '@/lib/supabase/service'
import type { PublicContractOffer } from '@/lib/website/publicContracts'
import { recordCanonicalEnergyEvent } from '@/lib/energy/canonicalEnergyEvents'
import { EnergyResolutionBindingError, loadQuoteEnergyResolution } from '@/lib/energy/resolutionBinding'
import {
  canonicalQuoteGridAreaCode,
  canonicalQuoteTimestamptz,
} from '@/lib/pricing/quoteIntegrity'
import {
  CANONICAL_CONTRACT_PRICING_SCHEMA,
  normalizeWebsiteQuotePersistenceInput,
} from '@/lib/pricing/canonicalContractEngine'

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
  quote_hash_version:
    | 'v1_snapshot_only'
    | 'v2_full_quote'
    | 'v3_commercial_selection'
  resolution_binding_status: 'verified' | 'legacy_unverified'
  postal_code: string | null
  annual_consumption_kwh: number
  start_date: string
  market_data_timestamp: string | null
  market_sources: unknown
  assumptions: unknown
  pricing_snapshot_schema_version: string
  price_option_reference: string | null
  area_price_reference: string | null
  invoice_delivery_method: string | null
  selected_component_references: string[]
  mandatory_component_references: string[]
  conditional_component_references: string[]
  site_count: number
  resolved_base_components: unknown[]
  resolved_price_components: unknown[]
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

export function assertWebsiteQuotePersistenceInvariant(input: {
  pricingSnapshotSchemaVersion: string
  quoteSnapshot: Record<string, unknown>
  priceOptionReference?: string | null
  invoiceDeliveryMethod?: string | null
  resolvedBaseComponents?: unknown[]
  resolvedPriceComponents?: unknown[]
}): void {
  const priceOptionReference =
    typeof input.priceOptionReference === 'string'
      ? input.priceOptionReference.trim()
      : ''
  if (!priceOptionReference) {
    throw new WebsiteQuoteValidationError({
      message: 'price_option_reference saknas i den lösta kommersiella quoten.',
      code: 'missing_price_option_reference',
      status: 422,
      field: 'price_option_reference',
    })
  }

  const invoiceDeliveryMethod =
    typeof input.invoiceDeliveryMethod === 'string'
      ? input.invoiceDeliveryMethod.trim()
      : ''
  if (!invoiceDeliveryMethod) {
    throw new WebsiteQuoteValidationError({
      message: 'invoice_delivery_method saknas i den lösta kommersiella quoten.',
      code: 'missing_invoice_delivery_method',
      status: 422,
      field: 'invoice_delivery_method',
    })
  }

  const quoteSnapshotSchema =
    typeof input.quoteSnapshot.snapshot_schema === 'string'
      ? input.quoteSnapshot.snapshot_schema
      : typeof input.quoteSnapshot.pricing_snapshot_schema_version === 'string'
        ? input.quoteSnapshot.pricing_snapshot_schema_version
        : null
  if (
    input.pricingSnapshotSchemaVersion !== CANONICAL_CONTRACT_PRICING_SCHEMA ||
    quoteSnapshotSchema !== CANONICAL_CONTRACT_PRICING_SCHEMA
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Quote-underlaget använder inte canonical pricing schema.',
      code: 'invalid_pricing_schema',
      status: 422,
      field: 'pricing_snapshot_schema_version',
      details: {
        expected: CANONICAL_CONTRACT_PRICING_SCHEMA,
        actual: input.pricingSnapshotSchemaVersion,
        quote_snapshot_schema: quoteSnapshotSchema,
      },
    })
  }

  if (!Array.isArray(input.resolvedBaseComponents)) {
    throw new WebsiteQuoteValidationError({
      message: 'resolved_base_components måste vara en array före quote-INSERT.',
      code: 'invalid_resolved_base_components',
      status: 422,
      field: 'resolved_base_components',
    })
  }
  if (!Array.isArray(input.resolvedPriceComponents)) {
    throw new WebsiteQuoteValidationError({
      message: 'resolved_price_components måste vara en array före quote-INSERT.',
      code: 'invalid_resolved_price_components',
      status: 422,
      field: 'resolved_price_components',
    })
  }

  const snapshotPriceOptionReference =
    typeof input.quoteSnapshot.price_option_reference === 'string'
      ? input.quoteSnapshot.price_option_reference.trim()
      : null
  if (
    snapshotPriceOptionReference &&
    snapshotPriceOptionReference !== priceOptionReference
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Explicit price_option_reference motsäger quote-snapshoten.',
      code: 'price_option_reference_mismatch',
      status: 409,
      field: 'price_option_reference',
    })
  }

  const snapshotInvoiceDeliveryMethod =
    typeof input.quoteSnapshot.invoice_delivery_method === 'string'
      ? input.quoteSnapshot.invoice_delivery_method.trim()
      : null
  if (
    snapshotInvoiceDeliveryMethod &&
    snapshotInvoiceDeliveryMethod !== invoiceDeliveryMethod
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'invoice_delivery_method motsäger quote-snapshoten.',
      code: 'invoice_delivery_method_mismatch',
      status: 409,
      field: 'invoice_delivery_method',
    })
  }
}

// V1 keeps valid_until on the wire for backwards compatibility and immutable
// audit hashing. It is not a customer-price expiry. New website quotes use a
// stable far-future value while business availability is enforced separately.
export const NON_EXPIRING_WEBSITE_QUOTE_VALID_UNTIL = '9999-12-31T23:59:59.999Z'

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

function quoteHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

function fullQuoteIntegrityPayload(input: {
  quoteReference: string
  companyId: string
  offerReference: string
  contractProductId?: string | null
  contractProductVersionId?: string | null
  contractPublicationVersionId?: string | null
  pricePlanId?: string | null
  pricePlanVersionId?: string | null
  priceBookId?: string | null
  legalBundleVersionId?: string | null
  energyDirection: string
  customerType: string
  priceArea: string
  gridAreaCode?: string | null
  postalCode?: string | null
  annualConsumptionKwh: number
  startDate: string
  energyResolutionId?: string | null
  resolutionSnapshot?: Record<string, unknown>
  resolverVersion?: string | null
  geodataVersion?: string | null
  marketReference?: Record<string, unknown>
  marketDataTimestamp?: string | null
  marketSources: unknown
  assumptions: unknown
  pricingSnapshotSchemaVersion: string
  quoteSnapshot: Record<string, unknown>
  priceOptionReference?: string | null
  areaPriceReference?: string | null
  invoiceDeliveryMethod?: string | null
  selectedComponentReferences?: string[]
  mandatoryComponentReferences?: string[]
  conditionalComponentReferences?: string[]
  resolvedBaseComponents?: unknown[]
  resolvedPriceComponents?: unknown[]
  siteCount?: number
  validUntil: string
}): Record<string, unknown> {
  return {
    quote_reference: input.quoteReference,
    company_id: input.companyId,
    offer_reference: input.offerReference,
    contract_product_id: input.contractProductId ?? null,
    contract_product_version_id: input.contractProductVersionId ?? null,
    contract_publication_version_id:
      input.contractPublicationVersionId ?? null,
    price_plan_id: input.pricePlanId ?? null,
    price_plan_version_id: input.pricePlanVersionId ?? null,
    price_book_id: input.priceBookId ?? null,
    legal_bundle_version_id: input.legalBundleVersionId ?? null,
    energy_direction: input.energyDirection,
    customer_type: input.customerType,
    price_area: input.priceArea,
    grid_area_code: input.gridAreaCode ?? null,
    postal_code: input.postalCode ?? null,
    annual_consumption_kwh: input.annualConsumptionKwh,
    start_date: input.startDate,
    energy_resolution_id: input.energyResolutionId ?? null,
    resolution_snapshot: input.resolutionSnapshot ?? {},
    resolver_version: input.resolverVersion ?? null,
    geodata_version: input.geodataVersion ?? null,
    market_reference: input.marketReference ?? {},
    market_data_timestamp: input.marketDataTimestamp
      ? canonicalQuoteTimestamptz(input.marketDataTimestamp)
      : null,
    market_sources: input.marketSources,
    assumptions: input.assumptions,
    pricing_snapshot_schema_version: input.pricingSnapshotSchemaVersion,
    price_option_reference: input.priceOptionReference ?? null,
    area_price_reference: input.areaPriceReference ?? null,
    invoice_delivery_method: input.invoiceDeliveryMethod ?? null,
    selected_component_references:
      input.selectedComponentReferences ?? [],
    mandatory_component_references:
      input.mandatoryComponentReferences ?? [],
    conditional_component_references:
      input.conditionalComponentReferences ?? [],
    site_count: input.siteCount ?? 1,
    resolved_base_components: input.resolvedBaseComponents ?? [],
    resolved_price_components: input.resolvedPriceComponents ?? [],
    quote_snapshot: input.quoteSnapshot,
    valid_until: canonicalQuoteTimestamptz(input.validUntil),
  }
}

function quoteIntegrityPayloadForVersion(
  version: WebsiteQuoteRecord["quote_hash_version"],
  input: Parameters<typeof fullQuoteIntegrityPayload>[0],
): Record<string, unknown> {
  const payload = fullQuoteIntegrityPayload(input)
  if (version === 'v2_full_quote') {
    for (const key of [
      'price_option_reference',
      'area_price_reference',
      'invoice_delivery_method',
      'selected_component_references',
      'mandatory_component_references',
      'conditional_component_references',
      'resolved_base_components',
      'resolved_price_components',
      'site_count',
    ]) {
      delete payload[key]
    }
  }
  return payload
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
  priceOptionReference?: string | null
  areaPriceReference?: string | null
  invoiceDeliveryMethod?: string | null
  selectedComponentReferences?: string[]
  mandatoryComponentReferences?: string[]
  conditionalComponentReferences?: string[]
  resolvedBaseComponents?: unknown[]
  resolvedPriceComponents?: unknown[]
  siteCount?: number
}): Promise<{ quoteReference: string; validUntil: string }> {
  const canonicalInput = normalizeWebsiteQuotePersistenceInput(input)
  assertWebsiteQuotePersistenceInvariant(canonicalInput)

  const quoteReference = newQuoteReference()
  const validUntil = NON_EXPIRING_WEBSITE_QUOTE_VALID_UNTIL
  const immutableQuoteHash = quoteHash(quoteIntegrityPayloadForVersion(
    'v3_commercial_selection',
    {
    quoteReference,
    companyId: canonicalInput.client.company_id,
    offerReference: canonicalInput.offerReference,
    contractProductId: canonicalInput.offer.contract_product_id,
    contractProductVersionId: canonicalInput.offer.contract_product_version_id,
    contractPublicationVersionId: canonicalInput.offer.contract_publication_version_id,
    pricePlanId: canonicalInput.offer.price_plan_id,
    pricePlanVersionId: canonicalInput.offer.price_plan_version_id,
    priceBookId: canonicalInput.offer.price_book_id,
    legalBundleVersionId: canonicalInput.offer.legal_bundle_version_id,
    energyDirection: canonicalInput.offer.energy_direction,
    customerType: canonicalInput.customerType,
    priceArea: canonicalInput.priceArea.trim().toUpperCase(),
    gridAreaCode: canonicalQuoteGridAreaCode(canonicalInput.gridAreaCode),
    postalCode: canonicalInput.postalCode,
    annualConsumptionKwh: canonicalInput.annualConsumptionKwh,
    startDate: canonicalInput.startDate,
    energyResolutionId: canonicalInput.resolutionId,
    resolutionSnapshot: canonicalInput.resolutionSnapshot,
    resolverVersion: canonicalInput.resolverVersion,
    geodataVersion: canonicalInput.geodataVersion,
    marketReference: canonicalInput.marketReference,
    marketDataTimestamp: canonicalInput.marketDataTimestamp,
    marketSources: canonicalInput.marketSources,
    assumptions: canonicalInput.assumptions,
    pricingSnapshotSchemaVersion: canonicalInput.pricingSnapshotSchemaVersion,
    priceOptionReference: canonicalInput.priceOptionReference,
    areaPriceReference: canonicalInput.areaPriceReference,
    invoiceDeliveryMethod: canonicalInput.invoiceDeliveryMethod,
    selectedComponentReferences: canonicalInput.selectedComponentReferences,
    mandatoryComponentReferences: canonicalInput.mandatoryComponentReferences,
    conditionalComponentReferences: canonicalInput.conditionalComponentReferences,
    resolvedBaseComponents: canonicalInput.resolvedBaseComponents,
    resolvedPriceComponents: canonicalInput.resolvedPriceComponents,
    siteCount: canonicalInput.siteCount,
    quoteSnapshot: canonicalInput.quoteSnapshot,
    validUntil,
    },
  ))
  const { data: inserted, error } = await supabaseService.from('website_contract_quotes').insert({
    company_id: canonicalInput.client.company_id,
    api_client_id: canonicalInput.client.id,
    quote_reference: quoteReference,
    offer_reference: canonicalInput.offerReference,
    contract_product_id: canonicalInput.offer.contract_product_id ?? null,
    contract_product_version_id: canonicalInput.offer.contract_product_version_id ?? null,
    contract_publication_version_id: canonicalInput.offer.contract_publication_version_id ?? null,
    price_plan_id: canonicalInput.offer.price_plan_id ?? null,
    price_plan_version_id: canonicalInput.offer.price_plan_version_id ?? null,
    price_book_id: canonicalInput.offer.price_book_id ?? null,
    legal_bundle_version_id: canonicalInput.offer.legal_bundle_version_id ?? null,
    energy_direction: canonicalInput.offer.energy_direction,
    customer_type: canonicalInput.customerType,
    price_area: canonicalInput.priceArea.trim().toUpperCase(),
    grid_area_code: canonicalQuoteGridAreaCode(canonicalInput.gridAreaCode),
    energy_resolution_id: canonicalInput.resolutionId ?? null,
    resolution_snapshot: canonicalInput.resolutionSnapshot ?? {},
    resolver_version: canonicalInput.resolverVersion ?? null,
    geodata_version: canonicalInput.geodataVersion ?? null,
    market_reference: canonicalInput.marketReference ?? {},
    quote_hash: immutableQuoteHash,
    quote_hash_version: 'v3_commercial_selection',
    resolution_binding_status: canonicalInput.resolutionBindingStatus ?? 'legacy_unverified',
    postal_code: canonicalInput.postalCode ?? null,
    annual_consumption_kwh: canonicalInput.annualConsumptionKwh,
    start_date: canonicalInput.startDate,
    market_data_timestamp: canonicalInput.marketDataTimestamp ?? null,
    market_sources: canonicalInput.marketSources ?? [],
    assumptions: canonicalInput.assumptions ?? [],
    pricing_snapshot_schema_version: canonicalInput.pricingSnapshotSchemaVersion,
    price_option_reference: canonicalInput.priceOptionReference ?? null,
    area_price_reference: canonicalInput.areaPriceReference ?? null,
    invoice_delivery_method: canonicalInput.invoiceDeliveryMethod ?? null,
    selected_component_references:
      canonicalInput.selectedComponentReferences ?? [],
    mandatory_component_references:
      canonicalInput.mandatoryComponentReferences ?? [],
    conditional_component_references:
      canonicalInput.conditionalComponentReferences ?? [],
    resolved_base_components: canonicalInput.resolvedBaseComponents ?? [],
    resolved_price_components: canonicalInput.resolvedPriceComponents ?? [],
    site_count: canonicalInput.siteCount ?? 1,
    quote_snapshot: canonicalInput.quoteSnapshot,
    valid_until: validUntil,
    status: 'active',
  }).select('id').single()
  if (error) throw error
  await recordCanonicalEnergyEvent({
    eventType: 'quote.created',
    companyId: canonicalInput.client.company_id,
    resolutionId: canonicalInput.resolutionId ?? null,
    quoteId: inserted?.id ? String(inserted.id) : null,
    correlationId: canonicalInput.client.id,
    source: 'website_quote_api',
    actorType: 'api_client',
    actorId: canonicalInput.client.id,
    payload: {
      quote_reference: quoteReference,
      offer_reference: canonicalInput.offerReference,
      price_area: canonicalInput.priceArea.trim().toUpperCase(),
      valid_until: validUntil,
      quote_hash: immutableQuoteHash,
      market_reference: canonicalInput.marketReference ?? {},
      contract_product_id: canonicalInput.offer.contract_product_id ?? null,
      contract_product_version_id: canonicalInput.offer.contract_product_version_id ?? null,
      contract_publication_version_id: canonicalInput.offer.contract_publication_version_id ?? null,
      price_plan_id: canonicalInput.offer.price_plan_id ?? null,
      price_plan_version_id: canonicalInput.offer.price_plan_version_id ?? null,
      price_book_id: canonicalInput.offer.price_book_id ?? null,
      legal_bundle_version_id: canonicalInput.offer.legal_bundle_version_id ?? null,
      energy_direction: canonicalInput.offer.energy_direction,
    },
  })
  return { quoteReference, validUntil }
}

function sameNumber(left: unknown, right: unknown): boolean {
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.0001
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const normalizedLeft = [...left].sort()
  const normalizedRight = [...right].sort()
  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  )
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
  priceOptionReference?: string | null
  invoiceDeliveryMethod?: string | null
  selectedComponentReferences?: string[] | null
  siteCount?: number | null
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
        // The resolution timestamp is freshness metadata for new calculations.
        // An already-issued immutable quote remains valid after it passes.
        allowExpired: true,
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
  const inputGridAreaCode = canonicalQuoteGridAreaCode(input.gridAreaCode)
  const resolutionGridAreaCode = canonicalQuoteGridAreaCode(
    canonicalResolution?.gridAreaCode,
  )
  if (
    resolutionGridAreaCode &&
    inputGridAreaCode &&
    inputGridAreaCode !== resolutionGridAreaCode
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Inskickad grid_area_code motsäger OPS-resolutionen.',
      code: 'quote_resolution_mismatch',
      status: 409,
      field: 'grid_area_code',
    })
  }
  const canonicalPriceArea = canonicalResolution?.priceArea ?? input.priceArea
  const canonicalGridAreaCode =
    resolutionGridAreaCode ?? inputGridAreaCode ?? null
  const computedQuoteHash =
    quote.quote_hash_version !== 'v1_snapshot_only'
      ? quoteHash(quoteIntegrityPayloadForVersion(
          quote.quote_hash_version,
          {
          quoteReference: quote.quote_reference,
          companyId: quote.company_id,
          offerReference: quote.offer_reference,
          contractProductId: quote.contract_product_id,
          contractProductVersionId: quote.contract_product_version_id,
          contractPublicationVersionId: quote.contract_publication_version_id,
          pricePlanId: quote.price_plan_id,
          pricePlanVersionId: quote.price_plan_version_id,
          priceBookId: quote.price_book_id,
          legalBundleVersionId: quote.legal_bundle_version_id,
          energyDirection: quote.energy_direction,
          customerType: quote.customer_type,
          priceArea: quote.price_area,
          gridAreaCode: quote.grid_area_code,
          postalCode: quote.postal_code,
          annualConsumptionKwh: quote.annual_consumption_kwh,
          startDate: quote.start_date,
          energyResolutionId: quote.energy_resolution_id,
          resolutionSnapshot: quote.resolution_snapshot,
          resolverVersion: quote.resolver_version,
          geodataVersion: quote.geodata_version,
          marketReference: quote.market_reference,
          marketDataTimestamp: quote.market_data_timestamp,
          marketSources: quote.market_sources,
          assumptions: quote.assumptions,
          pricingSnapshotSchemaVersion: quote.pricing_snapshot_schema_version,
          priceOptionReference: quote.price_option_reference,
          areaPriceReference: quote.area_price_reference,
          invoiceDeliveryMethod: quote.invoice_delivery_method,
          selectedComponentReferences: quote.selected_component_references,
          mandatoryComponentReferences: quote.mandatory_component_references,
          conditionalComponentReferences: quote.conditional_component_references,
          resolvedBaseComponents: quote.resolved_base_components,
          resolvedPriceComponents: quote.resolved_price_components,
          siteCount: quote.site_count,
          quoteSnapshot: quote.quote_snapshot,
          validUntil: quote.valid_until,
          },
        ))
      : quoteHash(quote.quote_snapshot)
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
  // Legacy rows may have been marked expired by the retired technical TTL.
  // Time alone must never invalidate a customer-visible website price.
  if (quote.status === 'expired') {
    const { error: reactivationError } = await supabaseService
      .from('website_contract_quotes')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', quote.id)
      .eq('status', 'expired')
    if (reactivationError) throw reactivationError
    quote.status = 'active'
  }
  if (quote.status === 'consumed' && quote.consumed_application_id !== (input.applicationId ?? null)) {
    throw new WebsiteQuoteValidationError({
      message: 'Quote har redan använts av en annan kundansökan.',
      code: 'quote_consumed',
      status: 409,
      details: { consumed: true },
    })
  }

  const mismatches: string[] = []
  if (quote.offer_reference !== input.offerReference) mismatches.push('offer_reference')
  if (quote.customer_type !== input.customerType) mismatches.push('customer_type')
  if (quote.price_area.toUpperCase() !== String(canonicalPriceArea).toUpperCase()) mismatches.push('price_area')
  if (input.resolutionId && quote.energy_resolution_id !== input.resolutionId) mismatches.push('resolution_id')
  if (quote.resolution_binding_status === 'verified' && !input.resolutionId) mismatches.push('resolution_id')
  if (quote.resolution_binding_status === 'verified' && String(quote.resolution_snapshot?.price_area ?? '').toUpperCase() !== quote.price_area.toUpperCase()) mismatches.push('resolution_snapshot.price_area')
  if (quote.resolution_binding_status === 'verified' && String(quote.resolution_snapshot?.resolution_id ?? '') !== String(quote.energy_resolution_id ?? '')) mismatches.push('resolution_snapshot.resolution_id')
  if (canonicalResolution && quote.energy_resolution_id !== canonicalResolution.id) mismatches.push('resolution_id')
  if (canonicalResolution && quote.resolver_version !== canonicalResolution.resolverVersion) mismatches.push('resolver_version')
  if (canonicalResolution && (quote.geodata_version ?? null) !== (canonicalResolution.geodataVersion ?? null)) mismatches.push('geodata_version')
  // grid_area_code is intentionally nullable while only the price area is
  // sufficiently verified for pricing/quote. Compare nullable values
  // canonically so null and an absent JSON value do not become '' !== null.
  const snapshotGridAreaCode = canonicalQuoteGridAreaCode(
    quote.resolution_snapshot?.grid_area_code,
  )
  if (
    canonicalResolution &&
    snapshotGridAreaCode !== resolutionGridAreaCode
  ) {
    mismatches.push('resolution_snapshot.grid_area_code')
  }
  if (
    canonicalGridAreaCode &&
    canonicalQuoteGridAreaCode(quote.grid_area_code) !== canonicalGridAreaCode
  ) {
    mismatches.push('grid_area_code')
  }
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

  if (
    input.priceOptionReference !== undefined &&
    input.priceOptionReference !== null &&
    quote.price_option_reference !== input.priceOptionReference
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Prisalternativet matchar inte den immutable quoten.',
      code: 'price_option_quote_mismatch',
      status: 409,
      field: 'price_option_reference',
    })
  }
  if (
    input.invoiceDeliveryMethod !== undefined &&
    input.invoiceDeliveryMethod !== null &&
    quote.invoice_delivery_method !== input.invoiceDeliveryMethod
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Fakturaleveransen matchar inte den immutable quoten.',
      code: 'invoice_delivery_quote_mismatch',
      status: 409,
      field: 'invoice_delivery_method',
    })
  }
  if (
    input.selectedComponentReferences !== undefined &&
    input.selectedComponentReferences !== null &&
    !sameStringArray(
      quote.selected_component_references,
      input.selectedComponentReferences,
    )
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Valda priskomponenter matchar inte den immutable quoten.',
      code: 'selected_components_quote_mismatch',
      status: 409,
      field: 'selected_component_references',
    })
  }
  if (
    input.siteCount !== undefined &&
    input.siteCount !== null &&
    quote.site_count !== input.siteCount
  ) {
    throw new WebsiteQuoteValidationError({
      message: 'Antalet anläggningar matchar inte den immutable quoten.',
      code: 'site_count_quote_mismatch',
      status: 409,
      field: 'site_count',
    })
  }

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
