import type { ExternalCustomerType } from '@/lib/customers/externalCustomerType'

export type TenantReference = `tenant_${string}`
export type QuoteReference = `quote_${string}`
export type OfferReference = `offer_${string}`
export type PublicationChannel = 'website' | 'api'
export type QuotePricingInterval = 'monthly' | 'hourly' | 'quarterly' | 'fixed' | 'portfolio' | 'mixed'

export type ExternalApiMeta = {
  tenant_reference: TenantReference
  api_version: 'v1'
  channel?: PublicationChannel
  publication_revision?: number
  publication_updated_at?: string | null
}

export type WebsiteQuoteRequest = {
  offer_reference: OfferReference | string
  price_area: string
  grid_area_code?: string | null
  postal_code?: string | null
  annual_consumption_kwh: number
  start_date?: string | null
  customer_type: ExternalCustomerType | 'company'
}

export type WebsiteQuoteResponse = {
  offer_reference: OfferReference | string
  quote_reference: QuoteReference | string
  pricing_interval: QuotePricingInterval
  estimate_method: string
  source_period: string
  source_window: { start: string; end: string }
  market_data_timestamp: string | null
  is_binding: boolean
  assumptions: string[]
  market_sources: Array<Record<string, unknown>>
  pricing_snapshot_schema_version: string
  valid_until: string
  offer: Record<string, unknown>
  input: Record<string, unknown>
  estimate: Record<string, number>
  lines: Array<Record<string, unknown>>
  warnings: string[]
}

export type WebsiteQuoteValidationRequest = WebsiteQuoteRequest & {
  quote_reference: QuoteReference | string
}

export type WebsiteEnergyAreaResolveRequest = {
  grid_area_code?: string | null
  postal_code?: string | null
  street?: string | null
  street_number?: string | null
  city?: string | null
  country?: string | null
  facility_id?: string | null
  metering_point_id?: string | null
}

export type WebsiteEnergyAreaResolveResponse = {
  grid_area_code: string | null
  grid_area_name: string | null
  grid_owner_name: string | null
  price_area: string | null
  resolution_status: string
  confidence: number
  source_chain: string[]
  automation_allowed: boolean
  next_required_action: string
  warnings: string[]
  diagnostics: Record<string, unknown> | null
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

export type WebsiteCustomerApplicationQuoteBinding = {
  offer_reference: OfferReference | string
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
