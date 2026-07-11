import { describe, expect, it } from 'vitest'
import { calculateBasePrice } from '@/lib/pricing/basePriceCalculator'
import { assertCanonicalSnapshot, buildCanonicalContractSnapshot } from '@/lib/pricing/contractSnapshot'
import { calculatePriceComponents } from '@/lib/pricing/priceComponentCalculator'
import type { BasePriceComponent, BillingUnderlayInput, PriceComponent } from '@/lib/pricing/types'

const underlay: BillingUnderlayInput = {
  companyId: 'tenant-a',
  customerId: 'customer-a',
  meteringPointId: 'meter-a',
  priceArea: 'SE4',
  quantityKwh: 1000,
  periodStart: '2026-07-01',
  periodEnd: '2026-08-01',
}

describe('canonical contract price snapshot', () => {
  it('freezes a 60/40 portfolio/spot mix and calculates it correctly', () => {
    const snapshot = buildCanonicalContractSnapshot({
      contractType: 'mix',
      portfolioWeightPercent: 60,
      spotWeightPercent: 40,
      monthlyFeeSek: 49,
      spotMarkupOrePerKwh: 5,
    })

    assertCanonicalSnapshot(snapshot)
    expect(snapshot.pricingModel).toBe('mixed')
    expect(snapshot.basePriceComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_type: 'portfolio', weight_percent: 60 }),
        expect.objectContaining({ source_type: 'spot', weight_percent: 40 }),
      ]),
    )

    const base = calculateBasePrice({
      underlay,
      components: snapshot.basePriceComponents.map((row) => ({
        sourceType: String(row.source_type) as BasePriceComponent['sourceType'],
        weightPercent: Number(row.weight_percent),
        fixedPriceSekPerKwh: typeof row.fixed_price_sek_per_kwh === 'number' ? row.fixed_price_sek_per_kwh : null,
        label: typeof row.label === 'string' ? row.label : null,
      })),
      sourceValues: { portfolioSekPerKwh: 0.8, spotSekPerKwh: 0.5 },
    })

    expect(base.status).toBe('success')
    expect(base.baseSekPerKwh).toBeCloseTo(0.68, 6)

    const components = calculatePriceComponents({
      underlay,
      components: snapshot.priceComponents.map((row) => ({
        componentType: String(row.component_type),
        name: String(row.name),
        calculationType: String(row.calculation_type),
        amount: Number(row.amount),
        unit: typeof row.unit === 'string' ? row.unit : null,
        vatApplicable: row.vat_applicable !== false,
      } satisfies PriceComponent)),
      baseAmountExVat: base.lines.reduce((sum, line) => sum + line.amountExVat, 0),
      spotAmountExVat: base.lines
        .filter((line) => line.metadata?.source_type === 'spot')
        .reduce((sum, line) => sum + line.amountExVat, 0),
      vatRate: snapshot.vatRate,
    })

    expect(components.errors).toEqual([])
    expect(components.lines.find((line) => line.description === 'Månadsavgift')?.amountExVat).toBeCloseTo(49, 2)
    expect(components.lines.find((line) => line.description === 'Påslag')?.amountExVat).toBeCloseTo(50, 2)
  })

  it('blocks a mix that does not total 100 percent', () => {
    expect(() => buildCanonicalContractSnapshot({
      contractType: 'mixed',
      spotWeightPercent: 50,
      portfolioWeightPercent: 40,
    })).toThrow(/100/)
  })

  it('requires a fixed price for fixed and fixed-share contracts', () => {
    expect(() => buildCanonicalContractSnapshot({ contractType: 'fixed' })).toThrow(/Fastpris saknas/)
  })

  it('creates a tenant-independent canonical snapshot shape without database ids', () => {
    const snapshot = buildCanonicalContractSnapshot({
      contractType: 'portfolio',
      monthlyFeeSek: 39,
    })
    assertCanonicalSnapshot(snapshot)
    expect(snapshot.basePriceComponents[0]).toMatchObject({ source_type: 'portfolio', weight_percent: 100 })
    expect(snapshot.priceComponents[0]).toMatchObject({
      component_type: 'fixed_monthly_fee',
      calculation_type: 'fixed_monthly',
      amount: 39,
    })
  })
})
