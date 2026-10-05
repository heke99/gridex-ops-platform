import { validateProdatRegisterPayload } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { validateProdatDateFields } from '@/lib/ediel/prodat/prodatDateValidation'
import { prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactEnvelope, type EdifactValidationIssue } from '@/lib/ediel/core/edifactValidation'
import { parseEdifact } from '@/lib/ediel/core/edifactParser'
import { isSupportedProdatBusinessCode, requiredProdatSegmentsForCode } from '@/lib/ediel/prodat/prodatFieldRules'

export type ProdatValidationResult = {
  ok: boolean
  syntaxOk: boolean
  issues: EdifactValidationIssue[]
}

export function validateProdat(rawPayload: string, options?: {registerFacts?:ProdatDependentConditionFacts; requireRegisterConditions?:boolean}): ProdatValidationResult {
  const envelope = validateEdifactEnvelope(rawPayload)
  const parsed = parseEdifact(rawPayload)
  const issues: EdifactValidationIssue[] = [...envelope.issues]
  const code = parsed.businessCode
  if (parsed.unh?.messageType === 'PRODAT') {
    const wire = tokenizeEdifact(rawPayload)
    for (const failure of validateProdatRegisterPayload({code:code ?? '',rawSegments:wire.segments.map(s=>s.raw),una:wire.una,facts:options?.registerFacts,requireConditions:options?.requireRegisterConditions})) {
      issues.push({severity:'error',code:'prodat_register_invalid',message:failure.description})
    }
    for (const failure of validateProdatDateFields(code ?? '', wire.segments, wire.una)) {
      issues.push({ severity: 'error', code: 'prodat_date_structure_invalid',
        message: failure.description })
    }
    for (const failure of prodatPartySyntaxIssues(wire.segments, wire.una)) {
      issues.push({ severity: 'error', code: failure.kind === 'length' ? 'prodat_party_length_invalid' : 'prodat_party_structure_invalid',
        message: `PRODAT NAD fält ${failure.fieldNumber ?? 'part'} följer inte 26.A s.45–46,79–83.` })
    }
  }

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
