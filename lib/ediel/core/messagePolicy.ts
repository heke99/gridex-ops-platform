import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseCanonicalMessageRow, type CanonicalEdielMessage } from '@/lib/ediel/core/canonicalMessage'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

// Shared protocol date selection; receipt/object matching must not reselect a guide.
function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  const candidate = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null
  const digits = raw.replace(/\D/g, '')
  const date = candidate ?? (digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null)
  if (!date) return null
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10))
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day ? date : null
}

export function canonicalBusinessDate(message: EdielMessageRow, canonical: CanonicalEdielMessage = parseCanonicalMessageRow(message)): string {
  const documentDate = canonical.rawSegments
    .find((segment) => /^DTM\+137:/i.test(segment))
    ?.replace(/^DTM\+137:/i, '')
    .split(':')[0]
  return normalizeDate(documentDate)
    ?? normalizeDate(message.message_received_at)
    ?? normalizeDate(message.created_at)
    ?? new Date().toISOString().slice(0, 10)
}

function readBooleanFact(message: EdielMessageRow, key: string): boolean | undefined {
  const parsed = message.parsed_payload ?? {}
  const report = message.validation_report ?? {}
  const candidates = [
    parsed[key],
    (parsed.prodatDependentFacts as Record<string, unknown> | undefined)?.[key],
    (report.prodatDependentFacts as Record<string, unknown> | undefined)?.[key],
  ]
  return candidates.find((value): value is boolean => typeof value === 'boolean')
}

function readObjectFact(message: EdielMessageRow, key: string): Record<string, boolean | null | undefined> | undefined {
  const parsed = message.parsed_payload ?? {}
  const direct = parsed[key]
  const nested = (parsed.prodatDependentFacts as Record<string, unknown> | undefined)?.[key]
  const value = direct ?? nested
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, boolean | null | undefined>
    : undefined
}

function readStringFact(message: EdielMessageRow, key: string): string | undefined {
  const parsed = message.parsed_payload ?? {}
  const report = message.validation_report ?? {}
  const candidates = [
    parsed[key],
    (parsed.prodatDependentFacts as Record<string, unknown> | undefined)?.[key],
    (report.prodatDependentFacts as Record<string, unknown> | undefined)?.[key],
  ]
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())
  return typeof value === 'string' ? value.trim() : undefined
}

export function resolveCanonicalMessagePolicy(message: EdielMessageRow, canonical: CanonicalEdielMessage = parseCanonicalMessageRow(message)): CanonicalEdielPolicy | null {
  if (canonical.family !== 'PRODAT' && canonical.family !== 'UTILTS' && canonical.family !== 'UTILTS_ERR') return null
  if (!canonical.messageCode) throw new Error(`canonical_policy_message_code_missing:${canonical.family}`)

  const family = canonical.family
  return resolveCanonicalEdielPolicy({
    family,
    messageCode: canonical.messageCode,
    subtypeOrReasonCode: canonical.subtype,
    direction: message.direction,
    referenceDate: canonicalBusinessDate(message, canonical),
    associationAssignedCode: canonical.version,
    applicationReference: canonical.applicationReference,
    bilateralCapabilityVerified: readBooleanFact(message, 'bilateralCapabilityVerified'),
    prodatDependentFacts: family === 'PRODAT' ? {
      market: 'electricity',
      customerKind: readStringFact(message, 'customerKind') as 'private' | 'business' | undefined,
      meterReadingsSentInUtilts: readBooleanFact(message, 'meterReadingsSentInUtilts'),
      multipleMeterRegisters: readBooleanFact(message, 'multipleMeterRegisters'),
      endUserAddressAvailable: readBooleanFact(message, 'endUserAddressAvailable'),
      invoiceeAddressDiffersFromEndUser: readBooleanFact(message, 'invoiceeAddressDiffersFromEndUser'),
      byCell: readObjectFact(message, 'byCell'),
    } : null,
    mode: 'parse',
  })
}
