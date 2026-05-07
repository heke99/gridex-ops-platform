// lib/ediel/utiltsEngine.ts

import type { EdielAckOutcome, EdielMessageRow } from '@/lib/ediel/types'
import { parseInboundUtilts, type ParsedUtiltsMessage } from '@/lib/ediel/utilts'

export type UtiltsRuntimeMessageCode =
  | 'S01'
  | 'S02'
  | 'S03'
  | 'S04'
  | 'E30'
  | 'E31'
  | 'E66'
  | 'E73'
  | 'ERR'

export type UtiltsValidationSeverity = 'error' | 'warning' | 'info'

export type UtiltsValidationIssueKind =
  | 'syntax'
  | 'application'
  | 'functional'

export type UtiltsValidationIssue = {
  severity: UtiltsValidationSeverity
  kind: UtiltsValidationIssueKind
  code: string
  title: string
  description: string
  segment?: string | null
  edielErrorCode?: string | null
  aperakErcCode?: string | null
  aperakFieldCode?: string | null
  aperakText?: string | null
  referenceQualifier?: string | null
  referenceNumber?: string | null
  lineItemReference?: string | null
  utiltsErrCode?: string | null
}

export type UtiltsAperakApplicationError = {
  ercCode: string
  fieldCode?: string | null
  text: string
  referenceQualifier?: string | null
  referenceNumber?: string | null
  lineItemReference?: string | null
}

export type UtiltsRuntimeTransaction = {
  transactionId: string | null
  meterPointId: string | null
  gridAreaId: string | null
  deliveryPeriodRaw: string | null
  deliveryPeriodFormat: string | null
  deliveryPeriodStart: string | null
  deliveryPeriodEnd: string | null
  registrationTime: string | null
  resolution: string | null
  resolutionFormat: string | null
  transactionReason: string | null
  unit: string | null
  quantities: Array<{ qualifier: string | null; value: number | null; raw: string }>
  sourceOrder: number
}

export type UtiltsRuntimeFacts = ParsedUtiltsMessage & {
  messageReference: string | null
  messageVersion: string | null
  documentReference: string | null
  interchangeReference: string | null
  market: string | null
  stage: string | null
  senderRole: string | null
  receiverRole: string | null
  subordinateRole: string | null
  meterPointId: string | null
  gridAreaId: string | null
  transactionId: string | null
  deliveryPeriodRaw: string | null
  deliveryPeriodStart: string | null
  deliveryPeriodEnd: string | null
  registrationTime: string | null
  resolution: string | null
  transactionReason: string | null
  unit: string | null
  quantities: Array<{ qualifier: string | null; value: number | null; raw: string }>
  transactions: UtiltsRuntimeTransaction[]
  references: Array<{ qualifier: string; value: string }>
  isUtiltsErr: boolean
}

export type UtiltsRuntimeValidation = {
  ok: boolean
  syntaxOk: boolean
  functionalOk: boolean
  issues: UtiltsValidationIssue[]
  classification: 'accepted' | 'syntax_rejected' | 'application_rejected' | 'functional_rejected'
}

export type UtiltsRuntimeAckPlan = {
  shouldSendContrl: boolean
  contrlOutcome: EdielAckOutcome | null
  shouldSendAperak: boolean
  aperakOutcome: EdielAckOutcome | null
  shouldSendUtiltsErr: boolean
  utiltsErrCodes: string[]
  aperakApplicationErrors: UtiltsAperakApplicationError[]
  reason: string
}

export type UtiltsRuntimeResult = {
  facts: UtiltsRuntimeFacts
  normalizedPayload: Record<string, unknown>
  validation: UtiltsRuntimeValidation
  ackPlan: UtiltsRuntimeAckPlan
}

const KNOWN_UTILTS_CODES = new Set<UtiltsRuntimeMessageCode>([
  'S01',
  'S02',
  'S03',
  'S04',
  'E30',
  'E31',
  'E66',
  'E73',
  'ERR',
])

const CURRENT_UTILTS_VERSION = 'E5SE5A'
const PREVIOUS_ACCEPTED_UTILTS_VERSIONS = new Set(['E5SE1B', 'E5SE9B'])

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function firstComponent(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.split(':')[0]?.trim() || null
}

