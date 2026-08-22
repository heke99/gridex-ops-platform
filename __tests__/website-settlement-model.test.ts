import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { websiteSettlementForContract } from '@/lib/pricing/websiteSettlement'

const read = (path: string) => readFileSync(path, 'utf8')

describe('website settlement model', () => {
  it.each([
    ['fixed','fixed_price','fixed_energy_price',true,'fixed'],
    ['variable_monthly','market_monthly','pricing_model',false,'month'],
    ['variable_hourly','market_hourly','pricing_model',false,'hour'],
    ['variable_quarterly','market_quarter_hour','pricing_model',false,'quarter_hour'],
    ['portfolio','portfolio','portfolio_pricing_model',false,'portfolio_period'],
    ['mixed','mixed','mixed_pricing_model',false,'mixed_components'],
  ] as const)('%s maps to the correct settlement contract', (contractType, model, accepts, locked, resolution) => {
    const settlement = websiteSettlementForContract({ contractType })
    expect(settlement.model).toBe(model)
    expect(settlement.customer_accepts).toBe(accepts)
    expect(settlement.energy_price_locked_at_signup).toBe(locked)
    expect(settlement.uses_actual_metered_consumption).toBe(true)
    expect(settlement.settlement_resolution).toBe(resolution)
    expect(settlement.market_data_role).toBe(locked ? 'not_applicable' : 'indicative_preview_only')
  })

  it('keeps settlement organization-scoped and billing based on metered data, not quote preview market data', () => {
    const quotes = read('lib/pricing/websiteQuotes.ts')
    const engine = read('lib/pricing/engine.ts')
    const sources = read('lib/pricing/priceSourceResolver.ts')
    const projector = read('lib/pricing/publicWebsiteQuote.ts')
    expect(quotes).toContain(".eq('company_id', input.client.company_id)")
    expect(engine).toContain('.eq("company_id", companyId)')
    expect(engine).toContain('quantityKwh: numberValue(underlay.total_kwh)')
    expect(engine).toContain('resolveIntervalSpotPricing')
    expect(sources).toContain('purpose ?? "settlement"')
    expect(sources).toContain('.eq("company_id", input.companyId)')
    expect(projector).toContain('publicSettlement')
    expect(projector).not.toContain('spot_price_summary_id')
  })
})
