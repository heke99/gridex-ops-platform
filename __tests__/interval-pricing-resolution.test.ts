import { describe, expect, it } from 'vitest'
import { spotPriceResolutionMatches } from '@/lib/pricing/intervalPricing'

describe('interval pricing source resolution', () => {
  it('uses only canonical hourly spot prices for hourly contracts', () => {
    expect(spotPriceResolutionMatches('hourly', 'hourly')).toBe(true)
    expect(spotPriceResolutionMatches('hourly', 'quarter_hour')).toBe(false)
  })

  it('uses only canonical quarter-hour spot prices for quarterly contracts', () => {
    expect(spotPriceResolutionMatches('quarterly', 'quarter_hour')).toBe(true)
    expect(spotPriceResolutionMatches('quarterly', 'hourly')).toBe(false)
  })
})
