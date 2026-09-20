import {selectedProdatAckFromPayload,assertSelectedProdatAckReady} from './prodatIncomingSelectedAck'
import type {DeathSelection} from './prodatDeathStatus'
import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import { decideProdatAperak as decideProdatAperakFromEngine } from '@/lib/ediel/decisionEngine'
import { validateProdatBusinessRules } from '@/lib/ediel/prodat/prodatBusinessRules'
import type { EdielMessageRow } from '@/lib/ediel/types'

export function prodatIssuesToAperakErrors(rawPayload: string, deathStatus?:DeathSelection): EdielAperakApplicationError[] {
  const selected=selectedProdatAckFromPayload(rawPayload,{deathStatus})
  assertSelectedProdatAckReady(selected)
  const errors=validateProdatBusinessRules(rawPayload)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      ercCode: issue.code.includes('missing') ? '41' : '42',
      fieldCode: null,
      text: issue.message,
      referenceQualifier: 'ACW',
      referenceNumber: null,
      lineItemReference: null,
    }))
  return [...errors,...selected.applicationErrors]
}

export function decideProdatAperak(params: {
  deathStatus?:DeathSelection
  message?: EdielMessageRow | null
  rawPayload?: string | null
  testKind?: 'TGT' | 'AGT' | 'bilateral' | 'production' | 'unknown' | null
  testCaseCode?: string | null
  expectedOutcome?: 'positive' | 'negative' | null
}) {
  return decideProdatAperakFromEngine({
    deathStatus:params.deathStatus,
    message: params.message ?? null,
    rawPayload: params.rawPayload ?? params.message?.raw_payload ?? null,
    testKind: params.testKind ?? null,
    testCaseCode: params.testCaseCode ?? null,
    expectedOutcome: params.expectedOutcome ?? null,
  })
}

export function decideProdatAperakOutcome(rawPayload: string, context?: {
  deathStatus?:DeathSelection
  message?: EdielMessageRow | null
  testKind?: 'TGT' | 'AGT' | 'bilateral' | 'production' | 'unknown' | null
  testCaseCode?: string | null
  expectedOutcome?: 'positive' | 'negative' | null
}): {
  outcome: 'positive' | 'negative'
  applicationErrors: EdielAperakApplicationError[]
} {
  const decision = decideProdatAperak({
    deathStatus:context?.deathStatus,
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
    if(decision.reason.includes('selectedFields')&&decision.reason.includes('internal_review'))throw Object.assign(new Error('PRODAT_SELECTED_ACK_REVIEW_REQUIRED'),{decision})
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