function segmentValue(segments: readonly string[], prefix: string): string | null {
  return segments.find((segment) => segment.toUpperCase().startsWith(prefix.toUpperCase())) ?? null
}

function segmentValues(segments: readonly string[], prefix: string): string[] {
  return segments.filter((segment) => segment.toUpperCase().startsWith(prefix.toUpperCase()))
}

function element(segment: string | null | undefined, index: number): string | null {
  const value = segment?.split('+')[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function parseUnhVersion(unh: string | null): string | null {
  const composite = element(unh, 2)
  const parts = composite?.split(':') ?? []
  return parts[4]?.trim() || null
}

function parseUnhMessageReference(unh: string | null): string | null {
  return element(unh, 1)
}

function parseBgmCode(bgm: string | null): string | null {
  return firstComponent(element(bgm, 1))
}

function parseBgmReference(bgm: string | null): string | null {
  return element(bgm, 2)
}
function parseUnbInterchangeReference(unb: string | null): string | null {
  return element(unb, 5)
}

function parseMks(mks: string | null): { market: string | null; stage: string | null } {
  const market = element(mks, 1)
  const stage = firstComponent(element(mks, 2))
  return { market, stage }
}

function parseNadQualifier(segments: readonly string[], qualifier: string): string | null {
  const hit = segmentValue(segments, `NAD+${qualifier}+`) ?? segmentValue(segments, `NAD+${qualifier}`)
  return hit ? firstComponent(element(hit, 2)) ?? qualifier : null
}

function parseSimpleDateTime(raw: string | null): string | null {
  if (!raw) return null
  const compact = raw.replace(/[^0-9]/g, '')
  if (compact.length < 8) return null
  const year = compact.slice(0, 4)
  const month = compact.slice(4, 6)
  const day = compact.slice(6, 8)
  const hour = compact.slice(8, 10) || '00'
  const minute = compact.slice(10, 12) || '00'
  return `${year}-${month}-${day}T${hour}:${minute}:00`
}

function parseDtmComposite(segment: string | null): { qualifier: string | null; value: string | null; format: string | null } {
  const composite = element(segment, 1)
  const parts = composite?.split(':') ?? []
  return {
    qualifier: parts[0]?.trim() || null,
    value: parts[1]?.trim() || null,
    format: parts[2]?.trim() || null,
  }
}

function parsePeriod719(segment: string | null): { raw: string | null; start: string | null; end: string | null } {
  const dtm = parseDtmComposite(segment)
  const raw = dtm.value
  if (!raw || raw.length < 16) {
    return { raw, start: null, end: null }
  }
  const splitAt = raw.length / 2
  const startRaw = raw.slice(0, splitAt)
  const endRaw = raw.slice(splitAt)
  return {
    raw,
    start: parseSimpleDateTime(startRaw),
    end: parseSimpleDateTime(endRaw),
  }
}

function parseQuantity(segment: string): { qualifier: string | null; value: number | null; raw: string } {
  const composite = element(segment, 1)
  const parts = composite?.split(':') ?? []
  return {
    qualifier: parts[0]?.trim() || null,
    value: numberOrNull(parts[1]),
    raw: segment,
  }
}

function parseReferences(segments: readonly string[]): Array<{ qualifier: string; value: string }> {
  return segmentValues(segments, 'RFF+').flatMap((segment) => {
    const composite = element(segment, 1)
    const parts = composite?.split(':') ?? []
    const qualifier = parts[0]?.trim()
    const value = parts.slice(1).join(':').trim()
    if (!qualifier || !value) return []
    return [{ qualifier, value }]
  })
}

function referenceValue(references: readonly { qualifier: string; value: string }[], ...qualifiers: string[]): string | null {
  const normalized = qualifiers.map((qualifier) => qualifier.toUpperCase())
  return references.find((reference) => normalized.includes(reference.qualifier.toUpperCase()))?.value ?? null
}

function parseStsReason(segments: readonly string[]): string | null {
  const sts = segmentValue(segments, 'STS+7')
  const parts = sts?.split('+') ?? []
  return firstComponent(parts[3]) ?? firstComponent(parts[2])
}

function parseUnit(segments: readonly string[]): string | null {
  return parseUnitFromSegments(segments)
}

function buildIssue(input: UtiltsValidationIssue): UtiltsValidationIssue {
  return input
}

type UtiltsTransactionGroup = {
  transactionId: string | null
  segments: string[]
}

function splitTransactionGroups(segments: readonly string[]): UtiltsTransactionGroup[] {
  const groups: UtiltsTransactionGroup[] = []
  let current: UtiltsTransactionGroup | null = null

  for (const segment of segments) {
    if (segment.toUpperCase().startsWith('IDE+24')) {
      if (current) groups.push(current)
      current = {
        transactionId: firstComponent(element(segment, 2)),
        segments: [segment],
      }
      continue
    }

    if (!current) continue
    if (segment.toUpperCase().startsWith('UNT+') || segment.toUpperCase().startsWith('UNZ+')) {
      continue
    }
    current.segments.push(segment)
  }

  if (current) groups.push(current)
  if (groups.length > 0) return groups

  return [{ transactionId: null, segments: [...segments] }]
}

function groupSegmentValue(group: UtiltsTransactionGroup, prefix: string): string | null {
  return group.segments.find((segment) => segment.toUpperCase().startsWith(prefix.toUpperCase())) ?? null
}

function parseUnitFromSegments(segments: readonly string[]): string | null {
  const mea = segmentValue(segments, 'MEA+AAZ')
  const parts = mea?.split('+') ?? []
  return parts[3]?.trim() || null
}

function parseUnitFromGroup(group: UtiltsTransactionGroup): string | null {
  const mea = groupSegmentValue(group, 'MEA+AAZ')
  const parts = mea?.split('+') ?? []
  return parts[3]?.trim() || null
}

function parseLocValueFromGroup(group: UtiltsTransactionGroup, prefix: 'LOC+172' | 'LOC+239'): string | null {
  return firstComponent(element(groupSegmentValue(group, prefix), 2))
}

function parseQuantitiesFromGroup(group: UtiltsTransactionGroup): Array<{ qualifier: string | null; value: number | null; raw: string }> {
  return group.segments
    .filter((segment) => segment.toUpperCase().startsWith('QTY+'))
    .map(parseQuantity)
}

function parsePeriodFromGroup(group: UtiltsTransactionGroup): { raw: string | null; format: string | null; start: string | null; end: string | null } {
  const dtm = parseDtmComposite(groupSegmentValue(group, 'DTM+324'))
  const parsed = parsePeriod719(groupSegmentValue(group, 'DTM+324'))
  return {
    raw: dtm.value ?? parsed.raw,
    format: dtm.format,
    start: parsed.start,
    end: parsed.end,
  }
}

function parseUtiltsTransactionGroup(group: UtiltsTransactionGroup, sourceOrder: number): UtiltsRuntimeTransaction {
  const period = parsePeriodFromGroup(group)
  const resolution = parseDtmComposite(groupSegmentValue(group, 'DTM+354'))

  return {
    transactionId: transactionIssueReference(group, null),
    meterPointId: parseLocValueFromGroup(group, 'LOC+172'),
    gridAreaId: parseLocValueFromGroup(group, 'LOC+239'),
    deliveryPeriodRaw: period.raw,
    deliveryPeriodFormat: period.format,
    deliveryPeriodStart: period.start,
    deliveryPeriodEnd: period.end,
    registrationTime: parseSimpleDateTime(parseDtmComposite(groupSegmentValue(group, 'DTM+597')).value),
    resolution: resolution.value,
    resolutionFormat: resolution.format,
    transactionReason: parseStsReason(group.segments),
    unit: parseUnitFromGroup(group),
    quantities: parseQuantitiesFromGroup(group),
    sourceOrder,
  }
}

function monthsBetweenPeriod(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const startMatch = start.match(/^(\d{4})-(\d{2})-/)
  const endMatch = end.match(/^(\d{4})-(\d{2})-/)
  if (!startMatch || !endMatch) return null

  const startIndex = Number(startMatch[1]) * 12 + Number(startMatch[2])
  const endIndex = Number(endMatch[1]) * 12 + Number(endMatch[2])
  const diff = endIndex - startIndex
  return Number.isFinite(diff) && diff > 0 ? diff : null
}

function isKnownTgtUnknownMeteringPoint(meterPointId: string | null): boolean {
  // TGT U1.2.2 uses this object to force a processability error. Keep it as a
  // portal fixture rule, not as generic production master-data. In production,
  // the same E10 decision should come from the real metering point registry.
  return meterPointId === '735999888000003025'
}

function isKnownTgtUnknownGridArea(gridAreaId: string | null): boolean {
  // TGT U1.4.2 uses XYZ to force unknown metering grid area.
  return String(gridAreaId ?? '').toUpperCase() === 'XYZ'
}

function sanitizeRuntimeToken(value?: string | null, maxLength = 35): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const sanitized = trimmed
    .replace(/[ÅÄ]/gi, 'A')
    .replace(/[Ö]/gi, 'O')
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^A-Za-z0-9_.\/-]/g, '')
    .slice(0, maxLength)

  return sanitized.length > 0 ? sanitized : null
}

