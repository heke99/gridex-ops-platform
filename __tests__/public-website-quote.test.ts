import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import {
  projectPublicWebsiteQuoteData,
  projectPublicWebsiteQuoteEnvelope,
} from '@/lib/pricing/publicWebsiteQuote'

const INTERNAL_UUID = '8d63cc83-5fcf-4e98-9a7a-7b415f89c012'

type SuccessEnvelope = {
  request_id: string
  data: Record<string, unknown>
}

type OpenApiSchema = {
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  additionalProperties?: boolean
}

type OpenApiDocument = {
  components?: {
    schemas?: Record<string, OpenApiSchema>
  }
}

function checkedInWebsiteOpenApi(): OpenApiDocument {
  return JSON.parse(
    readFileSync('docs/openapi/website-integration-v1.json', 'utf8'),
  ) as OpenApiDocument
}

function internalQuote() {
  return {
    quote_reference: 'quote_public_projection_1234567890',
    offer_reference: 'offer_public_projection_1234567890',
    valid_until: '2026-08-21T18:00:00.000Z',
    offer: {
      id: 'offer_public_projection_1234567890',
      offer_reference: 'offer_public_projection_1234567890',
      public_name: 'Gridex Månad',
      product_code: 'gridex_monthly',
      contract_type: 'variable_monthly',
      energy_direction: 'consumption',
      internal_contract_id: INTERNAL_UUID,
    },
    input: {
      resolution_id: 'resolution_public_projection_1234567890',
      price_area: 'SE3',
      grid_area_code: 'STH',
      postal_code: '11122',
      annual_consumption_kwh: 12000,
      estimated_monthly_consumption_kwh: 1000,
      start_date: '2026-09-01',
      billing_month: '2026-09',
      site_count: 1,
      price_option_reference: 'canonical_6519cb6687e54f35a5cf044c8d7cb9d1',
      invoice_delivery_method: 'email',
      selected_component_references: ['component_green_energy'],
    },
    estimate: {
      monthly_ex_vat: 1110,
      monthly_vat: 277.5,
      monthly_inc_vat: 1387.5,
      annual_ex_vat: 13320,
      annual_vat: 3330,
      annual_inc_vat: 16650,
    },
    lines: [
      {
        component_code: 'spot_per_kwh',
        name: 'Elenergi',
        quantity: 1000,
        unit: 'kWh',
        calculation_type: 'per_kwh',
        unit_price_ex_vat: 1,
        amount_ex_vat: 1000,
        vat_rate: 0.25,
        vat_amount: 250,
        amount_inc_vat: 1250,
        metadata: { contract_id: INTERNAL_UUID },
      },
      {
        component_code: 'markup_per_kwh',
        name: 'Påslag',
        quantity: 1000,
        unit: 'kWh',
        calculation_type: 'per_kwh',
        unit_price_ex_vat: 0.061,
        amount_ex_vat: 61,
        vat_rate: 0.25,
        vat_amount: 15.25,
        amount_inc_vat: 76.25,
      },
      {
        component_code: 'monthly_fee',
        name: 'Månadsavgift',
        quantity: 1,
        unit: 'month',
        calculation_type: 'fixed',
        unit_price_ex_vat: 49,
        amount_ex_vat: 49,
        vat_rate: 0.25,
        vat_amount: 12.25,
        amount_inc_vat: 61.25,
      },
    ],
    resolution: {
      id: INTERNAL_UUID,
      company_id: INTERNAL_UUID,
    },
    pricing: {
      price_plan_version_id: INTERNAL_UUID,
    },
    pricing_snapshot: {
      internal_contract_id: INTERNAL_UUID,
    },
    resolved_base_components: [{ id: INTERNAL_UUID }],
    resolved_price_components: [{ id: INTERNAL_UUID }],
    energy_direction: 'consumption',
    production_pricing: null,
    market_reference: {
      provider: 'nordpool',
      price_area: 'SE3',
      reference_type: 'preview',
      reference_period: '2026-09',
      price_sek_per_kwh: 1,
      price_ore_per_kwh: 100,
      price_ex_vat_sek_per_kwh: 0.8,
      price_ex_vat_ore_per_kwh: 80,
      requested_days: 30,
      included_days: 30,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      as_of: '2026-08-20T16:00:00.000Z',
      source_as_of: '2026-08-20T15:55:00.000Z',
      generated_at: '2026-08-20T16:00:00.000Z',
      stale_after: '2026-08-20T17:00:00.000Z',
      effective_stale_at: '2026-08-20T17:00:00.000Z',
      source_currency: 'SEK',
      source_checksum: 'market-public-checksum',
      source_resolution: 'monthly',
      unit: 'sek_per_kwh',
      includes_vat: true,
      includes_supplier_fees: false,
      includes_grid_fees: false,
      is_indicative: true,
      is_stale: false,
      fallback_used: false,
      fallback_reason: null,
      internal_market_id: INTERNAL_UUID,
    },
    market_sources: [{
      type: 'spot',
      provider: 'nordpool',
      reference_period: '2026-09',
      market_data_timestamp: '2026-08-20T16:00:00.000Z',
      id: INTERNAL_UUID,
    }],
    pricing_interval: 'monthly',
    estimate_method: 'canonical_monthly_preview',
    source_period: '2026-09',
    source_window: { start: '2026-09-01', end: '2026-09-30' },
    market_data_timestamp: '2026-08-20T16:00:00.000Z',
    is_binding: false,
    warnings: [],
    assumptions: ['Slutlig faktura använder verkliga mätvärden.'],
    pricing_snapshot_schema_version: 'gridex_contract_pricing_v6_selection',
    snapshot_schema: 'gridex_contract_pricing_v6_selection',
    price_option_reference: 'canonical_6519cb6687e54f35a5cf044c8d7cb9d1',
    area_price_reference: null,
    invoice_delivery_method: 'email',
    selected_component_references: ['component_green_energy'],
    mandatory_component_references: [],
    conditional_component_references: [],
    site_count: 1,
  }
}

