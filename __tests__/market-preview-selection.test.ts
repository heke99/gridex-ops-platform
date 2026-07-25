import { describe, expect, it } from 'vitest'
import { selectMarketPricePreviewRow, type MarketPriceSourcePolicy } from '@/lib/pricing/marketPriceSources'

const policy = (overrides: Partial<MarketPriceSourcePolicy> = {}): MarketPriceSourcePolicy => ({
  sourceKey: 'elprisetjustnu',
  priority: 10,
  maxAgeMinutes: 180,
  allowIndicativeLatest: false,
  supportedResolutions: ['monthly', 'hourly', 'quarterly'],
  priceAreas: ['SE1', 'SE2', 'SE3', 'SE4'],
  forecastPolicy: 'latest_available_indication',
  portfolioPolicy: 'require_locked_period_price',
  ...overrides,
})

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'preview-1',
    provider: 'elprisetjustnu',
    price_area: 'SE3',
    reference_period: 'rolling_30_days',
    price_sek_per_kwh: 0.65,
    requested_days: 30,
    included_days: 30,
    fallback_used: false,
    source_as_of: '2026-07-24T14:00:00Z',
    generated_at: '2026-07-24T14:01:00Z',
    stale_after: '2026-07-24T18:00:00Z',
    status: 'active',
    ...overrides,
  }
}

describe('canonical market preview selection', () => {
  it('selects a complete fresh 30-day preview', () => {
    const selected = selectMarketPricePreviewRow([row()], [policy()], {
      priceArea: 'SE3',
      requiredResolution: 'monthly',
      now: new Date('2026-07-24T15:00:00Z'),
    })
    expect(selected?.row.id).toBe('preview-1')
    expect(selected?.windowComplete).toBe(true)
    expect(selected?.effectiveStaleAt).toBe('2026-07-24T17:00:00.000Z')
  })

  it('rejects a partial fallback when tenant policy forbids it', () => {
    const selected = selectMarketPricePreviewRow([
      row({ included_days: 1, fallback_used: true, fallback_reason: 'partial_reference_window' }),
    ], [policy({ allowIndicativeLatest: false })], {
      priceArea: 'SE3',
      requiredResolution: 'monthly',
      now: new Date('2026-07-24T15:00:00Z'),
    })
    expect(selected).toBeNull()
  })

  it('allows an explicitly configured partial fallback', () => {
    const selected = selectMarketPricePreviewRow([
      row({ included_days: 7, fallback_used: true }),
    ], [policy({ allowIndicativeLatest: true })], {
      priceArea: 'SE3',
      requiredResolution: 'monthly',
      now: new Date('2026-07-24T15:00:00Z'),
    })
    expect(selected?.includedDays).toBe(7)
    expect(selected?.windowComplete).toBe(false)
  })

  it('uses tenant provider priority before a newer lower-priority provider', () => {
    const primary = policy({ sourceKey: 'primary', priority: 1 })
    const secondary = policy({ sourceKey: 'secondary', priority: 100 })
    const selected = selectMarketPricePreviewRow([
      row({ id: 'secondary', provider: 'secondary', source_as_of: '2026-07-24T14:30:00Z' }),
      row({ id: 'primary', provider: 'primary', source_as_of: '2026-07-24T14:00:00Z' }),
    ], [secondary, primary], {
      priceArea: 'SE3',
      requiredResolution: 'monthly',
      now: new Date('2026-07-24T15:00:00Z'),
    })
    expect(selected?.row.id).toBe('primary')
  })

  it('accepts negative spot prices', () => {
    const selected = selectMarketPricePreviewRow([row({ price_sek_per_kwh: -0.12 })], [policy()], {
      priceArea: 'SE3',
      requiredResolution: 'monthly',
      now: new Date('2026-07-24T15:00:00Z'),
    })
    expect(selected?.row.price_sek_per_kwh).toBe(-0.12)
  })

  it('never selects quarter-hour evidence for an hourly quote', () => {
    const selected = selectMarketPricePreviewRow([
      row({ id: 'quarter', source_resolution: 'quarter_hour' }),
      row({ id: 'hour', source_resolution: 'hourly' }),
    ], [policy()], {
      priceArea: 'SE3',
      requiredResolution: 'hourly',
      now: new Date('2026-07-24T15:00:00Z'),
    })
    expect(selected?.row.id).toBe('hour')
  })

  it('requires quarter-hour evidence for a quarterly quote', () => {
    const selected = selectMarketPricePreviewRow([
      row({ id: 'hour', source_resolution: 'hourly' }),
    ], [policy()], {
      priceArea: 'SE3',
      requiredResolution: 'quarterly',
      now: new Date('2026-07-24T15:00:00Z'),
    })
    expect(selected).toBeNull()
  })
})
