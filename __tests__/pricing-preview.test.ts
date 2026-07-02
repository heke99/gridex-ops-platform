import { describe, expect, it } from 'vitest'
import { finalizePricingPreview } from '@/lib/pricing/pricePreviewBuilder'
import type { PricingPreviewLine } from '@/lib/pricing/types'

function line(overrides: Partial<PricingPreviewLine>): PricingPreviewLine {
  return {
    lineType: 'base_price',
    description: 'Rad',
    quantity: 1,
    unit: 'st',
    unitPriceExVat: null,
    amountExVat: 0,
    vatRate: 0,
    vatAmount: 0,
    amountIncVat: 0,
    sortOrder: 10,
    ...overrides,
  }
}

describe('finalizePricingPreview', () => {
  it('applies the default 25 % VAT to base lines that carry no VAT yet and sums totals', () => {
    const result = finalizePricingPreview({
      billingUnderlayId: 'underlay-1',
      lines: [
        line({ amountExVat: 550, sortOrder: 10 }),
        line({ amountExVat: 50, vatRate: 0.25, vatAmount: 12.5, amountIncVat: 62.5, sortOrder: 20 }),
      ],
    })

    expect(result.status).toBe('success')
    expect(result.lines[0].vatRate).toBe(0.25)
    expect(result.lines[0].vatAmount).toBeCloseTo(137.5, 2)
    expect(result.totalExVat).toBeCloseTo(600, 2)
    expect(result.vatAmount).toBeCloseTo(150, 2)
    expect(result.totalIncVat).toBeCloseTo(750, 2)
  })

  it('handles negative discount lines so VAT stays consistent', () => {
    const result = finalizePricingPreview({
      lines: [
        line({ amountExVat: 100, vatRate: 0.25, vatAmount: 25, amountIncVat: 125, sortOrder: 10 }),
        line({ amountExVat: -20, vatRate: 0.25, vatAmount: -5, amountIncVat: -25, sortOrder: 20 }),
      ],
    })

    expect(result.totalExVat).toBeCloseTo(80, 2)
    expect(result.vatAmount).toBeCloseTo(20, 2)
    expect(result.totalIncVat).toBeCloseTo(100, 2)
  })

  it('rounds totals to öre (2 decimals)', () => {
    const result = finalizePricingPreview({
      lines: [
        line({ amountExVat: 33.333, vatRate: 0.25, vatAmount: 8.33, amountIncVat: 41.66, sortOrder: 10 }),
        line({ amountExVat: 33.333, vatRate: 0.25, vatAmount: 8.33, amountIncVat: 41.66, sortOrder: 20 }),
      ],
    })

    expect(result.totalExVat).toBeCloseTo(66.67, 2)
    expect(Number.isInteger(Math.round(result.totalExVat * 100))).toBe(true)
    expect(result.totalIncVat).toBeCloseTo(result.totalExVat + result.vatAmount, 2)
  })

  it('sorts lines by sortOrder', () => {
    const result = finalizePricingPreview({
      lines: [
        line({ description: 'B', sortOrder: 20 }),
        line({ description: 'A', sortOrder: 10 }),
      ],
    })
    expect(result.lines.map((entry) => entry.description)).toEqual(['A', 'B'])
  })

  it('marks the preview failed when blocking errors exist', () => {
    const result = finalizePricingPreview({
      lines: [],
      errors: ['Spotpris saknas för perioden och elområdet.'],
    })

    expect(result.status).toBe('failed')
    expect(result.errors).toHaveLength(1)
  })
})