function transactionIssueReference(group: UtiltsTransactionGroup, fallback: string | null): string | null {
  return sanitizeRuntimeToken(group.transactionId ?? fallback, 35)
}

function aperakErrorsFromIssues(issues: readonly UtiltsValidationIssue[]): UtiltsAperakApplicationError[] {
  const errors = issues
    .filter((issue) => issue.severity === 'error' && issue.kind === 'application')
    .map((issue) => ({
      ercCode: sanitizeRuntimeToken(issue.aperakErcCode ?? '40', 12) ?? '40',
      fieldCode: sanitizeRuntimeToken(issue.aperakFieldCode ?? null, 12),
      text: issue.aperakText ?? issue.description ?? issue.title,
      referenceQualifier: sanitizeRuntimeToken(issue.referenceQualifier ?? null, 12),
      referenceNumber: sanitizeRuntimeToken(issue.referenceNumber ?? null, 35),
      lineItemReference: sanitizeRuntimeToken(issue.lineItemReference ?? issue.referenceNumber ?? null, 35),
    }))

  const seen = new Set<string>()
  return errors.filter((error) => {
    const key = `${error.ercCode}|${error.fieldCode ?? ''}|${error.text}|${error.lineItemReference ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasSegment(segments: readonly string[], prefix: string): boolean {
  return segmentValues(segments, prefix).length > 0
}

function validateUtiltsFacts(facts: UtiltsRuntimeFacts): UtiltsRuntimeValidation {
  const issues: UtiltsValidationIssue[] = []
  const code = String(facts.messageCode ?? '').toUpperCase()

  if (!facts.rawSegments.some((segment) => segment.startsWith('UNB+'))) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'syntax',
      code: 'UTILTS_MISSING_UNB',
      title: 'UNB saknas',
      description: 'Meddelandet saknar UNB-servicekuvert.',
      edielErrorCode: '7',
    }))
  }

  if (!facts.rawSegments.some((segment) => segment.startsWith('UNH+'))) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'syntax',
      code: 'UTILTS_MISSING_UNH',
      title: 'UNH saknas',
      description: 'Meddelandet saknar UNH-serviceheader.',
      edielErrorCode: '7',
    }))
  }

  if (!facts.messageCode || !KNOWN_UTILTS_CODES.has(String(facts.messageCode).toUpperCase() as UtiltsRuntimeMessageCode)) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'application',
      code: 'UTILTS_UNKNOWN_MESSAGE_CODE',
      title: 'Okänd UTILTS-funktion',
      description: `BGM-koden ${facts.messageCode ?? '(saknas)'} stöds inte av UTILTS-runtime.`,
      aperakErcCode: '41',
      aperakFieldCode: '201',
    }))
  }

  if (facts.messageVersion && facts.messageVersion !== CURRENT_UTILTS_VERSION && !PREVIOUS_ACCEPTED_UTILTS_VERSIONS.has(facts.messageVersion)) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'application',
      code: 'UTILTS_UNSUPPORTED_VERSION',
      title: 'Ej accepterad UTILTS-version',
      description: `UTILTS-version ${facts.messageVersion} är inte accepterad av runtime-registret.`,
      aperakErcCode: '41',
      aperakFieldCode: '201',
    }))
  }

  if (!facts.senderEdielId || !facts.receiverEdielId) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'application',
      code: 'UTILTS_MISSING_PARTY',
      title: 'Avsändare eller mottagare saknas',
      description: 'UNB måste innehålla teknisk avsändare och mottagare.',
      aperakErcCode: '41',
      aperakFieldCode: '206',
    }))
  }

  const needsMeteringPoint = ['S02', 'E30', 'E66'].includes(code)
  const needsGridArea = ['S02', 'S03', 'E30', 'E66'].includes(code)
  if (needsMeteringPoint && !facts.meterPointId) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'application',
      code: 'UTILTS_MISSING_METERING_POINT',
      title: 'Anläggningsid saknas',
      description: 'LOC+172 saknas eller saknar anläggningsid.',
      aperakErcCode: '41',
      aperakFieldCode: '515',
    }))
  }

  if (needsGridArea && !facts.gridAreaId) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'application',
      code: 'UTILTS_MISSING_GRID_AREA',
      title: 'Nätområdesid saknas',
      description: 'LOC+239 saknas eller saknar nätområdesid.',
      aperakErcCode: '41',
      aperakFieldCode: '508',
    }))
  }

  if (needsGridArea && !facts.deliveryPeriodRaw) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'application',
      code: 'UTILTS_MISSING_DELIVERY_PERIOD',
      title: 'Leveransperiod saknas',
      description: 'DTM+324 saknas för objektmeddelandet.',
      aperakErcCode: '41',
      aperakFieldCode: '238',
    }))
  }

  if (['S02', 'S03'].includes(code) && !hasSegment(facts.rawSegments, 'STS+7')) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'functional',
      code: 'UTILTS_MISSING_REASON',
      title: 'Anledning till transaktionen saknas',
      description: 'STS+7 saknas. Detta klassas som funktionsfel för planeringsmeddelandet.',
      utiltsErrCode: code === 'S03' ? 'E49' : 'E87',
    }))
  }

  if (code === 'S02') {
    for (const group of splitTransactionGroups(facts.rawSegments)) {
      const transactionReference = transactionIssueReference(group, facts.transactionId)
      const groupUnit = parseUnitFromGroup(group)
      const deliveryPeriod = parseDtmComposite(groupSegmentValue(group, 'DTM+324'))
      const resolution = parseDtmComposite(groupSegmentValue(group, 'DTM+354'))

      if (!groupUnit) {
        issues.push(buildIssue({
          severity: 'error',
          kind: 'application',
          code: 'UTILTS_S02_MISSING_UNIT',
          title: 'Enhet saknas',
          description: 'MEA+AAZ saknas i UTILTS-S02-transaktionen.',
          aperakErcCode: '41',
          aperakFieldCode: '264',
          aperakText: 'MANDATORY FIELD MISSING',
          referenceQualifier: 'ACW',
          referenceNumber: transactionReference,
          lineItemReference: transactionReference,
        }))
      }

      if (resolution.value && (resolution.value !== '1' || resolution.format !== '802')) {
        issues.push(buildIssue({
          severity: 'error',
          kind: 'application',
          code: 'UTILTS_S02_INVALID_RESOLUTION',
          title: 'Felaktig upplösning',
          description: `DTM+354 ska vara 1:802 för månadsupplösning i UTILTS-S02, men var ${resolution.value}:${resolution.format ?? ''}.`,
          segment: groupSegmentValue(group, 'DTM+354'),
          aperakErcCode: '42',
          aperakFieldCode: '508',
          aperakText: 'INCORRECT DATA',
          referenceQualifier: 'ACW',
          referenceNumber: transactionReference,
          lineItemReference: transactionReference,
        }))
      }

      if (deliveryPeriod.value && (deliveryPeriod.format !== '719' || !/^\d{24}$/.test(deliveryPeriod.value))) {
        issues.push(buildIssue({
          severity: 'error',
          kind: 'application',
          code: 'UTILTS_S02_INVALID_DELIVERY_PERIOD_FORMAT',
          title: 'Felaktigt tidsformat för observationsperiod',
          description: `DTM+324 ska vara periodformat 719 med start och slut, men var ${deliveryPeriod.value}:${deliveryPeriod.format ?? ''}.`,
          segment: groupSegmentValue(group, 'DTM+324'),
          aperakErcCode: '42',
          aperakFieldCode: '245',
          aperakText: 'INCORRECT DATA',
          referenceQualifier: 'ACW',
          referenceNumber: transactionReference,
          lineItemReference: transactionReference,
        }))
      }

      const groupPeriod = parsePeriodFromGroup(group)
      const expectedMonths = monthsBetweenPeriod(groupPeriod.start, groupPeriod.end)
      const actualQuantities = parseQuantitiesFromGroup(group).length
      if (expectedMonths !== null && actualQuantities > 0 && actualQuantities !== expectedMonths) {
        issues.push(buildIssue({
          severity: 'error',
          kind: 'functional',
          code: 'UTILTS_S02_OBSERVATION_COUNT_MISMATCH',
          title: 'Fel antal observationer',
          description: `Antal observationer (${actualQuantities}) matchar inte observationsperiod/upplösning (${expectedMonths}).`,
          utiltsErrCode: 'E87',
          referenceQualifier: 'TN',
          referenceNumber: transactionReference,
          lineItemReference: transactionReference,
        }))
      }

      if (isKnownTgtUnknownMeteringPoint(parseLocValueFromGroup(group, 'LOC+172'))) {
        issues.push(buildIssue({
          severity: 'error',
          kind: 'functional',
          code: 'UTILTS_S02_UNKNOWN_METERING_POINT',
          title: 'Okänd anläggning',
          description: 'Anläggningsid kunde inte identifieras.',
          utiltsErrCode: 'E10',
          referenceQualifier: 'TN',
          referenceNumber: transactionReference,
          lineItemReference: transactionReference,
        }))
      }
    }
  }

  if (code === 'S03') {
    for (const group of splitTransactionGroups(facts.rawSegments)) {
      const transactionReference = transactionIssueReference(group, facts.transactionId)
      const groupQuantities = parseQuantitiesFromGroup(group)
      const gridAreaId = parseLocValueFromGroup(group, 'LOC+239') ?? facts.gridAreaId

      if (isKnownTgtUnknownGridArea(gridAreaId)) {
        issues.push(buildIssue({
          severity: 'error',
          kind: 'functional',
          code: 'UTILTS_S03_UNKNOWN_GRID_AREA',
          title: 'Okänt nätområde',
          description: 'Nätområdesid kunde inte identifieras.',
          utiltsErrCode: 'E49',
          referenceQualifier: 'TN',
          referenceNumber: transactionReference,
          lineItemReference: transactionReference,
        }))
      }

      if (groupQuantities.length === 0) {
        issues.push(buildIssue({
          severity: 'error',
          kind: 'application',
          code: 'UTILTS_S03_MISSING_PROFILE_SHARE',
          title: 'Andelstal saknas',
          description: 'Planerad periodisk kvantitet/andelstal saknas i UTILTS-S03-transaktionen.',
          aperakErcCode: '41',
          aperakFieldCode: '515',
          aperakText: 'MANDATORY FIELD MISSING',
          referenceQualifier: 'ACW',
          referenceNumber: transactionReference,
          lineItemReference: transactionReference,
        }))
      }
    }
  }

  if (code === 'E66' && facts.quantities.length === 0) {
    issues.push(buildIssue({
      severity: 'error',
      kind: 'functional',
      code: 'UTILTS_MISSING_METER_VALUE',
      title: 'Mätvärde saknas',
      description: 'E66 saknar QTY-rad med mätvärde/mätarställning.',
      utiltsErrCode: 'E10',
    }))
  }

  const syntaxOk = !issues.some((issue) => issue.severity === 'error' && issue.kind === 'syntax')
  const hasApplicationErrors = issues.some((issue) => issue.severity === 'error' && issue.kind === 'application')
  const functionalOk = !issues.some((issue) => issue.severity === 'error' && issue.kind === 'functional')

  const classification = !syntaxOk
    ? 'syntax_rejected'
    : hasApplicationErrors
      ? 'application_rejected'
      : !functionalOk
        ? 'functional_rejected'
        : 'accepted'

  return {
    ok: classification === 'accepted',
    syntaxOk,
    functionalOk,
    issues,
    classification,
  }
}

function shouldPositiveAperakBeSent(message: EdielMessageRow, facts: UtiltsRuntimeFacts): boolean {
  if (message.environment === 'test') return true
  const bgm = segmentValue(facts.rawSegments, 'BGM+')
  const requestAck = element(bgm, 4)
  return requestAck === 'AB'
}

export function decideUtiltsRuntimeAckPlan(params: {
  message: EdielMessageRow
  facts: UtiltsRuntimeFacts
  validation: UtiltsRuntimeValidation
}): UtiltsRuntimeAckPlan {
  if (params.message.message_family !== 'UTILTS') {
    return {
      shouldSendContrl: false,
      contrlOutcome: null,
      shouldSendAperak: false,
      aperakOutcome: null,
      shouldSendUtiltsErr: false,
      utiltsErrCodes: [],
      aperakApplicationErrors: [],
      reason: 'Meddelandet är inte UTILTS.',
    }
  }

  if (params.facts.isUtiltsErr || String(params.facts.messageCode).toUpperCase() === 'ERR') {
    return {
      shouldSendContrl: true,
      contrlOutcome: 'positive',
      shouldSendAperak: false,
      aperakOutcome: null,
      shouldSendUtiltsErr: false,
      utiltsErrCodes: [],
      aperakApplicationErrors: [],
      reason: 'Inbound UTILTS-ERR ska endast syntaxkvitteras med CONTRL.',
    }
  }

  if (params.validation.classification === 'syntax_rejected') {
    return {
      shouldSendContrl: true,
      contrlOutcome: 'negative',
      shouldSendAperak: false,
      aperakOutcome: null,
      shouldSendUtiltsErr: false,
      utiltsErrCodes: [],
      aperakApplicationErrors: [],
      reason: 'EDIFACT-syntaxen kunde inte accepteras.',
    }
  }

  if (params.validation.classification === 'application_rejected') {
    return {
      shouldSendContrl: true,
      contrlOutcome: 'positive',
      shouldSendAperak: true,
      aperakOutcome: 'negative',
      shouldSendUtiltsErr: false,
      utiltsErrCodes: [],
      aperakApplicationErrors: aperakErrorsFromIssues(params.validation.issues),
      reason: 'Meddelandet är syntaktiskt läsbart men bryter mot UTILTS-anvisningen.',
    }
  }

  if (params.validation.classification === 'functional_rejected') {
    const utiltsErrCodes = Array.from(
      new Set(
        params.validation.issues
          .map((issue) => issue.utiltsErrCode)
          .filter((code): code is string => Boolean(code))
      )
    )

    return {
      shouldSendContrl: true,
      contrlOutcome: 'positive',
      shouldSendAperak: false,
      aperakOutcome: null,
      shouldSendUtiltsErr: true,
      utiltsErrCodes: utiltsErrCodes.length > 0 ? utiltsErrCodes : ['E14'],
      aperakApplicationErrors: [],
      reason: 'Meddelandet är syntaktiskt/anvisningsmässigt läsbart men innehållet kunde inte behandlas.',
    }
  }

  return {
    shouldSendContrl: true,
    contrlOutcome: 'positive',
    shouldSendAperak: shouldPositiveAperakBeSent(params.message, params.facts),
    aperakOutcome: 'positive',
    shouldSendUtiltsErr: false,
    utiltsErrCodes: [],
    aperakApplicationErrors: [],
    reason: 'UTILTS accepterades.',
  }
}

export function parseUtiltsRuntimeFacts(rawPayload: string): UtiltsRuntimeFacts {
  const parsed = parseInboundUtilts(rawPayload)
  const segments = parsed.rawSegments
  const unb = segmentValue(segments, 'UNB+')
  const unh = segmentValue(segments, 'UNH+')
  const bgm = segmentValue(segments, 'BGM+')
  const mks = parseMks(segmentValue(segments, 'MKS+'))
  const loc172 = segmentValue(segments, 'LOC+172')
  const loc239 = segmentValue(segments, 'LOC+239')
  const dtm324 = segmentValue(segments, 'DTM+324')
  const dtm597 = segmentValue(segments, 'DTM+597')
  const dtm354 = segmentValue(segments, 'DTM+354')
  const period = parsePeriod719(dtm324)
  const references = parseReferences(segments)
  const transactions = splitTransactionGroups(segments).map((group, index) => parseUtiltsTransactionGroup(group, index))
  const bgmCode = parseBgmCode(bgm)
  const normalizedCode = String(parsed.messageCode ?? bgmCode ?? '').toUpperCase()

  return {
    ...parsed,
    messageCode: (normalizedCode || parsed.messageCode) as UtiltsRuntimeMessageCode,
    messageReference: parseUnhMessageReference(unh),
    messageVersion: parseUnhVersion(unh),
    documentReference: parseBgmReference(bgm),
    interchangeReference: parseUnbInterchangeReference(unb),
    market: mks.market,
    stage: mks.stage,
    senderRole: parseNadQualifier(segments, 'MS'),
    receiverRole: parseNadQualifier(segments, 'MR'),
    subordinateRole: segmentValue(segments, 'NAD+DDQ') ? 'DDQ' : null,
    meterPointId: firstComponent(element(loc172, 2)),
    gridAreaId: firstComponent(element(loc239, 2)),
    transactionId: firstComponent(element(segmentValue(segments, 'IDE+24'), 2)) ?? referenceValue(references, 'TN'),
    deliveryPeriodRaw: period.raw,
    deliveryPeriodStart: period.start,
    deliveryPeriodEnd: period.end,
    registrationTime: parseSimpleDateTime(parseDtmComposite(dtm597).value),
    resolution: parseDtmComposite(dtm354).value,
    transactionReason: parseStsReason(segments),
    unit: parseUnit(segments),
    quantities: segmentValues(segments, 'QTY+').map(parseQuantity),
    transactions,
    references,
    isUtiltsErr:
      normalizedCode === 'ERR' ||
      String(parsed.parsedPayload.hasUtiltsErrPattern ?? '').toLowerCase() === 'true' ||
      segments.some((segment) => segment.toUpperCase().startsWith('BGM+ERR')),
  }
}

export function normalizeUtiltsRuntimePayload(facts: UtiltsRuntimeFacts, message?: EdielMessageRow | null): Record<string, unknown> {
  const firstQty = facts.quantities.find((qty) => qty.value !== null) ?? null
  const parsedPayload = facts.parsedPayload ?? {}

  return {
    ...parsedPayload,
    engine: 'utilts_runtime',
    engineVersion: '2026-05-utilts-runtime-v1',
    messageFamily: 'UTILTS',
    messageCode: facts.messageCode,
    messageVersion: facts.messageVersion,
    messageReference: facts.messageReference,
    documentReference: facts.documentReference,
    interchangeReference: facts.interchangeReference,
    applicationReference: facts.applicationReference,
    transactionReference: facts.transactionReference ?? facts.transactionId,
    externalReference: facts.externalReference ?? facts.documentReference,
    meterPointId: facts.meterPointId,
    meteringPointId: facts.meterPointId,
    gridAreaId: facts.gridAreaId,
    periodStart: facts.deliveryPeriodStart,
    periodEnd: facts.deliveryPeriodEnd,
    deliveryPeriod: facts.deliveryPeriodRaw,
    registrationTime: facts.registrationTime,
    readAt: facts.registrationTime ?? facts.deliveryPeriodEnd ?? message?.message_received_at ?? null,
    resolution: facts.resolution,
    transactionReason: facts.transactionReason,
    unit: facts.unit ?? stringOrNull(parsedPayload.unit) ?? 'KWH',
    quantity: firstQty?.value ?? numberOrNull(parsedPayload.quantity),
    quantities: facts.quantities,
    transactions: facts.transactions,
    references: facts.references,
    senderRole: facts.senderRole,
    receiverRole: facts.receiverRole,
    subordinateRole: facts.subordinateRole,
    source: 'ediel_utilts_runtime',
  }
}

export function runUtiltsRuntimeForMessage(message: EdielMessageRow): UtiltsRuntimeResult {
  const rawPayload = message.raw_payload ?? ''
  const facts = parseUtiltsRuntimeFacts(rawPayload)
  const normalizedPayload = normalizeUtiltsRuntimePayload(facts, message)
  const validation = validateUtiltsFacts(facts)
  const ackPlan = decideUtiltsRuntimeAckPlan({ message, facts, validation })

  return {
    facts,
    normalizedPayload,
    validation,
    ackPlan,
  }
}
