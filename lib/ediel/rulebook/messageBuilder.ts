import { processGroupForMessage, type EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'

export type RulebookMessageBuildDecision = {
  family: string
  code: string
  processGroup: string
  applicationReference: string | null
  issues: EdielRulebookIssue[]
}

export function buildRulebookMessageDecision(input: {
  family: string
  code: string
  processGroup?: string | null
  applicationReference?: string | null
  rawPayload?: string | null
}): RulebookMessageBuildDecision {
  const processGroup = input.processGroup ?? processGroupForMessage(input.family, input.code)
  const canonicalProdat = String(input.family).trim().toUpperCase() === 'PRODAT'
    ? getCanonicalProdatProfile(input.code)
    : null
  const applicationReference = input.applicationReference ?? canonicalProdat?.applicationReference ?? null
  const validation = validateRulebookMessage({
    family: input.family,
    code: input.code,
    processGroup,
    applicationReference,
    rawPayload: input.rawPayload,
    mode: 'test',
  })
  return {
    family: input.family,
    code: input.code,
    processGroup,
    applicationReference,
    issues: validation.issues,
  }
}
