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

function meterNumbersForLine(line: ReturnType<typeof parseEdifactMessageFacts>['lineItems'][number]): string[] {
  return unique(
    line.segments
      .filter((segment) => segment.raw.startsWith('RFF+MG:'))
      .map((segment) => segment.raw.replace(/^RFF\+MG:/, '').split(':')[0]?.trim() ?? '')
  )
}

function payloadHasSameMeterNumber(message: EdielMessageRow): boolean {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return facts.lineItems.some((line) => {
    const rawMeterNumbers = line.segments
      .filter((segment) => segment.raw.startsWith('RFF+MG:'))
      .map((segment) => segment.raw.replace(/^RFF\+MG:/, '').split(':')[0]?.trim() ?? '')
      .filter(Boolean)
    return rawMeterNumbers.length >= 2 && new Set(rawMeterNumbers).size < rawMeterNumbers.length
  })
}

function firstMeterNumber(message: EdielMessageRow): string | null {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  for (const line of facts.lineItems) {
    const value = meterNumbersForLine(line)[0]
    if (value) return value
  }
  return null
}

function rawHasField(rawText: string, fieldCode: string): boolean {
  const escaped = fieldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\n|\\t|;|,)\\s*${escaped}(\\s|\\t|;|,)`, 'i').test(rawText)
}



function textLooksLikeZ10MeterNumberInvalid(rawText: string): boolean {
  const normalized = normalize(rawText)
  return (
    normalized.includes('FELAKTIGT MATARNUMMER') ||
    normalized.includes('FELAKTIG MATARNUMMER') ||
    normalized.includes('SAMMA MATARNUMMER') ||
    normalized.includes('METER NUMBER INVALID') ||
    normalized.includes('SAME METER NUMBER')
  )
}

function textLooksLikeConstantMissing(rawText: string): boolean {
  const normalized = normalize(rawText)
  return normalized.includes('KONSTANT SAKNAS') || normalized.includes('METER CONSTANT MISSING')
}

export function effectiveTgtTestCaseCodeForMessageRow(
  message: EdielMessageRow,
  row: EdielTgtDynamicTestDataSummary
): string {
  const rawText = [row.title, row.sourceNote, row.rawText]
    .filter(Boolean)
    .join(' ')
  const explicitCase = rawText.match(/\b(?:U\d\.\d\.\d+b?|\d\.\d\.\d+B?)\b/i)?.[0]
  if (explicitCase) return explicitCase.toUpperCase().replace(/B$/, 'B')

  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? '').toUpperCase()
  if (family === 'PRODAT' && code === 'Z10') {
    if (textLooksLikeZ10MeterNumberInvalid(rawText)) return '2.4.1'
    if (textLooksLikeConstantMissing(rawText)) return '2.4.2'
  }

  return String(row.testCaseCode ?? '').toUpperCase()
}


export type EdielTgtPayloadComparisonIssue = {
  fieldCode: string
  ercCode: string
  text: string
  expected: string | null
  actual: string | null
  referenceQualifier: string | null
  referenceNumber: string | null
  lineItemReference: string | null
}

type TgtObjectValues = {
  columnName: string
  sourceOrder: number
  fields: Record<string, string>
}

function normalizeCompare(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z]+/g, '')
    .toUpperCase()
}

function normalizeExpectedValue(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

function cavValue(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').replace(/^CAV\+/i, '').trim()
  if (!value) return null
  const parts = value.split(':').map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] ?? null : null
}

function cciCavValue(lineSegments: ReturnType<typeof parseEdifactMessageFacts>['segments'], cciCode: string): string | null {
  for (let index = 0; index < lineSegments.length; index += 1) {
    const segment = lineSegments[index]
    if (segment?.raw !== `CCI++${cciCode}`) continue
    const next = lineSegments[index + 1]
    if (!next || next.tag !== 'CAV') return null
    return cavValue(next.raw)
  }
  return null
}

function segmentFirstValue(segments: ReturnType<typeof parseEdifactMessageFacts>['segments'], prefix: string): string | null {
  const segment = segments.find((item) => item.raw.startsWith(prefix))
  if (!segment) return null
  const value = segment.raw.slice(prefix.length).trim()
  return value.length > 0 ? value.split(':')[0] ?? value : null
}

function partyIdFromNad(segments: ReturnType<typeof parseEdifactMessageFacts>['segments'], qualifier: string): string | null {
  const segment = segments.find((item) => item.raw.startsWith(`NAD+${qualifier}+`))
  const composite = segment?.elements[2] ?? ''
  const value = composite.split(':')[0]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function lineDateTimeValue(segments: ReturnType<typeof parseEdifactMessageFacts>['segments'], qualifiers: string[]): string | null {
  for (const qualifier of qualifiers) {
    const segment = segments.find((item) => item.raw.startsWith(`DTM+${qualifier}:`))
    const value = segment?.raw.replace(`DTM+${qualifier}:`, '').split(':')[0]?.trim() ?? ''
    if (value) return value
  }
  return null
}

function lineActualValue(line: ReturnType<typeof parseEdifactMessageFacts>['lineItems'][number], fieldCode: string): string | null {
  const code = fieldCode.toUpperCase()
  switch (code) {
    case '209':
    case '233':
      return line.itemId
    case '210':
      return lineDateTimeValue(line.segments, ['92', '157'])
    case '214':
      return cciCavValue(line.segments, 'Z02')
    case '217':
      return cciCavValue(line.segments, 'Z04')
    case '218':
      return cciCavValue(line.segments, 'Z16')
    case '222':
      return cciCavValue(line.segments, 'Z05')
    case '223':
      return cciCavValue(line.segments, 'Z13')
    case '224':
      return line.rffMg
    case '254':
      return cciCavValue(line.segments, 'Z02')
    case '260':
      return line.rffZ05
    case '261':
      return line.rffLi ?? segmentFirstValue(line.segments, 'RFF+ANJ:')
    case '262':
      return partyIdFromNad(line.segments, 'Z02')
    case '227':
      return partyIdFromNad(line.segments, 'UD') ?? partyIdFromNad(line.segments, 'IV')
    case '228':
    case '229':
    case '231':
    case '232':
    case '234':
    case '235':
    case '236':
    case '237':
      return line.segments.map((segment) => segment.raw).join(' ')
    default:
      return null
  }
}

function fieldErrorText(fieldCode: string, expected: string | null, actual: string | null): string {
  const code = fieldCode.toUpperCase()
  if (code === '105') return 'Anläggningen kan inte identifieras'
  if (code === '209') return 'Anläggningsid avviker från Edielportalens testdata'
  if (code === '218') return 'Antal siffror saknas eller avviker från Edielportalens testdata'
  if (code === '214') return 'Konstant saknas eller avviker från Edielportalens testdata'
  if (code === '224') return 'Mätarnummer saknas eller avviker från Edielportalens testdata'
  if (!actual) return `Fält ${fieldCode} saknas i mottaget meddelande`
  return `Fält ${fieldCode} avviker från Edielportalens testdata`
}

function issueForField(params: {
  fieldCode: string
  expected: string | null
  actual: string | null
  lineItemId: string | null
  lineItemReference: string | null
}): EdielTgtPayloadComparisonIssue {
  const ercCode = params.actual ? '42' : '41'
  return {
    fieldCode: params.fieldCode,
    ercCode,
    text: fieldErrorText(params.fieldCode, params.expected, params.actual),
    expected: params.expected,
    actual: params.actual,
    referenceQualifier: params.lineItemId ? 'Z07' : null,
    referenceNumber: params.lineItemId,
    lineItemReference: params.lineItemReference,
  }
}

function comparableFieldCodesForMessage(messageCode: string): Set<string> {
  // Only fields that are APERAK-relevant should be compared here.
  // Field 233 is an alternative facility identifier used for matching, not a separate
  // APERAK error beside 209. Field 254 is TGT/masterdata context and must not
  // generate a negative APERAK by itself.
  const common = ['209', '260', '261', '262']
  if (messageCode === 'Z06') return new Set([...common, '210', '217', '218', '222', '223'])
  if (messageCode === 'Z10') return new Set([...common, '210', '214', '217', '218', '223', '224'])
  if (messageCode === 'Z05') return new Set([...common, '210', '217', '223'])
  if (messageCode === 'Z09') return new Set([...common, '210', '217', '223'])
  if (messageCode === 'Z04') return new Set([...common, '210', '213', '214', '217', '223'])
  if (messageCode === 'Z03') return new Set([...common, '210', '213', '217', '223'])
  return new Set(common)
}

function testDataObjects(testData: EdielTgtCaseTestData | null | undefined): TgtObjectValues[] {
  if (!testData) return []
  const objects: TgtObjectValues[] = []

  for (const group of testData.groups) {
    const columns = [...group.columns].sort((a, b) => {
      const sourceOrderDiff = Number(a.sourceOrder ?? a.index) - Number(b.sourceOrder ?? b.index)
      return sourceOrderDiff !== 0 ? sourceOrderDiff : a.index - b.index
    })

    for (const column of columns) {
      const fields: Record<string, string> = {}
      for (const field of group.fields) {
        const rawValue = field.values[column.name]
        const value = normalizeExpectedValue(rawValue)
        if (!value) continue
        fields[String(field.fieldCode).toUpperCase()] = value
      }

      if (Object.keys(fields).length > 0) {
        objects.push({
          columnName: column.name,
          sourceOrder: Number(column.sourceOrder ?? column.index),
          fields,
        })
      }
    }
  }

  return objects.sort((a, b) => a.sourceOrder - b.sourceOrder)
}

function expectedFacilityIdsForObject(object: TgtObjectValues): string[] {
  return [object.fields['209'], object.fields['233']].filter((value): value is string => Boolean(value && /^735\d{15}$/.test(value)))
}

function matchExpectedObjectForLine(objects: TgtObjectValues[], lineItemId: string | null): TgtObjectValues | null {
  if (objects.length === 0) return null
  if (lineItemId) {
    const exact = objects.find((object) => expectedFacilityIdsForObject(object).some((id) => normalizeCompare(id) === normalizeCompare(lineItemId)))
    if (exact) return exact
  }
  return objects[0] ?? null
}

export function compareInboundPayloadToTgtTestData(params: {
  message: EdielMessageRow
  testData: EdielTgtCaseTestData | null | undefined
}): EdielTgtPayloadComparisonIssue[] {
  const { message, testData } = params
  if (!testData) return []

  const facts = parseEdifactMessageFacts(message.raw_payload)
  const messageCode = String(message.message_code ?? facts.messageCode ?? '').toUpperCase()
  const comparableFields = comparableFieldCodesForMessage(messageCode)
  const objects = testDataObjects(testData)
  if (objects.length === 0 || facts.lineItems.length === 0) return []

  const issues: EdielTgtPayloadComparisonIssue[] = []

  for (const line of facts.lineItems) {
    const object = matchExpectedObjectForLine(objects, line.itemId)
    if (!object) continue

    const expectedFacilities = expectedFacilityIdsForObject(object)
    if (expectedFacilities.length > 0 && line.itemId && !expectedFacilities.some((id) => normalizeCompare(id) === normalizeCompare(line.itemId))) {
      issues.push({
        fieldCode: '105',
        ercCode: '40',
        text: 'Anläggningen kan inte identifieras',
        expected: expectedFacilities[0] ?? null,
        actual: line.itemId,
        referenceQualifier: 'Z07',
        referenceNumber: line.itemId,
        lineItemReference: line.rffLi,
      })
      issues.push({
        fieldCode: '209',
        ercCode: '42',
        text: 'Anläggningsid avviker från Edielportalens testdata',
        expected: expectedFacilities[0] ?? null,
        actual: line.itemId,
        referenceQualifier: 'Z07',
        referenceNumber: line.itemId,
        lineItemReference: line.rffLi,
      })
      continue
    }

    for (const [fieldCode, expected] of Object.entries(object.fields)) {
      if (!comparableFields.has(fieldCode)) continue
      const actual = lineActualValue(line, fieldCode)
      if (!actual) {
        issues.push(issueForField({ fieldCode, expected, actual: null, lineItemId: line.itemId, lineItemReference: line.rffLi }))
        continue
      }

      const expectedComparable = normalizeCompare(expected)
      const actualComparable = normalizeCompare(actual)

      // Address/name fields are represented by whole NAD segments. Treat them as OK if
      // the expected value appears anywhere in the relevant line block.
      if (['228', '229', '231', '232', '234', '235', '236', '237'].includes(fieldCode)) {
        if (!actualComparable.includes(expectedComparable)) {
          issues.push(issueForField({ fieldCode, expected, actual, lineItemId: line.itemId, lineItemReference: line.rffLi }))
        }
        continue
      }

      if (expectedComparable !== actualComparable) {
        issues.push(issueForField({ fieldCode, expected, actual, lineItemId: line.itemId, lineItemReference: line.rffLi }))
      }
    }
  }

  const dedupeKey = (issue: EdielTgtPayloadComparisonIssue) => [
    issue.ercCode,
    issue.fieldCode,
    issue.referenceNumber ?? '',
    issue.lineItemReference ?? '',
    normalizeCompare(issue.expected),
    normalizeCompare(issue.actual),
  ].join('|')

  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = dedupeKey(issue)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
      if (payloadHasSameMeterNumber(message) || textLooksLikeZ10MeterNumberInvalid(rawText)) return '2.4.1'
      if (payloadHasMissingConstant(message) || textLooksLikeConstantMissing(rawText) || rawHasField(rawText, '214')) return '2.4.2'
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
  const rowCode = effectiveTgtTestCaseCodeForMessageRow(message, row).toUpperCase()
  const facilityMismatch = hasFacilityMismatch(message, row.parsedPayload)

  let matchingFacilities = 0
  let mismatchingFacilities = 0

  if (expectedFacilities.length > 0) {
    score += 10
    const expected = new Set(expectedFacilities)
    matchingFacilities = actualFacilities.filter((id) => expected.has(id)).length
    mismatchingFacilities = actualFacilities.filter((id) => !expected.has(id)).length

    // Correct TGT/masterdata row selection must be identity-first, but not
    // identity-only. A row whose facility matches the inbound message is a
    // better masterdata source for detail validation than an unrelated row that
    // merely produces an object mismatch. This is also the production rule:
    // validate detail fields only after the object is identified.
    score += matchingFacilities * 700
    score += mismatchingFacilities * 20
  }

  const isObjectFailureCase = rowCode === '1.3.1' || rowCode === '2.2.1' || rowCode === '3.2.1'
  const isDigitCountCase = rowCode === '2.2.2'
  const isSameMeterNumberCase = rowCode === '2.4.1'
  const isConstantCase = rowCode === '2.4.2'

  if (facilityMismatch && isObjectFailureCase && matchingFacilities === 0) {
    score += 500
  }

  // Detail-error TGT rows should win when the object is identified and the
  // inbound payload actually contains the matching detail problem. Without this
  // boost a generic positive row, or an unrelated object-mismatch row, can be
  // selected and the APERAK becomes false positive (ERC 100/OK).
  if (isDigitCountCase && payloadHasMissingDigitCount(message)) score += 650
  if (isSameMeterNumberCase && payloadHasSameMeterNumber(message)) score += 650
  if (isConstantCase && payloadHasMissingConstant(message)) score += 650

  // If row contains exact fields that match a negative scenario, prefer it over older positive rows.
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
  const text = String(rawText ?? '')
  return (
    text.includes(sourceMessageMarker(sourceMessageId)) ||
    text.includes(`GridCore source_message_id=${sourceMessageId}`) ||
    text.includes(`source_message_id=${sourceMessageId}`)
  )
}

export function findExactTgtTestDataForMessage(
  message: EdielMessageRow,
  rows: readonly EdielTgtDynamicTestDataSummary[]
): EdielTgtDynamicTestDataSummary | null {
  return rows.find((row) =>
    rawTextHasSourceMessageMarker(row.rawText, message.id) ||
    rawTextHasSourceMessageMarker(row.sourceNote, message.id)
  ) ?? null
}
