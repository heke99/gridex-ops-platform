import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { onlineSignatureFailureCode } from '@/lib/customer-contracts/onlineSigning'

describe('safe actionable signing failures', () => {
  it('recognizes a database error object rather than losing it as object Object', () => {
    expect(onlineSignatureFailureCode({ code: 'P0001', message: 'starts_at is required when status is signed, active, or terminated' }))
      .toBe('delivery_start_date_required')
  })
  it.each(['signature_link_expired', 'signature_link_revoked', 'signature_exact_locked_chain_invalid'])('retains the known safe reason %s', (message) => {
    expect(onlineSignatureFailureCode({ code: '55000', message })).toBe(message)
  })
  it('never emits unknown raw database messages, details, credentials or client values', () => {
    expect(onlineSignatureFailureCode({ message: 'private contact data and token', details: 'private detail', code: 'P0001' })).toBe('signature_finalization_failed')
    expect(onlineSignatureFailureCode(new Error('private contact data'))).toBe('signature_finalization_failed')
    expect(onlineSignatureFailureCode(null)).toBe('signature_finalization_failed')
  })
})
