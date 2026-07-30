import type { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import type { ExternalCustomerType } from '@/lib/customers/externalCustomerType'

export type TenantReference = `tenant_${string}`
export type QuoteReference = `quote_${string}`
export type OfferReference = `offer_${string}`
export type PublicationChannel = 'website' | 'api'
export type WebsiteVisibilityMode = 'visible' | 'hidden' | 'summary_only'
export type CalculationInclusion = 'included' | 'excluded' | 'conditional'

export type WebsitePricingComponent = {
  component_code: string | null
  component_type?: string | null
  name?: string | null
  amount: number
  unit: string
  calculation_type?: string | null
  calculation_base?: string | null
  vat_applicable?: boolean
  calculation_inclusion: CalculationInclusion
  website_visibility: WebsiteVisibilityMode
  website_card_visible?: boolean
}

export type ContractPriceOptionAreaPrice = {
  area_price_reference: string
  price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  energy_price_ore_per_kwh: number
  unit: 'ore_per_kwh'
  valid_from: string | null
  valid_to: string | null
}

export type ContractPriceOption = {
  price_option_reference: string
  option_code: string
  customer_name: string
  contract_type: string
  customer_type: ExternalCustomerType | 'both'
  binding_months: number
  notice_months: number
  auto_renew_enabled: boolean
  renewal_term_months: number | null
  default: boolean
  selection_required: boolean
  valid_from: string | null
  valid_to: string | null
  earliest_start_date: string | null
  latest_start_date: string | null
  area_prices: ContractPriceOptionAreaPrice[]
}

export type WebsitePublicContractPricing = {
  fixed_price?: Record<string, unknown> | null
  area_pricing: Array<{ price_area: string; energy_price_ore_per_kwh: number; unit: 'ore_per_kwh' }>
  monthly_fee?: Record<string, unknown> | null
  invoice_fee?: Record<string, unknown> | null
  markup?: Record<string, unknown> | null
  variable_fee?: Record<string, unknown> | null
  vat_rate: number | null
  market_price_responsibility: 'ops_quote' | 'not_applicable'
  calculation_components: WebsitePricingComponent[]
  components: WebsitePricingComponent[]
  display_components: WebsitePricingComponent[]
  summary_components: WebsitePricingComponent[]
  calculation_contract: {
    includes_all_applicable_components: true
    hidden_components_must_be_calculated: true
    market_price_supplied_by_ops: boolean
  }
}

export type WebsitePublicContract = {
  offer_reference: OfferReference | string
  contract_type: string
  customer_type: ExternalCustomerType | 'both'
  fixed_price_ore_per_kwh: number | null
  monthly_fee_sek: number | null
  invoice_fee_sek: number | null
  price_options: ContractPriceOption[]
  pricing: WebsitePublicContractPricing
  price_areas: string[]
  legal: Record<string, unknown>
}

export type ExternalApiMeta = {
  tenant_reference: TenantReference
  api_version: 'v1'
  channel?: PublicationChannel
  publication_revision?: number
  publication_updated_at?: string | null
  contract_schema_version?: typeof WEBSITE_INTEGRATION_CONTRACT_VERSION
}


export type MarketReference = {
  provider: string
  price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  reference_type: 'preview'
  reference_period: string
  price_sek_per_kwh: number
  price_ore_per_kwh: number
  price_ex_vat_sek_per_kwh: number
  price_ex_vat_ore_per_kwh: number
  requested_days: number
  included_days: number
  period_start: string | null
  period_end: string | null
  source_as_of: string
  generated_at: string
  stale_after: string
  effective_stale_at: string
  source_currency: 'SEK' | string
  unit: 'sek_per_kwh'
  includes_vat: boolean
  includes_supplier_fees: boolean
  includes_grid_fees: boolean
  is_indicative: boolean
  is_stale: boolean
  fallback_used: boolean
  fallback_reason: string | null
  source_checksum: string | null
}

export type WebsiteCurrentMarketPriceRequest = {
  resolution_id: string
  price_area?: 'SE1' | 'SE2' | 'SE3' | 'SE4'
}

export type WebsiteCurrentMarketPriceResponse = {
  data: {
    provider: string
    resolution_id: string
    price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4'
    reference_type: 'current_interval'
    resolution: 'hourly' | 'quarterly'
    time_start: string
    time_end: string
    price_sek_per_kwh: number
    price_ore_per_kwh: number
    price_ex_vat_sek_per_kwh: number
    price_ex_vat_ore_per_kwh: number
    includes_vat: false
    includes_supplier_fees: false
    includes_grid_fees: false
    is_indicative: false
    is_stale: boolean
    source_as_of: string
    next_update_at: string
  }
  request_id: string
  contract_schema_version: typeof WEBSITE_INTEGRATION_CONTRACT_VERSION
}

export type WebsiteQuoteRequest = {
  offer_reference: OfferReference | string
  customer_type: ExternalCustomerType | 'company'
  resolution_id: string
  annual_consumption_kwh: number
  start_date: string
  price_option_reference?: string
  invoice_delivery_method: 'email' | 'e_invoice' | 'paper' | 'direct_debit'
  selected_component_references: string[]
  site_count: number
}

export type CommercialSelection = {
  price_option_reference: string
  area_price_reference: string | null
  invoice_delivery_method: 'email' | 'e_invoice' | 'paper' | 'direct_debit'
  selected_component_references: string[]
  mandatory_component_references: string[]
  conditional_component_references: string[]
  site_count: number
}

export type WebsiteQuoteResponse = {
  data: {
    quote_reference: QuoteReference | string
    offer_reference: OfferReference | string
    price_option_reference: string
    area_price_reference: string | null
    valid_until: string
    resolution_id: string
    market_reference?: MarketReference
    selected_area_price: null | {
      area_price_reference: string
      price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4'
      energy_price_ore_per_kwh: number
      unit: 'ore_per_kwh'
    }
    invoice_delivery_method: CommercialSelection['invoice_delivery_method']
    selected_component_references: string[]
    mandatory_component_references: string[]
    conditional_component_references: string[]
    site_count: number
    estimate: Record<string, number>
    lines: Array<Record<string, unknown>>
  }
  request_id: string
}

export type WebsiteQuoteValidationRequest = WebsiteQuoteRequest & {
  quote_reference: QuoteReference | string
  application_id?: string | null
}

export type LegalBundleDocument = {
  id: string
  document_reference: string
  module_key: string
  version: string
  title: string
  published_at: string | null
  content_sha256: string | null
  origin: string
  legal_bundle_version_id: string
  url: string | null
}

export type LegalRequirement = {
  requirement_code: string
  document_reference: string
  document_version: string
  document_hash: string
  document_url: string
  required: true
}

export type LegalAcceptance = {
  requirement_code: string
  document_reference: string
  document_version: string
  document_hash: string
  accepted: true
  accepted_at: string
}

export type WebsiteEnergyAreaResolveRequest = {
  street?: string | null
  street_number?: string | null
  postal_code?: string | null
  city?: string | null
  country?: string | null
  grid_area_code?: string | null
  facility_id?: string | null
  metering_point_id?: string | null
}

export type WebsiteEnergyAreaResolveResponse = {
  data: {
    resolution_id: string | null
    price_area: 'SE1' | 'SE2' | 'SE3' | 'SE4' | null
    grid_area_code: string | null
    grid_area_name: string | null
    grid_owner_id: string | null
    grid_owner_name: string | null
    resolution_status: string
    confidence: number
    automation_allowed: boolean
    next_required_action: string
    warnings: string[]
  }
  request_id: string
}

export type WebsiteSwitchStatusResponse = {
  application_number: string
  application_status: string
  switch: null | {
    switch_reference: `switch_${string}` | string
    status: string | null
    requested_start_date: string | null
    submitted_at: string | null
    completed_at: string | null
    failed_at: string | null
    failure_reason: string | null
    paused_at: string | null
    pause_reason: string | null
    lifecycle_blocked: boolean
    lifecycle_block_source: string | null
    updated_at: string | null
    events: Array<Record<string, unknown>>
  }
  next_step: string | null
  blocking_reasons: unknown[]
  requested_start_date: string | null
  confirmed_start_date: string | null
  actual_start_date: string | null
}

export type WebsiteCustomerApplicationBinding = {
  /** Canonical public offer selected from OPS public-contracts. Always top-level. */
  offer_reference: OfferReference | string
  /** Canonical OPS quote created from the same resolution. Always top-level. */
  quote_reference: QuoteReference | string
  price_option_reference: string
  /** Tenant-bound OPS energy resolution used by the quote. Always top-level. */
  resolution_id: string
  legal_bundle_version: string
  invoice_delivery_method: CommercialSelection['invoice_delivery_method']
  selected_component_references: string[]
  site_count: number
  annual_consumption_kwh: number
  start_date: string
  customer_type: ExternalCustomerType | 'company'
  contract?: {
    requested_start_mode?: 'asap' | 'specific_date' | 'move_in'
    requested_start_date?: string
  }
}

export type ContractsPublicationChangedWebhook = {
  event_id: string
  delivery_id: string
  event_type: 'contracts.publication.changed'
  created_at: string
  tenant_reference: TenantReference
  aggregate: {
    type: 'contract_publication'
    reference: string
  }
  data: {
    channel: PublicationChannel | 'internal' | 'phone' | 'partner'
    publication_revision: number
    revision_token: string
    reason: string
    timestamp: string
  }
  contract_schema_version: typeof WEBSITE_INTEGRATION_CONTRACT_VERSION
}
