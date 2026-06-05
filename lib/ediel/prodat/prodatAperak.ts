import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import { decideProdatAperak as decideProdatAperakFromEngine } from '@/lib/ediel/decisionEngine'
import { validateProdatBusinessRules } from '@/lib/ediel/prodat/prodatBusinessRules'
import type { EdielMessageRow } from '@/lib/ediel/types'

export function prodatIssuesToAperakErrors(rawPayload: string): EdielAperakApplicationError[] {
  return validateProdatBusinessRules(rawPayload)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      ercCode: issue.code.includes('missing') ? '41' : '42',
      fieldCode: null,
      text: issue.message,
      referenceQualifier: 'ACW',
      referenceNumber: null,
      lineItemReference: null,
    }))
}

export function decideProdatAperak(params: {
  message?: EdielMessageRow | null
  rawPayload?: string | null
  testKind?: 'TGT' | 'AGT' | 'bilateral' | 'production' | 'unknown' | null
  testCaseCode?: string | null
  expectedOutcome?: 'positive' | 'negative' | null
}) {
  return decideProdatAperakFromEngine({
    message: params.message ?? null,
    rawPayload: params.rawPayload ?? params.message?.raw_payload ?? null,
    testKind: params.testKind ?? null,
    testCaseCode: params.testCaseCode ?? null,
    expectedOutcome: params.expectedOutcome ?? null,
  })
}

export function decideProdatAperakOutcome(rawPayload: string, context?: {
  message?: EdielMessageRow | null
  testKind?: 'TGT' | 'AGT' | 'bilateral' | 'production' | 'unknown' | null
  testCaseCode?: string | null
  expectedOutcome?: 'positive' | 'negative' | null
}): {
  outcome: 'positive' | 'negative'
  applicationErrors: EdielAperakApplicationError[]
} {
  const decision = decideProdatAperak({
    message: context?.message ?? null,
    rawPayload,
    testKind: context?.testKind ?? null,
    testCaseCode: context?.testCaseCode ?? null,
    expectedOutcome: context?.expectedOutcome ?? null,
  })

  if (decision.kind === 'ack' && decision.outcome === 'negative') {
    return {
      outcome: 'negative',
      applicationErrors: decision.applicationErrors,
    }
  }

  // The legacy function cannot return manual_review. Keep it safe by surfacing
  // uncertain production decisions as a negative APERAK with a clear object/process
  // error instead of silently returning positive.
  if (decision.kind === 'manual_review') {
    return {
      outcome: 'negative',
      applicationErrors: [
        {
          ercCode: '40',
          fieldCode: '105',
          text: decision.messageText ?? 'The object could not be identified',
          referenceQualifier: null,
          referenceNumber: null,
          lineItemReference: null,
        },
      ],
    }
  }

  return {
    outcome: 'positive',
    applicationErrors: [],
  }
}
