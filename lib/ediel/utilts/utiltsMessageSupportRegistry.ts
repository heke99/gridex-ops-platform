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
  { messageCode: 'E66', supportStatus: 'full', businessProcesses: ['metering_values', 'timeseries_request'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Metering values request/response; built outbound and parsed inbound.' },
  { messageCode: 'E73', supportStatus: 'outbound_only', businessProcesses: ['timeseries_request'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Data request; built outbound.' },
  { messageCode: 'E31', supportStatus: 'inbound_only', businessProcesses: ['metering_values'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Schedule/aggregated values; parsed inbound.' },
  { messageCode: 'S02', supportStatus: 'inbound_only', businessProcesses: ['metering_values'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Measurement series; parsed inbound.' },
  { messageCode: 'S03', supportStatus: 'inbound_only', businessProcesses: ['metering_values'], applicationReferencePolicyKey: '23-DDQ-UTILTS', note: 'Measurement series; parsed inbound.' },
  { messageCode: 'S01', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Rulebook profile only; no specific parser/builder yet.' },
  { messageCode: 'S04', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Rulebook profile only; no specific parser/builder yet.' },
  { messageCode: 'S05', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Not yet implemented; route to manual review.' },
  { messageCode: 'S06', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Not yet implemented; route to manual review.' },
  { messageCode: 'S07', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Not yet implemented; route to manual review.' },
  { messageCode: 'E30', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Not yet implemented; route to manual review.' },
  { messageCode: 'E72', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Not yet implemented; route to manual review.' },
  { messageCode: 'E74', supportStatus: 'manual_review', businessProcesses: ['metering_values'], applicationReferencePolicyKey: null, note: 'Not yet implemented; route to manual review.' },
  { messageCode: 'ERR', supportStatus: 'full', businessProcesses: ['acknowledgement'], applicationReferencePolicyKey: null, note: 'UTILTS functional error; built and parsed.' },
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
  for (const code of ['E66', 'E31', 'S01', 'S02', 'S03', 'S04']) {
    if (!getUtiltsMessageSupport(code)) issues.push({ code, issue: 'canonical profile code missing from support registry' })
  }
  return { ok: issues.length === 0, issues }
}
