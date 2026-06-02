import { validateEdifactEnvelope, type EdifactValidationIssue } from '@/lib/ediel/core/edifactValidation'
import { parseEdifact } from '@/lib/ediel/core/edifactParser'
import { isSupportedProdatBusinessCode, requiredProdatSegmentsForCode } from '@/lib/ediel/prodat/prodatFieldRules'

export type ProdatValidationResult = {
  ok: boolean
  syntaxOk: boolean
  issues: EdifactValidationIssue[]
}

export function validateProdat(rawPayload: string): ProdatValidationResult {
  const envelope = validateEdifactEnvelope(rawPayload)
  const parsed = parseEdifact(rawPayload)
  const issues: EdifactValidationIssue[] = [...envelope.issues]
  const code = parsed.businessCode

  if (parsed.unh?.messageType !== 'PRODAT') {
    issues.push({ severity: 'error', code: 'not_prodat', message: 'UNH anger inte PRODAT.' })
  }

  if (!isSupportedProdatBusinessCode(code)) {
    issues.push({ severity: 'error', code: 'unsupported_prodat_code', message: `PRODAT-koden ${code ?? '(saknas)'} stöds inte.` })
  } else {
    const tags = new Set(parsed.segments.map((segment) => segment.tag))
    for (const tag of requiredProdatSegmentsForCode(code)) {
      if (!tags.has(tag)) {
        issues.push({ severity: 'error', code: `missing_${tag.toLowerCase()}`, message: `${tag} saknas för PRODAT ${code}.` })
      }
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    syntaxOk: envelope.syntaxOk,
    issues,
  }
}
