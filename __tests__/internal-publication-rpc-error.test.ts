// simulation: 20261029-3f1a8ab1/claude-track2/014
import { describe, expect, it } from 'vitest'
import {
  INTERNAL_PUBLICATION_REPUBLISH_REQUIRED_MESSAGE,
  toInternalContractCreateError,
} from '@/lib/customer-contracts/internalPublicationRpcError'

describe('toInternalContractCreateError', () => {
  it('maps internal_publication_republish_required to a Swedish message', () => {
    const mapped = toInternalContractCreateError({ code: 'P0001', message: 'internal_publication_republish_required' })
    expect(mapped).toBeInstanceOf(Error)
    expect((mapped as Error).message).toBe(INTERNAL_PUBLICATION_REPUBLISH_REQUIRED_MESSAGE)
  })

  it('passes every other RPC error through unchanged', () => {
    const other = { code: 'P0002', message: 'internal_contract_offer_not_sellable' }
    expect(toInternalContractCreateError(other)).toBe(other)
    const sameCodeOtherMessage = { code: 'P0001', message: 'something_else' }
    expect(toInternalContractCreateError(sameCodeOtherMessage)).toBe(sameCodeOtherMessage)
  })
})
