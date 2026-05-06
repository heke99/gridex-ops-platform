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
  utiltsErrCode?: string | null
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
  const mea = segmentValue(segments, 'MEA+AAZ')
  const parts = mea?.split('+') ?? []
  return parts[3]?.trim() || null
}

function buildIssue(input: UtiltsValidationIssue): UtiltsValidationIssue {
  return input
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

  const needsObjectData = ['S02', 'S03', 'E30', 'E66'].includes(code)
  if (needsObjectData && !facts.meterPointId) {
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

  if (needsObjectData && !facts.gridAreaId) {
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

  if (needsObjectData && !facts.deliveryPeriodRaw) {
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

  if (['S02', 'S03'].includes(code)) {
    if (!hasSegment(facts.rawSegments, 'STS+7')) {
      issues.push(buildIssue({
        severity: 'error',
        kind: 'functional',
        code: 'UTILTS_MISSING_REASON',
        title: 'Anledning till transaktionen saknas',
        description: 'STS+7 saknas. Detta klassas som funktionsfel för planeringsmeddelandet.',
        utiltsErrCode: code === 'S03' ? 'E49' : 'E87',
      }))
    }

    if (facts.quantities.length === 0) {
      issues.push(buildIssue({
        severity: 'error',
        kind: 'functional',
        code: 'UTILTS_MISSING_QUANTITY',
        title: 'Kvantitet saknas',
        description: 'Planeringsmeddelandet saknar QTY-rad med prognos-/andelstalvärde.',
        utiltsErrCode: code === 'S03' ? 'E49' : 'E10',
      }))
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
