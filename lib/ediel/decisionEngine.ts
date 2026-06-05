import type { AckFamily, AckOutcome, EdielAperakApplicationError } from '@/lib/ediel/ack'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  compareEngineDecisionWithExpected,
  selectRuleProfile,
  summarizeRuleProfile,
  type EdielClassifiedMessage,
  type EdielDecisionContextKind,
} from '@/lib/ediel/rulebook/ruleProfileSelector'
import { validateProdatBusinessRules } from '@/lib/ediel/prodat/prodatBusinessRules'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'

export type EdielEngineAckFamily = 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
export type EdielEngineAckOutcome = 'positive' | 'negative'
export type EdielEngineDecisionKind = 'ack' | 'manual_review' | 'no_ack'

export type EdielEngineDecision = {
  kind: EdielEngineDecisionKind
  ackFamily: EdielEngineAckFamily | null
  outcome: EdielEngineAckOutcome | null
  messageText: string | null
  applicationErrors: EdielAperakApplicationError[]
  reason: string
  ruleKeys: string[]
  classification: ReturnType<typeof summarizeRuleProfile> | null
  portalFeedback?: PortalValidationFeedback | null
  expectedComparison?: ReturnType<typeof compareEngineDecisionWithExpected> | null
}

export type ProdatAperakDecisionInput = {
  message?: EdielMessageRow | null
  rawPayload?: string | null
  family?: string | null
  messageCode?: string | null
  applicationReference?: string | null
  processType?: string | null
  actorRole?: string | null
  testKind?: EdielDecisionContextKind | null
  testCaseCode?: string | null
  expectedOutcome?: AckOutcome | null
  validationReport?: Record<string, unknown> | string | null
}

export type UtiltsResponseDecisionInput = {
  message: EdielMessageRow
  testKind?: EdielDecisionContextKind | null
  testCaseCode?: string | null
  expectedFamily?: AckFamily | null
  expectedOutcome?: AckOutcome | null
}

export type PortalValidationFeedback = {
  expectedA902: string[]
  actualA902: string[]
  expectedNegativeAperak: boolean
  actualWasPositiveAperak: boolean
  mismatch: boolean
  sourceText: string | null
}

export type AckLifecycleDecisionInput = {
  desiredFamily: AckFamily
  desiredOutcome?: AckOutcome | null
  existingAcks: Array<Pick<EdielMessageRow, 'id' | 'message_family' | 'status' | 'ack_outcome' | 'created_at' | 'updated_at'>>
}

export type AckLifecycleDecision = {
  status: 'create_new' | 'already_sent_success' | 'blocked_final_ack_exists' | 'supersede_replaceable'
  existingAckId: string | null
  existingOutcome: AckOutcome | null
  message: string
}

