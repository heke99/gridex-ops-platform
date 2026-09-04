import { describe, expect, it } from 'vitest'
import { inboundRouteMessageCodeMatches } from '@/lib/ediel/tenant/inboundRouteSemantics'

// Regression boundary: operational tenant routing consumes the dependency-light canonical response projection without importing unrelated runtime graphs.
describe('inbound route business-response matching', () => {
  it('allows canonical Z02 as the business response to a configured PRODAT Z01 route', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'PRODAT', configuredCode: 'Z01', inboundCode: 'Z02' })).toBe(true)
  })
  it('keeps exact message-code routes valid', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'PRODAT', configuredCode: 'Z02', inboundCode: 'Z02' })).toBe(true)
  })
  it('does not turn unrelated PRODAT codes into route evidence', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'PRODAT', configuredCode: 'Z03', inboundCode: 'Z02' })).toBe(false)
  })
  it('fails closed for unknown families on a mismatched code', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'UNKNOWN', configuredCode: 'A', inboundCode: 'B' })).toBe(false)
  })
})
