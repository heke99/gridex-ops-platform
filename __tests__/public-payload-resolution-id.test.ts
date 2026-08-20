import { describe, expect, it } from 'vitest'
import {
  PublicPayloadSafetyError,
  assertPublicResponsePayload,
} from '@/lib/api/publicPayloadSafety'

const resolutionId = '9ce4490c-59ae-4de7-a66e-414486db12bb'
const internalCustomerId = '5ef6d6c4-1111-4222-8333-30f160647e4f'

describe('public payload safety for canonical website energy resolution', () => {
  it('allows the contract-defined resolution_id handle', () => {
    expect(() =>
      assertPublicResponsePayload({
        data: {
          resolution_id: resolutionId,
          price_area: 'SE4',
          resolution_status: 'postal_suggested',
        },
        request_id: 'b977e264-f693-4be3-a858-144d285e0ff1',
        correlation_id: 'd01fb0a1-4f0a-4247-8ae5-4613f40e23de',
      }),
    ).not.toThrow()
  })

  it('continues to reject unrelated internal identifiers', () => {
    expect(() =>
      assertPublicResponsePayload({ data: { customer_id: internalCustomerId } }),
    ).toThrow(PublicPayloadSafetyError)
  })
})
