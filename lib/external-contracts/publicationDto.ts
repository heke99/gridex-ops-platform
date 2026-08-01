import {
  serializePublicContractLegal,
  serializePublicContractPriceOptions,
} from '@/lib/external-contracts/publicContractModel'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export const API_CONTRACT_RESPONSE_SCHEMA_VERSION =
  WEBSITE_INTEGRATION_CONTRACT_VERSION

export type ExternalContractChannel = 'website' | 'api'

const INTERNAL_KEYS = new Set([
  'company_id',
  'companyId',
  'tenant_id',
  'tenantId',
  'source_contract_offer_id',
  'contract_product_id',
  'contract_product_version_id',
  'contract_publication_id',
  'contract_publication_version_id',
  'price_plan_id',
  'price_plan_version_id',
  'price_book_id',
  'legal_bundle_id',
  'legal_bundle_version_id',
  'commercial_snapshot',
  'publication_snapshot',
  'legal_snapshot',
])

const WEBSITE_COMPATIBILITY_FIELDS = [
  'id',
  'contract_offer_id',
  'publication_reference',
  'offer_code',
  'code',
  'product_code',
  'public_name',
  'public_description',
  'type',
  'billing_model',
  'area_pricing',
  'customer_types',
  'production_pricing',
  'portfolio_price_ore_per_kwh',
  'portfolio_management_fee',
  'monthly_fee_sek',
  'invoice_fee_sek',
  'markup_ore_per_kwh',
  'spot_markup_ore_per_kwh',
  'variable_fee_ore_per_kwh',
  'fixed_price_ore_per_kwh',
  'green_fee_mode',
  'green_fee_value',
  'terms_version',
  'terms_url',
  'public_price_text',
  'binding_months',
  'notice_months',
  'website_cta_enabled',
  'price_areas',
  'automatic_renewal',
  'power_of_attorney_required',
  'vat_rate',
  'mix',
  'withdrawal_version',
  'pricing_snapshot',
  'is_public',
  'is_active',
  'sort_order',
] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function sanitize(value: unknown, removeIdentifierKeys = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, removeIdentifierKeys))
  }
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const identifierKey = key === 'id' || key.endsWith('_id') || /Id$/.test(key)
    if (!INTERNAL_KEYS.has(key) && !(removeIdentifierKeys && identifierKey)) {
      result[key] = sanitize(item, removeIdentifierKeys)
    }
  }
  return result
}

const PUBLIC_PRICING_FIELDS = [
  'monthly_fee',
  'invoice_fee',
  'markup',
  'spot_markup',
  'variable_fee',
  'fixed_price',
  'area_pricing',
  'green_fee',
  'spot_share',
  'portfolio_share',
  'fixed_share',
  'public_price_text',
  'visibility',
  'price_areas',
  'vat_rate',
  'market_price_responsibility',
  'calculation_contract',
  'interval_resolution',
  'energy_direction',
  'production_pricing',
  'base_components',
  'calculation_components',
  'components',
  'display_components',
  'summary_components',
  'electricity_certificate',
  'start_fee',
  'administration_fee',
  'break_fee',
  'portfolio_price',
  'portfolio_monthly_prices',
  'portfolio_method',
  'portfolio_indications',
  'portfolio_management_fee',
  'discount',
] as const

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function amount(value: unknown, unit: string, currency?: string) {
  const numeric = number(value)
  if (numeric === null) return null
  return {
    amount: numeric,
    ...(currency ? { currency } : {}),
    unit,
    vat_included: false,
  }
}

