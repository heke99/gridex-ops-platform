import { resolveCanonicalAckMatrixRule, type CanonicalAckMatrixRule } from '@/lib/ediel/ack/canonicalAckEngine'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {
  resolveEdielGuideAcceptance,
  type AuthoritativeEdielGuide,
  type EdielGuideFamily,
} from '@/lib/ediel/rulebook/guideRegistry'
import {
  resolveCanonicalEdielBusinessSemantics,
  type CanonicalEdielBusinessSemantics,
  type CanonicalEdielBusinessFamily,
} from '@/lib/ediel/rulebook/businessSemantics'
import { canonicalProdatApplicationReferenceForProcessGroup } from '@/lib/ediel/rulebook/prodatApplicationReference'
import { getCanonicalProdatProfile } from '@/lib/ediel/rulebook/prodatRulebook'
import {
  resolveProdatBusinessContext,
  resolveProdatSubtype,
  type ProdatBusinessContext,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {
  assertSupplierUtiltsOutboundAllowed,
  getSupplierUtiltsSupport,
} from '@/lib/ediel/rulebook/utiltsMarketEngine'
import { resolveVerifiedUtiltsApplicationReference } from '@/lib/ediel/rulebook/utiltsApplicationReference'
import { getUtiltsFieldRules, type UtiltsFieldRule } from '@/lib/ediel/rulebook/utiltsFieldMatrix'
import { resolveCanonicalUtiltsProfile, type UtiltsCanonicalProfile } from '@/lib/ediel/rulebook/utiltsRulebook'
import {
  assertUtiltsMessageUseAllowed,
  resolveUtiltsProcessabilityPolicy,
  type UtiltsProcessabilityPolicy,
} from '@/lib/ediel/rulebook/utilts25A4'
import type { RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'

export type CanonicalEdielPolicyDirection = 'inbound' | 'outbound'
export type CanonicalEdielPolicyMode = 'send' | 'parse' | 'historical_replay'

export type CanonicalEdielSourceTrace = {
  authority: 'guide' | 'business_semantics' | 'field_matrix' | 'application_reference' | 'acknowledgement' | 'processability'
  document: string
  section: string
}

export type CanonicalEdielPolicy = {
  family: CanonicalEdielBusinessFamily
  code: string
  subtype: string | null
  transactionReasonCode: string | null
  direction: CanonicalEdielPolicyDirection
  referenceDate: string
  semantics: CanonicalEdielBusinessSemantics
  guide: AuthoritativeEdielGuide
  acceptedInboundGuides: readonly AuthoritativeEdielGuide[]
  acceptedOutboundGuides: readonly AuthoritativeEdielGuide[]
  previousGuideGraceActive: boolean
  associationAssignedCode: string | null
  applicationReference: string | null
  fieldRules: readonly (RulebookFieldRule | UtiltsFieldRule)[]
  ackRule: CanonicalAckMatrixRule
  utiltsProfile: UtiltsCanonicalProfile | null
  utiltsProcessability: UtiltsProcessabilityPolicy | null
  supplierUtiltsSupport: ReturnType<typeof getSupplierUtiltsSupport> | null
  bilateralRequired: boolean
  customerStatusRequired: boolean
  businessResponses: readonly string[]
  sourceTrace: readonly CanonicalEdielSourceTrace[]
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeDate(value: string): string {
  const date = String(value ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('canonical_ediel_reference_date_required')
  return date
}

function normalizeFamily(value: string): CanonicalEdielBusinessFamily {
  const family = normalize(value)
  if (!['PRODAT', 'UTILTS', 'UTILTS_ERR', 'APERAK', 'CONTRL'].includes(family)) {
    throw new Error(`canonical_ediel_family_unsupported:${family || 'missing'}`)
  }
  return family as CanonicalEdielBusinessFamily
}

function guideFamily(family: CanonicalEdielBusinessFamily): EdielGuideFamily {
  if (family === 'UTILTS_ERR') return 'UTILTS'
  return family as EdielGuideFamily
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object') deepFreeze(nested)
  }
  return value
}

function assertAssociationAccepted(input: {
  provided?: string | null
  guides: readonly AuthoritativeEdielGuide[]
  family: CanonicalEdielBusinessFamily
}): string | null {
  const provided = normalize(input.provided)
  const canonical = input.guides[0]?.associationAssignedCode ?? null
  if (!provided) return canonical

  const accepted = input.guides.some((guide) => normalize(guide.associationAssignedCode) === provided)
  if (!accepted) throw new Error(`canonical_ediel_association_not_allowed:${input.family}:${provided}`)
  return provided
}

function policyMode(input: {
  direction: CanonicalEdielPolicyDirection
  mode?: CanonicalEdielPolicyMode
}): CanonicalEdielPolicyMode {
  if (input.mode) return input.mode
  return input.direction === 'outbound' ? 'send' : 'parse'
}

/**
 * Mandatory source-controlled policy gateway for Swedish Ediel/EDIFACT.
 *
 * This resolver composes the independent canonical authorities; it does not
 * duplicate their rule tables. Runtime consumers should resolve one policy
 * snapshot and use it throughout parse/validate/render/ACK/state processing.
 * No mutable database row may override the returned protocol/business meaning.
 */
export function resolveCanonicalEdielPolicy(input: {
  family: string
  messageCode: string
  subtypeOrReasonCode?: string | null
  direction: CanonicalEdielPolicyDirection
  referenceDate: string
  associationAssignedCode?: string | null
  applicationReference?: string | null
  requestedMessageCode?: string | null
  businessContext?: ProdatBusinessContext | null
  bilateralCapabilityVerified?: boolean
  mode?: CanonicalEdielPolicyMode
}): CanonicalEdielPolicy {
  const family = normalizeFamily(input.family)
  const code = family === 'UTILTS_ERR' ? 'ERR' : normalize(input.messageCode)
  const referenceDate = normalizeDate(input.referenceDate)
  const mode = policyMode(input)
  if (!code) throw new Error(`canonical_ediel_message_code_required:${family}`)

  const acceptance = resolveEdielGuideAcceptance({
    family: guideFamily(family),
    referenceDate,
    associationAssignedCode: input.associationAssignedCode ?? null,
  })
  const directionGuides = input.direction === 'inbound'
    ? acceptance.acceptedInbound
    : acceptance.acceptedOutbound
  const associationAssignedCode = assertAssociationAccepted({
    provided: input.associationAssignedCode,
    guides: directionGuides,
    family,
  })
  const ackRule = resolveCanonicalAckMatrixRule({ family, code })

  if (family === 'PRODAT') {
    const profile = getCanonicalProdatProfile(code)
    if (!profile) throw new Error(`canonical_ediel_prodat_code_unsupported:${code}`)

    const subtype = resolveProdatSubtype({
      messageCode: code,
      subtypeOrReasonCode: input.subtypeOrReasonCode,
      bilateralCapabilityVerified: input.bilateralCapabilityVerified,
    })
    if (!subtype.ok || !subtype.subtype || !subtype.transactionReasonCode) {
      throw new Error(subtype.reason ?? `canonical_ediel_prodat_subtype_invalid:${code}`)
    }

    const contextual = resolveProdatBusinessContext({
      messageCode: code,
      subtypeOrReasonCode: subtype.subtype,
      businessContext: input.businessContext,
      bilateralCapabilityVerified: input.bilateralCapabilityVerified,
    })
    if (!contextual.ok) throw new Error(contextual.reason ?? `canonical_ediel_prodat_context_invalid:${code}:${subtype.subtype}`)

    const semantics = resolveCanonicalEdielBusinessSemantics({ family, code, subtype: subtype.subtype })
    if (!semantics) throw new Error(`canonical_ediel_business_semantics_missing:${family}:${code}:${subtype.subtype}`)

    const expectedApplicationReference = canonicalProdatApplicationReferenceForProcessGroup(profile.processGroup)
    const providedApplicationReference = normalize(input.applicationReference)
    if (providedApplicationReference && providedApplicationReference !== expectedApplicationReference) {
      throw new Error(`canonical_ediel_application_reference_not_allowed:${code}:${providedApplicationReference}`)
    }
    if (input.direction === 'inbound' && !providedApplicationReference) {
      throw new Error(`canonical_ediel_application_reference_required:${family}:${code}`)
    }

    return deepFreeze({
      family,
      code,
      subtype: subtype.subtype,
      transactionReasonCode: subtype.transactionReasonCode,
      direction: input.direction,
      referenceDate,
      semantics,
      guide: acceptance.current,
      acceptedInboundGuides: acceptance.acceptedInbound,
      acceptedOutboundGuides: acceptance.acceptedOutbound,
      previousGuideGraceActive: acceptance.previousGuideGraceActive,
      associationAssignedCode,
      applicationReference: providedApplicationReference || expectedApplicationReference,
      fieldRules: canonicalProdat26AFieldRules(code),
      ackRule,
      utiltsProfile: null,
      utiltsProcessability: null,
      supplierUtiltsSupport: null,
      bilateralRequired: contextual.bilateralRequired,
      customerStatusRequired: contextual.customerStatusRequired,
      businessResponses: semantics.expectedBusinessResponses,
      sourceTrace: [
        { authority: 'guide', document: acceptance.current.documentName, section: 'effective-dated guide registry' },
        { authority: 'business_semantics', document: semantics.source.document, section: semantics.source.pageOrSection },
        { authority: 'field_matrix', document: acceptance.current.documentName, section: 'PRODAT 26.A field matrix' },
        { authority: 'application_reference', document: acceptance.current.documentName, section: 'PRODAT Application Reference' },
        { authority: 'acknowledgement', document: acceptance.current.documentName, section: 'PRODAT/APERAK acknowledgement rules' },
      ],
    } satisfies CanonicalEdielPolicy)
  }

  if (family === 'UTILTS' || family === 'UTILTS_ERR') {
    const version = associationAssignedCode ?? acceptance.current.associationAssignedCode
    if (!version) throw new Error(`canonical_ediel_association_required:${family}:${code}`)

    const utiltsProfile = resolveCanonicalUtiltsProfile({
      messageCode: code,
      businessDate: referenceDate,
      version,
    })
    assertUtiltsMessageUseAllowed({
      referenceDate,
      messageCode: code,
      mode: mode === 'historical_replay' ? 'historical_replay' : input.direction === 'outbound' ? 'outbound' : 'live_inbound',
    })

    const semantics = resolveCanonicalEdielBusinessSemantics({ family, code })
    if (!semantics) throw new Error(`canonical_ediel_business_semantics_missing:${family}:${code}`)

    const supplierUtiltsSupport = getSupplierUtiltsSupport(code)
    if (input.direction === 'outbound' && family === 'UTILTS') {
      assertSupplierUtiltsOutboundAllowed({
        code,
        bilateralCapabilityVerified: input.bilateralCapabilityVerified,
        requestedMessageCode: input.requestedMessageCode,
      })
    }

    const providedApplicationReference = normalize(input.applicationReference)
    let applicationReference: string | null = providedApplicationReference || null
    if (family === 'UTILTS') {
      if (input.direction === 'inbound' && !providedApplicationReference) {
        throw new Error(`canonical_ediel_application_reference_required:${family}:${code}`)
      }
      applicationReference = resolveVerifiedUtiltsApplicationReference({
        messageCode: code,
        requestedMessageCode: input.requestedMessageCode,
        applicationReference: providedApplicationReference || undefined,
      })
    }

    const processability = resolveUtiltsProcessabilityPolicy(referenceDate)
    return deepFreeze({
      family,
      code,
      subtype: null,
      transactionReasonCode: null,
      direction: input.direction,
      referenceDate,
      semantics,
      guide: acceptance.current,
      acceptedInboundGuides: acceptance.acceptedInbound,
      acceptedOutboundGuides: acceptance.acceptedOutbound,
      previousGuideGraceActive: acceptance.previousGuideGraceActive,
      associationAssignedCode,
      applicationReference,
      fieldRules: family === 'UTILTS' ? getUtiltsFieldRules(code) : [],
      ackRule,
      utiltsProfile,
      utiltsProcessability: processability,
      supplierUtiltsSupport,
      bilateralRequired: utiltsProfile.bilateralCapabilityRequired,
      customerStatusRequired: false,
      businessResponses: semantics.expectedBusinessResponses,
      sourceTrace: [
        { authority: 'guide', document: acceptance.current.documentName, section: 'effective-dated guide registry' },
        { authority: 'business_semantics', document: semantics.source.document, section: semantics.source.pageOrSection },
        { authority: 'field_matrix', document: acceptance.current.documentName, section: family === 'UTILTS' ? 'UTILTS field matrix' : 'UTILTS_ERR structure' },
        { authority: 'application_reference', document: acceptance.current.documentName, section: family === 'UTILTS' ? 'UTILTS field 311' : 'not applicable' },
        { authority: 'acknowledgement', document: acceptance.current.documentName, section: 'UTILTS/APERAK/UTILTS_ERR acknowledgement rules' },
        { authority: 'processability', document: acceptance.current.documentName, section: 'UTILTS processability validation' },
      ],
    } satisfies CanonicalEdielPolicy)
  }

  const semantics = resolveCanonicalEdielBusinessSemantics({ family, code })
  if (!semantics) throw new Error(`canonical_ediel_business_semantics_missing:${family}:${code}`)

  return deepFreeze({
    family,
    code,
    subtype: null,
    transactionReasonCode: null,
    direction: input.direction,
    referenceDate,
    semantics,
    guide: acceptance.current,
    acceptedInboundGuides: acceptance.acceptedInbound,
    acceptedOutboundGuides: acceptance.acceptedOutbound,
    previousGuideGraceActive: acceptance.previousGuideGraceActive,
    associationAssignedCode,
    applicationReference: normalize(input.applicationReference) || null,
    fieldRules: [],
    ackRule,
    utiltsProfile: null,
    utiltsProcessability: null,
    supplierUtiltsSupport: null,
    bilateralRequired: false,
    customerStatusRequired: false,
    businessResponses: semantics.expectedBusinessResponses,
    sourceTrace: [
      { authority: 'guide', document: acceptance.current.documentName, section: 'effective-dated guide registry' },
      { authority: 'business_semantics', document: semantics.source.document, section: semantics.source.pageOrSection },
      { authority: 'acknowledgement', document: acceptance.current.documentName, section: `${family} acknowledgement rules` },
    ],
  } satisfies CanonicalEdielPolicy)
}
