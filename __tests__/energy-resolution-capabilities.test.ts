import { describe, expect, it } from 'vitest'
import { deriveEnergyResolutionReadiness } from '@/lib/energy/resolutionBinding'

const NOW = new Date('2026-07-25T12:00:00.000Z')
const FUTURE = '2026-07-26T12:00:00.000Z'

describe('granular energy resolution readiness', () => {
  it('allows verified SE3 pricing and quote while switch dispatch is not ready', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE3',
      gridAreaCode: 'MAL',
      gridOwnerId: null,
      resolutionStatus: 'grid_area_master_validated',
      confidence: 0.98,
      priceAreaAssuranceStatus: 'verified',
      priceAreaAssuranceSource: 'grid_area_master',
      priceAreaAssuranceConfidence: 0.98,
      priceAreaCandidateCount: 1,
      priceAreaUniqueCount: 1,
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

  it('allows a high-confidence single-area postal consensus for price only', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE3',
      resolutionStatus: 'postal_suggested',
      confidence: 0.85,
      priceAreaAssuranceStatus: 'estimated',
      priceAreaAssuranceSource: 'postal_city_consensus',
      priceAreaAssuranceConfidence: 0.85,
      priceAreaCandidateCount: 3,
      priceAreaUniqueCount: 1,
      expiresAt: FUTURE,
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(true)
    expect(result.capabilities.quote_ready).toBe(true)
    expect(result.capabilities.facility_lookup_ready).toBe(false)
    expect(result.capabilities.switch_request_creatable).toBe(false)
    expect(result.capabilities.switch_dispatch_ready).toBe(false)
    expect(result.blockers.pricing).toEqual([])
  })

  it('blocks a low-confidence postal estimate', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE3',
      resolutionStatus: 'postal_suggested',
      confidence: 0.79,
      priceAreaAssuranceStatus: 'estimated',
      priceAreaAssuranceSource: 'postal_consensus',
      priceAreaAssuranceConfidence: 0.79,
      priceAreaCandidateCount: 1,
      priceAreaUniqueCount: 1,
      expiresAt: FUTURE,
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(false)
    expect(result.capabilities.quote_ready).toBe(false)
    expect(result.blockers.pricing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'price_area_confidence_insufficient' }),
      ]),
    )
  })

  it('keeps Papilite centroid pricing ready after public postal_consensus remapping', () => {
    // Website V1 remaps internal postal_centroid → postal_consensus. Round-tripping
    // the public payload through readiness must still honor the 0.7 centroid floor
    // when evidence retains coordinate_scope=postal_centroid.
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE3',
      resolutionStatus: 'postal_suggested',
      confidence: 0.7,
      priceAreaAssuranceStatus: 'estimated',
      priceAreaAssuranceSource: 'postal_consensus',
      priceAreaAssuranceConfidence: 0.7,
      priceAreaCandidateCount: 1,
      priceAreaUniqueCount: 1,
      priceAreaEvidence: {
        coordinate_scope: 'postal_centroid',
        provider: 'papilite',
      },
      expiresAt: FUTURE,
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(true)
    expect(result.capabilities.quote_ready).toBe(true)
    expect(result.blockers.pricing).toEqual([])
  })

  it('blocks postal candidates spanning more than one price area', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: null,
      resolutionStatus: 'postal_suggested',
      confidence: 0.85,
      priceAreaAssuranceStatus: 'ambiguous',
      priceAreaAssuranceSource: 'postal_consensus',
      priceAreaAssuranceConfidence: 0.85,
      priceAreaCandidateCount: 2,
      priceAreaUniqueCount: 2,
      conflictCode: 'postal_price_area_ambiguous',
      expiresAt: FUTURE,
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(false)
    expect(result.capabilities.quote_ready).toBe(false)
    expect(result.blockers.pricing[0]?.code).toBe('price_area_ambiguous')
    expect(result.blockers.pricing).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'price_area_confidence_insufficient' }),
      ]),
    )
  })

  it('does not promote a legacy postal suggestion without assurance evidence', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE3',
      resolutionStatus: 'postal_suggested',
      confidence: 0.85,
      expiresAt: FUTURE,
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(false)
    expect(result.priceAreaAssurance.status).toBe('unresolved')
  })

  it('blocks expired price-area evidence independently for pricing and quote', () => {
    const result = deriveEnergyResolutionReadiness({
      priceArea: 'SE1',
      gridAreaCode: 'ABC',
      gridOwnerId: '00000000-0000-0000-0000-000000000001',
      resolutionStatus: 'grid_area_master_validated',
      confidence: 0.99,
      priceAreaAssuranceStatus: 'verified',
      priceAreaAssuranceSource: 'grid_area_master',
      priceAreaAssuranceConfidence: 0.99,
      priceAreaCandidateCount: 1,
      priceAreaUniqueCount: 1,
      expiresAt: '2026-07-25T11:59:59.000Z',
      now: NOW,
    })

    expect(result.capabilities.pricing_ready).toBe(false)
    expect(result.capabilities.quote_ready).toBe(false)
    expect(result.blockers.pricing[0]?.code).toBe('price_area_evidence_expired')
    expect(result.blockers.pricing[0]?.retryable).toBe(true)
  })
})
