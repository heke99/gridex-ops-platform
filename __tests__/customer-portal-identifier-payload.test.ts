import { describe, expect, it } from 'vitest'
import { portalIdentifiersFromPayload } from '@/lib/customer-portal/externalApi'

describe('customer portal payload identifier consistency', () => {
  it.each([
    { external_customer_id: 'EXT-10', externalCustomerId: 'EXT-20' },
    { customer_number: 'C-10', customerNumber: 'C-20' },
    { email: 'customer@example.test', customer_email: 'other@example.test' },
  ])('rejects contradictory aliases before API customer lookup: %j', (payload) => {
    expect(() => portalIdentifiersFromPayload(payload)).toThrowError(
      expect.objectContaining({ status: 403, code: 'customer_identifier_mismatch' }),
    )
  })

  it('accepts equivalent repeated aliases', () => {
    expect(portalIdentifiersFromPayload({ customer_number: ' C-10 ', customerNumber: 'C-10' }))
      .toMatchObject({ customerNumber: 'C-10' })
  })
})
