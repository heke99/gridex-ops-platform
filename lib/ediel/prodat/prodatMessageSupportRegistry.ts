// lib/ediel/prodat/prodatMessageSupportRegistry.ts
//
// Compile-time support contract derived from the PRODAT 26.A rulebook. The
// dated DB rule pack remains the runtime source of truth. This registry must
// fail closed and must never make an inbound-only message sendable merely
// because a renderer exists.

import {
  PRODAT_CANONICAL_PROFILES,
  getCanonicalProdatProfile,
  type ProdatCanonicalProfile,
  type ProdatRuleProfileKey,
} from '@/lib/ediel/rulebook/prodatRulebook'
import { ACTIVE_PRODAT_ENGINE_CODES } from '@/lib/ediel/prodat/registry'
import {
  SUPPORTED_PRODAT_BUSINESS_CODES,
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
  switch (profile.messageCode) {
    case 'Z01':
    case 'Z02':
      return ['customer_masterdata', 'facility_lookup']
    case 'Z03':
    case 'Z04':
    case 'Z05':
      return ['supplier_switch']
    case 'Z06':
      return ['masterdata', 'customer_masterdata']
    case 'Z08':
      return ['delivery_contract']
    case 'Z09':
      return ['masterdata']
    case 'Z10':
      return ['metering', 'masterdata']
    case 'Z13':
    case 'Z14':
    case 'Z15':
    case 'Z18':
      return ['metering_permission']
    default:
      return [profile.processGroup]
  }
}

function requiredFieldsFor(profile: ProdatCanonicalProfile): ProdatRequiredFields {
  const code = profile.messageCode
  // A renderable Z01/Z02 must address an identified facility. If the facility
  // is unknown Gridex uses the separate manual information-request workflow.
  if (code === 'Z01' || code === 'Z02') {
    return { facility: true, meteringPoint: false, customer: true, gridArea: false }
  }
  if (code === 'Z13' || code === 'Z14' || code === 'Z15' || code === 'Z18') {
    return { facility: false, meteringPoint: true, customer: true, gridArea: true }
  }
  return { facility: false, meteringPoint: true, customer: true, gridArea: true }
}

function supportStatusFor(profile: ProdatCanonicalProfile, hasBuilder: boolean): ProdatSupportStatus {
  // Builder readiness only matters for messages Gridex may originate. An
  // inbound message remains inbound_only even if a legacy outbound builder is
  // still present for test/backwards compatibility.
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
    hasEngineBuilder,
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

  // A field-rule renderer may exist for inbound-only messages for parsing/test
  // fixtures. That must not imply outbound support, so only require a registry
  // entry here, not sendability.
  for (const code of SUPPORTED_PRODAT_BUSINESS_CODES) {
    if (!getProdatMessageSupport(code)) {
      issues.push({ code, issue: 'field-rule supported code missing from support registry' })
    }
  }

  return { ok: issues.length === 0, issues }
}
