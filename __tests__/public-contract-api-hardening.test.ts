import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { ifNoneMatchMatches, parsePublicContractsQuery, PublicContractsQueryError } from '@/lib/website/publicContractApi'

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

  it('matches only the exact tenant/channel ETag token', () => {
    expect(ifNoneMatchMatches(request('', { 'if-none-match': '"other", "contracts-abc"' }), '"contracts-abc"')).toBe(true)
    expect(ifNoneMatchMatches(request('', { 'if-none-match': '"other"' }), '"contracts-abc"')).toBe(false)
  })
})
