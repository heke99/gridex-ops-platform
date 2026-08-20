import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'

type JsonRecord = Record<string, unknown>

const SWEDISH_STANDARD_VAT_FACTOR = 1.25

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const normalized = text(entry)
    return normalized ? [normalized] : []
  })
}

function cleanObject<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as T
}

function roundPublicPrice(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}

function recoverExVatPrice(gross: number | null, includesVat: boolean | undefined): number | null {
  if (gross === null) return null
  if (includesVat === false) return gross
  if (includesVat !== true) return null
  return roundPublicPrice(gross / SWEDISH_STANDARD_VAT_FACTOR)
}

function publicSelectedAreaPrice(value: unknown): JsonRecord | null {
  const row = record(value)
  if (!row) return null
  const priceArea = text(row.price_area)
  const energyPrice = finite(row.energy_price_ore_per_kwh)
  const unit = text(row.unit)
  if (!priceArea || energyPrice === null || !unit) return null
  return cleanObject({
    price_area: priceArea,
    energy_price_ore_per_kwh: energyPrice,
    unit,
    vat_included: typeof row.vat_included === 'boolean' ? row.vat_included : undefined,
    vat_rate: finite(row.vat_rate) ?? undefined,
  })
}

function publicProductionPricing(value: unknown): JsonRecord | null {
  const row = record(value)
  if (!row) return null
  const projected = cleanObject({
    pricing_model: text(row.pricing_model) ?? undefined,
    compensation_ore_per_kwh: finite(row.compensation_ore_per_kwh) ?? undefined,
    fixed_compensation_ore_per_kwh: finite(row.fixed_compensation_ore_per_kwh) ?? undefined,
    markup_ore_per_kwh: finite(row.markup_ore_per_kwh) ?? undefined,
    deduction_ore_per_kwh: finite(row.deduction_ore_per_kwh) ?? undefined,
    monthly_fee_sek: finite(row.monthly_fee_sek) ?? undefined,
    currency: text(row.currency) ?? undefined,
    unit: text(row.unit) ?? undefined,
    valid_from: text(row.valid_from) ?? undefined,
    valid_to: text(row.valid_to) ?? undefined,
  })
  return Object.keys(projected).length > 0 ? projected : null
}

