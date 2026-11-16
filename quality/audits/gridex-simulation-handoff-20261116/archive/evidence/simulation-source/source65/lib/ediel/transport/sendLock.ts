import type {RequestedChangeBasis} from '@/lib/ediel/production/requestedChangeSource'
import { assertProdatFreeTextSendBoundary } from '@/lib/ediel/prodat/prodatFreeText'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {assertMeterChangeSendBoundary} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import type {ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import type {CustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import type {ProdatDateEventValidationContext} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {assertDeathStatusSendBoundary,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import type {SourceQualifiedOutboundAck} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import type {ProdatCommonHeaderRejectionEvidence} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder'
import { evaluateEdielProductionSendLock } from '@/lib/ediel/core/productionGuards'

export function assertEdielSendLock(message: EdielMessageRow,dateEventContext?:ProdatDateEventValidationContext,reportingContext?:ExpectedContext,ackSourceQualification?:SourceQualifiedOutboundAck,deathStatusContext?:DeathStatusValidationContext,prodatCommonHeaderRejectionEvidence?:ProdatCommonHeaderRejectionEvidence,customerMasterdataContext?:CustomerMasterdataValidationContext,requestedChangeBasis?:RequestedChangeBasis): void {
  assertProdatFreeTextSendBoundary(message)
  if(!gasApplicabilitySendIssue(message))assertMeterChangeSendBoundary(message)
  assertDeathStatusSendBoundary(message,deathStatusContext,requestedChangeBasis)
  const preflight = preflightEdielMessageRow(message, 'send',dateEventContext,reportingContext,ackSourceQualification,deathStatusContext,prodatCommonHeaderRejectionEvidence,customerMasterdataContext,requestedChangeBasis)

  const protocolErrors = preflight.issues.filter(issue => (issue.code.startsWith('PRODAT_REGISTER_') || issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_')) && issue.severity === 'error')
  if (protocolErrors.length) throw new Error(protocolErrors.map(issue => `${issue.code}: ${issue.description}`).join(' | '))
  const lock = evaluateEdielProductionSendLock(message, preflight)
  if (lock.status === 'blocked') {
    throw new Error(lock.issues.map((issue) => issue.message).join(' | ') || 'Ediel send lock blockerade utskick.')
  }
}
