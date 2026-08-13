import { describe, expect, it } from 'vitest'
import {
  decideUtiltsRuntimeAckPlan,
  resolveUtiltsTransactionDispositions,
  type UtiltsRuntimeFacts,
  type UtiltsRuntimeValidation,
} from '@/lib/ediel/utiltsEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'

describe('UTILTS transaction-level disposition', () => {
  it('proves the canonical 95 accepted / 3 guide / 2 processability partial-success split', () => {
    const accepted = Array.from({ length: 95 }, (_, index) => ({ transactionId: `TX-OK-${index + 1}` }))
    const guideRejected = Array.from({ length: 3 }, (_, index) => ({ transactionId: `TX-GUIDE-${index + 1}` }))
    const processabilityRejected = Array.from({ length: 2 }, (_, index) => ({ transactionId: `TX-PROCESS-${index + 1}` }))
    const transactions = [...accepted, ...guideRejected, ...processabilityRejected]

    const result = resolveUtiltsTransactionDispositions({
      syntaxOk: true,
      transactions,
      issues: [
        ...guideRejected.map(({ transactionId }) => ({
          severity: 'error' as const,
          kind: 'application' as const,
          code: 'FIELD_REQUIRED',
          title: 'Required field missing',
          description: 'A required guide field is missing.',
          referenceNumber: transactionId,
          lineItemReference: transactionId,
          aperakFieldCode: '245',
        })),
        ...processabilityRejected.map(({ transactionId }) => ({
          severity: 'error' as const,
          kind: 'functional' as const,
          code: 'UNKNOWN_OBJECT',
          title: 'Unknown object',
          description: 'The transaction object cannot be processed.',
          referenceNumber: transactionId,
          lineItemReference: transactionId,
          utiltsErrCode: 'E10',
        })),
      ],
    })

    expect(result).toHaveLength(100)
    expect(result.filter((row) => row.disposition === 'accepted')).toHaveLength(95)
    expect(result.filter((row) => row.disposition === 'guide_rejected')).toHaveLength(3)
    expect(result.filter((row) => row.disposition === 'processability_rejected')).toHaveLength(2)
    expect(result.filter((row) => row.responseType === 'positive_aperak')).toHaveLength(95)
    expect(result.filter((row) => row.responseType === 'negative_aperak')).toHaveLength(3)
    expect(result.filter((row) => row.responseType === 'utilts_err')).toHaveLength(2)
  })

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

  it('keeps guide APERAK error details when the message also has processability faults', () => {
    // Message-level classification prefers functional_rejected whenever any
    // functional issue exists. Transaction-scoped ACK creation still needs the
    // guide/application error payload for sibling guide_rejected transactions.
    const validation: UtiltsRuntimeValidation = {
      ok: false,
      syntaxOk: true,
      functionalOk: false,
      classification: 'functional_rejected',
      issues: [
        {
          severity: 'error',
          kind: 'application',
          code: 'FIELD_REQUIRED',
          title: 'Required field missing',
          description: 'Field 245 is required.',
          aperakErcCode: '41',
          aperakFieldCode: '245',
          aperakText: 'MANDATORY FIELD MISSING',
          referenceQualifier: 'ACW',
          referenceNumber: 'TX-GUIDE',
          lineItemReference: 'TX-GUIDE',
        },
        {
          severity: 'error',
          kind: 'functional',
          code: 'UNKNOWN_OBJECT',
          title: 'Unknown object',
          description: 'Metering point is not processable.',
          utiltsErrCode: 'E10',
          referenceQualifier: 'TN',
          referenceNumber: 'TX-PROCESS',
          lineItemReference: 'TX-PROCESS',
        },
      ],
    }

    const plan = decideUtiltsRuntimeAckPlan({
      message: { message_family: 'UTILTS', environment: 'production' } as EdielMessageRow,
      facts: { isUtiltsErr: false, messageCode: 'E66' } as UtiltsRuntimeFacts,
      validation,
    })

    expect(plan.shouldSendUtiltsErr).toBe(true)
    expect(plan.utiltsErrDetails).toEqual([
      expect.objectContaining({ code: 'E10', referenceNumber: 'TX-PROCESS' }),
    ])
    expect(plan.aperakApplicationErrors).toEqual([
      expect.objectContaining({
        ercCode: '41',
        fieldCode: '245',
        lineItemReference: 'TX-GUIDE',
      }),
    ])
  })

  it('attributes synthesized transaction-N profile refs when IDE+24 is absent', () => {
    // Profiles emit referenceNumber=transaction-1 for missing IDE+24. Disposition
    // matching must use the same identity so guide rejection is not orphaned into
    // an incorrect accepted/positive-APERAK outcome.
    const result = resolveUtiltsTransactionDispositions({
      syntaxOk: true,
      transactions: [{ transactionId: null }],
      issues: [
        {
          severity: 'error',
          kind: 'application',
          code: 'UTILTS_TRANSACTION_ID_MISSING',
          title: 'Transaktions-id saknas',
          description: 'E31 kräver IDE+24 eller TN-referens per transaktion.',
          referenceNumber: 'transaction-1',
          lineItemReference: 'transaction-1',
          aperakErcCode: '41',
          aperakFieldCode: '512',
        },
      ],
    })

    expect(result).toEqual([
      {
        transactionId: 'transaction-1',
        disposition: 'guide_rejected',
        responseType: 'negative_aperak',
        issueCodes: ['UTILTS_TRANSACTION_ID_MISSING'],
      },
    ])
  })
})