function publicMarketReference(value: unknown): JsonRecord | null {
  const row = record(value)
  if (!row) return null

  const includesVat = typeof row.includes_vat === 'boolean' ? row.includes_vat : undefined
  const grossSek = finite(row.price_sek_per_kwh)
  const grossOre = finite(row.price_ore_per_kwh)
  const explicitExVatSek = finite(row.price_ex_vat_sek_per_kwh)
  const explicitExVatOre = finite(row.price_ex_vat_ore_per_kwh)

  // PR #172 briefly stored a public-safe but OpenAPI-incomplete quote body in
  // write-idempotency. Exact retries can still replay that body after deploy.
  // Fresh canonical quotes always carry the explicit ex-VAT fields; these
  // fallbacks only repair those already-stored responses without weakening the
  // public contract or forcing a duplicate quote write.
  const exVatSek = explicitExVatSek
    ?? recoverExVatPrice(grossSek, includesVat)
    ?? (explicitExVatOre === null ? null : roundPublicPrice(explicitExVatOre / 100))
  const exVatOre = explicitExVatOre
    ?? recoverExVatPrice(grossOre, includesVat)
    ?? (exVatSek === null ? null : roundPublicPrice(exVatSek * 100))

  const projected = cleanObject({
    provider: text(row.provider) ?? undefined,
    source: text(row.source) ?? undefined,
    price_area: text(row.price_area) ?? undefined,
    reference_type: text(row.reference_type) ?? undefined,
    reference_period: text(row.reference_period) ?? undefined,
    price_sek_per_kwh: grossSek ?? undefined,
    price_ore_per_kwh: grossOre ?? undefined,
    price_ex_vat_sek_per_kwh: exVatSek ?? undefined,
    price_ex_vat_ore_per_kwh: exVatOre ?? undefined,
    requested_days: finite(row.requested_days) ?? undefined,
    included_days: finite(row.included_days) ?? undefined,
    period_start: text(row.period_start) ?? undefined,
    period_end: text(row.period_end) ?? undefined,
    as_of: text(row.as_of) ?? undefined,
    source_as_of: text(row.source_as_of) ?? undefined,
    generated_at: text(row.generated_at) ?? undefined,
    stale_after: text(row.stale_after) ?? undefined,
    effective_stale_at: text(row.effective_stale_at) ?? undefined,
    source_currency: text(row.source_currency) ?? undefined,
    source_checksum: text(row.source_checksum) ?? undefined,
    source_resolution: text(row.source_resolution) ?? undefined,
    unit: text(row.unit) ?? undefined,
    includes_vat: includesVat,
    includes_supplier_fees: typeof row.includes_supplier_fees === 'boolean' ? row.includes_supplier_fees : undefined,
    includes_grid_fees: typeof row.includes_grid_fees === 'boolean' ? row.includes_grid_fees : undefined,
    is_indicative: typeof row.is_indicative === 'boolean' ? row.is_indicative : undefined,
    is_stale: typeof row.is_stale === 'boolean' ? row.is_stale : undefined,
    fallback_used: typeof row.fallback_used === 'boolean' ? row.fallback_used : undefined,
    fallback_reason: text(row.fallback_reason) ?? undefined,
    freshness: text(row.freshness) ?? undefined,
  })
  return Object.keys(projected).length > 0 ? projected : null
}

function publicMarketSources(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const row = record(entry)
    if (!row) return []
    const projected = cleanObject({
      type: text(row.type) ?? undefined,
      name: text(row.name) ?? undefined,
      provider: text(row.provider) ?? undefined,
      period: text(row.period) ?? text(row.reference_period) ?? undefined,
      timestamp: text(row.timestamp) ?? text(row.as_of) ?? text(row.market_data_timestamp) ?? undefined,
      price_area: text(row.price_area) ?? undefined,
      is_indicative: typeof row.is_indicative === 'boolean' ? row.is_indicative : undefined,
      is_stale: typeof row.is_stale === 'boolean' ? row.is_stale : undefined,
      non_binding: typeof row.non_binding === 'boolean' ? row.non_binding : undefined,
    })
    return Object.keys(projected).length > 0 ? [projected] : []
  })
}

function publicLines(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const row = record(entry)
    if (!row) return []
    return [cleanObject({
      component_code: text(row.component_code) ?? undefined,
      name: text(row.name) ?? undefined,
      quantity: finite(row.quantity) ?? undefined,
      unit: text(row.unit) ?? undefined,
      calculation_type: text(row.calculation_type) ?? undefined,
      unit_price_ex_vat: finite(row.unit_price_ex_vat) ?? undefined,
      amount_ex_vat: finite(row.amount_ex_vat) ?? undefined,
      vat_rate: finite(row.vat_rate) ?? undefined,
      vat_amount: finite(row.vat_amount) ?? undefined,
      amount_inc_vat: finite(row.amount_inc_vat) ?? undefined,
    })]
  })
}

function publicInput(value: unknown): JsonRecord {
  const row = record(value) ?? {}
  return cleanObject({
    resolution_id: text(row.resolution_id) ?? undefined,
    price_area: text(row.price_area) ?? undefined,
    grid_area_code: text(row.grid_area_code) ?? undefined,
    postal_code: text(row.postal_code) ?? undefined,
    annual_consumption_kwh: finite(row.annual_consumption_kwh) ?? undefined,
    estimated_monthly_consumption_kwh: finite(row.estimated_monthly_consumption_kwh) ?? undefined,
    start_date: text(row.start_date) ?? undefined,
    billing_month: text(row.billing_month) ?? undefined,
    site_count: finite(row.site_count) ?? undefined,
    price_option_reference: text(row.price_option_reference) ?? undefined,
    invoice_delivery_method: text(row.invoice_delivery_method) ?? undefined,
    selected_component_references: strings(row.selected_component_references),
  })
}

