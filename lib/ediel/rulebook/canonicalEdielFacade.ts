import {
  canonicalAckRequirements,
  resolveCanonicalAckMatrixRule,
  type CanonicalAckMatrixRule,
} from '@/lib/ediel/ack/canonicalAckEngine'
import {
  resolveCanonicalEdielBusinessSemantics,
  type CanonicalEdielBusinessSemantics,
  type CanonicalEdielBusinessFamily,
} from '@/lib/ediel/rulebook/businessSemantics'
import {
  canonicalProdatSubtypeAlias,
  PRODAT_TRANSACTION_REASON_CODES,
  type ProdatBusinessContext,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

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

export function canonicalBusinessSemanticsProjection(input: {
  family: CanonicalEdielBusinessFamily
  code: string
  subtype?: string | null
}): CanonicalEdielBusinessSemantics | null {
  return resolveCanonicalEdielBusinessSemantics(input)
}

export type { CanonicalAckMatrixRule, ProdatBusinessContext }
