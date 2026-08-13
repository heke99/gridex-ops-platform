import { describe, expect, it } from 'vitest'
import { resolveUtiltsTransactionDispositions } from '@/lib/ediel/utiltsEngine'

describe('UTILTS transaction-level disposition', () => {
  it('keeps valid transactions accepted when sibling transactions fail at different layers', () => {
    const result = resolveUtiltsTransactionDispositions({
      syntaxOk: true,
      transactions: [
        { transactionId: 'TX-VALID-1' },
        { transactionId: 'TX-GUIDE' },
        { transactionId: 'TX-PROCESS' },
        { transactionId: 'TX-VALID-2' },
      ],
      issues: [
        {
          severity: 'error',
          kind: 'application',
          code: 'FIELD_REQUIRED',
          title: 'Required field missing',
          description: 'Field 245 is required.',
          referenceNumber: 'TX-GUIDE',
          lineItemReference: 'TX-GUIDE',
          aperakFieldCode: '245',
        },
        {
          severity: 'error',
          kind: 'functional',
          code: 'UNKNOWN_OBJECT',
          title: 'Unknown object',
          description: 'Metering point is not processable.',
          referenceNumber: 'TX-PROCESS',
          lineItemReference: 'TX-PROCESS',
          utiltsErrCode: 'E10',
        },
      ],
    })

    expect(result).toEqual([
      { transactionId: 'TX-VALID-1', disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [] },
      { transactionId: 'TX-GUIDE', disposition: 'guide_rejected', responseType: 'negative_aperak', issueCodes: ['FIELD_REQUIRED'] },
      { transactionId: 'TX-PROCESS', disposition: 'processability_rejected', responseType: 'utilts_err', issueCodes: ['UNKNOWN_OBJECT'] },
      { transactionId: 'TX-VALID-2', disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [] },
    ])
  })

  it('keeps an unreferenced syntax failure at message level', () => {
    const result = resolveUtiltsTransactionDispositions({
      syntaxOk: false,
      transactions: [{ transactionId: 'TX-1' }, { transactionId: 'TX-2' }],
      issues: [{
        severity: 'error',
        kind: 'syntax',
        code: 'UNT_COUNT_INVALID',
        title: 'UNT mismatch',
        description: 'Segment count is invalid.',
      }],
    })

    expect(result.map((row) => row.responseType)).toEqual(['negative_contrl', 'negative_contrl'])
  })
})