function publicEstimate(value: unknown): JsonRecord | null {
  const row = record(value)
  if (!row) return null
  const projected = cleanObject({
    monthly_ex_vat: finite(row.monthly_ex_vat) ?? undefined,
    monthly_vat: finite(row.monthly_vat) ?? undefined,
    monthly_inc_vat: finite(row.monthly_inc_vat) ?? undefined,
    annual_ex_vat: finite(row.annual_ex_vat) ?? undefined,
    annual_vat: finite(row.annual_vat) ?? undefined,
    annual_inc_vat: finite(row.annual_inc_vat) ?? undefined,
  })
  return Object.keys(projected).length > 0 ? projected : null
}

function sourceWindow(value: unknown): JsonRecord | null {
  const row = record(value)
  if (!row) return null
  const start = text(row.start)
  const end = text(row.end)
  return start && end ? { start, end } : null
}

function pricePerKwhOre(source: JsonRecord, projectedLines: JsonRecord[]): number | null {
  const selected = publicSelectedAreaPrice(source.selected_area_price)
  const fixed = finite(selected?.energy_price_ore_per_kwh)
  if (fixed !== null) return fixed

  const production = publicProductionPricing(source.production_pricing)
  const productionPrice = finite(
    production?.compensation_ore_per_kwh ?? production?.fixed_compensation_ore_per_kwh,
  )
  if (productionPrice !== null) return productionPrice

  const input = record(source.input) ?? {}
  const monthlyKwh = finite(input.estimated_monthly_consumption_kwh)
    ?? ((finite(input.annual_consumption_kwh) ?? 0) / 12)
  if (!(monthlyKwh > 0)) return null

  const perKwhAmount = projectedLines.reduce((sum, line) => {
    const unit = (text(line.unit) ?? '').toLowerCase()
    const calculationType = (text(line.calculation_type) ?? '').toLowerCase()
    const componentCode = (text(line.component_code) ?? '').toLowerCase()
    const isPerKwh = unit.includes('kwh') || calculationType.includes('per_kwh') || componentCode.includes('per_kwh')
    return isPerKwh ? sum + (finite(line.amount_ex_vat) ?? 0) : sum
  }, 0)
  if (perKwhAmount > 0) return Math.round((perKwhAmount / monthlyKwh) * 100 * 1_000_000) / 1_000_000

  const estimate = record(source.estimate)
  const monthlyExVat = finite(estimate?.monthly_ex_vat)
  return monthlyExVat !== null
    ? Math.round((monthlyExVat / monthlyKwh) * 100 * 1_000_000) / 1_000_000
    : null
}

export type PublicWebsiteQuoteData = JsonRecord
export type PublicWebsiteQuoteEnvelope = {
  data: PublicWebsiteQuoteData
  request_id: string
}

export class PublicWebsiteQuoteProjectionError extends Error {
  readonly code = 'website_quote_public_projection_failed'
  readonly status = 500

  constructor(message: string) {
    super(message)
    this.name = 'PublicWebsiteQuoteProjectionError'
  }
}

