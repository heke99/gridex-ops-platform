// lib/ediel/intent/noPlaceholderGuard.ts
//
// Production rule (PART 2.4 / PART 4 segment rules): never send UNKNOWN, MISSING,
// N/A, PLACEHOLDER or other fake identifiers as facility id, metering point id,
// grid area, customer identifier, Ediel id, object id or transaction reference.
// If data is missing, the caller must block or use an explicitly documented
// allowed-missing rule modelled in the payload (never a string placeholder).

import type { EdielIntentBlockingReason } from '@/lib/ediel/intent/types'

const FORBIDDEN_PLACEHOLDER_TOKENS = [
  'UNKNOWN',
  'MISSING',
  'N/A',
  'NA',
  'PLACEHOLDER',
  'TBD',
  'TODO',
  'XXX',
  'XXXX',
  'NONE',
  'NULL',
  'UNDEFINED',
  'DUMMY',
  'TEST123',
  'OKAND',
  'OKÄND',
  'SAKNAS',
]

export type PlaceholderSensitiveField =
  | 'facilityId'
  | 'meteringPointId'
  | 'gridAreaCode'
  | 'customerIdentifier'
  | 'senderEdielId'
  | 'receiverEdielId'
  | 'objectId'
  | 'edielId'
  | 'transactionReference'

export function isPlaceholderIdentifier(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toUpperCase()
  if (!normalized) return false
  if (FORBIDDEN_PLACEHOLDER_TOKENS.includes(normalized)) return true
  // Collapse separators so "UN-KNOWN", "N.A.", "PLACE_HOLDER" etc. are caught too.
  const collapsed = normalized.replace(/[\s._/-]+/g, '')
  return FORBIDDEN_PLACEHOLDER_TOKENS.some((token) => token.replace(/[\s._/-]+/g, '') === collapsed)
}

export type NoPlaceholderCheckInput = Partial<Record<PlaceholderSensitiveField, unknown>>

export function collectPlaceholderViolations(input: NoPlaceholderCheckInput): EdielIntentBlockingReason[] {
  const reasons: EdielIntentBlockingReason[] = []
  for (const [field, value] of Object.entries(input)) {
    if (isPlaceholderIdentifier(value)) {
      reasons.push({
        code: 'placeholder_identifier_not_allowed',
        message: `Otillåten platshållare i ${field}: "${String(value).trim()}". Riktiga identifierare krävs eller dokumenterad allowed-missing-regel.`,
        field,
        severity: 'block',
        details: { field, value: String(value).trim() },
      })
    }
  }
  return reasons
}

export function assertNoPlaceholderIdentifiers(input: NoPlaceholderCheckInput): void {
  const reasons = collectPlaceholderViolations(input)
  if (reasons.length > 0) {
    throw new Error(`no_placeholder_guard_blocked: ${reasons.map((r) => r.message).join(' | ')}`)
  }
}
