// lib/ediel/rulebook/ackRules.ts

import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import {
  getRulebookMessageRule,
  type RulebookIssue,
} from '@/lib/ediel/rulebook/rulebook'

export type RulebookAckDecision = {
  requiresContrl: boolean
  requiresAperak: boolean
  contrlStatus: 'pending' | 'not_required'
  aperakStatus: 'pending' | 'not_required'
  utiltsErrStatus: 'pending' | 'not_required'
  negativeAperakAlwaysOnError: boolean
  ackDueMinutes: number | null
  issues: RulebookIssue[]
}

export function deriveRulebookAckDecision(params: {
  family: string
  code: string
  hasApplicationError?: boolean
  hasSyntaxError?: boolean
  utiltsFunctionalError?: boolean
}): RulebookAckDecision {
  const family = params.family.trim().toUpperCase()
  const rule = getRulebookMessageRule({ family, code: params.code })
  const issues: RulebookIssue[] = []

  if (!rule) {
    issues.push({
      severity: 'warning',
      code: 'rulebook_ack_rule_missing',
      title: 'ACK-regel saknas',
      description: `Ingen regel hittades för ${params.family}/${params.code}. Faller tillbaka till teknisk CONTRL.`,
    })
  }

  if (family === 'CONTRL') {
    return noAck(issues)
  }

  if (family === 'UTILTS_ERR') {
    return noAck(issues)
  }

  if (family === 'APERAK') {
    return {
      requiresContrl: true,
      requiresAperak: false,
      contrlStatus: 'pending',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'not_required',
      negativeAperakAlwaysOnError: false,
      ackDueMinutes: EDIEL_ACK_DEADLINE_MINUTES,
      issues,
    }
  }

  if (params.utiltsFunctionalError && family === 'UTILTS') {
    return {
      requiresContrl: true,
      requiresAperak: false,
      contrlStatus: 'pending',
      aperakStatus: 'not_required',
      utiltsErrStatus: 'pending',
      negativeAperakAlwaysOnError: false,
      ackDueMinutes: EDIEL_ACK_DEADLINE_MINUTES,
      issues,
    }
  }

  return {
    requiresContrl: rule?.requiresContrl ?? true,
    requiresAperak: rule?.requiresAperak ?? false,
    contrlStatus: (rule?.requiresContrl ?? true) ? 'pending' : 'not_required',
    aperakStatus: (rule?.requiresAperak ?? false) ? 'pending' : 'not_required',
    utiltsErrStatus: 'not_required',
    negativeAperakAlwaysOnError: rule?.supportsNegativeAperak ?? (family === 'PRODAT' || family === 'UTILTS'),
    ackDueMinutes: rule ? EDIEL_ACK_DEADLINE_MINUTES : null,
    issues,
  }
}

function noAck(issues: RulebookIssue[]): RulebookAckDecision {
  return {
    requiresContrl: false,
    requiresAperak: false,
    contrlStatus: 'not_required',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
    negativeAperakAlwaysOnError: false,
    ackDueMinutes: null,
    issues,
  }
}
