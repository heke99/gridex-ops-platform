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
    // ESCO permission flows. The technical UNB application reference is still
    // PRODAT, so TGT matching must use the actual business message code from
    // UNH/BGM instead of assuming only supplier/grid-owner switch tests.
    if (code === 'Z13') return ['8.1']
    if (code === 'Z14') return ['8.1', '8.2']
    if (code === 'Z15') return ['9.1', '9.2']
    if (code === 'Z18') return ['9.1']
  }

  if (family === 'UTILTS') {
    if (code === 'S02') return ['U1.1', 'U1.2']
    if (code === 'S03') return ['U1.3', 'U1.4']
    if (code === 'E66') return ['U2.1', 'U2.2']
    if (code === 'E31') return ['U2.3', 'U2.4']
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

function facilityIdsForTgtIdentity(message: EdielMessageRow, testData: EdielTgtCaseTestData | null | undefined): string[] {
  const code = String(message.message_code ?? '').toUpperCase()

  // In PRODAT Z05 TGT 3.2.1 the portal sends a bad line-item object in field 209,
  // while field 233 carries the expected/correct installation. Using 209 + 233 as
  // interchangeable identity makes the backend think the bad Z05 object is valid
  // and produces a false positive APERAK. For Z05 object validation, field 233 is
  // the authoritative expected installation when present.
  if (code === 'Z05') {
    const z05Expected = fieldValuesFromTgtTestData(testData, ['233']).filter((value) => /^735\d{15}$/.test(value))
    if (z05Expected.length > 0) return z05Expected
  }

  return facilityIdsFromTgtTestData(testData)
}

function tgtTestDataHasZ05FacilityMismatch(testData: EdielTgtCaseTestData | null | undefined): boolean {
  const sentIds = fieldValuesFromTgtTestData(testData, ['209']).filter((value) => /^735\d{15}$/.test(value))
  const expectedIds = fieldValuesFromTgtTestData(testData, ['233']).filter((value) => /^735\d{15}$/.test(value))

  return sentIds.length > 0 && expectedIds.length > 0 && sentIds.some((id) => !expectedIds.includes(id))
}

function rawTextLooksLikeZ05FacilityMismatch(rawText: string | null | undefined): boolean {
  const text = String(rawText ?? '')
  const sentIds = valuesByFieldCodeFromRawText(text, '209').filter((value) => /^735\d{15}$/.test(value))
  const expectedIds = valuesByFieldCodeFromRawText(text, '233').filter((value) => /^735\d{15}$/.test(value))

  return sentIds.length > 0 && expectedIds.length > 0 && sentIds.some((id) => !expectedIds.includes(id))
}

function rawFacilityIds(rawText: string): string[] {
  return unique(Array.from(rawText.matchAll(/735\d{15}/g)).map((match) => match[0]))
}

function messageFacilityIds(message: EdielMessageRow): string[] {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return unique(facts.lineItems.map((line) => line.itemId ?? '').filter((value) => /^735\d{15}$/.test(value)))
}

function hasFacilityMismatch(message: EdielMessageRow, testData: EdielTgtCaseTestData | null | undefined): boolean {
  const expected = new Set(facilityIdsForTgtIdentity(message, testData))
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

function rawHasField(rawText: string, fieldCode: string): boolean {
  const escaped = fieldCode.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\n|\\r|\\t|;|,)\\s*${escaped}(\\s|\\t|;|,)`, 'i').test(rawText)
}

export function tgtRawTextLooksLikeZ10MeterChangeButMissingConstant(rawText: string | null | undefined): boolean {
  const text = String(rawText ?? '')

  const hasZ10MeterChangeContext =
    rawHasField(text, '224') ||
    rawHasField(text, '225') ||
    rawHasField(text, '217') ||
    rawHasField(text, '218') ||
    rawHasField(text, '259')

  const hasConstant = rawHasField(text, '214')

  return hasZ10MeterChangeContext && !hasConstant
}

export function tgtTestDataLooksLikeConstantMissing(testData: EdielTgtCaseTestData | null | undefined): boolean {
  if (!testData) return false

  const hasZ10MeterChangeContext =
    fieldValuesFromTgtTestData(testData, ['224', '225', '217', '218', '259']).length > 0

  const hasConstant = fieldValuesFromTgtTestData(testData, ['214']).length > 0

  return hasZ10MeterChangeContext && !hasConstant
}

function normalizeTgtFieldValue(value: string | null | undefined): string {
  const tokens = String(value ?? '')
    .replace(/\([^)]*\)/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z_-]+/g, ' ')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)

  return tokens[tokens.length - 1] ?? ''
}

function valuesByFieldCodeFromRawText(rawText: string, fieldCode: string): string[] {
  const values: string[] = []
  const escaped = fieldCode.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&')
  const pattern = new RegExp(String.raw`(?:^|\n|\r|;|,)\s*${escaped}(?:[^0-9A-Za-z\n\r;,]+)([^\n\r;,]+)`, 'gi')

  for (const match of rawText.matchAll(pattern)) {
    const value = normalizeTgtFieldValue(match[1])
    if (value) values.push(value)
  }

  return unique(values)
}

export function tgtRawTextHasSameNewAndOldMeterNumber(rawText: string | null | undefined): boolean {
  const text = String(rawText ?? '')
  const newMeters = valuesByFieldCodeFromRawText(text, '224')
  const oldMeters = valuesByFieldCodeFromRawText(text, '225')

  if (newMeters.length === 0 || oldMeters.length === 0) return false
  return newMeters.some((value) => oldMeters.includes(value))
}

export function tgtTestDataHasSameNewAndOldMeterNumber(testData: EdielTgtCaseTestData | null | undefined): boolean {
  if (!testData) return false

  for (const group of testData.groups) {
    const newField = group.fields.find((field) => String(field.fieldCode).toUpperCase() === '224')
    const oldField = group.fields.find((field) => String(field.fieldCode).toUpperCase() === '225')

    if (!newField || !oldField) continue

    const columnNames = new Set([...Object.keys(newField.values), ...Object.keys(oldField.values)])

    for (const columnName of columnNames) {
      const newValue = normalizeTgtFieldValue(newField.values[columnName])
      const oldValue = normalizeTgtFieldValue(oldField.values[columnName])

      if (newValue && oldValue && newValue === oldValue) return true
    }
  }

  return false
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

function textLooksLikeZ09F(rawText: string): boolean {
  const normalized = normalize(rawText)
  return normalized.includes('Z09F') || normalized.includes('AVTAL OM TIMVARDEN') || normalized.includes('AGREEMENT HOURLY')
}

function textLooksLikeZ09G(rawText: string): boolean {
  const normalized = normalize(rawText)
  return normalized.includes('Z09G') || normalized.includes('TIMVARDEN UPPHOR') || normalized.includes('AGREEMENT ENDS')
}

function textLooksLikeZ09D(rawText: string): boolean {
  const normalized = normalize(rawText)
  return normalized.includes('Z09D') || normalized.includes('MIKROPRODUKTION') || normalized.includes('MICROPRODUCTION')
}

function textLooksLikeZ05LK(rawText: string): boolean {
  const normalized = normalize(rawText)
  return normalized.includes('Z05LK') || normalized.includes('LK')
}

function textLooksLikeUtiltsGuideError(rawText: string): boolean {
  const normalized = normalize(rawText)
  return (
    normalized.includes('ANVISNINGSFEL') ||
    normalized.includes('MANDATORY') ||
    normalized.includes('SAKNAS') ||
    normalized.includes('MISSING')
  )
}

const UTILTS_TGT_FUNCTIONAL_ERROR_CODES = new Set(['E10', 'E19', 'E49', 'E50', 'E87', 'E90', 'E98'])

function utiltsFunctionalErrorCodesInText(rawText: string): string[] {
  const normalized = normalize(rawText)
  const matches = normalized.match(/\bE\d{2}\b/g) ?? []
  return matches.filter((code) => UTILTS_TGT_FUNCTIONAL_ERROR_CODES.has(code))
}

function textLooksLikeUtiltsFunctionalError(rawText: string): boolean {
  const normalized = normalize(rawText)
  return (
    normalized.includes('FUNKTIONSFEL') ||
    normalized.includes('FUNCTIONAL') ||
    normalized.includes('PROCESS') ||
    utiltsFunctionalErrorCodesInText(rawText).length > 0
  )
}

type UtiltsTgtGroup = {
  segments: string[]
}

function splitUtiltsTgtGroups(rawText: string): UtiltsTgtGroup[] {
  const segments = parseEdifactMessageFacts(rawText).rawSegments
  const groups: UtiltsTgtGroup[] = []
  let current: UtiltsTgtGroup | null = null

  for (const segment of segments) {
    const upper = segment.toUpperCase()

    if (upper.startsWith('IDE+24')) {
      if (current) groups.push(current)
      current = { segments: [segment] }
      continue
    }

    if (!current) continue
    if (upper.startsWith('UNT+') || upper.startsWith('UNZ+')) continue
    current.segments.push(segment)
  }

  if (current) groups.push(current)
  return groups.length > 0 ? groups : [{ segments }]
}

function utiltsTgtElement(segment: string | null | undefined, index: number): string | null {
  const value = String(segment ?? '').split('+')[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function utiltsTgtFirstComponent(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const first = raw.split(':')[0]?.trim() ?? ''
  return first.length > 0 ? first : null
}

function utiltsTgtQuantityQualifiers(group: UtiltsTgtGroup): string[] {
  return group.segments
    .filter((segment) => segment.toUpperCase().startsWith('QTY+'))
    .map((segment) => utiltsTgtFirstComponent(utiltsTgtElement(segment, 1)) ?? '')
    .filter(Boolean)
    .map((qualifier) => qualifier.toUpperCase())
}

function utiltsTgtGroupHasMeterNumber(group: UtiltsTgtGroup): boolean {
  return group.segments.some((segment) => /(^|[+:])M-[A-Z0-9-]+($|[+:])/.test(segment.toUpperCase()))
}

function utiltsTgtGroupHasMeterReading(group: UtiltsTgtGroup): boolean {
  const qualifiers = utiltsTgtQuantityQualifiers(group)
  return qualifiers.some((qualifier) => ['101', '203', '204'].includes(qualifier))
}

function utiltsTgtGroupHasEnergyQuantity(group: UtiltsTgtGroup): boolean {
  return utiltsTgtQuantityQualifiers(group).includes('136')
}

function utiltsTgtGroupResolution(group: UtiltsTgtGroup): string | null {
  const segment = group.segments.find((item) => item.toUpperCase().startsWith('DTM+354')) ?? null
  const composite = utiltsTgtElement(segment, 1)
  const parts = composite?.split(':') ?? []

  // DTM+354 is shaped as DTM+354:<resolution>:<format>. The first component
  // is the qualifier (354), while the required interval value is the second
  // component (15/60). Returning the qualifier made quarter/hour E66 groups look
  // non-interval, so U2.2.2 could slip through as positive APERAK.
  return parts[1]?.trim() || null
}

function utiltsTgtSegmentHasRealRegistrationTime(segment: string): boolean {
  const upper = segment.toUpperCase().trim()
  if (!upper.startsWith('DTM+597')) return false

  const composite = utiltsTgtElement(segment, 1)
  const value = utiltsTgtFirstComponent(composite)

  // DTM+597 by itself, DTM+597:, DTM+597:? or other placeholders do not
  // contain the mandatory registration timestamp. For U2.2.2 the qualifier
  // can exist while the actual timestamp is still missing.
  if (!value || value.includes('?')) return false

  return /^(\d{8}|\d{10}|\d{12}|\d{14})$/.test(value)
}

function utiltsTgtGroupHasRegistrationTime(group: UtiltsTgtGroup): boolean {
  return group.segments.some((segment) => utiltsTgtSegmentHasRealRegistrationTime(segment))
}

function utiltsTgtGroupIsIntervalValueGroup(group: UtiltsTgtGroup): boolean {
  const resolution = utiltsTgtGroupResolution(group)
  return resolution === '15' || resolution === '60'
}

function rawLooksLikeUtiltsE66GuideSchError(rawText: string): boolean {
  const groups = splitUtiltsTgtGroups(rawText)
  if (groups.length === 0) return false

  return groups.some((group) => {
    if (utiltsTgtGroupIsIntervalValueGroup(group)) return false

    const hasEnergy = utiltsTgtGroupHasEnergyQuantity(group)
    const missingMeterNumberForReading = !utiltsTgtGroupHasMeterNumber(group) && utiltsTgtGroupHasMeterReading(group)
    const missingMeterReadingForEnergy = hasEnergy && !utiltsTgtGroupHasMeterReading(group)

    return missingMeterNumberForReading || missingMeterReadingForEnergy
  })
}

function rawLooksLikeUtiltsE66QuarterGuideError(rawText: string): boolean {
  const groups = splitUtiltsTgtGroups(rawText)
  return groups.some((group) => utiltsTgtGroupIsIntervalValueGroup(group) && !utiltsTgtGroupHasRegistrationTime(group))
}

function textLooksLikeUtiltsE66QuarterGuideError(rawText: string): boolean {
  const normalized = normalize(rawText)

  // Important for U2.1.5: GridCore can receive validation metadata that mentions
  // field 512 even when Edielportalen expects the positive quarter-energy case.
  // Do not classify E66-T as U2.2.2 from a bare field number/code-list mention.
  // Only explicit guide-error wording or the raw inbound EDIFACT structure may
  // move the message to the negative APERAK path.
  return (
    normalized.includes('REGISTRERINGSTIDPUNKT SAKNAS') ||
    normalized.includes('REGISTRATION TIME MISSING') ||
    rawLooksLikeUtiltsE66QuarterGuideError(rawText)
  )
}

function textLooksLikeUtiltsE66FunctionalMultiError(rawText: string): boolean {
  const normalized = normalize(rawText)
  return (
    normalized.includes('88 VARDEN') ||
    normalized.includes('88 VALUES') ||
    normalized.includes('MINUSTECKEN') ||
    normalized.includes('NEGATIVE') ||
    normalized.includes('STATUS SAKNAT') ||
    normalized.includes('E98') ||
    normalized.includes('E90')
  )
}

function textLooksLikeUtiltsE66FunctionalSchError(rawText: string): boolean {
  const normalized = normalize(rawText)
  return (
    normalized.includes('MATARSTALLNING STAMMER INTE') ||
    normalized.includes('METER READING') ||
    normalized.includes('REGISTRERINGSTIDPUNKT TIDIGARE') ||
    normalized.includes('E19') ||
    normalized.includes('E50')
  )
}

function utiltsTgtGroupHasNegativeFinalShare(group: UtiltsTgtGroup): boolean {
  return group.segments.some((segment) => {
    if (!segment.toUpperCase().startsWith('QTY+136:')) return false
    const value = utiltsTgtFirstComponent(utiltsTgtElement(segment, 1))
    return value !== null && Number(value.replace(',', '.')) < 0
  })
}

function rawLooksLikeUtiltsE31SchGuideError(rawText: string): boolean {
  const groups = splitUtiltsTgtGroups(rawText)
  return groups.some((group) => utiltsTgtGroupHasNegativeFinalShare(group))
}

function textLooksLikeUtiltsE31SchGuideError(rawText: string): boolean {
  const normalized = normalize(rawText)
  return (
    normalized.includes('NEGATIVT SLUTLIGT ANDELSTAL') ||
    normalized.includes('NEGATIVT ANDELSTAL') ||
    normalized.includes('NEGATIVE FINAL SHARE') ||
    rawLooksLikeUtiltsE31SchGuideError(rawText)
  )
}

function utiltsTgtGroupGridArea(group: UtiltsTgtGroup): string | null {
  const hit = group.segments.find((segment) => segment.toUpperCase().startsWith('LOC+239+')) ?? null
  return utiltsTgtFirstComponent(utiltsTgtElement(hit, 2))
}

function rawLooksLikeUtiltsE31SchFunctionalError(rawText: string): boolean {
  const groups = splitUtiltsTgtGroups(rawText)
  return groups.some((group) => String(utiltsTgtGroupGridArea(group) ?? '').toUpperCase() === 'XYZ')
}

function textLooksLikeUtiltsE31SchFunctionalError(rawText: string): boolean {
  const normalized = normalize(rawText)
  return (
    normalized.includes('FUNKTIONSFEL') ||
    normalized.includes('FUNCTIONAL') ||
    normalized.includes('OKANT NATOMRADE') ||
    normalized.includes('UNKNOWN GRID AREA') ||
    normalized.includes('FEL ANTAL') ||
    normalized.includes('OBSERVATION COUNT') ||
    normalized.includes('E49') ||
    normalized.includes('E87') ||
    rawLooksLikeUtiltsE31SchFunctionalError(rawText)
  )
}

export function effectiveTgtTestCaseCodeForMessageRow(
  message: EdielMessageRow,
  row: EdielTgtDynamicTestDataSummary
): string {
  const rawText = [row.title, row.sourceNote, row.rawText].filter(Boolean).join(' ')
  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? '').toUpperCase()

  if (family === 'PRODAT' && code === 'Z10') {
    if (textLooksLikeZ10MeterNumberInvalid(rawText) || tgtRawTextHasSameNewAndOldMeterNumber(rawText)) return '2.4.1'
    if (textLooksLikeConstantMissing(rawText) || tgtRawTextLooksLikeZ10MeterChangeButMissingConstant(rawText)) return '2.4.2'
  }

  const explicitCase = rawText.match(/\b(?:U\d\.\d\.\d+b?|\d\.\d\.\d+B?)\b/i)?.[0]
  if (explicitCase) return explicitCase.toUpperCase().replace(/B$/, 'B')

  if (family === 'PRODAT' && code === 'Z09') {
    if (textLooksLikeZ09D(rawText)) return '2.5.3'
    if (textLooksLikeZ09G(rawText)) return '2.5.2'
    if (textLooksLikeZ09F(rawText)) return '2.5.1'
  }

  if (family === 'PRODAT' && code === 'Z05') {
    if (rawTextLooksLikeZ05FacilityMismatch(rawText) || tgtTestDataHasZ05FacilityMismatch(row.parsedPayload)) return '3.2.1'
    if (textLooksLikeZ05LK(rawText)) return '3.1.2'
  }

  if (family === 'UTILTS') {
    return inferTgtTestCaseCodeForInboundTestData({ message, rawText, fallback: row.testCaseCode })
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

function expectedFacilityIdsForObject(object: TgtObjectValues, messageCode?: string | null): string[] {
  const code = String(messageCode ?? '').toUpperCase()

  if (code === 'Z05' && object.fields['233'] && /^735\d{15}$/.test(object.fields['233'])) {
    return [object.fields['233']]
  }

  return [object.fields['209'], object.fields['233']].filter((value): value is string => Boolean(value && /^735\d{15}$/.test(value)))
}

function matchExpectedObjectForLine(objects: TgtObjectValues[], lineItemId: string | null, messageCode?: string | null): TgtObjectValues | null {
  if (objects.length === 0) return null

  if (lineItemId) {
    const exact = objects.find((object) => expectedFacilityIdsForObject(object, messageCode).some((id) => normalizeCompare(id) === normalizeCompare(lineItemId)))
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
    const object = matchExpectedObjectForLine(objects, line.itemId, messageCode)
    if (!object) continue

    const expectedFacilities = expectedFacilityIdsForObject(object, messageCode)

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

  const dedupeKey = (issue: EdielTgtPayloadComparisonIssue) =>
    [
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


function utiltsApplicationReference(message: EdielMessageRow, rawText: string): string {
  return [
    message.application_reference,
    message.raw_payload,
    rawText,
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
}

function looksLikePositiveUtiltsE66QuarterEnergyCase(message: EdielMessageRow, rawText: string): boolean {
  const text = utiltsApplicationReference(message, rawText)
  const normalized = normalize(rawText)

  if (!text.includes('23-DDQ-E66-T')) return false

  // Explicit negative TGT markers must still win. This keeps U2.2.2/U2.2.4
  // available when imported testdata or portal text names the negative case.
  if (/\bU2\.2\./i.test(rawText)) return false
  if (normalized.includes('ANVISNINGSFEL') || normalized.includes('FUNKTIONSFEL')) return false
  if (normalized.includes('REGISTRERINGSTIDPUNKT SAKNAS') || normalized.includes('REGISTRATION TIME MISSING')) return false
  if (textLooksLikeUtiltsE66FunctionalMultiError(rawText) || textLooksLikeUtiltsE66FunctionalSchError(rawText)) return false

  // Quarter/timed E66 can be a positive U2.1 case, but not when the actual
  // inbound UTILTS structure is missing the required registration timestamp.
  // This keeps U2.1.5 positive while allowing U2.2.2 to become negative
  // APERAK based on payload structure rather than hardcoded test ids.
  if (rawLooksLikeUtiltsE66QuarterGuideError(rawText)) return false

  return true
}

function shouldPreferPositiveUtiltsE66QuarterTgtCase(message: EdielMessageRow, rawText: string): boolean {
  if (!looksLikePositiveUtiltsE66QuarterEnergyCase(message, rawText)) return false

  // Do not let GridCore's own saved validation_report/failure_reason turn a
  // portal-positive E66-T into U2.2.2. In the TGT flow, explicit negative
  // testdata/case markers decide guide-error tests; a generic local 512
  // finding is not enough because correct quarter-energy cases can contain the
  // same local signal.
  const contextWithoutLocalValidation = [
    message.raw_payload,
    message.application_reference,
    message.external_reference,
    message.transaction_reference,
    message.correlation_reference,
    message.original_transaction_id,
    message.original_message_code,
    JSON.stringify(message.parsed_payload ?? {}),
  ]
    .filter(Boolean)
    .join(' ')

  const normalizedContext = normalize(contextWithoutLocalValidation)
  if (/\bU2\.2\./i.test(contextWithoutLocalValidation)) return false
  if (normalizedContext.includes('ANVISNINGSFEL') || normalizedContext.includes('FUNKTIONSFEL')) return false
  if (normalizedContext.includes('REGISTRERINGSTIDPUNKT SAKNAS') || normalizedContext.includes('REGISTRATION TIME MISSING')) return false

  return true
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

  if (family === 'PRODAT' && code === 'Z10') {
    if (textLooksLikeZ10MeterNumberInvalid(rawText) || tgtRawTextHasSameNewAndOldMeterNumber(rawText)) return '2.4.1'
    if (textLooksLikeConstantMissing(rawText) || tgtRawTextLooksLikeZ10MeterChangeButMissingConstant(rawText)) return '2.4.2'
  }

  if (explicit && explicit.toLowerCase() !== 'auto' && tgtCaseCodeMatchesMessage(message, explicit)) {
    return explicit.toUpperCase()
  }

  const explicitCase = rawText.match(/\b(?:U\d\.\d\.\d+b?|\d\.\d\.\d+B?)\b/i)?.[0]
  if (explicitCase && tgtCaseCodeMatchesMessage(message, explicitCase)) {
    return explicitCase.toUpperCase().replace(/B$/, 'B')
  }

  if (family === 'PRODAT') {
    if (code === 'Z06') {
      if (hasRawFacilityMismatch(message, rawText)) return '2.2.1'
      if (payloadHasMissingDigitCount(message) || rawHasField(rawText, '218')) return '2.2.2'
      if (text.includes('Z06G')) return '2.1.3'
      return '2.1.1'
    }

    if (code === 'Z10') {
      if (payloadHasSameMeterNumber(message) || textLooksLikeZ10MeterNumberInvalid(rawText) || tgtRawTextHasSameNewAndOldMeterNumber(rawText)) return '2.4.1'
      if (payloadHasMissingConstant(message) || textLooksLikeConstantMissing(rawText) || tgtRawTextLooksLikeZ10MeterChangeButMissingConstant(rawText)) return '2.4.2'
      if (hasRawFacilityMismatch(message, rawText)) return '2.4.1'
      return '2.3.1'
    }

    if (code === 'Z05') {
      if (hasRawFacilityMismatch(message, rawText)) return '3.2.1'
      return '3.1.1'
    }

    if (code === 'Z09') {
      if (textLooksLikeZ09D(rawText)) return '2.5.3'
      if (textLooksLikeZ09G(rawText)) return '2.5.2'
      if (textLooksLikeZ09F(rawText)) return '2.5.1'
      return '2.5.1'
    }

    if (code === 'Z14') {
      if (/\b8\.2\.1\b/i.test(rawText)) return '8.2.1'
      return '8.1.1'
    }

    if (code === 'Z15') {
      if (/\b9\.2\.1\b/i.test(rawText) || rawText.includes('Z75') || rawText.includes('Z79')) return '9.2.1'
      return '9.1.1'
    }

    if (code === 'Z04') return '1.4.3'
    if (code === 'Z03') return '1.3.1'
  }

  if (family === 'UTILTS') {
    if (code === 'S02') {
      if (textLooksLikeUtiltsFunctionalError(rawText)) return /\bU1\.2\.2B\b/i.test(rawText) ? 'U1.2.2B' : 'U1.2.2'
      if (textLooksLikeUtiltsGuideError(rawText)) return /\bU1\.2\.1B\b/i.test(rawText) ? 'U1.2.1B' : 'U1.2.1'
      return 'U1.1.1'
    }

    if (code === 'S03') {
      if (textLooksLikeUtiltsFunctionalError(rawText)) return 'U1.4.2'
      if (textLooksLikeUtiltsGuideError(rawText)) return 'U1.4.1'
      return /\bU1\.3\.1B\b/i.test(rawText) ? 'U1.3.1B' : 'U1.3.1'
    }

    if (code === 'E66') {
      if (textLooksLikeUtiltsE66QuarterGuideError(rawText)) return 'U2.2.2'

      if (shouldPreferPositiveUtiltsE66QuarterTgtCase(message, rawText)) return 'U2.1.1'

      if (textLooksLikeUtiltsFunctionalError(rawText)) {
        if (textLooksLikeUtiltsE66FunctionalMultiError(rawText)) return /\bU2\.2\.4B\b/i.test(rawText) ? 'U2.2.4B' : 'U2.2.4'
        if (textLooksLikeUtiltsE66FunctionalSchError(rawText)) return /\bU2\.2\.3B\b/i.test(rawText) ? 'U2.2.3B' : 'U2.2.3'
        return /\bU2\.2\.3B\b/i.test(rawText) ? 'U2.2.3B' : 'U2.2.3'
      }

      if (!looksLikePositiveUtiltsE66QuarterEnergyCase(message, rawText) && textLooksLikeUtiltsE66QuarterGuideError(rawText)) return 'U2.2.2'

      if (rawLooksLikeUtiltsE66GuideSchError(rawText) || textLooksLikeUtiltsGuideError(rawText)) {
        return /\bU2\.2\.1B\b/i.test(rawText) ? 'U2.2.1B' : 'U2.2.1'
      }

      return 'U2.1.1'
    }

    if (code === 'E31') {
      if (textLooksLikeUtiltsE31SchFunctionalError(rawText)) return 'U2.4.3'
      if (textLooksLikeUtiltsE31SchGuideError(rawText) || textLooksLikeUtiltsGuideError(rawText)) return 'U2.4.1'
      return 'U2.3.2'
    }
  }

  return messageCodePrefixesForTgtAutoMatch(message)[0] ? `${messageCodePrefixesForTgtAutoMatch(message)[0]}.1` : 'AUTO'
}

function tgtCaseCodeMatchesMessage(message: EdielMessageRow, testCaseCode: string | null | undefined): boolean {
  const code = String(testCaseCode ?? '').toUpperCase()

  if (!code || code === 'AUTO') return true

  const prefixes = messageCodePrefixesForTgtAutoMatch(message)

  if (prefixes.length === 0) return true

  return prefixes.some((prefix) => code === prefix || code.startsWith(`${prefix}.`) || code.startsWith(`${prefix}B`))
}

export function scoreTgtTestDataForMessage(message: EdielMessageRow, row: EdielTgtDynamicTestDataSummary): number {
  const family = String(message.message_family ?? '').toUpperCase()
  const suite = family === 'UTILTS' ? 'UTILTS' : family === 'PRODAT' ? 'PRODAT' : null

  if (!suite || row.testSuite !== suite) return -1

  const prefixes = messageCodePrefixesForTgtAutoMatch(message)
  const text = textForTgtAutoMatch(message)
  let score = 0

  if (prefixes.some((prefix) => row.testCaseCode === prefix || row.testCaseCode.startsWith(`${prefix}.`) || row.testCaseCode.startsWith(`${prefix}b`))) {
    score += 20
  }

  if (text.includes(String(row.testCaseCode).toUpperCase())) score += 40

  const expectedFacilities = facilityIdsForTgtIdentity(message, row.parsedPayload)
  const actualFacilities = messageFacilityIds(message)
  const rowCode = effectiveTgtTestCaseCodeForMessageRow(message, row).toUpperCase()

  if (!tgtCaseCodeMatchesMessage(message, rowCode)) return -1

  const facilityMismatch = hasFacilityMismatch(message, row.parsedPayload)

  let matchingFacilities = 0
  let mismatchingFacilities = 0

  if (expectedFacilities.length > 0) {
    score += 10

    const expected = new Set(expectedFacilities)

    matchingFacilities = actualFacilities.filter((id) => expected.has(id)).length
    mismatchingFacilities = actualFacilities.filter((id) => !expected.has(id)).length

    score += matchingFacilities * 700
    score += mismatchingFacilities * 20
  }

  const isObjectFailureCase = rowCode === '1.3.1' || rowCode === '2.2.1' || rowCode === '3.2.1'
  const isDigitCountCase = rowCode === '2.2.2'
  const rowText = [row.title, row.sourceNote, row.rawText].filter(Boolean).join(' ')
  const isSameMeterNumberCase = rowCode === '2.4.1'
  const isConstantCase = rowCode === '2.4.2'

  const rowLooksLikeSameMeterNumber =
    textLooksLikeZ10MeterNumberInvalid(rowText) ||
    tgtRawTextHasSameNewAndOldMeterNumber(rowText) ||
    tgtTestDataHasSameNewAndOldMeterNumber(row.parsedPayload)

  const rowLooksLikeConstantMissing =
    textLooksLikeConstantMissing(rowText) ||
    tgtRawTextLooksLikeZ10MeterChangeButMissingConstant(rowText) ||
    tgtTestDataLooksLikeConstantMissing(row.parsedPayload)

  const isKnownPositiveProdatCase = ['2.3.1', '2.3.2', '2.5.1', '2.5.2', '2.5.3', '3.1.1', '3.1.2'].includes(rowCode)
  const rowLooksLikeZ05FacilityMismatch =
    String(message.message_family ?? '').toUpperCase() === 'PRODAT' &&
    String(message.message_code ?? '').toUpperCase() === 'Z05' &&
    (rawTextLooksLikeZ05FacilityMismatch(rowText) || tgtTestDataHasZ05FacilityMismatch(row.parsedPayload))

  if (facilityMismatch && isObjectFailureCase && matchingFacilities === 0) {
    score += 500
  }

  if (rowCode === '3.2.1' && rowLooksLikeZ05FacilityMismatch) {
    score += 900
  }

  if (isKnownPositiveProdatCase && rowLooksLikeZ05FacilityMismatch) {
    score -= 900
  }

  if (isKnownPositiveProdatCase && !facilityMismatch && matchingFacilities > 0 && !rowLooksLikeSameMeterNumber && !rowLooksLikeConstantMissing) {
    score += 250
  }

  if (isDigitCountCase && payloadHasMissingDigitCount(message)) score += 650
  if (isSameMeterNumberCase && (payloadHasSameMeterNumber(message) || rowLooksLikeSameMeterNumber)) score += 900
  if (isConstantCase && (payloadHasMissingConstant(message) || rowLooksLikeConstantMissing)) score += 850

  if (String(message.message_family ?? '').toUpperCase() === 'PRODAT' && String(message.message_code ?? '').toUpperCase() === 'Z10') {
    if (isDigitCountCase && rowLooksLikeSameMeterNumber) score -= 800
    if (isKnownPositiveProdatCase && (rowLooksLikeSameMeterNumber || rowLooksLikeConstantMissing)) score -= 500
  }

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
  const markedRows = rows.filter((row) =>
    rawTextHasSourceMessageMarker(row.rawText, message.id) ||
    rawTextHasSourceMessageMarker(row.sourceNote, message.id)
  )

  const scoredMarkedRows = markedRows
    .map((row) => ({ row, score: scoreTgtTestDataForMessage(message, row) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score

      if (scoreDiff !== 0) return scoreDiff

      return String(b.row.updatedAt).localeCompare(String(a.row.updatedAt))
    })

  return scoredMarkedRows[0]?.row ?? null
}