import { assertProdatFreeTextSendBoundary } from '@/lib/ediel/prodat/prodatFreeText'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {assertMeterChangeSendBoundary} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import type {ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import type {TgtDateEventValidationContext} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder'
import { evaluateEdielProductionSendLock } from '@/lib/ediel/core/productionGuards'

export function assertEdielSendLock(message: EdielMessageRow,dateEventContext?:TgtDateEventValidationContext,reportingContext?:ExpectedContext): void {
  assertProdatFreeTextSendBoundary(message)
  if(!gasApplicabilitySendIssue(message))assertMeterChangeSendBoundary(message)
  const preflight = preflightEdielMessageRow(message, 'send',dateEventContext,reportingContext)
  const protocolErrors = preflight.issues.filter(issue => (issue.code.startsWith('PRODAT_REGISTER_') || issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_')) && issue.severity === 'error')
  if (protocolErrors.length) throw new Error(protocolErrors.map(issue => `${issue.code}: ${issue.description}`).join(' | '))
  const lock = evaluateEdielProductionSendLock(message, preflight)
  if (lock.status === 'blocked') {
    throw new Error(lock.issues.map((issue) => issue.message).join(' | ') || 'Ediel send lock blockerade utskick.')
  }
}
