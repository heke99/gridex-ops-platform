import { describe, expect, it } from 'vitest'
import { selectMarketPriceRow } from '@/lib/pricing/marketPriceSources'

const policies = [
  { sourceKey: 'primary', priority: 10, maxAgeMinutes: 60, allowIndicativeLatest: false, supportedResolutions: ['monthly'] },
  { sourceKey: 'secondary', priority: 20, maxAgeMinutes: 60, allowIndicativeLatest: false, supportedResolutions: ['monthly'] },
]

describe('market price source selection', () => {
  it('uses tenant priority rather than a provider name', () => {
    const selected = selectMarketPriceRow([
      { source: 'secondary', status: 'locked', updated_at: '2026-07-21T12:00:00Z' },
      { source: 'primary', status: 'complete', updated_at: '2026-07-21T11:00:00Z' },
    ], policies)
    expect(selected?.source).toBe('primary')
  })

  it('prefers locked evidence within the same source priority', () => {
    const selected = selectMarketPriceRow([
      { source: 'primary', status: 'complete', updated_at: '2026-07-21T12:00:00Z' },
      { source: 'primary', status: 'locked', updated_at: '2026-07-21T11:00:00Z' },
    ], policies)
    expect(selected?.status).toBe('locked')
  })
  it('rejects stale unlocked evidence but keeps locked final evidence', () => {
    const now = new Date('2026-07-21T14:00:00Z')
    const stale = selectMarketPriceRow([
      { source: 'primary', status: 'complete', updated_at: '2026-07-21T12:00:00Z' },
    ], policies, { requiredResolution: 'monthly', enforceFreshness: true, now })
    expect(stale).toBeNull()

    const locked = selectMarketPriceRow([
      { source: 'primary', status: 'locked', updated_at: '2026-06-01T12:00:00Z' },
    ], policies, { requiredResolution: 'monthly', enforceFreshness: true, now })
    expect(locked?.status).toBe('locked')
  })

  it('rejects providers that do not support the requested resolution', () => {
    const selected = selectMarketPriceRow([
      { source: 'primary', status: 'locked', updated_at: '2026-07-21T12:00:00Z' },
    ], policies, { requiredResolution: 'quarterly' })
    expect(selected).toBeNull()
  })

})