describe('public website quote projection', () => {
  it('keeps the internal persistence snapshot private and emits a safe public DTO', () => {
    const projected = projectPublicWebsiteQuoteData(internalQuote())

    expect(() => assertPublicResponsePayload({ data: projected })).not.toThrow()
    expect(projected.quote_reference).toBe('quote_public_projection_1234567890')
    expect(projected.offer_reference).toBe('offer_public_projection_1234567890')
    expect(projected).not.toHaveProperty('price_per_kwh_ore')
    expect(projected.pricing).toEqual({ price_per_kwh_ore: 106.1 })
    expect(projected.market_reference).toMatchObject({
      reference_type: 'preview',
      price_ex_vat_sek_per_kwh: 0.8,
      price_ex_vat_ore_per_kwh: 80,
      source_currency: 'SEK',
      source_resolution: 'monthly',
    })
    expect(projected.offer).toMatchObject({
      offer_reference: 'offer_public_projection_1234567890',
      name: 'Gridex Månad',
      contract_type: 'variable_monthly',
    })
    expect(projected).not.toHaveProperty('resolution')
    expect(projected).not.toHaveProperty('pricing_snapshot')
    expect(projected).not.toHaveProperty('resolved_base_components')
    expect(projected).not.toHaveProperty('resolved_price_components')
    expect(projected.offer).not.toHaveProperty('id')
    expect(projected.market_reference).not.toHaveProperty('internal_market_id')
    expect((projected.lines as Record<string, unknown>[])[0]).not.toHaveProperty('metadata')
  })

  it('keeps every projected top-level field inside the checked-in WebsiteQuoteData contract', () => {
    const projected = projectPublicWebsiteQuoteData(internalQuote())
    const schemas = checkedInWebsiteOpenApi().components?.schemas ?? {}
    const quoteSchema = schemas.WebsiteQuoteData
    const marketReferenceSchema = schemas.MarketReference

    expect(quoteSchema?.additionalProperties).toBe(false)
    expect(quoteSchema?.properties).toHaveProperty('pricing')
    expect(quoteSchema?.properties).not.toHaveProperty('price_per_kwh_ore')

    const allowedTopLevel = new Set(Object.keys(quoteSchema?.properties ?? {}))
    expect(Object.keys(projected).filter((key) => !allowedTopLevel.has(key))).toEqual([])

    const marketReference = projected.market_reference as Record<string, unknown>
    for (const field of marketReferenceSchema?.required ?? []) {
      expect(marketReference, `market_reference missing required OpenAPI field ${field}`).toHaveProperty(field)
    }
    expect(marketReference).toHaveProperty('price_ex_vat_sek_per_kwh')
    expect(marketReference).toHaveProperty('price_ex_vat_ore_per_kwh')
  })

  it('projects a legacy unsafe cached idempotency response without recalculating a quote', () => {
    const replay = projectPublicWebsiteQuoteEnvelope({
      data: internalQuote(),
      request_id: '9a634b1b-2b45-4fd3-82df-3eef1ccfa056',
    }, 'c7e08f25-03c2-4bd9-a971-2f50e40a27a5') as SuccessEnvelope

    expect(replay.request_id).toBe('9a634b1b-2b45-4fd3-82df-3eef1ccfa056')
    expect(replay.data.quote_reference).toBe('quote_public_projection_1234567890')
    expect(replay.data).not.toHaveProperty('price_per_kwh_ore')
    expect(replay.data.pricing).toEqual({ price_per_kwh_ore: 106.1 })
    expect(() => assertPublicResponsePayload(replay)).not.toThrow()
  })

  it('replays cached canonical business errors exactly instead of quote-projecting them', () => {
    const errorEnvelope = {
      error: {
        code: 'invalid_quote_input',
        message: 'annual_consumption_kwh är ogiltigt.',
        retryable: false,
      },
      request_id: '58b2dd63-ae65-4ca9-b8c2-bd3c3f808714',
    }

    const replay = projectPublicWebsiteQuoteEnvelope(errorEnvelope, 'fallback')
    expect(replay).toEqual(errorEnvelope)
    expect(() => assertPublicResponsePayload(replay)).not.toThrow()
  })

  it('rejects an incomplete public commercial selection before response storage', () => {
    const incomplete = {
      ...internalQuote(),
      price_option_reference: null,
    }
    expect(() => projectPublicWebsiteQuoteData(incomplete)).toThrowError(
      expect.objectContaining({ code: 'website_quote_public_projection_failed' }),
    )
  })

  it('is deterministic for idempotency storage and replay', () => {
    const first = projectPublicWebsiteQuoteEnvelope(
      { data: internalQuote(), request_id: '9a634b1b-2b45-4fd3-82df-3eef1ccfa056' },
      'fallback',
    ) as SuccessEnvelope
    const replay = projectPublicWebsiteQuoteEnvelope(first, 'different-request-id') as SuccessEnvelope
    expect(replay).toEqual(first)
  })
})