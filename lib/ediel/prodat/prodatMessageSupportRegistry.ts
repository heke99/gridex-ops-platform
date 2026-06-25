// lib/ediel/prodat/prodatMessageSupportRegistry.ts
//
// Batch 4: one central truth for PRODAT support. Each referenced PRODAT code has
// exactly one support status, derived from and reconciled with the canonical
// rulebook profiles (`PRODAT_CANONICAL_PROFILES`), the engine builders
// (`ACTIVE_PRODAT_ENGINE_CODES`) and the field rules
// (`SUPPORTED_PRODAT_BUSINESS_CODES`). Anything without a builder/profile is
// classified manual_review/unsupported rather than guessed.

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
  if (profile.processGroup === 'metering_access') return ['metering_permission']
  if (profile.processGroup === 'customer_masterdata') {
    return profile.messageCode === 'Z01' || profile.messageCode === 'Z02'
      ? ['customer_masterdata', 'facility_lookup']
      : ['customer_masterdata']
  }
  return ['supplier_switch']
}

function rolesFor(appRef: '23-DDQ-PRODAT' | '23-DGI-PRODAT'): { sender: string[]; receiver: string[] } {
  if (appRef === '23-DGI-PRODAT') {
    return { sender: ['energy_service_company', 'grid_owner'], receiver: ['grid_owner', 'energy_service_company'] }
  }
  return { sender: ['supplier', 'grid_owner'], receiver: ['grid_owner', 'supplier'] }
}

function requiredFieldsFor(profile: ProdatCanonicalProfile): ProdatRequiredFields {
  const code = profile.messageCode
  // Z01/Z02 customer-identity request: customer required; facility/MP is the
  // documented allowed-missing case (requested from the grid owner).
  if (code === 'Z01' || code === 'Z02') {
    return { facility: false, meteringPoint: false, customer: true, gridArea: false }
  }
  // Supplier switch + masterdata + permission flows require an identified object.
  return { facility: false, meteringPoint: true, customer: true, gridArea: true }
}

function supportStatusFor(profile: ProdatCanonicalProfile, hasBuilder: boolean): ProdatSupportStatus {
  if (!hasBuilder) return 'manual_review'
  if (profile.direction === 'both') return 'full'
  if (profile.direction === 'actor_to_portal') return 'outbound_only'
  return 'inbound_only'
}

function buildEntry(profile: ProdatCanonicalProfile): ProdatMessageSupport {
  const hasBuilder = (ACTIVE_PRODAT_ENGINE_CODES as readonly string[]).includes(profile.messageCode)
  const roles = rolesFor(profile.applicationReference)
  return {
    messageCode: profile.messageCode,
    supportStatus: supportStatusFor(profile, hasBuilder),
    businessProcesses: businessProcessesFor(profile),
    applicationReferencePolicyKey: profile.applicationReference,
    fieldMatrixProfileId: profile.profileKey,
    requiredFields: requiredFieldsFor(profile),
    allowedSenderRoles: roles.sender,
    allowedReceiverRoles: roles.receiver,
    hasEngineBuilder: hasBuilder,
    requiredSegments: requiredProdatSegmentsForCode(profile.messageCode),
  }
}

export const PRODAT_MESSAGE_SUPPORT: ProdatMessageSupport[] = PRODAT_CANONICAL_PROFILES.map(buildEntry)

export function getProdatMessageSupport(code: string | null | undefined): ProdatMessageSupport | null {
  const normalized = String(code ?? '').toUpperCase()
  return PRODAT_MESSAGE_SUPPORT.find((entry) => entry.messageCode === normalized) ?? null
}

// Unknown/unsupported codes resolve to a manual_review classification rather than
// a permissive default.
export function resolveProdatSupportStatus(code: string | null | undefined): ProdatSupportStatus {
  const entry = getProdatMessageSupport(code)
  if (!entry) return getCanonicalProdatProfile(code) ? 'manual_review' : 'unsupported'
  return entry.supportStatus
}

export function isProdatCodeSendable(code: string | null | undefined): boolean {
  const status = resolveProdatSupportStatus(code)
  return status === 'full' || status === 'outbound_only'
}

export type ProdatRegistryConsistencyIssue = { code: string; issue: string }

// Verifies the registry, rulebook and field rules agree. Used by regression.
export function verifyProdatRegistryConsistency(): {
  ok: boolean
  issues: ProdatRegistryConsistencyIssue[]
} {
  const issues: ProdatRegistryConsistencyIssue[] = []

  // Every engine builder code must have exactly one support entry.
  for (const code of ACTIVE_PRODAT_ENGINE_CODES) {
    const matches = PRODAT_MESSAGE_SUPPORT.filter((entry) => entry.messageCode === code)
    if (matches.length !== 1) {
      issues.push({ code, issue: `expected exactly one support entry, found ${matches.length}` })
    }
  }

  // No duplicate support statuses per code.
  const seen = new Set<string>()
  for (const entry of PRODAT_MESSAGE_SUPPORT) {
    if (seen.has(entry.messageCode)) {
      issues.push({ code: entry.messageCode, issue: 'duplicate support entry' })
    }
    seen.add(entry.messageCode)
  }

  // Field-rule supported business codes must be sendable in the registry.
  for (const code of SUPPORTED_PRODAT_BUSINESS_CODES) {
    const entry = getProdatMessageSupport(code)
    if (!entry) {
      issues.push({ code, issue: 'field-rule supported code missing from support registry' })
      continue
    }
    if (entry.supportStatus === 'unsupported' || entry.supportStatus === 'manual_review') {
      issues.push({ code, issue: `field-rule supported code classified ${entry.supportStatus}` })
    }
  }

  // Application reference policy key must agree with the canonical rulebook.
  for (const entry of PRODAT_MESSAGE_SUPPORT) {
    const profile = getCanonicalProdatProfile(entry.messageCode)
    if (profile && profile.applicationReference !== entry.applicationReferencePolicyKey) {
      issues.push({ code: entry.messageCode, issue: 'application reference mismatch between registry and rulebook' })
    }
  }

  return { ok: issues.length === 0, issues }
}
