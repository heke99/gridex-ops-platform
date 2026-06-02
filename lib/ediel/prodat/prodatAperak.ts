import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import { validateProdatBusinessRules } from '@/lib/ediel/prodat/prodatBusinessRules'

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

export function decideProdatAperakOutcome(rawPayload: string): {
  outcome: 'positive' | 'negative'
  applicationErrors: EdielAperakApplicationError[]
} {
  const applicationErrors = prodatIssuesToAperakErrors(rawPayload)
  return {
    outcome: applicationErrors.length > 0 ? 'negative' : 'positive',
    applicationErrors,
  }
}
