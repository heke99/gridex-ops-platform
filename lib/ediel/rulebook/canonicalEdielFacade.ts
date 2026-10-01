export {canonicalMessageCode,canonicalLogicalMessageCodeProjection} from '@/lib/ediel/core/messageIdentity'
export { EDIEL_ENERGY_SHARING_CAPABILITY } from '@/lib/ediel/rulebook/guideRegistry'
import {AUTHORITATIVE_EDIEL_GUIDES} from '@/lib/ediel/rulebook/guideRegistry'
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
  canonicalZ01BusinessResponseDeadlineMinutes,
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

export function canonicalZ01BusinessResponseDeadlineMinutesProjection(): number {
  return canonicalZ01BusinessResponseDeadlineMinutes()
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

import {AUTHORITATIVE_AI_LIST_PROFILE} from '@/lib/ediel/rulebook/guideRegistry'
/** Read-only source profile for the positional list codec and operational gate. */
export function canonicalAiListProfile(){return AUTHORITATIVE_AI_LIST_PROFILE}
/** Known original guide/registered-version scopes, derived from the same
 * frozen registry and canonical profiles. This is source-knowledge projection,
 * never current-date selection or evidence for an old message. */
export function canonicalRegisteredEdielGuideScopes(){
 return Object.freeze(AUTHORITATIVE_EDIEL_GUIDES.filter(guide=>['PRODAT','UTILTS','CONTRL'].includes(guide.family)).map(guide=>{
  const prodat=guide.family==='PRODAT'?PRODAT_CANONICAL_PROFILES.find(profile=>profile.associationAssignedCode===guide.associationAssignedCode):null
  const guideVersion=prodat?.guideVersion??guide.guideRevision
  const guideRevision=prodat?.guideRevision??(guide.family==='UTILTS'?/-(\d+)$/.exec(guide.guideRevision)?.[1]??null:null)
  return Object.freeze({family:guide.family,guideVersion,guideRevision,version:guideRevision?`${guideVersion}:r${guideRevision}`:guideVersion,
   canonicalGuideRevision:guide.guideRevision,associationAssignedCode:guide.associationAssignedCode,documentName:guide.documentName})
 }))
}

import {PRODAT_26A_FIELD_MATRIX} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
/** Physical field metadata only; no usage, dependency or revision decision. */
export function canonicalProdatFieldWireDescriptor(fieldNumber:string):Readonly<{fieldNumber:string;fieldKey:string;segmentPath:string}>|null {
 const row=PRODAT_26A_FIELD_MATRIX.find(item=>item.fieldNumber===fieldNumber)
 return row?Object.freeze({fieldNumber:row.fieldNumber,fieldKey:row.fieldKey,segmentPath:row.segmentPath}):null
}

/** Frozen P26.A field217 code table: Z04=15 minutes, Z02=Hour.
 * Z01 Profile and Z03 administrator choice do not establish exact resolution;
 * field222 reporting frequency is a distinct domain and is never consulted. */
export function canonicalProdatMeasurementResolution(value:string|null|undefined):'15'|'60'|null {
 return value==='Z04'?'15':value==='Z02'?'60':null
}
