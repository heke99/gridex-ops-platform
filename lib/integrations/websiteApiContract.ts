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
  [key: string]: unknown
}

export type WebsitePublicContractPricing = {
  fixed_price?: Record<string, unknown> | null
  monthly_fee?: Record<string, unknown> | null
  invoice_fee?: Record<string, unknown> | null
  markup?: Record<string, unknown> | null
  variable_fee?: Record<string, unknown> | null
  vat_rate: number | null
  market_price_responsibility: 'tenant' | 'not_applicable'
  calculation_components: WebsitePricingComponent[]
  components: WebsitePricingComponent[]
  display_components: WebsitePricingComponent[]
  summary_components: WebsitePricingComponent[]
  calculation_contract: {
    includes_all_applicable_components: true
    hidden_components_must_be_calculated: true
    market_price_supplied_by_ops: false
  }
  [key: string]: unknown
}

export type WebsitePublicContract = {
  offer_reference: OfferReference | string
  contract_type: string
  customer_type: ExternalCustomerType | 'both'
  fixed_price_ore_per_kwh: number | null
  monthly_fee_sek: number | null
  invoice_fee_sek: number | null
  pricing: WebsitePublicContractPricing
  price_areas: string[]
  legal: Record<string, unknown>
  [key: string]: unknown
}

export type ExternalApiMeta = {
  tenant_reference: TenantReference
  api_version: 'v1'
  channel?: PublicationChannel
  publication_revision?: number
  publication_updated_at?: string | null
  contract_schema_version?: '2026-07-22.2'
}

export type RemovedWebsiteEndpointResponse = {
  error: {
    code:
      | 'tenant_managed_pricing_required'
      | 'quote_validation_removed'
      | 'tenant_managed_energy_area_required'
      | 'public_energy_area_removed'
    message: string
  }
}

/** @deprecated External OPS quote calculation was removed in API 2026-07-22.2. */
export type WebsiteQuoteRequest = never

/** @deprecated The quote endpoint only returns RemovedWebsiteEndpointResponse. */
export type WebsiteQuoteResponse = RemovedWebsiteEndpointResponse

/** @deprecated quote_reference is not part of new signup flows. */
export type WebsiteQuoteValidationRequest = never

/** @deprecated Public energy-area resolution belongs to the tenant. */
export type WebsiteEnergyAreaResolveRequest = never

/** @deprecated The resolver endpoint only returns RemovedWebsiteEndpointResponse. */
export type WebsiteEnergyAreaResolveResponse = RemovedWebsiteEndpointResponse

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
  offer_reference: OfferReference | string
  /** @deprecated Ignored compatibility field. */
  quote_reference?: QuoteReference | string
  annual_consumption_kwh?: number
  price_area_code?: string
  grid_area_code?: string
  postal_code?: string
  start_date?: string
  customer_type: ExternalCustomerType | 'company'
}

export type ContractsPublicationChangedWebhook = {
  id: string
  event_id: string
  type: 'contracts.publication.changed'
  event_type: 'contracts.publication.changed'
  created_at: string
  tenant_reference: TenantReference
  aggregate: {
    type: 'contract_publication'
    id: string
  }
  data: {
    tenant_reference: TenantReference
    channel: PublicationChannel | 'internal' | 'phone' | 'partner'
    publication_revision: number
    revision_token: string
    reason: string
    timestamp: string
  }
}
