import { describe, expect, it } from 'vitest'
import {
  calculationTypeForPricingUnit,
  displayPricingUnit,
  normalizePricingUnit,
  normalizePricingUnitForComponent,
  sekPerKwhFromComponent,
} from '@/lib/pricing/unitConversion'
import type { PriceComponent } from '@/lib/pricing/types'

describe('normalizePricingUnit', () => {
  it('normalizes öre/kWh spellings', () => {
    expect(normalizePricingUnit({ unit: 'ore_per_kwh' })).toBe('ore_per_kwh')
    expect(normalizePricingUnit({ unit: 'öre/kWh' })).toBe('ore_per_kwh')
    expect(normalizePricingUnit({ unit: 'ÖRE/KWH' })).toBe('ore_per_kwh')
  })

  it('normalizes SEK/kWh spellings', () => {
    expect(normalizePricingUnit({ unit: 'sek_per_kwh' })).toBe('sek_per_kwh')
    expect(normalizePricingUnit({ unit: 'kr/kWh' })).toBe('sek_per_kwh')
  })

  it('normalizes monthly and invoice units', () => {
    expect(normalizePricingUnit({ unit: 'kr/månad' })).toBe('sek_month')
    expect(normalizePricingUnit({ unit: 'sek_month' })).toBe('sek_month')
    expect(normalizePricingUnit({ unit: 'kr/faktura' })).toBe('sek_invoice')
  })

  it('falls back to calculationType and componentType for legacy rows', () => {
    expect(normalizePricingUnit({ unit: null, calculationType: 'fixed_monthly' })).toBe('sek_month')
    expect(normalizePricingUnit({ unit: null, calculationType: null, componentType: 'invoice_fee' })).toBe('sek_invoice')
  })

  it('returns unknown for unrecognized units', () => {
    expect(normalizePricingUnit({ unit: 'bananas' })).toBe('unknown')
  })
})

describe('normalizePricingUnitForComponent', () => {
  it('reinterprets legacy plain-SEK monthly fees as SEK per month', () => {
    expect(
      normalizePricingUnitForComponent({ unit: 'sek', componentType: 'fixed_monthly_fee', calculationType: 'fixed_once' })
    ).toBe('sek_month')
  })

  it('reinterprets legacy plain-SEK invoice fees as SEK per invoice', () => {
    expect(
      normalizePricingUnitForComponent({ unit: 'kr', componentType: 'invoice_fee', calculationType: 'fixed_once' })
    ).toBe('sek_invoice')
  })
})

describe('sekPerKwhFromComponent', () => {
  const base: PriceComponent = {
    componentType: 'markup_ore_per_kwh',
    name: 'Påslag',
    calculationType: 'per_kwh',
    amount: 5,
    unit: 'ore_per_kwh',
  }

  it('converts öre/kWh to SEK/kWh (divide by 100)', () => {
    expect(sekPerKwhFromComponent(base)).toBeCloseTo(0.05, 6)
  })

  it('keeps SEK/kWh unchanged', () => {
    expect(sekPerKwhFromComponent({ ...base, unit: 'sek_per_kwh', amount: 0.05 })).toBeCloseTo(0.05, 6)
  })
})

describe('display and calculation-type mapping', () => {
  it('maps normalized units to Swedish display units', () => {
    expect(displayPricingUnit('ore_per_kwh')).toBe('öre/kWh')
    expect(displayPricingUnit('sek_month')).toBe('kr/månad')
    expect(displayPricingUnit('unknown')).toBe('okänd enhet')
  })

  it('maps units to calculation types', () => {
    expect(calculationTypeForPricingUnit('ore_per_kwh')).toBe('per_kwh')
    expect(calculationTypeForPricingUnit('sek_month')).toBe('fixed_monthly')
    expect(calculationTypeForPricingUnit('%')).toBe('percentage')
    expect(calculationTypeForPricingUnit('sek')).toBe('fixed_once')
  })
})