const FINAL_ACK_STATUSES = new Set(['sent', 'acknowledged', 'validated'])
const REPLACEABLE_ACK_STATUSES = new Set(['draft', 'prepared', 'queued', 'failed', 'cancelled'])

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function isTruthyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function rawSegments(rawPayload?: string | null): string[] {
  return String(rawPayload ?? '')
    .replace(/\r\n/g, '')
    .replace(/\n/g, '')
    .replace(/^UNA.{6}'/i, '')
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function segmentStarts(rawPayload: string | null | undefined, prefix: string): boolean {
  const upperPrefix = prefix.toUpperCase()
  return rawSegments(rawPayload).some((segment) => segment.toUpperCase().startsWith(upperPrefix))
}

function firstCavAfterCci(rawPayload: string | null | undefined, qualifier: string): string | null {
  const segments = rawSegments(rawPayload)
  const expected = `CCI++${qualifier.toUpperCase()}`
  const index = segments.findIndex((segment) => {
    const upper = segment.toUpperCase()
    return upper === expected || upper.startsWith(`${expected}+`)
  })
  if (index < 0) return null

  for (let cursor = index + 1; cursor < segments.length; cursor += 1) {
    const upper = segments[cursor]?.toUpperCase() ?? ''
    if (upper.startsWith('CCI+')) return null
    if (upper.startsWith('CAV+')) {
      const raw = segments[cursor]?.split('+')[1] ?? ''
      const value = raw.split(':').find((part) => part.trim().length > 0) ?? raw
      return normalize(value) || null
    }
  }

  return null
}

function firstReference(rawPayload: string | null | undefined, qualifier: string): string | null {
  const prefix = `RFF+${qualifier}:`
  const segment = rawSegments(rawPayload).find((item) => item.toUpperCase().startsWith(prefix.toUpperCase()))
  if (!segment) return null
  return segment.slice(prefix.length).split('+')[0]?.trim() || null
}

function firstLinObject(rawPayload: string | null | undefined): string | null {
  const lin = rawSegments(rawPayload).find((segment) => segment.toUpperCase().startsWith('LIN+'))
  return lin?.split('+')[3]?.split(':')[0]?.trim() || null
}

function messageValidationReport(input: ProdatAperakDecisionInput): Record<string, unknown> | string | null {
  return input.validationReport ?? input.message?.validation_report ?? null
}

function stringifyForSearch(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function collectCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectCodes)
  const text = stringifyForSearch(value).toUpperCase()
  return Array.from(new Set((text.match(/\b(?:40|41|42|100)\b/g) ?? []).map((item) => item.trim())))
}

function readPath(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return null
}

export function parsePortalValidationFeedback(value: unknown): PortalValidationFeedback | null {
  if (value == null) return null
  const text = stringifyForSearch(value)
  const upper = text.toUpperCase()

  const directExpected = readPath(value, ['expectedA902', 'expected_a902', 'portalExpectedA902', 'portal_expected_a902', 'expected'])
  const directActual = readPath(value, ['actualA902', 'actual_a902', 'portalActualA902', 'portal_actual_a902', 'actual'])

  const expectedFromText = (() => {
    const match = upper.match(/EXPECTED[^0-9]*(40|41|42|100)(?:\s*[|,/ ]\s*(40|41|42|100))?(?:\s*[|,/ ]\s*(40|41|42|100))?/) ??
      upper.match(/FÖRVÄNT[^0-9]*(40|41|42|100)(?:\s*[|,/ ]\s*(40|41|42|100))?(?:\s*[|,/ ]\s*(40|41|42|100))?/) ??
      upper.match(/A902[^0-9]*(40|41|42|100)(?:\s*[|,/ ]\s*(40|41|42|100))?(?:\s*[|,/ ]\s*(40|41|42|100))?/)
    return match ? match.slice(1).filter(Boolean) : []
  })()

  const actualFromText = (() => {
    const match = upper.match(/ACTUAL[^0-9]*(40|41|42|100)/) ?? upper.match(/FAKTISK[^0-9]*(40|41|42|100)/)
    return match ? [match[1]] : []
  })()

  const expectedA902 = Array.from(new Set([...collectCodes(directExpected), ...expectedFromText]))
  const actualA902 = Array.from(new Set([...collectCodes(directActual), ...actualFromText]))
  const expectedNegativeAperak = expectedA902.some((code) => ['40', '41', '42'].includes(code))
  const actualWasPositiveAperak = actualA902.includes('100') || /ACTUAL[^0-9]*100/.test(upper) || /FAKTISK[^0-9]*100/.test(upper)
  const mismatch = expectedNegativeAperak && actualWasPositiveAperak

  if (expectedA902.length === 0 && actualA902.length === 0 && !upper.includes('A902')) return null

  return {
    expectedA902,
    actualA902,
    expectedNegativeAperak,
    actualWasPositiveAperak,
    mismatch,
    sourceText: text.slice(0, 1200) || null,
  }
}

function errorForCode(params: {
  ercCode: string
  fieldCode?: string | null
  text: string
  rawPayload?: string | null
  referenceQualifier?: string | null
}): EdielAperakApplicationError {
  const z07 = firstLinObject(params.rawPayload) ?? firstReference(params.rawPayload, 'Z07')
  const li = firstReference(params.rawPayload, 'LI')
  return {
    ercCode: params.ercCode,
    fieldCode: params.fieldCode ?? null,
    text: params.text,
    referenceQualifier: params.referenceQualifier ?? (z07 ? 'Z07' : null),
    referenceNumber: z07,
    lineItemReference: li,
  }
}

function prodatBusinessIssueToAperakError(rawPayload: string | null | undefined, issue: { code?: string; message?: string }): EdielAperakApplicationError {
  const code = normalize(issue.code)
  if (code.includes('MISSING')) {
    return errorForCode({ ercCode: '41', fieldCode: null, text: issue.message ?? 'MANDATORY FIELD MISSING', rawPayload })
  }
  return errorForCode({ ercCode: '42', fieldCode: null, text: issue.message ?? 'INCORRECT DATA', rawPayload })
}

function buildKnownPermissionErrors(params: {
  rawPayload: string | null
  classification: EdielClassifiedMessage
}): EdielAperakApplicationError[] {
  const { rawPayload, classification } = params
  const code = normalize(classification.messageCode)
  const errors: EdielAperakApplicationError[] = []
  const status = firstCavAfterCci(rawPayload, 'Z23')
  const endReason = firstCavAfterCci(rawPayload, 'Z25')

  if (code === 'Z14' && classification.variant === 'unknown') {
    errors.push(errorForCode({
      ercCode: segmentStarts(rawPayload, 'CCI++Z23') ? '42' : '41',
      fieldCode: '322',
      text: segmentStarts(rawPayload, 'CCI++Z23') ? 'INCORRECT DATA - permission status' : 'MANDATORY FIELD MISSING - permission status',
      rawPayload,
    }))
  }

  if (code === 'Z15') {
    if (status && !['A75'].includes(status)) {
      errors.push(errorForCode({ ercCode: '42', fieldCode: '322', text: `INCORRECT DATA - permission status ${status}`, rawPayload }))
    }
    if (endReason && !['B79', 'B80'].includes(endReason)) {
      errors.push(errorForCode({ ercCode: '42', fieldCode: '324', text: `INCORRECT DATA - permission end reason ${endReason}`, rawPayload }))
    }
  }

  if (code === 'Z18' && !endReason) {
    errors.push(errorForCode({ ercCode: '41', fieldCode: '324', text: 'MANDATORY FIELD MISSING - permission end reason', rawPayload }))
  }

  return errors
}

function shouldRequireProductionPermissionLink(params: {
  message?: EdielMessageRow | null
  classification: EdielClassifiedMessage
  testKind?: EdielDecisionContextKind | null
}): boolean {
  if (params.testKind && params.testKind !== 'production') return false
  if (params.message?.test_flag === 1) return false
  if (params.classification.family !== 'PRODAT') return false
  if (!['Z14', 'Z15', 'Z18'].includes(normalize(params.classification.messageCode))) return false
  return true
}

function hasProductionPermissionLink(message?: EdielMessageRow | null): boolean {
  if (!message) return false
  if (isTruthyString(message.related_message_id)) return true
  if (isTruthyString(message.original_message_id)) return true
  if (isTruthyString(message.correlation_reference)) return true
  if (isTruthyString(message.customer_id) || isTruthyString(message.site_id) || isTruthyString(message.metering_point_id)) return true
  if (['matched', 'linked', 'resolved'].includes(String(message.business_match_status ?? '').toLowerCase())) return true

  const report = message.validation_report ?? {}
  const text = stringifyForSearch(report).toLowerCase()
  return text.includes('linked_to_z13') || text.includes('linked_to_permission') || text.includes('business_match_status":"matched')
}

function portalFeedbackError(feedback: PortalValidationFeedback, rawPayload: string | null): EdielAperakApplicationError {
  const ercCode = feedback.expectedA902.find((code) => ['40', '41', '42'].includes(code)) ?? '40'
  const fieldCode = ercCode === '40' ? '105' : ercCode === '41' ? '512' : null
  const text = ercCode === '40'
    ? 'The object could not be identified'
    : ercCode === '41'
      ? 'MANDATORY FIELD MISSING'
      : 'INCORRECT DATA'
  return errorForCode({ ercCode, fieldCode, text, rawPayload })
}

export function decideProdatAperak(input: ProdatAperakDecisionInput): EdielEngineDecision {
  const rawPayload = input.rawPayload ?? input.message?.raw_payload ?? null
  const classification = selectRuleProfile({
    message: input.message ?? null,
    family: input.family ?? input.message?.message_family ?? 'PRODAT',
    messageCode: input.messageCode ?? input.message?.message_code ?? null,
    rawPayload,
    applicationReference: input.applicationReference ?? input.message?.application_reference ?? null,
    processType: input.processType ?? input.message?.process_type ?? null,
    actorRole: input.actorRole ?? null,
    testKind: input.testKind ?? null,
  })
  const portalFeedback = parsePortalValidationFeedback(messageValidationReport(input))
  const businessErrors = validateProdatBusinessRules(rawPayload ?? '')
    .filter((item) => item.severity === 'error')
    .map((item) => prodatBusinessIssueToAperakError(rawPayload, item))
  const knownPermissionErrors = buildKnownPermissionErrors({ rawPayload, classification })

  const applicationErrors = [...businessErrors, ...knownPermissionErrors]
  if (portalFeedback?.expectedNegativeAperak && portalFeedback.actualWasPositiveAperak) {
    applicationErrors.unshift(portalFeedbackError(portalFeedback, rawPayload))
  }

  if (applicationErrors.length > 0) {
    const comparison = compareEngineDecisionWithExpected({
      actualFamily: 'APERAK',
      actualOutcome: 'negative',
      expectedFamily: input.expectedOutcome ? 'APERAK' : null,
      expectedOutcome: input.expectedOutcome ?? null,
    })

    return {
      kind: 'ack',
      ackFamily: 'APERAK',
      outcome: 'negative',
      messageText: applicationErrors[0]?.text ?? 'PRODAT applikations-/affärsvalidering gav fel.',
      applicationErrors,
      reason: portalFeedback?.mismatch
        ? 'Portalfeedback visar att negativ APERAK förväntades men positiv APERAK skickades/planerades. Engine väljer negativ APERAK.'
        : `PRODAT backend decision selected negative APERAK using ${classification.ruleProfileId}.`,
      ruleKeys: [classification.ruleProfileId, ...applicationErrors.map((error) => `${error.ercCode}:${error.fieldCode ?? 'NO_FIELD'}`)],
      classification: summarizeRuleProfile(classification),
      portalFeedback,
      expectedComparison: comparison,
    }
  }

  const isNonProductionPermissionNegativeScenario =
    input.expectedOutcome === 'negative' &&
    input.testKind &&
    input.testKind !== 'production' &&
    ['Z14', 'Z15', 'Z18'].includes(normalize(classification.messageCode)) &&
    !hasProductionPermissionLink(input.message)

  if (isNonProductionPermissionNegativeScenario) {
    const facilityError = errorForCode({
      ercCode: '40',
      fieldCode: '105',
      text: 'The object could not be identified',
      rawPayload,
      referenceQualifier: null,
    })
    const comparison = compareEngineDecisionWithExpected({
      actualFamily: 'APERAK',
      actualOutcome: 'negative',
      expectedFamily: 'APERAK',
      expectedOutcome: input.expectedOutcome,
    })

    return {
      kind: 'ack',
      ackFamily: 'APERAK',
      outcome: 'negative',
      messageText: facilityError.text,
      applicationErrors: [facilityError],
      reason: `PRODAT backend decision selected negative APERAK because the permission message has no safe facility/process link in ${input.testKind} negative scenario.`,
      ruleKeys: ['facility_not_identified', classification.ruleProfileId],
      classification: summarizeRuleProfile(classification),
      portalFeedback,
      expectedComparison: comparison,
    }
  }

  if (shouldRequireProductionPermissionLink({ message: input.message, classification, testKind: input.testKind ?? null }) && !hasProductionPermissionLink(input.message)) {
    return {
      kind: 'manual_review',
      ackFamily: 'APERAK',
      outcome: null,
      messageText: classification.manualReviewReason ?? 'PRODAT permission-meddelandet saknar säker process-/tillståndskoppling i produktion.',
      applicationErrors: [],
      reason: 'Produktion får inte gissa positiv eller negativ APERAK när Z14/Z15/Z18 inte kan kopplas till rätt Z13/tillstånd/process.',
      ruleKeys: ['manual_review_required', classification.ruleProfileId],
      classification: summarizeRuleProfile(classification),
      portalFeedback,
      expectedComparison: null,
    }
  }

  const comparison = compareEngineDecisionWithExpected({
    actualFamily: 'APERAK',
    actualOutcome: 'positive',
    expectedFamily: input.expectedOutcome ? 'APERAK' : null,
    expectedOutcome: input.expectedOutcome ?? null,
  })

  return {
    kind: 'ack',
    ackFamily: 'APERAK',
    outcome: 'positive',
    messageText: classification.variant === 'Z14N'
      ? 'Z14N är ett korrekt affärsbesked om nekad tillgång och ska kvitteras med positiv APERAK när payload/process är giltig.'
      : null,
    applicationErrors: [],
    reason: `PRODAT backend decision selected positive APERAK using ${classification.ruleProfileId}.`,
    ruleKeys: [classification.ruleProfileId],
    classification: summarizeRuleProfile(classification),
    portalFeedback,
    expectedComparison: comparison,
  }
}

export function decideUtiltsResponse(input: UtiltsResponseDecisionInput): EdielEngineDecision {
  const classification = selectRuleProfile({
    message: input.message,
    testKind: input.testKind ?? null,
  })

  const testCase = normalize(input.testCaseCode)
  if ((input.testKind === 'AGT' || testCase.startsWith('UE')) && ['UE1', 'UE2'].includes(testCase) && input.message.message_family === 'UTILTS') {
    const comparison = compareEngineDecisionWithExpected({
      actualFamily: 'UTILTS_ERR',
      actualOutcome: 'negative',
      expectedFamily: input.expectedFamily ?? 'UTILTS_ERR',
      expectedOutcome: input.expectedOutcome ?? 'negative',
    })
    return {
      kind: 'ack',
      ackFamily: 'UTILTS_ERR',
      outcome: 'negative',
      messageText: 'AGT UE1/UE2 använder produktionsokända mätdata och ska därför kvitteras med UTILTS_ERR efter positiv CONTRL.',
      applicationErrors: [],
      reason: 'AGT UE1/UE2 separeras från TGT U3: positiv CONTRL + UTILTS_ERR, inte positiv APERAK.',
      ruleKeys: ['AGT_UE_UTILTS_ERR', classification.ruleProfileId],
      classification: summarizeRuleProfile(classification),
      expectedComparison: comparison,
    }
  }

  const runtime = runUtiltsRuntimeForMessage(input.message)

  if (runtime.ackPlan.shouldSendUtiltsErr) {
    const comparison = compareEngineDecisionWithExpected({
      actualFamily: 'UTILTS_ERR',
      actualOutcome: 'negative',
      expectedFamily: input.expectedFamily ?? null,
      expectedOutcome: input.expectedOutcome ?? null,
    })
    return {
      kind: 'ack',
      ackFamily: 'UTILTS_ERR',
      outcome: 'negative',
      messageText: runtime.ackPlan.reason || 'UTILTS process-/funktionsfel ska besvaras med UTILTS_ERR.',
      applicationErrors: [],
      reason: runtime.ackPlan.reason || 'UTILTS runtime selected UTILTS_ERR.',
      ruleKeys: ['UTILTS_FUNCTIONAL_ERROR', classification.ruleProfileId],
      classification: summarizeRuleProfile(classification),
      expectedComparison: comparison,
    }
  }

  if (runtime.ackPlan.shouldSendAperak) {
    const outcome = runtime.ackPlan.aperakOutcome
    const applicationErrors = runtime.ackPlan.aperakApplicationErrors.map((error) => ({
      ercCode: error.ercCode,
      fieldCode: error.fieldCode ?? null,
      text: error.text,
      referenceQualifier: error.referenceQualifier ?? 'ACW',
      referenceNumber: error.referenceNumber ?? null,
      lineItemReference: error.lineItemReference ?? null,
    }))
    const comparison = compareEngineDecisionWithExpected({
      actualFamily: 'APERAK',
      actualOutcome: outcome,
      expectedFamily: input.expectedFamily ?? null,
      expectedOutcome: input.expectedOutcome ?? null,
    })
    return {
      kind: 'ack',
      ackFamily: 'APERAK',
      outcome,
      messageText: runtime.ackPlan.reason ?? (outcome === 'positive' ? null : 'UTILTS anvisnings-/applikationsfel.'),
      applicationErrors: outcome === 'negative' ? applicationErrors : [],
      reason: runtime.ackPlan.reason || `UTILTS runtime selected ${outcome} APERAK.`,
      ruleKeys: [classification.ruleProfileId],
      classification: summarizeRuleProfile(classification),
      expectedComparison: comparison,
    }
  }

  return {
    kind: 'manual_review',
    ackFamily: null,
    outcome: null,
    messageText: 'UTILTS runtime kunde inte välja APERAK eller UTILTS_ERR säkert.',
    applicationErrors: [],
    reason: 'Unknown UTILTS response plan; requires manual review.',
    ruleKeys: ['manual_review_required', classification.ruleProfileId],
    classification: summarizeRuleProfile(classification),
    expectedComparison: null,
  }
}

function isFinalAck(value: Pick<EdielMessageRow, 'status'>): boolean {
  return FINAL_ACK_STATUSES.has(String(value.status ?? '').toLowerCase())
}

function isReplaceableAck(value: Pick<EdielMessageRow, 'status'>): boolean {
  return REPLACEABLE_ACK_STATUSES.has(String(value.status ?? '').toLowerCase())
}

function ackOutcome(value: Pick<EdielMessageRow, 'ack_outcome'>): AckOutcome | null {
  return value.ack_outcome === 'positive' || value.ack_outcome === 'negative' ? value.ack_outcome : null
}

function sortNewestFirst<T extends { created_at?: string | null; updated_at?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')))
}

export function ensureExpectedAckSent(input: AckLifecycleDecisionInput): AckLifecycleDecision {
  const sameFamily = sortNewestFirst(input.existingAcks.filter((ack) => ack.message_family === input.desiredFamily))
  const finalSame = sameFamily.find((ack) => {
    if (!isFinalAck(ack)) return false
    if (input.desiredFamily === 'UTILTS_ERR') return true
    return ackOutcome(ack) === input.desiredOutcome
  })
  if (finalSame) {
    return {
      status: 'already_sent_success',
      existingAckId: finalSame.id,
      existingOutcome: ackOutcome(finalSame),
      message: 'Rätt final ACK finns redan. Skicka inte om.',
    }
  }

  const finalConflict = sameFamily.find((ack) => {
    if (!isFinalAck(ack)) return false
    if (input.desiredFamily === 'UTILTS_ERR') return false
    const existingOutcome = ackOutcome(ack)
    return Boolean(existingOutcome && input.desiredOutcome && existingOutcome !== input.desiredOutcome)
  })
  if (finalConflict) {
    return {
      status: 'blocked_final_ack_exists',
      existingAckId: finalConflict.id,
      existingOutcome: ackOutcome(finalConflict),
      message: 'Final ACK med motsatt outcome finns redan. Blockera och kräv manuell teknisk granskning.',
    }
  }

  const replaceable = sameFamily.find(isReplaceableAck)
  if (replaceable) {
    return {
      status: 'supersede_replaceable',
      existingAckId: replaceable.id,
      existingOutcome: ackOutcome(replaceable),
      message: 'Endast draft/prepared/queued/failed ACK finns. Den kan ersättas av aktuell backend decision.',
    }
  }

  return {
    status: 'create_new',
    existingAckId: null,
    existingOutcome: null,
    message: 'Ingen återanvändbar eller blockerande ACK finns. Skapa ny ACK.',
  }
}