function pricingFrom(
  publication: Record<string, unknown>,
  commercial: Record<string, unknown>,
  removeIdentifierKeys: boolean,
): Record<string, unknown> {
  const explicit = record(publication.pricing)
  const snapshotPricing = record(commercial.pricing)
  const source: Record<string, unknown> = {
    ...commercial,
    ...snapshotPricing,
    ...explicit,
  }
  const result: Record<string, unknown> = {}
  for (const field of PUBLIC_PRICING_FIELDS) {
    if (source[field] !== undefined) result[field] = source[field]
  }

  result.monthly_fee ??= amount(source.monthly_fee_sek, 'month', 'SEK')
  result.invoice_fee ??= amount(source.invoice_fee_sek, 'invoice', 'SEK')
  result.markup ??= amount(
    source.spot_markup_ore_per_kwh ?? source.markup_ore_per_kwh,
    'ore_per_kwh',
  )
  result.spot_markup ??= result.markup
  result.variable_fee ??= amount(
    source.variable_fee_ore_per_kwh,
    'ore_per_kwh',
  )
  result.fixed_price ??= amount(
    source.fixed_price_ore_per_kwh,
    'ore_per_kwh',
  )
  result.green_fee ??=
    number(source.green_fee_value) === null
      ? null
      : {
          amount: number(source.green_fee_value),
          mode: text(source.green_fee_mode),
          vat_included: false,
        }
  result.price_areas ??= Array.isArray(source.price_areas)
    ? source.price_areas
    : []
  result.visibility ??= record(source.website_visibility)
  const components = Array.isArray(source.calculation_components)
    ? source.calculation_components
    : Array.isArray(source.price_components)
      ? source.price_components
      : Array.isArray(source.commercial_components)
        ? source.commercial_components.filter((item) => {
            const component = record(item)
            return component.informational_only !== true
          })
        : []
  result.calculation_components ??= components
  result.components ??= components
  result.display_components ??= Array.isArray(source.display_components)
    ? source.display_components
    : Array.isArray(source.display_price_components)
      ? source.display_price_components
      : components.filter((item) => record(item).website_published === true)
  result.summary_components ??= Array.isArray(source.summary_components)
    ? source.summary_components
    : Array.isArray(source.summary_price_components)
      ? source.summary_price_components
      : []
  result.calculation_contract ??= record(source.calculation_contract)

  return sanitize(result, removeIdentifierKeys) as Record<string, unknown>
}

function websiteCompatibilityFields(
  publication: Record<string, unknown>,
  legal: ReturnType<typeof serializePublicContractLegal>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of WEBSITE_COMPATIBILITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(publication, field)) {
      result[field] = sanitize(publication[field])
    }
  }
  if (Object.prototype.hasOwnProperty.call(publication, 'legal_versions')) {
    result.legal_versions = legal.module_versions.map((module) => ({
      id: module.id,
      type: module.module_key,
      version: module.version,
      title: module.title,
      published_at: module.published_at,
      content_sha256: module.content_sha256,
      legal_bundle_version_id: module.legal_bundle_version_id,
      document_reference: module.document_reference,
      origin: module.origin,
      url: module.url,
    }))
  }
  return result
}

/**
 * The single external publication boundary for website and API contract feeds.
 * It emits only canonical fields plus documented website compatibility aliases.
 * Public legal identifiers are rebuilt explicitly; internal database identifiers
 * are never preserved by a recursive object spread.
 */
export function mapContractPublicationToPublicDto(input: {
  publication: Record<string, unknown>
  channel: ExternalContractChannel
  companyId: string
}): Record<string, unknown> {
  const publication = input.publication
  const commercial = record(publication.commercial_snapshot)
  const offerReference = text(
    publication.offer_reference,
    commercial.offer_reference,
    input.channel === 'website' ? publication.id : null,
  )
  if (!offerReference) {
    throw new Error('contract_external_dto_offer_reference_missing')
  }

  const priceOptions = serializePublicContractPriceOptions(
    publication.price_options,
  )
  const legalSource = publication.legal ?? publication.legal_snapshot
  const legal = serializePublicContractLegal({
    value: legalSource,
    companyId: input.companyId,
  })

  const base = {
    offer_reference: offerReference,
    name:
      text(
        publication.name,
        publication.public_name,
        commercial.name,
        commercial.public_name,
      ) ?? 'Elavtal',
    description: text(
      publication.description,
      publication.public_description,
      commercial.description,
      commercial.public_description,
    ),
    contract_type:
      text(publication.contract_type, commercial.contract_type) ??
      'variable_monthly',
    energy_direction:
      text(publication.energy_direction, commercial.energy_direction) ??
      'consumption',
    customer_type:
      text(publication.customer_type, commercial.customer_type) ?? 'both',
    price_options: priceOptions,
    pricing: pricingFrom(publication, commercial, input.channel === 'api'),
    legal,
    valid_from: text(publication.valid_from, commercial.valid_from),
    valid_to: text(publication.valid_to, commercial.valid_to),
    channel: input.channel,
  }

  if (input.channel === 'api') return base
  return {
    ...websiteCompatibilityFields(publication, legal),
    ...base,
  }
}