export function projectPublicWebsiteQuoteData(value: unknown): PublicWebsiteQuoteData {
  const source = record(value)
  if (!source) throw new PublicWebsiteQuoteProjectionError('Quote-underlaget saknar objektformat.')

  const quoteReference = text(source.quote_reference)
  const offerReference = text(source.offer_reference)
  const validUntil = text(source.valid_until)
  const offer = record(source.offer) ?? {}
  const input = publicInput(source.input)
  const lines = publicLines(source.lines)
  const estimate = publicEstimate(source.estimate)
  const selectedAreaPrice = publicSelectedAreaPrice(source.selected_area_price)
  const computedPricePerKwhOre = pricePerKwhOre(source, lines)
  const priceOptionReference = text(source.price_option_reference)
  const invoiceDeliveryMethod = text(source.invoice_delivery_method)
  const siteCount = finite(source.site_count)

  if (
    !quoteReference ||
    !offerReference ||
    !validUntil ||
    !text(input.resolution_id) ||
    !priceOptionReference ||
    !invoiceDeliveryMethod ||
    siteCount === null ||
    !Number.isInteger(siteCount) ||
    siteCount < 1
  ) {
    throw new PublicWebsiteQuoteProjectionError('Quote-underlaget saknar obligatoriska publika fält.')
  }

  const publicOffer = cleanObject({
    offer_reference: offerReference,
    public_name: text(offer.public_name) ?? text(offer.name) ?? undefined,
    name: text(offer.public_name) ?? text(offer.name) ?? undefined,
    product_code: text(offer.product_code) ?? undefined,
    contract_type: text(offer.contract_type) ?? undefined,
    energy_direction: text(offer.energy_direction) ?? text(source.energy_direction) ?? undefined,
    selected_area_price: selectedAreaPrice,
  })

  const projected = cleanObject({
    quote_reference: quoteReference,
    offer_reference: offerReference,
    valid_until: validUntil,
    status: text(source.status) ?? 'created',
    offer: publicOffer,
    selected_area_price: selectedAreaPrice,
    input,
    estimate: estimate ?? undefined,
    lines,
    pricing: computedPricePerKwhOre === null
      ? undefined
      : { price_per_kwh_ore: computedPricePerKwhOre },
    energy_direction: text(source.energy_direction) ?? undefined,
    production_pricing: publicProductionPricing(source.production_pricing),
    market_reference: publicMarketReference(source.market_reference),
    is_binding: source.is_binding === true,
    market_data_timestamp: text(source.market_data_timestamp) ?? undefined,
    pricing_interval: text(source.pricing_interval) ?? undefined,
    estimate_method: text(source.estimate_method) ?? undefined,
    source_period: text(source.source_period) ?? undefined,
    source_window: sourceWindow(source.source_window),
    market_sources: publicMarketSources(source.market_sources),
    warnings: strings(source.warnings),
    assumptions: strings(source.assumptions),
    pricing_snapshot_schema_version: text(source.pricing_snapshot_schema_version) ?? undefined,
    snapshot_schema: text(source.snapshot_schema) ?? undefined,
    price_option_reference: priceOptionReference,
    area_price_reference: text(source.area_price_reference),
    invoice_delivery_method: invoiceDeliveryMethod,
    selected_component_references: strings(source.selected_component_references),
    mandatory_component_references: strings(source.mandatory_component_references),
    conditional_component_references: strings(source.conditional_component_references),
    site_count: siteCount,
  })

  assertPublicResponsePayload(projected, '$.data')
  return projected
}

export function projectPublicWebsiteQuoteEnvelope(
  value: unknown,
  fallbackRequestId: string,
): PublicWebsiteQuoteEnvelope | JsonRecord {
  const root = record(value)

  // Write-idempotency also stores canonical 4xx business responses. Those are
  // already public API envelopes and must replay byte-for-shape rather than be
  // treated as successful quote snapshots. This branch also preserves the
  // original request_id from the completed operation.
  if (root && !record(root.data) && record(root.error)) {
    assertPublicResponsePayload(root)
    return root
  }

  const source = root && record(root.data) ? root.data : value
  const requestId = text(root?.request_id) ?? fallbackRequestId
  const envelope = {
    data: projectPublicWebsiteQuoteData(source),
    request_id: requestId,
  }
  assertPublicResponsePayload(envelope)
  return envelope
}
