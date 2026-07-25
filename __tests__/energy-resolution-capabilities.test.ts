import { describe, expect, it } from 'vitest'
import { deriveEnergyResolutionReadiness } from '@/lib/energy/resolutionBinding'

const NOW = new Date('2026-07-25T12:00:00.000Z')
const FUTURE = '2026-07-26T12:00:00.000Z'

describe('granular energy resolution readiness', () => {
  it('allows SE3 pricing and quote while switch dispatch is not ready', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE3',
      gridAreaCode: 'MAL',
      gridOwnerId: null,
      resolutionStatus: 'grid_area_master_validated',
      confidence: 0.98,
      expiresAt: FUTURE,
      now: NOW,
    })

    expect(result.capabilities).toEqual({
      pricing_ready: true,
      quote_ready: true,
      facility_lookup_ready: false,
      switch_request_creatable: false,
      switch_dispatch_ready: false,
    })
    expect(result.blockers.pricing).toEqual([])
    expect(result.blockers.switch_dispatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'switch_context_required' }),
      ]),
    )
  })

  it('does not describe a postal suggestion as pricing or switch ready', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE3',
      resolutionStatus: 'postal_suggested',
      confidence: 0.7,
      expiresAt: FUTURE,
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(false)
    expect(result.capabilities.quote_ready).toBe(false)
    expect(result.capabilities.switch_dispatch_ready).toBe(false)
    expect(result.blockers.pricing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'resolution_confidence_insufficient' }),
      ]),
    )
  })

  it('blocks expired resolutions independently for pricing and quote', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE1',
      gridAreaCode: 'ABC',
      gridOwnerId: '00000000-0000-0000-0000-000000000001',
      resolutionStatus: 'grid_area_master_validated',
      confidence: 0.99,
      expiresAt: '2026-07-25T11:59:59.000Z',
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(false)
    expect(result.capabilities.quote_ready).toBe(false)
    expect(result.blockers.pricing[0]?.code).toBe('resolution_expired')
  })
})
