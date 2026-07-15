import { describe, expect, it } from 'vitest'
import { normalizeContractPricing } from '@/lib/pricing/contractPricingVersioning'

describe('contract pricing versioning snapshot', () => {
  it('generates canonical public price text', () => {
    const result = normalizeContractPricing({ name: 'Rörligt', contractType: 'variable_monthly', customerType: 'private', spotMarkupOrePerKwh: '4', monthlyFeeSek: '59', vatRate: '25' })
    expect(result.publicPriceText).toContain('påslag 4 öre/kWh')
    expect(result.publicPriceText).toContain('månadsavgift 59 kr')
    expect(result.snapshot.price_components).toHaveLength(2)
  })

  it('blocks fixed contracts without fixed price', () => {
    expect(() => normalizeContractPricing({ name: 'Fast', contractType: 'fixed', customerType: 'both' })).toThrow(/fast pris/i)
  })

  it('blocks mix weights that do not total 100', () => {
    expect(() => normalizeContractPricing({ name: 'Mix', contractType: 'mixed', customerType: 'both', spotWeightPercent: 60, portfolioWeightPercent: 30, fixedWeightPercent: 0 })).toThrow(/100 procent/i)
  })

  it('blocks negative fees', () => {
    expect(() => normalizeContractPricing({ name: 'Rörligt', contractType: 'spot', customerType: 'both', monthlyFeeSek: -1 })).toThrow(/Månadsavgift/i)
  })

  it('requires a discount period', () => {
    expect(() => normalizeContractPricing({ name: 'Rörligt', contractType: 'spot', customerType: 'both', discountValue: 50 })).toThrow(/rabattperiod/i)
  })

  it('normalizes price areas', () => {
    const result = normalizeContractPricing({ name: 'Rörligt', contractType: 'spot', customerType: 'both', priceAreas: 'se1, SE3 se1' })
    expect(result.snapshot.price_areas).toEqual(['SE1', 'SE3'])
  })
})
