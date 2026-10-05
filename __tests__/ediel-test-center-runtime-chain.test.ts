import { describe, expect, it } from 'vitest'
import {
  assertTestCenterRuntimeMessage,
  normalizeTestCenterBillingMonth,
} from '@/lib/ediel/testing/testCenterRuntimePolicy'

const baseMessage = {
  id: 'msg-test-1',
  company_id: 'company-1',
  customer_id: 'customer-1',
  message_family: 'UTILTS',
  direction: 'inbound',
  environment: 'test',
} as const

describe('Test Center metering-to-invoice runtime guard', () => {
  it('allows only an explicitly linked inbound UTILTS test message', () => {
    expect(() =>
      assertTestCenterRuntimeMessage({
        message: baseMessage,
        companyId: 'company-1',
        customerId: 'customer-1',
      }),
    ).not.toThrow()
  })

  it('fails closed for production messages', () => {
    expect(() =>
      assertTestCenterRuntimeMessage({
        message: { ...baseMessage, environment: 'production' },
        companyId: 'company-1',
        customerId: 'customer-1',
      }),
    ).toThrow(/endast behandla Ediel-meddelanden i testmiljö/i)
  })

  it('fails closed for outbound messages', () => {
    expect(() =>
      assertTestCenterRuntimeMessage({
        message: { ...baseMessage, direction: 'outbound' },
        companyId: 'company-1',
        customerId: 'customer-1',
      }),
    ).toThrow(/inkommande Ediel-meddelande/i)
  })

  it('fails closed for non-UTILTS messages', () => {
    expect(() =>
      assertTestCenterRuntimeMessage({
        message: { ...baseMessage, message_family: 'PRODAT' },
        companyId: 'company-1',
        customerId: 'customer-1',
      }),
    ).toThrow(/endast UTILTS/i)
  })

  it('fails closed on tenant mismatch', () => {
    expect(() =>
      assertTestCenterRuntimeMessage({
        message: baseMessage,
        companyId: 'company-2',
        customerId: 'customer-1',
      }),
    ).toThrow(/inte valt bolag/i)
  })

  it('requires explicit selected-customer linkage before ingest', () => {
    expect(() =>
      assertTestCenterRuntimeMessage({
        message: { ...baseMessage, customer_id: null },
        companyId: 'company-1',
        customerId: 'customer-1',
      }),
    ).toThrow(/explicit kopplat till vald testkund/i)

    expect(() =>
      assertTestCenterRuntimeMessage({
        message: baseMessage,
        companyId: 'company-1',
        customerId: 'customer-2',
      }),
    ).toThrow(/explicit kopplat till vald testkund/i)
  })

  it('accepts only canonical YYYY-MM billing month', () => {
    expect(normalizeTestCenterBillingMonth('2026-08')).toBe('2026-08')
    expect(() => normalizeTestCenterBillingMonth('2026-8')).toThrow(/YYYY-MM/)
    expect(() => normalizeTestCenterBillingMonth('2026-13')).toThrow(/YYYY-MM/)
  })
})
