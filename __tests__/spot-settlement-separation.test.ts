import { describe, expect, it } from 'vitest'
import { selectMarketPriceRow } from '@/lib/pricing/marketPriceSources'

describe('preview and settlement separation', () => {
  const policy = [{
    sourceKey: 'elprisetjustnu',
    priority: 1,
    maxAgeMinutes: 180,
    allowIndicativeLatest: true,
    supportedResolutions: ['monthly'],
    priceAreas: ['SE4'],
    forecastPolicy: 'latest_available_indication' as const,
    portfolioPolicy: 'require_locked_period_price' as const,
  }]

  it('accepts locked historical settlement without a freshness window', () => {
    const selected = selectMarketPriceRow([
      {
        id: 'locked-month',
        source: 'elprisetjustnu',
        price_area: 'SE4',
        status: 'locked',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-02-01T00:00:00Z',
        verified_at: '2025-02-01T00:05:00Z',
        locked_at: '2025-02-01T00:10:00Z',
        covered_duration_minutes: 44_640,
        expected_duration_minutes: 44_640,
        quality_issues: [],
        source_checksum: 'verified-checksum',
        average_sek_per_kwh: 1.25,
      },
    ], [...policy], {
      requiredResolution: 'monthly',
      priceArea: 'SE4',
      enforceFreshness: false,
      dataKind: 'settlement',
    })
    expect(selected?.id).toBe('locked-month')
  })

  it('rejects indicative preview evidence as settlement', () => {
    const selected = selectMarketPriceRow([
      {
        id: 'preview',
        source: 'elprisetjustnu',
        provider: 'elprisetjustnu',
        price_area: 'SE4',
        status: 'preview',
        is_indicative: true,
        average_sek_per_kwh: 1.25,
      },
    ], [...policy], {
      requiredResolution: 'monthly',
      priceArea: 'SE4',
      enforceFreshness: false,
      dataKind: 'settlement',
    })
    expect(selected).toBeNull()
  })
  it('rejects a legacy locked row without complete verification evidence', () => {
    const selected = selectMarketPriceRow([
      {
        id: 'legacy-locked-month',
        source: 'elprisetjustnu',
        price_area: 'SE4',
        status: 'locked',
        locked_at: '2025-02-01T00:10:00Z',
        average_sek_per_kwh: 1.25,
      },
    ], [...policy], {
      requiredResolution: 'monthly',
      priceArea: 'SE4',
      enforceFreshness: false,
      dataKind: 'settlement',
    })
    expect(selected).toBeNull()
  })

})
