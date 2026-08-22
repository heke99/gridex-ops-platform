// Central support registry for Gridex's electricity-supplier role.
// Full market semantics live in utiltsMarketEngine; this registry classifies
// which of those messages this product may originate or consume automatically.

import {
  getCanonicalUtiltsProfile,
  UTILTS_CANONICAL_PROFILES,
} from '@/lib/ediel/rulebook/utiltsRulebook'
import {
  getSupplierUtiltsSupport,
  resolveCanonicalUtiltsApplicationReference,
} from '@/lib/ediel/rulebook/utiltsMarketEngine'

export type UtiltsSupportStatus =
  | 'full'
  | 'inbound_only'
  | 'outbound_only'
  | 'test_only'
  | 'manual_review'
  | 'unsupported'

export type UtiltsMessageSupport = {
  messageCode: string
  supportStatus: UtiltsSupportStatus
  businessProcesses: string[]
  applicationReferencePolicyKey: string | null
  note: string
}

function supportStatus(messageCode: string): UtiltsSupportStatus {
  const supplierSupport = getSupplierUtiltsSupport(messageCode)
  if (supplierSupport === 'inbound_only') return 'inbound_only'
  if (supplierSupport === 'outbound_only') return 'outbound_only'
  if (supplierSupport === 'ack_only') return 'manual_review'
  if (supplierSupport === 'manual_review') return 'manual_review'
  return 'unsupported'
}

function applicationReferencePolicyKey(messageCode: string): string | null {
  // E73's Application Reference identifies the requested application (S02 or
  // E66), so it cannot be represented by one static string in this registry.
  if (messageCode === 'E73' || messageCode === 'ERR') return null
  try {
    return resolveCanonicalUtiltsApplicationReference({
      code: messageCode,
      actorRole: 'supplier',
      resolution: messageCode === 'E66' ? 'quarter_hour' : 'monthly',
    })
  } catch {
    return null
  }
}

export const UTILTS_MESSAGE_SUPPORT: UtiltsMessageSupport[] = UTILTS_CANONICAL_PROFILES.map((profile) => ({
  messageCode: profile.messageCode,
  supportStatus: supportStatus(profile.messageCode),
  businessProcesses: [profile.businessProcess],
  applicationReferencePolicyKey: applicationReferencePolicyKey(profile.messageCode),
  note: `Canonical ${profile.phase}/${profile.scope}; ${profile.productionReadiness}; guide ${profile.guideVersion}, association ${profile.associationAssignedCode}.`,
}))

export function getUtiltsMessageSupport(code: string | null | undefined): UtiltsMessageSupport | null {
  const normalized = String(code ?? '').toUpperCase()
  return UTILTS_MESSAGE_SUPPORT.find((entry) => entry.messageCode === normalized) ?? null
}

export function resolveUtiltsSupportStatus(code: string | null | undefined): UtiltsSupportStatus {
  const entry = getUtiltsMessageSupport(code)
  if (entry) return entry.supportStatus
  return getCanonicalUtiltsProfile(code) ? 'manual_review' : 'unsupported'
}

export function isUtiltsCodeSendable(code: string | null | undefined): boolean {
  const status = resolveUtiltsSupportStatus(code)
  return status === 'full' || status === 'outbound_only'
}

export function isUtiltsCodeReceivable(code: string | null | undefined): boolean {
  const status = resolveUtiltsSupportStatus(code)
  return status === 'full' || status === 'inbound_only'
}

export type UtiltsRegistryConsistencyIssue = { code: string; issue: string }

export function verifyUtiltsRegistryConsistency(): { ok: boolean; issues: UtiltsRegistryConsistencyIssue[] } {
  const issues: UtiltsRegistryConsistencyIssue[] = []
  const seen = new Set<string>()
  for (const entry of UTILTS_MESSAGE_SUPPORT) {
    if (seen.has(entry.messageCode)) issues.push({ code: entry.messageCode, issue: 'duplicate support entry' })
    seen.add(entry.messageCode)
    if (entry.applicationReferencePolicyKey === '23-DDQ-UTILTS') {
      issues.push({ code: entry.messageCode, issue: 'generic UTILTS Application Reference is forbidden' })
    }
  }
  for (const code of ['S01','S02','S03','S04','S05','S06','S07','E30','E31','E66','E72','E73','E74','ERR']) {
    if (!getUtiltsMessageSupport(code)) issues.push({ code, issue: 'canonical profile code missing from support registry' })
  }
  if (isUtiltsCodeSendable('E66')) issues.push({ code: 'E66', issue: 'supplier must never originate E66' })
  if (!isUtiltsCodeSendable('E73')) issues.push({ code: 'E73', issue: 'supplier E73 request path must be available behind bilateral guard' })
  return { ok: issues.length === 0, issues }
}
