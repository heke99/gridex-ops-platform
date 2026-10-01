import { assertProdatFreeTextSendBoundary } from '@/lib/ediel/prodat/prodatFreeText'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {assertMeterChangeSendBoundary} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import type {ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import type {ProdatDateEventValidationContext} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import type {DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import type {SourceQualifiedOutboundAck} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { type RulebookValidationResult, validateEdielMessageRowWithRulebook, validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { sourceQualifiedNegativeFixtureMatchesMessage, type SourceQualifiedNegativeFixture } from '@/lib/ediel/testing/negativeFixtureAuthority'

export function assertRulebookAllowsSend(message: EdielMessageRow,dateEventContext?:ProdatDateEventValidationContext,reportingContext?:ExpectedContext,negativeFixture?:SourceQualifiedNegativeFixture | null,deathStatusContext?:DeathStatusValidationContext,ackSourceQualification?:SourceQualifiedOutboundAck): RulebookValidationResult | null {
  if (message.direction !== 'outbound') return null
  assertProdatFreeTextSendBoundary(message)
  if(!gasApplicabilitySendIssue(message))assertMeterChangeSendBoundary(message)

  const validation = validateEdielMessageRowWithRulebook(message, 'send',dateEventContext,reportingContext,ackSourceQualification,deathStatusContext)
  return enforceQualifiedSendValidation(message, validation, negativeFixture)
}

/** Actual persisted sends consume the same canonical registry/original ports.
 * In particular ACKs cannot gain original authority from detached row JSON. */
export async function assertRegistryRulebookAllowsSend(message: EdielMessageRow, dateEventContext?: ProdatDateEventValidationContext,
  reportingContext?: ExpectedContext, negativeFixture?: SourceQualifiedNegativeFixture | null,deathStatusContext?:DeathStatusValidationContext,ackSourceQualification?:SourceQualifiedOutboundAck): Promise<RulebookValidationResult | null> {
  if (message.direction !== 'outbound') return null
  assertProdatFreeTextSendBoundary(message)
  if (!gasApplicabilitySendIssue(message)) assertMeterChangeSendBoundary(message)
  const validation = await validateRulebookMessageWithRegistry({family: message.message_family, code: message.message_code,
    processGroup: message.process_type, applicationReference: message.application_reference, rawPayload: message.raw_payload,
    parsedPayload: message.parsed_payload, mode: 'send', direction: message.direction, environment: message.environment,
    companyId: message.company_id, messageRow: message, dateEventRow: message, dateEventContext, reportingContext,deathStatusContext,ackSourceQualification})
  return enforceQualifiedSendValidation(message, validation, negativeFixture)
}

function enforceQualifiedSendValidation(message: EdielMessageRow, validation: RulebookValidationResult, negativeFixture?: SourceQualifiedNegativeFixture | null): RulebookValidationResult {
  const errors = validation.issues.filter((issue) => issue.severity === 'error' || issue.blocking)
  const registerErrors = errors.filter(issue => issue.scope === 'prodat_register')
  const dependentErrors = errors.filter(issue => issue.scope === 'prodat_dependent')
  // Report all protected findings together: a register failure must not hide
  // an independently verified subtype/product violation behind the same gate.
  if (registerErrors.length) throw new Error('PRODAT register blockerar skick: ' + [...registerErrors, ...dependentErrors].map(issue => issue.code + ': ' + issue.description).join(' | '))
  if (dependentErrors.length) throw new Error('PRODAT D-villkor blockerar skick: ' + dependentErrors.map(issue => issue.code + ': ' + issue.description).join(' | '))
  // Caller metadata never grants permission to send a failed national check.
  // Any intentional negative certification run requires its separate source owner.
  if (errors.length === 0) return validation
  // A failed local authority/configuration decision is not a deliberately bad
  // national fixture. Protected D/register facts were guarded above as well.
  if (validation.canonicalPolicy && !errors.some(issue=>issue.code.startsWith('CANONICAL_'))
    && sourceQualifiedNegativeFixtureMatchesMessage({message,diagnosticCodes:errors.map(issue=>issue.code),qualification:negativeFixture})) return validation

  throw new Error(
    `Rulebook blockerar skick: ${errors.map((issue) => `${issue.code}: ${issue.description}`).join(' | ')}`
  )
}
