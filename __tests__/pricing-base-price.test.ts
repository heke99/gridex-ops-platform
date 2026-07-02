import { describe, expect, it } from 'vitest'
import { calculateBasePrice } from '@/lib/pricing/basePriceCalculator'
import type { BasePriceComponent, BasePriceSourceValues, BillingUnderlayInput, PriceArea } from '@/lib/pricing/types'

function underlay(overrides: Partial<BillingUnderlayInput> = {}): BillingUnderlayInput {
  return {
    companyId: 'company-1',
    billingUnderlayId: 'underlay-1',
    customerId: 'customer-1',
    meteringPointId: 'mp-1',
    priceArea: 'SE3',
    quantityKwh: 1000,
    periodStart: '2026-05-01',
    periodEnd: '2026-06-01',
    ...overrides,
  }
}

function spotComponent(weightPercent = 100): BasePriceComponent {
  return { sourceType: 'spot', weightPercent, label: 'Spotpris' }
}

function fixedComponent(weightPercent = 100, fixedPriceSekPerKwh = 0.89): BasePriceComponent {
  return { sourceType: 'fixed', weightPercent, fixedPriceSekPerKwh, label: 'Fastpris' }
}

function portfolioComponent(weightPercent = 100): BasePriceComponent {
  return { sourceType: 'portfolio', weightPercent, label: 'Portföljpris' }
}

describe('calculateBasePrice', () => {
  it('prices a pure spot contract from the monthly spot value', () => {
    const result = calculateBasePrice({
      underlay: underlay(),
      components: [spotComponent()],
      sourceValues: { spotSekPerKwh: 0.55 },
    })

    expect(result.status).toBe('success')
    expect(result.baseSekPerKwh).toBeCloseTo(0.55, 6)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].amountExVat).toBeCloseTo(1000 * 0.55, 2)
    expect(result.lines[0].metadata?.source_type).toBe('spot')
  })

  it.each<[PriceArea, number]>([
    ['SE1', 0.32],
    ['SE2', 0.35],
    ['SE3', 0.61],
    ['SE4', 0.78],
  ])('uses the resolved spot value for price area %s', (priceArea, spotSekPerKwh) => {
    const result = calculateBasePrice({
      underlay: underlay({ priceArea }),
      components: [spotComponent()],
      sourceValues: { spotSekPerKwh },
    })
    expect(result.status).toBe('success')
    expect(result.baseSekPerKwh).toBeCloseTo(spotSekPerKwh, 6)
  })

  it('prices a fixed contract from the component fixed price', () => {
    const result = calculateBasePrice({
      underlay: underlay({ quantityKwh: 500 }),
      components: [fixedComponent(100, 0.89)],
      sourceValues: {},
    })

    expect(result.status).toBe('success')
    expect(result.baseSekPerKwh).toBeCloseTo(0.89, 6)
    expect(result.lines[0].amountExVat).toBeCloseTo(500 * 0.89, 2)
  })

  it('prices a portfolio contract from the confirmed portfolio monthly price', () => {
    const result = calculateBasePrice({
      underlay: underlay(),
      components: [portfolioComponent()],
      sourceValues: { portfolioSekPerKwh: 0.72 },
    })

    expect(result.status).toBe('success')
    expect(result.baseSekPerKwh).toBeCloseTo(0.72, 6)
  })

  it('weights a 50/50 spot and fixed mix correctly', () => {
    const result = calculateBasePrice({
      underlay: underlay({ quantityKwh: 2000 }),
      components: [spotComponent(50), fixedComponent(50, 1.0)],
      sourceValues: { spotSekPerKwh: 0.5 },
    })

    expect(result.status).toBe('success')
    // 0.5 * 50% + 1.0 * 50% = 0.75 SEK/kWh
    expect(result.baseSekPerKwh).toBeCloseTo(0.75, 6)
    expect(result.lines).toHaveLength(2)
    const total = result.lines.reduce((sum, line) => sum + line.amountExVat, 0)
    expect(total).toBeCloseTo(2000 * 0.75, 2)
  })

  it('fails (blocks) when a required spot price is missing for the period/area', () => {
    const result = calculateBasePrice({
      underlay: underlay(),
      components: [spotComponent()],
      sourceValues: {},
    })

    expect(result.status).toBe('failed')
    expect(result.baseSekPerKwh).toBeNull()
    expect(result.errors.some((error) => error.includes('Spotpris'))).toBe(true)
  })

  it('fails (blocks) when a required portfolio price is missing for the period/area', () => {
    const result = calculateBasePrice({
      underlay: underlay(),
      components: [portfolioComponent()],
      sourceValues: { spotSekPerKwh: 0.5 },
    })

    expect(result.status).toBe('failed')
    expect(result.errors.some((error) => error.includes('Portföljpris'))).toBe(true)
  })

  it('fails when mix weights do not sum to 100 %', () => {
    const result = calculateBasePrice({
      underlay: underlay(),
      components: [spotComponent(60), fixedComponent(30, 1.0)],
      sourceValues: { spotSekPerKwh: 0.5 },
    })

    expect(result.status).toBe('failed')
    expect(result.errors.some((error) => error.includes('100'))).toBe(true)
  })

  it('fails when metering quantity is missing', () => {
    const result = calculateBasePrice({
      underlay: underlay({ quantityKwh: null }),
      components: [spotComponent()],
      sourceValues: { spotSekPerKwh: 0.5 },
    })

    expect(result.status).toBe('failed')
    expect(result.errors.some((error) => error.includes('Mätförbrukning'))).toBe(true)
  })

  it('fails when no base price component is configured', () => {
    const result = calculateBasePrice({
      underlay: underlay(),
      components: [],
      sourceValues: { spotSekPerKwh: 0.5 },
    })

    expect(result.status).toBe('failed')
    expect(result.errors.some((error) => error.includes('Prisbas saknas'))).toBe(true)
  })
})
