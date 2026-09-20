import { assertProdatFreeTextSendBoundary } from '@/lib/ediel/prodat/prodatFreeText'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {assertMeterChangeSendBoundary} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import type {ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import type {TgtDateEventValidationContext} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function assertRulebookAllowsSend(message: EdielMessageRow,dateEventContext?:TgtDateEventValidationContext,reportingContext?:ExpectedContext): void {
  if (message.direction !== 'outbound') return
  assertProdatFreeTextSendBoundary(message)
  if(!gasApplicabilitySendIssue(message))assertMeterChangeSendBoundary(message)
  const parsedPayload = objectValue(message.parsed_payload) ?? {}

  const validation = validateEdielMessageRowWithRulebook(message, 'send',dateEventContext,reportingContext)
  const errors = validation.issues.filter((issue) => issue.severity === 'error' || issue.blocking)
  const registerErrors = errors.filter(issue => issue.scope === 'prodat_register')
  const dependentErrors = errors.filter(issue => issue.scope === 'prodat_dependent')
  // Report all protected findings together: a register failure must not hide
  // an independently verified subtype/product violation behind the same gate.
  if (registerErrors.length) throw new Error('PRODAT register blockerar skick: ' + [...registerErrors, ...dependentErrors].map(issue => issue.code + ': ' + issue.description).join(' | '))
  if (dependentErrors.length) throw new Error('PRODAT D-villkor blockerar skick: ' + dependentErrors.map(issue => issue.code + ': ' + issue.description).join(' | '))
  if (parsedPayload.rulebookAllowInvalidSend === true) return
  if (errors.length === 0) return

  throw new Error(
    `Rulebook blockerar skick: ${errors.map((issue) => `${issue.code}: ${issue.description}`).join(' | ')}`
  )
}
