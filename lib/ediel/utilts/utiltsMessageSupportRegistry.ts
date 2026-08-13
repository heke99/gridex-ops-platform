// lib/ediel/utilts/utiltsMessageSupportRegistry.ts
//
// Batch 7: one central truth for UTILTS support. No "partial unknown UTILTS":
// every code in scope is full, inbound_only, outbound_only, test_only,
// manual_review or unsupported. Unknown codes resolve to manual_review/unsupported
// rather than a permissive default.

import {
  getCanonicalUtiltsProfile,
  UTILTS_CANONICAL_PROFILES,
} from '@/lib/ediel/rulebook/utiltsRulebook'

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
  if (messageCode === 'E66' || messageCode === 'ERR') return 'full'
  if (messageCode === 'E73') return 'outbound_only'
  return 'inbound_only'
}

// Presentation and intent validation derive their semantics from the same
// canonical profiles used by parser, validator and renderer.
export const UTILTS_MESSAGE_SUPPORT: UtiltsMessageSupport[] = UTILTS_CANONICAL_PROFILES.map((profile) => ({
  messageCode: profile.messageCode,
  supportStatus: supportStatus(profile.messageCode),
  businessProcesses: [profile.businessProcess],
  applicationReferencePolicyKey: profile.messageCode === 'ERR' ? null : '23-DDQ-UTILTS',
  note: `Canonical ${profile.phase}/${profile.scope} profile; guide ${profile.guideVersion}, association ${profile.associationAssignedCode}.`,
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

export type UtiltsRegistryConsistencyIssue = { code: string; issue: string }

export function verifyUtiltsRegistryConsistency(): { ok: boolean; issues: UtiltsRegistryConsistencyIssue[] } {
  const issues: UtiltsRegistryConsistencyIssue[] = []
  const seen = new Set<string>()
  for (const entry of UTILTS_MESSAGE_SUPPORT) {
    if (seen.has(entry.messageCode)) issues.push({ code: entry.messageCode, issue: 'duplicate support entry' })
    seen.add(entry.messageCode)
  }
  // Every canonical rulebook profile code must be classified.
  for (const code of ['S01','S02','S03','S04','S05','S06','S07','E30','E31','E66','E72','E73','E74','ERR']) {
    if (!getUtiltsMessageSupport(code)) issues.push({ code, issue: 'canonical profile code missing from support registry' })
  }
  return { ok: issues.length === 0, issues }
}
