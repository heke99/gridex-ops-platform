// lib/ediel/prodat/prodatMessageSupportRegistry.ts
//
// Compile-time support contract projected from the PRODAT 26.A rulebook.
// Source-controlled canonical rules decide semantics; DB rows are activation/evidence.

import {
  PRODAT_CANONICAL_PROFILES,
  getCanonicalProdatProfile,
  type ProdatCanonicalProfile,
  type ProdatRuleProfileKey,
} from '@/lib/ediel/rulebook/prodatRulebook'
import { ACTIVE_PRODAT_ENGINE_CODES } from '@/lib/ediel/prodat/registry'
import {
  SUPPORTED_PRODAT_BUSINESS_CODES,
  canonicalProdat26AFieldRules,
  requiredProdatSegmentsForCode,
} from '@/lib/ediel/prodat/prodatFieldRules'

export type ProdatSupportStatus =
  | 'full'
  | 'inbound_only'
  | 'outbound_only'
  | 'test_only'
  | 'manual_review'
  | 'unsupported'

export type ProdatRequiredFields = {
  facility: boolean
  meteringPoint: boolean
  customer: boolean
  gridArea: boolean
}

export type ProdatMessageSupport = {
  messageCode: string
  supportStatus: ProdatSupportStatus
  businessProcesses: string[]
  applicationReferencePolicyKey: '23-DDQ-PRODAT' | '23-DGI-PRODAT'
  fieldMatrixProfileId: ProdatRuleProfileKey
  requiredFields: ProdatRequiredFields
  allowedSenderRoles: string[]
  allowedReceiverRoles: string[]
  hasEngineBuilder: boolean
  requiredSegments: string[]
}

function businessProcessesFor(profile: ProdatCanonicalProfile): string[] {
  // Gridex application aliases are UI/orchestration vocabulary, not Ediel norm.
  if (profile.messageCode === 'Z01' || profile.messageCode === 'Z02') return [profile.processGroup, 'facility_lookup']
  return [profile.processGroup]
}

function requiresAny(code: string, fieldKeys: readonly string[]): boolean {
  return canonicalProdat26AFieldRules(code).some(
    (rule) => fieldKeys.includes(rule.fieldKey) && (rule.requirement === 'required' || rule.requirement === 'dependent'),
  )
}

function requiredFieldsFor(profile: ProdatCanonicalProfile): ProdatRequiredFields {
  return {
    facility: requiresAny(profile.messageCode, ['installation_id']),
    meteringPoint: requiresAny(profile.messageCode, ['line_item', 'installation_id']),
    customer: requiresAny(profile.messageCode, ['end_user_id', 'end_user_name']),
    gridArea: requiresAny(profile.messageCode, ['net_area']),
  }
}

function supportStatusFor(profile: ProdatCanonicalProfile, hasBuilder: boolean): ProdatSupportStatus {
  if (profile.direction === 'portal_to_actor') return 'inbound_only'
  return hasBuilder ? 'outbound_only' : 'manual_review'
}

function buildEntry(profile: ProdatCanonicalProfile): ProdatMessageSupport {
  const hasBuilder = (ACTIVE_PRODAT_ENGINE_CODES as readonly string[]).includes(profile.messageCode)
  return {
    messageCode: profile.messageCode,
    supportStatus: supportStatusFor(profile, hasBuilder),
    businessProcesses: businessProcessesFor(profile),
    applicationReferencePolicyKey: profile.applicationReference,
    fieldMatrixProfileId: profile.profileKey,
    requiredFields: requiredFieldsFor(profile),
    allowedSenderRoles: [profile.senderRole],
    allowedReceiverRoles: [profile.receiverRole],
    hasEngineBuilder: hasBuilder,
    requiredSegments: requiredProdatSegmentsForCode(profile.messageCode),
  }
}

export const PRODAT_MESSAGE_SUPPORT: ProdatMessageSupport[] = PRODAT_CANONICAL_PROFILES.map(buildEntry)

export function getProdatMessageSupport(code: string | null | undefined): ProdatMessageSupport | null {
  const normalized = String(code ?? '').toUpperCase()
  return PRODAT_MESSAGE_SUPPORT.find((entry) => entry.messageCode === normalized) ?? null
}

export function resolveProdatSupportStatus(code: string | null | undefined): ProdatSupportStatus {
  const entry = getProdatMessageSupport(code)
  if (!entry) return getCanonicalProdatProfile(code) ? 'manual_review' : 'unsupported'
  return entry.supportStatus
}

export function isProdatCodeSendable(code: string | null | undefined): boolean {
  const status = resolveProdatSupportStatus(code)
  return status === 'full' || status === 'outbound_only'
}

export function isProdatCodeReceivable(code: string | null | undefined): boolean {
  const status = resolveProdatSupportStatus(code)
  return status === 'full' || status === 'inbound_only'
}

export type ProdatRegistryConsistencyIssue = { code: string; issue: string }

export function verifyProdatRegistryConsistency(): {
  ok: boolean
  issues: ProdatRegistryConsistencyIssue[]
} {
  const issues: ProdatRegistryConsistencyIssue[] = []

  for (const code of ACTIVE_PRODAT_ENGINE_CODES) {
    const matches = PRODAT_MESSAGE_SUPPORT.filter((entry) => entry.messageCode === code)
    if (matches.length !== 1) {
      issues.push({ code, issue: `expected exactly one support entry, found ${matches.length}` })
    }
  }

  const seen = new Set<string>()
  for (const entry of PRODAT_MESSAGE_SUPPORT) {
    if (seen.has(entry.messageCode)) {
      issues.push({ code: entry.messageCode, issue: 'duplicate support entry' })
    }
    seen.add(entry.messageCode)

    const profile = getCanonicalProdatProfile(entry.messageCode)
    if (!profile) continue
    if (profile.applicationReference !== entry.applicationReferencePolicyKey) {
      issues.push({ code: entry.messageCode, issue: 'application reference mismatch between registry and rulebook' })
    }
    if (entry.allowedSenderRoles.length !== 1 || entry.allowedSenderRoles[0] !== profile.senderRole) {
      issues.push({ code: entry.messageCode, issue: 'sender role mismatch between registry and rulebook' })
    }
    if (entry.allowedReceiverRoles.length !== 1 || entry.allowedReceiverRoles[0] !== profile.receiverRole) {
      issues.push({ code: entry.messageCode, issue: 'receiver role mismatch between registry and rulebook' })
    }
    if (profile.direction === 'portal_to_actor' && isProdatCodeSendable(entry.messageCode)) {
      issues.push({ code: entry.messageCode, issue: 'inbound-only code incorrectly classified as sendable' })
    }
  }

  for (const code of SUPPORTED_PRODAT_BUSINESS_CODES) {
    if (!getProdatMessageSupport(code)) {
      issues.push({ code, issue: 'field-rule supported code missing from support registry' })
    }
  }

  return { ok: issues.length === 0, issues }
}
