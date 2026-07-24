import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import websiteOpenApi from '@/docs/openapi/website-integration-v1.json'
import customerPortalOpenApiDocument from '@/docs/openapi/customer-portal-v1.json'

const root = process.cwd()
const websiteSpec = websiteOpenApi as unknown as Record<string, any>
const customerPortalOpenApi = customerPortalOpenApiDocument as unknown as Record<string, any>

describe('market-price public API contract', () => {
  it('keeps runtime, registry and OpenAPI on version 2026-07-24.2', () => {
    const contract = readFileSync(`${root}/lib/integrations/websiteIntegrationContract.ts`, 'utf8')
    const registry = readFileSync(`${root}/lib/api/publicRouteRegistry.ts`, 'utf8')
    expect(contract).toContain("WEBSITE_INTEGRATION_CONTRACT_VERSION = '2026-07-24.2'")
    expect(registry).toContain("path: '/api/v1/website/market-price/current'")
    expect(websiteSpec.info.version).toBe('2026-07-24.2')
    expect(customerPortalOpenApi.info.version).toBe('2026-07-24.2')
  })

  it('documents the current market-price endpoint only in website OpenAPI', () => {
    expect(websiteSpec.paths['/api/v1/website/market-price/current']).toBeDefined()
    expect(customerPortalOpenApi.paths['/api/v1/website/market-price/current']).toBeUndefined()
    const response = websiteSpec.components.schemas.CurrentMarketPriceResponse
    expect(response.required).toContain('contract_schema_version')
    expect(response.properties.contract_schema_version.const).toBe('2026-07-24.2')
  })

  it('requires direct numeric price and evidence fields in MarketReference', () => {
    const schema = websiteSpec.components.schemas.MarketReference
    expect(schema.properties.reference_type.const).toBe('preview')
    for (const field of [
      'price_sek_per_kwh',
      'price_ore_per_kwh',
      'price_ex_vat_sek_per_kwh',
      'price_ex_vat_ore_per_kwh',
      'requested_days',
      'included_days',
      'source_as_of',
      'generated_at',
      'stale_after',
      'effective_stale_at',
    ]) {
      expect(schema.required).toContain(field)
      expect(schema.properties[field]).toBeDefined()
    }
  })

  it('surfaces market-price readiness in system health', () => {
    const migration = readFileSync(`${root}/supabase/migrations/20260724223000_market_price_api_documentation_completion.sql`, 'utf8')
    const health = readFileSync(`${root}/lib/ops/health.ts`, 'utf8')
    const page = readFileSync(`${root}/app/admin/system-health/page.tsx`, 'utf8')
    expect(migration).toContain('gridex_market_price_readiness_v')
    expect(migration).toContain('gridex_ops_health_checks_v3')
    expect(health).toContain('gridex_ops_health_checks_v3')
    expect(page).toContain('Marknadspris och tenant-API')
  })

  it('runs spot cron hourly and imports previous/current Stockholm days', () => {
    const vercel = JSON.parse(readFileSync(`${root}/vercel.json`, 'utf8')) as { crons: Array<{ path: string; schedule: string }> }
    const cron = vercel.crons.find((item) => item.path === '/api/cron/pricing/spot-prices')
    expect(cron?.schedule).toBe('15 * * * *')
    const route = readFileSync(`${root}/app/api/cron/pricing/spot-prices/route.ts`, 'utf8')
    expect(route).toContain('previousStockholmCalendarDate')
    expect(route).toContain('currentStockholmCalendarDate')
    expect(route).toContain('nextStockholmCalendarDate')
  })
})
