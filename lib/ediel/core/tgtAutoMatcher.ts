// lib/ediel/core/tgtAutoMatcher.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from '@/lib/ediel/tgtTestData'
import type { EdielTgtDynamicTestDataSummary } from '@/lib/ediel/tgtTestDataStore'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'

function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z]+/g, ' ')
    .trim()
    .toUpperCase()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export function textForTgtAutoMatch(message: EdielMessageRow): string {
  return [
    message.raw_payload,
    message.external_reference,
    message.transaction_reference,
    message.interchange_reference,
    message.original_transaction_id,
    message.original_message_code,
    JSON.stringify(message.parsed_payload ?? {}),
    JSON.stringify(message.validation_report ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
}

export function messageCodePrefixesForTgtAutoMatch(message: EdielMessageRow): string[] {
  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? '').toUpperCase()

  if (family === 'PRODAT') {
    if (code === 'Z03') return ['1.2', '1.3']
    if (code === 'Z04') return ['1.4', '1.5']
    if (code === 'Z06') return ['2.1', '2.2']
    if (code === 'Z10') return ['2.3', '2.4']
    if (code === 'Z09') return ['2.5']
    if (code === 'Z05') return ['3.1', '3.2']
  }

  if (family === 'UTILTS') {
    if (code === 'S02') return ['U1.1', 'U1.2']
    if (code === 'S03') return ['U1.3', 'U1.4']
    if (code === 'E66') return ['U2.1', 'U2.2']
  }

  return []
}

export function fieldValuesFromTgtTestData(
  testData: EdielTgtCaseTestData | null | undefined,
  fieldCodes: string[]
): string[] {
  if (!testData) return []
  const wanted = new Set(fieldCodes.map((code) => code.toUpperCase()))
  const values: string[] = []

  for (const group of testData.groups) {
    for (const field of group.fields) {
      if (!wanted.has(String(field.fieldCode).toUpperCase())) continue
      for (const value of Object.values(field.values)) {
        const cleaned = String(value ?? '').trim()
        if (cleaned) values.push(cleaned)
      }
    }
  }

  return unique(values)
}

export function facilityIdsFromTgtTestData(testData: EdielTgtCaseTestData | null | undefined): string[] {
  return fieldValuesFromTgtTestData(testData, ['209', '233']).filter((value) => /^735\d{15}$/.test(value))
}

function rawFacilityIds(rawText: string): string[] {
  return unique(Array.from(rawText.matchAll(/735\d{15}/g)).map((match) => match[0]))
}

function messageFacilityIds(message: EdielMessageRow): string[] {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return unique(facts.lineItems.map((line) => line.itemId ?? '').filter((value) => /^735\d{15}$/.test(value)))
}

function hasFacilityMismatch(message: EdielMessageRow, testData: EdielTgtCaseTestData | null | undefined): boolean {
  const expected = new Set(facilityIdsFromTgtTestData(testData))
  const actual = messageFacilityIds(message)
  if (expected.size === 0 || actual.length === 0) return false
  return actual.some((id) => !expected.has(id))
}

function hasRawFacilityMismatch(message: EdielMessageRow, rawText: string): boolean {
  const expected = new Set(rawFacilityIds(rawText))
  const actual = messageFacilityIds(message)
  if (expected.size === 0 || actual.length === 0) return false
  return actual.some((id) => !expected.has(id))
}

function payloadHasMissingDigitCount(message: EdielMessageRow): boolean {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return facts.lineItems.some((line) => !line.hasDigitCount)
}

function payloadHasMissingConstant(message: EdielMessageRow): boolean {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return facts.lineItems.some((line) => !line.hasConstant)
}

function rawHasField(rawText: string, fieldCode: string): boolean {
  const escaped = fieldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\n|\\t|;|,)\\s*${escaped}(\\s|\\t|;|,)`, 'i').test(rawText)
}

export function inferTgtTestCaseCodeForInboundTestData(params: {
  message: EdielMessageRow
  rawText: string
  fallback?: string | null
}): string {
  const { message, rawText, fallback } = params
  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? '').toUpperCase()
  const text = textForTgtAutoMatch(message)

  const explicit = String(fallback ?? '').trim()
  if (explicit && explicit.toLowerCase() !== 'auto') return explicit

  // If copied/exported data mentions a test case code, trust it.
  const explicitCase = rawText.match(/\b(?:U\d\.\d\.\d+b?|\d\.\d\.\d+B?)\b/i)?.[0]
  if (explicitCase) return explicitCase.toUpperCase().replace(/B$/, 'B')

  if (family === 'PRODAT') {
    if (code === 'Z06') {
      if (hasRawFacilityMismatch(message, rawText)) return '2.2.1'
      if (payloadHasMissingDigitCount(message) || rawHasField(rawText, '218')) return '2.2.2'
      if (text.includes('Z06G')) return '2.1.3'
      return '2.1.1'
    }

    if (code === 'Z10') {
      if (payloadHasMissingConstant(message) || rawHasField(rawText, '214')) return '2.4.2'
      if (hasRawFacilityMismatch(message, rawText)) return '2.4.1'
      return '2.3.1'
    }

    if (code === 'Z05') {
      if (hasRawFacilityMismatch(message, rawText)) return '3.2.1'
      return '3.1.1'
    }

    if (code === 'Z09') return '2.5.1'
    if (code === 'Z04') return '1.4.3'
    if (code === 'Z03') return '1.3.1'
  }

  if (family === 'UTILTS') {
    if (code === 'S02') return rawText.match(/E87|E10|funktionsfel/i) ? 'U1.2.2' : rawText.match(/saknas|mandatory|anvisningsfel/i) ? 'U1.2.1' : 'U1.1.1'
    if (code === 'S03') return rawText.match(/saknas|mandatory|anvisningsfel/i) ? 'U1.4.1' : 'U1.3.1'
    if (code === 'E66') return rawText.match(/funktionsfel|process|E87|E10/i) ? 'U2.2.3' : rawText.match(/saknas|mandatory|anvisningsfel/i) ? 'U2.2.1' : 'U2.1.1'
  }

  return messageCodePrefixesForTgtAutoMatch(message)[0] ? `${messageCodePrefixesForTgtAutoMatch(message)[0]}.1` : 'AUTO'
}

export function scoreTgtTestDataForMessage(message: EdielMessageRow, row: EdielTgtDynamicTestDataSummary): number {
  const family = String(message.message_family ?? '').toUpperCase()
  const suite = family === 'UTILTS' ? 'UTILTS' : family === 'PRODAT' ? 'PRODAT' : null
  if (!suite || row.testSuite !== suite || row.roleCode !== 'supplier') return -1

  const prefixes = messageCodePrefixesForTgtAutoMatch(message)
  const text = textForTgtAutoMatch(message)
  let score = 0

  if (prefixes.some((prefix) => row.testCaseCode === prefix || row.testCaseCode.startsWith(`${prefix}.`) || row.testCaseCode.startsWith(`${prefix}b`))) {
    score += 20
  }

  if (text.includes(String(row.testCaseCode).toUpperCase())) score += 40

  const expectedFacilities = facilityIdsFromTgtTestData(row.parsedPayload)
  const actualFacilities = messageFacilityIds(message)
  if (expectedFacilities.length > 0) {
    score += 10
    const expected = new Set(expectedFacilities)
    const matching = actualFacilities.filter((id) => expected.has(id)).length
    const mismatching = actualFacilities.filter((id) => !expected.has(id)).length
    score += matching * 5
    score += mismatching * 80
  }

  if (hasFacilityMismatch(message, row.parsedPayload)) score += 100

  // If row contains exact fields that match a negative scenario, prefer it over older positive rows.
  const rowCode = row.testCaseCode.toUpperCase()
  if (rowCode.startsWith('2.2') || rowCode.startsWith('2.4') || rowCode.startsWith('3.2') || rowCode.includes('U2.2') || rowCode.includes('U1.2') || rowCode.includes('U1.4')) {
    score += 15
  }

  return score
}

export function findBestTgtTestDataForMessage(
  message: EdielMessageRow,
  rows: readonly EdielTgtDynamicTestDataSummary[]
): EdielTgtDynamicTestDataSummary | null {
  const scored = rows
    .map((row) => ({ row, score: scoreTgtTestDataForMessage(message, row) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score
      if (scoreDiff !== 0) return scoreDiff
      return String(b.row.updatedAt).localeCompare(String(a.row.updatedAt))
    })

  return scored[0]?.row ?? null
}

export function sourceMessageMarker(sourceMessageId: string): string {
  return `GRIDCORE_SOURCE_MESSAGE_ID:${sourceMessageId}`
}

export function rawTextHasSourceMessageMarker(rawText: string | null | undefined, sourceMessageId: string): boolean {
  return String(rawText ?? '').includes(sourceMessageMarker(sourceMessageId))
}

export function findExactTgtTestDataForMessage(
  message: EdielMessageRow,
  rows: readonly EdielTgtDynamicTestDataSummary[]
): EdielTgtDynamicTestDataSummary | null {
  return rows.find((row) => rawTextHasSourceMessageMarker(row.rawText, message.id)) ?? null
}
