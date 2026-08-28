import {
  canonicalAckRequirements,
  resolveCanonicalAckMatrixRule,
  type CanonicalAckMatrixRule,
} from '@/lib/ediel/ack/canonicalAckEngine'
import {
  listCanonicalEdielBusinessSemantics,
  resolveCanonicalEdielBusinessSemantics,
  type CanonicalEdielBusinessSemantics,
  type CanonicalEdielBusinessFamily,
} from '@/lib/ediel/rulebook/businessSemantics'
import {
  canonicalDeadlineCatalog,
  canonicalDeadlineRuleForMessage,
  canonicalSupplierSwitchSendPolicy,
  evaluateCanonicalEdielActionDeadline,
  type CanonicalDeadlineEvaluation,
  type CanonicalEdielDeadlineRule,
  type CanonicalSupplierSwitchSendPolicy,
} from '@/lib/ediel/rulebook/deadlinePolicy'
import {
  PRODAT_CANONICAL_PROFILES,
  getCanonicalProdatProfile,
  type ProdatCanonicalProfile,
} from '@/lib/ediel/rulebook/prodatRulebook'
import {
  canonicalProdatSubtypeAlias,
  PRODAT_TRANSACTION_REASON_CODES,
  type ProdatBusinessContext,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {
  assertSupplierUtiltsOutboundAllowed,
  normalizeUtiltsResolutionClass,
  resolveCanonicalUtiltsApplicationReference,
  type UtiltsRequestedMessageCode,
  type UtiltsResolutionClass,
} from '@/lib/ediel/rulebook/utiltsMarketEngine'
import {
  resolveVerifiedUtiltsApplicationReference,
} from '@/lib/ediel/rulebook/utiltsApplicationReference'
import {
  getCanonicalUtiltsProfile,
  type UtiltsCanonicalProfile,
} from '@/lib/ediel/rulebook/utiltsRulebook'

/**
 * Narrow projection facade for operational code that needs a static canonical
 * lookup but does not have enough message context to resolve a full
 * CanonicalEdielPolicy yet. Normative tables stay private to the rulebook/ack
 * implementation layers; callers receive only derived immutable values.
 */
export function canonicalAckRuleForFamilyCode(input: {
  family: string
  code: string | null | undefined
}): CanonicalAckMatrixRule {
  return resolveCanonicalAckMatrixRule(input)
}

export function canonicalAckRequirementsForFamilyCode(input: {
  family: string
  code: string | null | undefined
}) {
  return canonicalAckRequirements(input)
}

export function canonicalProdatSubtypeForMessage(
  messageCode: string,
  value: string | null | undefined,
): string | null {
  return canonicalProdatSubtypeAlias(value, messageCode)
}

export function canonicalProdatTransactionReasonCodes(): readonly string[] {
  return PRODAT_TRANSACTION_REASON_CODES
}

export function canonicalProdatProfileForMessage(
  messageCode: string | null | undefined,
): ProdatCanonicalProfile | null {
  return getCanonicalProdatProfile(messageCode)
}

export function canonicalProdatProfiles(): readonly ProdatCanonicalProfile[] {
  return PRODAT_CANONICAL_PROFILES
}

export function canonicalProdatApplicationReferenceForProcess(
  businessProcess: string | null | undefined,
): string | null {
  const process = String(businessProcess ?? '').trim().toLowerCase()
  const references = [...new Set(
    PRODAT_CANONICAL_PROFILES
      .filter((profile) => profile.processGroup === process)
      .map((profile) => profile.applicationReference),
  )]
  return references.length === 1 ? references[0] : null
}

export function canonicalVerifiedUtiltsApplicationReference(input: {
  messageCode: string
  requestedMessageCode?: string | null
  applicationReference?: string | null
}): string {
  return resolveVerifiedUtiltsApplicationReference(input)
}

export function canonicalUtiltsProfileForMessage(
  messageCode: string | null | undefined,
): UtiltsCanonicalProfile | null {
  return getCanonicalUtiltsProfile(messageCode)
}

export function assertCanonicalSupplierUtiltsOutboundAllowed(input: {
  code: string
  bilateralCapabilityVerified?: boolean
  requestedMessageCode?: string | null
}): { requestedMessageCode: UtiltsRequestedMessageCode | null } {
  return assertSupplierUtiltsOutboundAllowed(input)
}

export function canonicalUtiltsResolutionClass(value: unknown): UtiltsResolutionClass {
  return normalizeUtiltsResolutionClass(value)
}

export function canonicalSupplierUtiltsApplicationReference(input: {
  code: string
  actorRole?: string | null
  requestedMessageCode?: string | null
  resolution?: unknown
  applicationReference?: string | null
}): string {
  return resolveCanonicalUtiltsApplicationReference(input)
}

export function canonicalBusinessSemanticsProjection(input: {
  family: CanonicalEdielBusinessFamily | string
  code: string
  subtype?: string | null
}): CanonicalEdielBusinessSemantics | null {
  return resolveCanonicalEdielBusinessSemantics(input)
}

export function canonicalBusinessSemanticsCatalog(): readonly CanonicalEdielBusinessSemantics[] {
  return listCanonicalEdielBusinessSemantics()
}

export function canonicalDeadlineForMessage(input: {
  family: string
  code: string
  subtype?: string | null
}): CanonicalEdielDeadlineRule | null {
  return canonicalDeadlineRuleForMessage(input)
}

export function canonicalDeadlineCatalogProjection(): readonly CanonicalEdielDeadlineRule[] {
  return canonicalDeadlineCatalog()
}

export function canonicalSupplierSwitchSendPolicyProjection(input: {
  subtype?: 'L' | 'LK' | 'C' | null
  cancellationOfSubtype?: 'L' | 'LK' | null
} = {}): CanonicalSupplierSwitchSendPolicy {
  return canonicalSupplierSwitchSendPolicy(input)
}

export function canonicalDeadlineForAction(input: {
  actionType: string
  requestedDate?: string | null
  historicalStartDate?: string | null
  historicalEndDate?: string | null
  networkContractStartDate?: string | null
  now?: Date
}): CanonicalDeadlineEvaluation {
  return evaluateCanonicalEdielActionDeadline(input)
}

export type {
  CanonicalAckMatrixRule,
  CanonicalDeadlineEvaluation,
  CanonicalEdielBusinessFamily,
  CanonicalEdielBusinessSemantics,
  CanonicalEdielDeadlineRule,
  CanonicalSupplierSwitchSendPolicy,
  ProdatBusinessContext,
  ProdatCanonicalProfile,
  UtiltsCanonicalProfile,
  UtiltsRequestedMessageCode,
  UtiltsResolutionClass,
}
