import type { EdifactValidationIssue } from '@/lib/ediel/core/edifactValidation'
import { parseProdat } from '@/lib/ediel/prodat/parseProdat'

export function validateProdatBusinessRules(rawPayload: string): EdifactValidationIssue[] {
  const parsed = parseProdat(rawPayload)
  const issues: EdifactValidationIssue[] = []

  if (parsed.lineItems.length === 0) {
    issues.push({ severity: 'error', code: 'prodat_missing_line_item', message: 'PRODAT saknar LIN/objektrad.' })
  }

  for (const item of parsed.lineItems) {
    if (!item.meteringPointId) {
      issues.push({ severity: 'error', code: 'prodat_missing_metering_point', message: 'LIN-rad saknar anläggnings-id/mätpunkt.' })
    }
    if ((parsed.messageCode === 'Z13' || parsed.messageCode === 'Z18') && !item.agreementReference) {
      issues.push({ severity: 'error', code: 'prodat_missing_agreement_reference', message: 'Mätvärdesåtkomst kräver avtalsreferens.' })
    }
  }

  return issues
}
