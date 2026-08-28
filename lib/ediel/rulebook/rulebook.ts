import type { EdielMessageFamily } from '@/lib/ediel/types'
import { canonicalAckRequirements, listCanonicalAckMatrix } from '@/lib/ediel/ack/canonicalAckEngine'
import {
  PRODAT_CANONICAL_PROFILES,
  getCanonicalProdatProfile,
  type ProdatProcessGroup,
} from '@/lib/ediel/rulebook/prodatRulebook'
import { canonicalProdatApplicationReferenceForProcessGroup } from '@/lib/ediel/rulebook/prodatApplicationReference'
import { UTILTS_CANONICAL_PROFILES, getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'
import { AUTHORITATIVE_EDIEL_GUIDES } from '@/lib/ediel/rulebook/guideRegistry'

export type EdielRulebookProcessGroup =
  | 'customer_masterdata'
  | 'supplier_switch'
  | 'delivery_contract'
  | 'masterdata'
  | 'metering'
  | 'metering_access'
  | 'meter_values'
  | 'ediel_ack'
  | 'ai_list'
  | 'unknown'

export type EdielRulebookRequirement = 'required' | 'dependent' | 'optional' | 'not_used' | 'forbidden'

export type EdielRulebookIssue = {
  severity: 'error' | 'warning'
  code: string
  title: string
  description: string
  fieldPath?: string | null
  blocking?: boolean
}

export type EdielRulebookMessageRule = {
  family: EdielMessageFamily | 'BI_LIST'
  code: string
  version: string
  previousVersion?: string | null
  applicationReference: string | null
  processGroup: EdielRulebookProcessGroup
  requiresContrl: boolean
  requiresAperak: boolean
  negativeAperakOnError: boolean
  requiresUtiltsErr: boolean
  validFrom: string
  validTo?: string | null
  status: 'active' | 'draft' | 'review' | 'superseded' | 'archived'
  allowedSubtypes?: string[]
  description: string
}

function prodatCodesFor(group: ProdatProcessGroup): readonly string[] {
  return PRODAT_CANONICAL_PROFILES.filter((profile) => profile.processGroup === group).map((profile) => profile.messageCode)
}

/** Compatibility projections. The canonical profile catalog owns membership. */
export const PRODAT_CUSTOMER_MASTERDATA_CODES = prodatCodesFor('customer_masterdata')
export const PRODAT_SUPPLIER_SWITCH_CODES = prodatCodesFor('supplier_switch')
export const PRODAT_DELIVERY_CONTRACT_CODES = prodatCodesFor('delivery_contract')
export const PRODAT_MASTERDATA_CODES = prodatCodesFor('masterdata')
export const PRODAT_METERING_CODES = prodatCodesFor('metering')
export const PRODAT_METERING_ACCESS_CODES = prodatCodesFor('metering_access')
export const ACK_FAMILIES = Array.from(new Set(
  listCanonicalAckMatrix()
    .map((rule) => rule.family)
    .filter((family) => family !== 'PRODAT' && family !== 'UTILTS'),
))

export function normalizeRulebookToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function includesCode(codes: readonly string[], code: string | null | undefined): boolean {
  return codes.includes(normalizeRulebookToken(code))
}

export function isProdatMeteringAccessCode(code: string | null | undefined): boolean {
  return getCanonicalProdatProfile(code)?.processGroup === 'metering_access'
}

export function isProdatSupplierSwitchCode(code: string | null | undefined): boolean {
  return getCanonicalProdatProfile(code)?.processGroup === 'supplier_switch'
}

export function isProdatCustomerMasterdataCode(code: string | null | undefined): boolean {
  return getCanonicalProdatProfile(code)?.processGroup === 'customer_masterdata'
}

export function isProdatDeliveryContractCode(code: string | null | undefined): boolean {
  return getCanonicalProdatProfile(code)?.processGroup === 'delivery_contract'
}

export function isProdatMasterdataCode(code: string | null | undefined): boolean {
  return getCanonicalProdatProfile(code)?.processGroup === 'masterdata'
}

export function isProdatMeteringCode(code: string | null | undefined): boolean {
  return getCanonicalProdatProfile(code)?.processGroup === 'metering'
}

export function isAckFamily(family: string | null | undefined): boolean {
  return includesCode(ACK_FAMILIES, family)
}

export function processGroupForMessage(
  family: string | null | undefined,
  code: string | null | undefined,
): EdielRulebookProcessGroup {
  const normalizedFamily = normalizeRulebookToken(family)
  const normalizedCode = normalizeRulebookToken(code)

  if (normalizedFamily === 'PRODAT') {
    return getCanonicalProdatProfile(normalizedCode)?.processGroup ?? 'unknown'
  }
  if (normalizedFamily === 'UTILTS') {
    return getCanonicalUtiltsProfile(normalizedCode) ? 'meter_values' : 'unknown'
  }
  if (isAckFamily(normalizedFamily) || isAckFamily(normalizedCode)) return 'ediel_ack'
  if (normalizedFamily === 'AI_LIST' || normalizedCode === 'AI') return 'ai_list'
  if (normalizedFamily === 'BI_LIST' || normalizedCode === 'BI') return 'ai_list'
  return 'unknown'
}

/**
 * Deprecated compatibility facade. New message-level code must resolve the
 * canonical PRODAT profile by message code. This helper only projects the
 * already-canonical process-group policy for legacy callers.
 */
export function defaultApplicationReferenceForProcess(
  processGroup: EdielRulebookProcessGroup,
  family?: string | null,
): string | null {
  if (family && normalizeRulebookToken(family) !== 'PRODAT') return null
  if (!['supplier_switch','customer_masterdata','delivery_contract','masterdata','metering','metering_access'].includes(processGroup)) {
    return null
  }
  return canonicalProdatApplicationReferenceForProcessGroup(processGroup as ProdatProcessGroup)
}

/** Compatibility projection only; runtime version selection is effective-dated
 * in core/versionRegistry and never calls this function. */
export function messageVersionForFamily(family: string | null | undefined, code?: string | null): string {
  const normalizedFamily = normalizeRulebookToken(family)
  const normalizedCode = normalizeRulebookToken(code)

  if (normalizedFamily === 'PRODAT') {
    const profile = getCanonicalProdatProfile(normalizedCode) ?? PRODAT_CANONICAL_PROFILES[0]
    return profile?.guideVersion.replace(/[^A-Z0-9]/gi, '') ?? 'active'
  }
  if (normalizedFamily === 'UTILTS') {
    return getCanonicalUtiltsProfile(normalizedCode)?.version ?? 'active'
  }
  if (normalizedFamily === 'APERAK' || normalizedCode === 'APERAK') {
    return AUTHORITATIVE_EDIEL_GUIDES.find((guide) => guide.family === 'APERAK')?.guideRevision.replace(/[^A-Z0-9]/gi, '') ?? 'active'
  }
  if (normalizedFamily === 'CONTRL' || normalizedCode === 'CONTRL') {
    return AUTHORITATIVE_EDIEL_GUIDES.find((guide) => guide.family === 'CONTRL')?.guideRevision.replace(/[^A-Z0-9]/gi, '') ?? 'active'
  }
  if (normalizedFamily === 'AI_LIST' || normalizedCode === 'AI' || normalizedCode === 'BI') return 'Ver20140401'
  return 'active'
}

function projectedAckFields(family: string, code: string) {
  const ack = canonicalAckRequirements({ family, code })
  return {
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    negativeAperakOnError: ack.supportsNegativeAperak,
    requiresUtiltsErr: ack.supportsUtiltsErr,
  }
}

function prodatRuleProjection(): EdielRulebookMessageRule[] {
  return PRODAT_CANONICAL_PROFILES.map((profile) => ({
    family: 'PRODAT',
    code: profile.messageCode,
    version: profile.guideVersion.replace(/[^A-Z0-9]/gi, ''),
    previousVersion: null,
    applicationReference: profile.applicationReference,
    processGroup: profile.processGroup,
    ...projectedAckFields('PRODAT', profile.messageCode),
    validFrom: profile.effectiveFrom,
    validTo: null,
    status: 'active',
    allowedSubtypes: [...profile.allowedVariants],
    description: profile.meaning,
  }))
}

function utiltsRuleProjection(): EdielRulebookMessageRule[] {
  return UTILTS_CANONICAL_PROFILES.map((profile) => {
    const family = profile.messageCode === 'ERR' ? 'UTILTS_ERR' : 'UTILTS'
    return {
      family: family as EdielMessageFamily,
      code: profile.messageCode === 'ERR' ? 'UTILTS_ERR' : profile.messageCode,
      version: profile.version,
      previousVersion: null,
      applicationReference: null,
      processGroup: profile.messageCode === 'ERR' ? 'ediel_ack' : 'meter_values',
      ...projectedAckFields(family, profile.messageCode),
      validFrom: profile.effectiveFrom,
      validTo: profile.effectiveTo,
      status: 'active' as const,
      description: profile.officialMeaning,
    }
  })
}

function acknowledgementRuleProjection(family: 'APERAK' | 'CONTRL'): EdielRulebookMessageRule {
  const guide = AUTHORITATIVE_EDIEL_GUIDES.find((candidate) => candidate.family === family)
  const ack = projectedAckFields(family, family)
  return {
    family,
    code: family,
    version: guide?.guideRevision.replace(/[^A-Z0-9]/gi, '') ?? 'active',
    previousVersion: null,
    applicationReference: null,
    processGroup: 'ediel_ack',
    ...ack,
    validFrom: guide?.effectiveFrom ?? '1970-01-01',
    validTo: guide?.effectiveTo ?? null,
    status: 'active',
    description: family === 'APERAK' ? 'Applikationskvittens.' : 'Syntax-/teknisk kvittens.',
  }
}

export function activeRulebookRules(): EdielRulebookMessageRule[] {
  return [
    ...prodatRuleProjection(),
    ...utiltsRuleProjection(),
    acknowledgementRuleProjection('APERAK'),
    acknowledgementRuleProjection('CONTRL'),
    { family: 'AI_LIST', code: 'AI', version: 'Ver20140401', previousVersion: null, applicationReference: null, processGroup: 'ai_list', requiresContrl: false, requiresAperak: false, negativeAperakOnError: false, requiresUtiltsErr: false, validFrom: '2025-10-01', status: 'active', description: 'Anläggningsinformationslista/strukturkontroll.' },
    { family: 'BI_LIST' as never, code: 'BI', version: 'Ver20140401', previousVersion: null, applicationReference: null, processGroup: 'ai_list', requiresContrl: false, requiresAperak: false, negativeAperakOnError: false, requiresUtiltsErr: false, validFrom: '2025-10-01', status: 'active', description: 'Ändringslista för anläggnings-id/nätområde/elnätsföretag.' },
  ]
}

export function getRulebookRule(
  family: string | null | undefined,
  code: string | null | undefined,
): EdielRulebookMessageRule | null {
  const normalizedFamily = normalizeRulebookToken(family)
  const normalizedCode = normalizeRulebookToken(code)
  return activeRulebookRules().find(
    (rule) => normalizeRulebookToken(rule.family) === normalizedFamily && normalizeRulebookToken(rule.code) === normalizedCode,
  ) ?? null
}
