// reality-defects: F9-T48
// Owner decision 41 (2026-10-28): an existing monthly contract keeps the arithmetic mean of its contracted calendar
// month ("Medelspotpris"); a method the locked snapshot states is followed; hourly and quarterly contracts are priced
// per delivered interval ("Spotpris"). There is no general move to the Ediel month.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

import { calculateBasePrice } from '@/lib/pricing/basePriceCalculator'
import { civilDeliveryDaysOutsideMonth, spotIntervalResolution, spotPriceMonth } from '@/lib/pricing/engine'
import type { BillingUnderlayInput } from '@/lib/pricing/types'

describe('monthly contract: contracted calendar month', () => {
  it('an Ediel-month underlay (00:00 +0100 on the 1st) is priced with its civil month, not the Ediel month', () => {
    expect(spotPriceMonth('2026-09-01', '2026-09')).toBe('2026-09')
    expect(spotPriceMonth('2026-10-01', '2026-10')).toBe('2026-10')
  })

  it('a reconciliation run in a later month keeps the original period month', () => {
    expect(spotPriceMonth('2026-08-01', '2026-10')).toBe('2026-08')
  })

  it('negative: without a dated period start the billing month is used, never an invented month', () => {
    expect(spotPriceMonth('', '2026-10')).toBe('2026-10')
    expect(spotPriceMonth('2026-08-01T22:00:00Z', '2026-10')).toBe('2026-10')
  })
})

describe('resolution per contract', () => {
  it('a monthly contract without a stated method is priced monthly', () => {
    expect(spotIntervalResolution({}, {}, 'variable_monthly')).toBe('monthly')
  })

  it('hourly and quarterly contracts match their delivered price interval', () => {
    expect(spotIntervalResolution({}, {}, 'variable_hourly')).toBe('hourly')
    expect(spotIntervalResolution({}, {}, 'variable_quarterly')).toBe('quarterly')
  })

  it('a method the locked snapshot states is followed, also against the contract type', () => {
    expect(spotIntervalResolution({ interval_resolution: 'hourly' }, {}, 'variable_monthly')).toBe('hourly')
    expect(spotIntervalResolution({}, { interval_resolution: 'quarterly' }, 'variable_monthly')).toBe('quarterly')
    expect(spotIntervalResolution({ interval_resolution: 'monthly' }, {}, 'variable_hourly')).toBe('monthly')
  })
})

describe('the monthly price is the arithmetic mean times kWh', () => {
  const underlay = (snapshot: Record<string, unknown>) =>
    ({ quantityKwh: 1432.223, pricingSnapshot: snapshot }) as unknown as BillingUnderlayInput

  it('F batch: 1 432,223 kWh at the civil-month mean gives the invoiced amount, labelled Medelspotpris', () => {
    const mean = 687.92 / 1432.223
    const result = calculateBasePrice({
      underlay: underlay({ contract_type: 'variable_monthly' }),
      components: [{ sourceType: 'spot', weightPercent: 100 } as never],
      sourceValues: { spotSekPerKwh: mean } as never,
    })
    expect(result.status).not.toBe('failed')
    expect(result.lines[0].description).toContain('Medelspotpris')
    expect(result.lines[0].amountExVat).toBe(687.92)
  })

  it('negative: an hourly contract is not labelled with a monthly mean', () => {
    const result = calculateBasePrice({
      underlay: underlay({ contract_type: 'variable_hourly' }),
      components: [{ sourceType: 'spot', weightPercent: 100 } as never],
      sourceValues: { spotSekPerKwh: 0.5 } as never,
    })
    expect(result.lines[0].description).toContain('Spotpris')
    expect(result.lines[0].description).not.toContain('Medelspotpris')
  })
})

it('the edge civil day of an Ediel month is outside the price month and is the only extra day', () => {
  expect(civilDeliveryDaysOutsideMonth('2026-08-31T22:00:00Z', '2026-09-30T23:00:00Z', '2026-09')).toEqual(['2026-10-01'])
  expect(civilDeliveryDaysOutsideMonth('2026-08-31T22:00:00Z', '2026-09-30T22:00:00Z', '2026-09')).toEqual([])
})
