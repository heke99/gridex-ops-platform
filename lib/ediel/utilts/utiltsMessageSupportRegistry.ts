// lib/ediel/utilts/utiltsMessageSupportRegistry.ts
//
// Batch 7: one central truth for UTILTS support. No "partial unknown UTILTS":
// every code in scope is full, inbound_only, outbound_only, test_only,
// manual_review or unsupported. Unknown codes resolve to manual_review/unsupported
// rather than a permissive default.

import { getCanonicalUtiltsProfile } from '@/lib/ediel/rulebook/utiltsRulebook'

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

// Codes explicitly in scope per the hardening brief.
export const UTILTS_MESSAGE_SUPPORT: UtiltsMessageSupport[] = [
  { messageCode: 'E66', supportStatus: 'full', businessProcesses: ['metering_values', 'timeseries_request'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Canonical profile, outbound request and transaction-aware inbound processing.' },
  { messageCode: 'E73', supportStatus: 'outbound_only', businessProcesses: ['timeseries_request'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Canonical data-request profile and outbound builder.' },
  ...['S01','S02','S03','S04','S05','S06','S07','E30','E31','E72','E74'].map((messageCode) => ({ messageCode, supportStatus: 'inbound_only' as const, businessProcesses: ['metering_values'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Canonical profile with transaction-level inbound validation, correction and DST rules.' })),
  { messageCode: 'ERR', supportStatus: 'full', businessProcesses: ['acknowledgement'], applicationReferencePolicyKey: null, note: 'Canonical UTILTS functional-error profile.' },
]

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
