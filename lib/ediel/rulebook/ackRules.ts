import { getRulebookRule, processGroupForMessage, type EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

export type RulebookAckDecision = {
  requiresContrl: boolean
  requiresAperak: boolean
  requiresUtiltsErr: boolean
  negativeAperakOnError: boolean
  issues: EdielRulebookIssue[]
}

export function resolveRulebookAckDecision(input: {
  family: string | null | undefined
  code: string | null | undefined
  hasApplicationError?: boolean
  hasFunctionalError?: boolean
}): RulebookAckDecision {
  const rule = getRulebookRule(input.family, input.code)
  const processGroup = processGroupForMessage(input.family, input.code)
  const issues: EdielRulebookIssue[] = []

  if (!rule && processGroup !== 'unknown') {
    issues.push({
      severity: 'warning',
      code: 'RULEBOOK_ACK_RULE_MISSING',
      title: 'ACK-regel saknas',
      description: `Ingen explicit ACK-regel hittades för ${input.family ?? 'okänd'} ${input.code ?? ''}.`,
    })
  }

  const requiresUtiltsErr = Boolean(rule?.requiresUtiltsErr && input.hasFunctionalError)

  return {
    requiresContrl: rule?.requiresContrl ?? processGroup !== 'ediel_ack',
    requiresAperak: rule?.requiresAperak ?? false,
    requiresUtiltsErr,
    negativeAperakOnError: rule?.negativeAperakOnError ?? Boolean(input.hasApplicationError),
    issues,
  }
}
