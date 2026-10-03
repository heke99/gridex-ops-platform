import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

import {
  evaluateMeteringResolutionRequirement,
  meteringResolutionForContract,
  normalizeMeteringResolution,
  utiltsResolutionCode,
} from '@/lib/metering/contractMeteringResolution'

describe('meteringResolutionForContract', () => {
  it('follows the contract type, never a channel default', () => {
    expect(meteringResolutionForContract({ contractType: 'fixed' })).toBe('month')
    expect(meteringResolutionForContract({ contractType: 'variable_monthly' })).toBe('month')
    expect(meteringResolutionForContract({ contractType: 'variable_hourly' })).toBe('hour')
    expect(meteringResolutionForContract({ contractType: 'variable_quarterly' })).toBe('quarter_hour')
    expect(meteringResolutionForContract({ contractType: 'portfolio' })).toBe('quarter_hour')
    expect(meteringResolutionForContract({ contractType: 'mixed' })).toBe('quarter_hour')
  })

  it('lets the locked price snapshot decide when it states an interval', () => {
    expect(meteringResolutionForContract({ contractType: 'portfolio', priceSnapshot: { interval_resolution: 'hourly' } })).toBe('hour')
    expect(meteringResolutionForContract({ contractType: 'mixed', priceSnapshot: { pricing: { interval_resolution: 'monthly' } } })).toBe('month')
  })

  it('requests the finest data for unknown contract types instead of guessing low', () => {
    expect(meteringResolutionForContract({ contractType: 'manual_override' })).toBe('quarter_hour')
  })
})

describe('evaluateMeteringResolutionRequirement', () => {
  const contract = (contract_type: string) => ({ id: 'c1', contract_type, price_snapshot: {} })

  it('requests what the contract needs on an interval meter', () => {
    const result = evaluateMeteringResolutionRequirement({ meteringPointId: 'mp', readingFrequency: 'hourly', contract: contract('variable_hourly') })
    expect(result).toMatchObject({ contractResolution: 'hour', requestResolution: 'hour', meterCannotDeliver: false, source: 'contract_type' })
  })

  it('flags an hourly contract on a monthly-read meter instead of silently downgrading', () => {
    const result = evaluateMeteringResolutionRequirement({ meteringPointId: 'mp', readingFrequency: 'monthly', contract: contract('variable_quarterly') })
    expect(result).toMatchObject({ contractResolution: 'quarter_hour', requestResolution: 'month', meterCannotDeliver: true })
  })

  it('a monthly contract on a monthly meter is fine', () => {
    const result = evaluateMeteringResolutionRequirement({ meteringPointId: 'mp', readingFrequency: 'monthly', contract: contract('fixed') })
    expect(result.meterCannotDeliver).toBe(false)
  })

  it('without a contract requests what the meter delivers', () => {
    expect(evaluateMeteringResolutionRequirement({ meteringPointId: 'mp', readingFrequency: 'hourly', contract: null }))
      .toMatchObject({ requestResolution: 'quarter_hour', source: 'no_contract' })
  })
})

describe('resolution codes', () => {
  it('maps to Ediel minute codes (hourly is 60, not 15)', () => {
    expect(utiltsResolutionCode('quarter_hour')).toBe('15')
    expect(utiltsResolutionCode('hour')).toBe('60')
    expect(utiltsResolutionCode('day')).toBe('1440')
    expect(normalizeMeteringResolution('PT15M')).toBe('quarter_hour')
    expect(normalizeMeteringResolution('hourly')).toBe('hour')
    expect(normalizeMeteringResolution('nonsense')).toBeNull()
  })
})
