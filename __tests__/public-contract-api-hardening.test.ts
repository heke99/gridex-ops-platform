import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  buildPublicContractRepresentationEtag,
  canonicalJson,
  ifNoneMatchMatches,
  parsePublicContractsQuery,
  PublicContractsQueryError,
} from '@/lib/website/publicContractApi'

function request(query = '', headers: Record<string, string> = {}) {
  return new NextRequest(`https://tenant.example/api/v1/website/public-contracts${query}`, { headers })
}

describe('public contract API query contract', () => {
  it('accepts the documented website filters', () => {
    expect(parsePublicContractsQuery(request('?customer_type=private&channel=website&diagnostics=0'))).toEqual({
      customerType: 'private',
      channel: 'website',
      diagnostics: false,
    })
  })

  it('rejects unknown, duplicate and widening parameters', () => {
    expect(() => parsePublicContractsQuery(request('?customer_type=both'))).toThrow(PublicContractsQueryError)
    expect(() => parsePublicContractsQuery(request('?customer_type=private&customer_type=business'))).toThrow(PublicContractsQueryError)
    expect(() => parsePublicContractsQuery(request('?channel=api'))).toThrow(PublicContractsQueryError)
    expect(() => parsePublicContractsQuery(request('?debug=1'))).toThrow(PublicContractsQueryError)
  })

  it('matches only the exact organization/channel ETag token', () => {
    expect(ifNoneMatchMatches(request('', { 'if-none-match': '"other", "contracts-abc"' }), '"contracts-abc"')).toBe(true)
    expect(ifNoneMatchMatches(request('', { 'if-none-match': '"other"' }), '"contracts-abc"')).toBe(false)
  })

  it('canonicalizes object keys before representation hashing', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    )
  })

  it('changes ETag whenever the actual contract representation changes', () => {
    const base = {
      organizationReference: 'organization_xxxxxxxxxxxxxxxxxxxx',
      channel: 'website' as const,
      customerType: 'private' as const,
      contractSchemaVersion: '2026-08-19.2',
      contracts: [{ offer_reference: 'offer_1', monthly_fee: 49 }],
      feedState: 'contracts_present' as const,
      emptyFeedAuthorization: null,
    }
    const first = buildPublicContractRepresentationEtag(base)
    expect(buildPublicContractRepresentationEtag({
      ...base,
      contracts: [{ monthly_fee: 49, offer_reference: 'offer_1' }],
    })).toBe(first)
    expect(buildPublicContractRepresentationEtag({
      ...base,
      contracts: [{ offer_reference: 'offer_1', monthly_fee: 59 }],
    })).not.toBe(first)
    expect(buildPublicContractRepresentationEtag({
      ...base,
      contracts: [],
      feedState: 'canonical_empty',
      emptyFeedAuthorization: {
        authorized: true,
        reason: 'canonical_unpublished_or_archived',
        blockers: ['PUBLICATION_NOT_PUBLISHED'],
      },
    })).not.toBe(first)
    expect(buildPublicContractRepresentationEtag({
      ...base,
      feedState: 'canonical_empty',
      contracts: [],
      emptyFeedAuthorization: {
        authorized: true,
        reason: 'publication_validity_ended',
        blockers: ['PUBLICATION_EXPIRED'],
      },
    })).not.toBe(first)
  })
})
