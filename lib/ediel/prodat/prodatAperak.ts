import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {deathStatusAperakErrors} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import type {DeathSelection} from './prodatDeathStatus'
import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import { decideProdatAperak as decideProdatAperakFromEngine } from '@/lib/ediel/decisionEngine'
import { validateProdatBusinessRules } from '@/lib/ediel/prodat/prodatBusinessRules'
import type { EdielMessageRow } from '@/lib/ediel/types'

export function prodatIssuesToAperakErrors(rawPayload: string, deathStatus?:DeathSelection): EdielAperakApplicationError[] {
  const wire=tokenizeEdifact(rawPayload),bgm=wire.segments.find(t=>t.tag==='BGM')
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
  return [...errors,...deathStatusAperakErrors({code:segmentComposite(bgm,1,wire.una)[0]??'',rawSegments:wire.segments.map(t=>t.raw),una:wire.una,facts:{deathStatus}})]
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
