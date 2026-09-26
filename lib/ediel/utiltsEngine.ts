import { canonicalBusinessDate } from '@/lib/ediel/core/messagePolicy'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { fieldRulesForMessage } from '@/lib/ediel/rulebook/fieldMatrix'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type { UtiltsProcessabilityPolicy } from '@/lib/ediel/rulebook/utilts25A4'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveUtiltsProcessabilityPolicy } from '@/lib/ediel/rulebook/utilts25A4'
import {
  addNormalizedResolution,
  expectedObservationCountForResolution,
  normalizeEdifactResolution,
  resolutionFormatNeedsLegacyCountCorrection,
} from '@/lib/ediel/utilts/resolution'
import {
  localEdifactDateTimeToUtc,
  parseEdifactTimezoneOffsetFromSegments,
} from '@/lib/ediel/utilts/timezone'
import {
  decideUtiltsRuntimeAckPlan,
  resolveUtiltsTransactionDispositions,
  runUtiltsRuntimeForMessage as runLegacyUtiltsRuntimeForMessage,
  type UtiltsRuntimeFacts,
  type UtiltsRuntimeResult,
  type UtiltsRuntimeTransaction,
  type UtiltsRuntimeValidation,
  type UtiltsValidationIssue,
} from '@/lib/ediel/utiltsEngine.part-1'

export * from '@/lib/ediel/utiltsEngine.part-1'

export type UtiltsRuntimeReferenceOptions = {
  referenceDate?: string | Date | null
  canonicalPolicy?: CanonicalEdielPolicy
}

const PRE_TENANT_OBJECT_SENTINEL = '00000000-0000-0000-0000-000000000000'

function runtimeValidationMessage(message: EdielMessageRow): EdielMessageRow {
  const companyId = String(message.company_id ?? '').trim()
  if (companyId) return message

  // Object/processability errors such as UNKNOWN_METERING_POINT are assertions
  // about a specific tenant's persisted production graph. Before tenant
  // resolution that assertion is not logically available. Run the exact same
  // UTILTS kernel with a non-persisted resolved-object sentinel so syntax,
  // guide, period, quantity, timing and all other functional checks still run.
  // Once company_id exists, the original message is used unchanged and object
  // matching remains fully fail-closed.
  const parsedPayload = message.parsed_payload && typeof message.parsed_payload === 'object' && !Array.isArray(message.parsed_payload)
    ? { ...(message.parsed_payload as Record<string, unknown>) }
    : {}
  delete parsedPayload.utiltsTransactionMatches

  return {
    ...message,
    metering_point_id: PRE_TENANT_OBJECT_SENTINEL,
    grid_owner_id: PRE_TENANT_OBJECT_SENTINEL,
    business_match_status: 'matched',
    parsed_payload: parsedPayload,
  }
}

function normalizedReferenceDate(
  message: EdielMessageRow,
  options?: UtiltsRuntimeReferenceOptions,
): string {
  const explicit = options?.referenceDate
  if (explicit instanceof Date) {
    if (Number.isNaN(explicit.getTime())) throw new Error('utilts_reference_date_invalid')
    return explicit.toISOString().slice(0, 10)
  }
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 10)

  return canonicalBusinessDate(message)
}

function rebuildValidation(issues: UtiltsValidationIssue[]): UtiltsRuntimeValidation {
  const syntaxOk = !issues.some((issue) => issue.severity === 'error' && issue.kind === 'syntax')
  const hasApplicationErrors = issues.some(
    (issue) => issue.severity === 'error' && issue.kind === 'application',
  )
  const hasFunctionalErrors = issues.some(
    (issue) => issue.severity === 'error' && issue.kind === 'functional',
  )
  // Preserve the canonical runtime's established precedence: a processability
  // failure must produce UTILTS_ERR even when the same message also contains
  // guide/application errors. Transaction-scoped APERAK details are retained in
  // the issue set for sibling transactions; they must not demote a functional
  // rejection to message-level application_rejected.
  const classification: UtiltsRuntimeValidation['classification'] = !syntaxOk
    ? 'syntax_rejected'
    : hasFunctionalErrors
      ? 'functional_rejected'
      : hasApplicationErrors
        ? 'application_rejected'
        : 'accepted'

  return {
    ok: classification === 'accepted',
    syntaxOk,
    functionalOk: !hasFunctionalErrors,
    issues,
    classification,
  }
}

export function rebuildUtiltsRuntimeResult(input: {
  message: EdielMessageRow
  result: UtiltsRuntimeResult
  issues: UtiltsValidationIssue[]
}): UtiltsRuntimeResult {
  const previous = input.result.validation.issues
  const unchanged = input.issues.length === previous.length && input.issues.every((issue, index) => issue === previous[index])
  if (unchanged) return input.result

  const validation = rebuildValidation(input.issues)
  const transactionDispositions = resolveUtiltsTransactionDispositions({
    syntaxOk: validation.syntaxOk,
    transactions: input.result.facts.transactions,
    issues: validation.issues,
  })
  const ackPlan = decideUtiltsRuntimeAckPlan({
    message: input.message,
    facts: input.result.facts,
    validation,
  })
  return { ...input.result, validation, transactionDispositions, ackPlan }
}

function qualifier(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function issueReference(issue: UtiltsValidationIssue): string {
  return String(issue.referenceNumber ?? issue.lineItemReference ?? '').trim()
}

function transactionReference(transaction: UtiltsRuntimeTransaction, index: number): string {
  return String(transaction.transactionId ?? '').trim() || `TX-${index + 1}`
}

function issueBelongsToTransaction(
  issue: UtiltsValidationIssue,
  transaction: UtiltsRuntimeTransaction,
  index: number,
  transactionCount: number,
): boolean {
  const reference = issueReference(issue)
  const transactionId = String(transaction.transactionId ?? '').trim()
  if (!reference) return transactionCount === 1
  if (transactionId && reference === transactionId) return true
  return reference === transactionReference(transaction, index)
}

function rawTransactionGroups(facts: UtiltsRuntimeFacts): string[][] {
  const groups: string[][] = []
  let current: string[] | null = null
  for (const segment of facts.rawSegments) {
    if (/^IDE\+24(?:\+|:|$)/i.test(segment)) {
      if (current) groups.push(current)
      current = [segment]
      continue
    }
    if (current) current.push(segment)
  }
  if (current) groups.push(current)
  return groups
}

function numericCavValue(segment: string | null | undefined): number | null {
  const match = /^CAV\+([^:+'\s]+)/i.exec(String(segment ?? '').trim())
  if (!match) return null
  const parsed = Number(match[1].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function meterConstant(segments: readonly string[]): number {
  for (let index = 0; index < segments.length; index += 1) {
    if (!/^CCI\+.*Z02(?:[:+]|$)/i.test(segments[index] ?? '')) continue
    const value = numericCavValue(segments[index + 1])
    if (value !== null && value > 0) return value
  }
  return 1
}

function compactDateTimeMs(value: string | null | undefined): number | null {
  const compact = String(value ?? '').replace(/[^0-9]/g, '')
  if (![8, 10, 12, 14].includes(compact.length)) return null
  const year = Number(compact.slice(0, 4))
  const month = Number(compact.slice(4, 6))
  const day = Number(compact.slice(6, 8))
  const hour = compact.length >= 10 ? Number(compact.slice(8, 10)) : 0
  const minute = compact.length >= 12 ? Number(compact.slice(10, 12)) : 0
  const second = compact.length >= 14 ? Number(compact.slice(12, 14)) : 0
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  const date = new Date(ms)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) return null
  return ms
}

function e66ReadingTimes(segments: readonly string[]): { registration: number | null; readings: number[] } {
  let registration: number | null = null
  const readings: number[] = []
  let insideObservation = false
  let currentObservationHasReading = false

  for (const segment of segments) {
    if (/^SEQ\+/i.test(segment)) {
      insideObservation = true
      currentObservationHasReading = false
      continue
    }
    if (/^QTY\+220:/i.test(segment)) {
      currentObservationHasReading = true
      continue
    }
    const dtm = /^DTM\+597:([^:+'\s]+)/i.exec(segment)
    if (!dtm) continue
    const timestamp = compactDateTimeMs(dtm[1])
    if (timestamp === null) continue
    if (!insideObservation && registration === null) registration = timestamp
    if (insideObservation && currentObservationHasReading) readings.push(timestamp)
  }

  return { registration, readings }
}

function functionalIssue(input: {
  code: string
  title: string
  description: string
  utiltsErrCode: string
  reference: string
}): UtiltsValidationIssue {
  return {
    severity: 'error',
    kind: 'functional',
    code: input.code,
    title: input.title,
    description: input.description,
    utiltsErrCode: input.utiltsErrCode,
    referenceQualifier: 'TN',
    referenceNumber: input.reference,
    lineItemReference: input.reference,
  }
}

export function applyCanonicalE66QuantityPolicyToRuntimeResult(input: {
  message: EdielMessageRow
  result: UtiltsRuntimeResult
  functionalEligible?: ReadonlySet<string>
}): UtiltsRuntimeResult {
  if (String(input.result.facts.messageCode ?? '').trim().toUpperCase() !== 'E66') return input.result

  const transactions = input.result.facts.transactions
  const groups = rawTransactionGroups(input.result.facts)
  let issues = [...input.result.validation.issues]

  transactions.forEach((transaction, index) => {
    const readings = transaction.quantities.filter((quantity) => qualifier(quantity.qualifier) === '220')
    const energies = transaction.quantities.filter((quantity) => qualifier(quantity.qualifier) === '136')
    const reference = transactionReference(transaction, index)
    const belongs = (issue: UtiltsValidationIssue) => issueBelongsToTransaction(issue, transaction, index, transactions.length)

    // 25-A-3 field 517 is QTY+220. The legacy kernel previously used 101/203/204
    // as QTY qualifiers, which are not the meter-reading quantity field. Remove
    // only the legacy consequences for this transaction and rebuild them below
    // from the canonical 220/136 semantics.
    issues = issues.filter((issue) => {
      if (!belongs(issue)) return true
      if (['UTILTS_E66_METER_READING_ENERGY_MISMATCH', 'UTILTS_E66_REGISTRATION_BEFORE_LATEST_METER_READING'].includes(issue.code)) return false
      if (readings.length > 0 && ['UTILTS_E66_ENERGY_ONLY_WITHOUT_METER_READING', 'UTILTS_E66_MISSING_METER_READING'].includes(issue.code)) return false
      return true
    })
    if (input.functionalEligible && !input.functionalEligible.has(reference)) return

    const readingValues = readings.map((quantity) => quantity.value).filter((value): value is number => value !== null)
    const energyValues = energies.map((quantity) => quantity.value).filter((value): value is number => value !== null)
    if (readingValues.length >= 2 && energyValues.length > 0) {
      const expectedEnergy = Math.abs(readingValues[readingValues.length - 1] - readingValues[0]) * meterConstant(groups[index] ?? [])
      const reportedEnergy = energyValues.reduce((sum, value) => sum + value, 0)
      if (Math.abs(expectedEnergy - reportedEnergy) > 0.001) {
        issues.push(functionalIssue({
          code: 'UTILTS_E66_METER_READING_ENERGY_MISMATCH',
          title: 'Mätarställning stämmer inte med energimängd',
          description: 'Skillnaden mellan QTY+220-mätarställningarna, multiplicerad med eventuell mätarkonstant, stämmer inte med QTY+136-energin.',
          utiltsErrCode: 'E19',
          reference,
        }))
      }
    }

    if (readings.length > 0) {
      const timing = e66ReadingTimes(groups[index] ?? [])
      const latestReading = timing.readings.length > 0 ? Math.max(...timing.readings) : null
      if (timing.registration !== null && latestReading !== null && timing.registration < latestReading) {
        issues.push(functionalIssue({
          code: 'UTILTS_E66_REGISTRATION_BEFORE_LATEST_METER_READING',
          title: 'Registreringstidpunkt tidigare än senaste mätarställning',
          description: 'Transaktionens registreringstidpunkt ligger före den senaste DTM+597 som hör till QTY+220-mätarställning.',
          utiltsErrCode: 'E50',
          reference,
        }))
      }
    }

    const expected = expectedObservationCountForResolution({
      start: transaction.deliveryPeriodStart,
      end: transaction.deliveryPeriodEnd,
      value: transaction.resolution,
      format: transaction.resolutionFormat,
    })
    const shouldRebuildCount = readings.length > 0 || resolutionFormatNeedsLegacyCountCorrection(transaction.resolutionFormat)
    if (shouldRebuildCount && energies.length > 0 && expected !== null) {
      issues = issues.filter((issue) => {
        if (!belongs(issue)) return true
        return !['UTILTS_E66_OBSERVATION_COUNT_MISMATCH', 'UTILTS_DST_INTERVAL_COUNT_MISMATCH'].includes(issue.code)
      })
      if (energies.length !== expected) {
        issues.push(functionalIssue({
          code: 'UTILTS_E66_OBSERVATION_COUNT_MISMATCH',
          title: 'Fel antal energiobservationer',
          description: `E66 förväntar ${expected} QTY+136-observationer utifrån DTM+324/354 men innehåller ${energies.length}. QTY+220 räknas inte som fakturerbar energi.`,
          utiltsErrCode: 'E87',
          reference,
        }))
      }
    }
  })

  return rebuildUtiltsRuntimeResult({ message: input.message, result: input.result, issues })
}

export function applyUtiltsResolutionFormatPolicyToRuntimeResult(input: {
  message: EdielMessageRow
  result: UtiltsRuntimeResult
}): UtiltsRuntimeResult {
  const issues = input.result.validation.issues.filter((issue) => {
    if (issue.code !== 'UTILTS_DST_INTERVAL_COUNT_MISMATCH') return true
    const reference = String(issue.referenceNumber ?? issue.lineItemReference ?? '').trim()
    const transaction = input.result.facts.transactions.find((entry) =>
      reference ? String(entry.transactionId ?? '').trim() === reference : false,
    ) ?? (input.result.facts.transactions.length === 1 ? input.result.facts.transactions[0] : null)

    // Defensive compatibility for any older validator that still reduces the
    // DTM+354 value to minutes. profiles.ts now performs the canonical 2379
    // calculation itself; non-806 legacy mismatches must not leak through.
    return !resolutionFormatNeedsLegacyCountCorrection(transaction?.resolutionFormat)
  })

  return rebuildUtiltsRuntimeResult({ message: input.message, result: input.result, issues })
}

export function applyUtiltsEffectiveDatePolicyToRuntimeResult(input: {
  message: EdielMessageRow
  result: UtiltsRuntimeResult
  referenceDate: string
  processabilityPolicy?: UtiltsProcessabilityPolicy | null
}): UtiltsRuntimeResult {
  const policy = input.processabilityPolicy ?? resolveUtiltsProcessabilityPolicy(input.referenceDate)
  if (policy.guideRevision === '25-A-3') return input.result

  const removedRejectionCodes = new Set(
    policy.removedRejectionReasonCodes.map((code) => code.toUpperCase()),
  )
  const issues = input.result.validation.issues.filter((issue) => {
    const utiltsErrCode = String(issue.utiltsErrCode ?? '').trim().toUpperCase()
    if (utiltsErrCode && removedRejectionCodes.has(utiltsErrCode)) return false
    if (
      !policy.compareMeterReadingsToEnergyVolumes &&
      issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH'
    ) {
      return false
    }
    return true
  })

  return rebuildUtiltsRuntimeResult({ message: input.message, result: input.result, issues })
}

function applyUtiltsHeaderGuide(message: EdielMessageRow, result: UtiltsRuntimeResult): UtiltsRuntimeResult {
  const rules = fieldRulesForMessage('UTILTS', result.facts.messageCode)
  const wire = tokenizeEdifact(message.raw_payload)
  const nadIssues: UtiltsValidationIssue[] = []
  for (const segment of wire.segments) {
    if (segment.tag === 'IDE' || segment.tag === 'UNT') break
    if (segment.tag !== 'NAD') continue
    const role = segmentComposite(segment, 1, wire.una)[0]
    if (role !== 'MS' && role !== 'MR') continue
    const field = role === 'MS' ? '207' : '208'
    const parts = segmentComposite(segment, 2, wire.una)
    const qualifier = parts[1]?.trim() ?? ''
    const agency = parts[2]?.trim() ?? ''
    const badAgency = !['260', '9', '305'].includes(agency)
    const badQualifier = agency === '260' && qualifier !== 'SVK'
    if (!badAgency && !badQualifier) continue
    const missing = badAgency ? !agency : !qualifier
    const path = badAgency ? 'C082/3055' : 'C082/1131'
    nadIssues.push({
      severity: 'error', kind: 'application',
      code: badAgency ? (missing ? 'UTILTS_NAD_AGENCY_MISSING' : 'UTILTS_NAD_AGENCY_INVALID')
        : (missing ? 'UTILTS_NAD_QUALIFIER_MISSING' : 'UTILTS_NAD_QUALIFIER_INVALID'),
      title: missing ? 'NAD-kod saknas' : 'Ogiltig NAD-kod',
      description: `NAD+${role}/${path} ${missing ? 'saknas' : 'har otillåtet värde'}.`,
      aperakErcCode: missing ? '41' : '42', aperakFieldCode: field,
      aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
    })
  }
  const market = wire.segments.find(segment => segment.tag === 'MKS')
  const mksIssues = (['501', '502'] as const).flatMap(fieldNumber => {
    const rule = rules.find(item => item.fieldNumber === fieldNumber)
    if (!rule?.allowedValues?.length) return []
    const composite = market ? segmentComposite(market, fieldNumber === '501' ? 1 : 2, wire.una) : []
    const value = composite[0]?.trim() ?? null
    const allowed = Boolean(value && rule.allowedValues.includes(value))
    // 25-A-3 annex C UG-122-21 qualifies phase 502 with agency 260.
    const agency = fieldNumber === '502' ? composite[2]?.trim() : null
    const invalidAgency = fieldNumber === '502' && allowed && agency !== '260'
    if (allowed && !invalidAgency) return []
    const missing = !value || (invalidAgency && !agency)
    const path = invalidAgency ? 'MKS/C332/3055' : rule.segmentPath
    return [{
      severity: 'error' as const, kind: 'application' as const,
      code: invalidAgency ? (missing ? 'UTILTS_PHASE_AGENCY_MISSING' : 'UTILTS_PHASE_AGENCY_INVALID')
        : missing ? rule.errorCodeIfMissing ?? 'MKS_MISSING' : rule.errorCodeIfInvalid ?? 'UTILTS_PHASE_INVALID',
      title: invalidAgency ? (missing ? 'Byråkod för skede saknas' : 'Ogiltig byråkod för skede')
        : missing ? `${rule.label} saknas` : `Ogiltigt ${rule.label}`,
      description: missing ? `${path} saknas.` : `${path} har otillåtet värde ${invalidAgency ? agency : value}.`,
      aperakErcCode: missing ? '41' : '42',
      aperakFieldCode: fieldNumber,
      aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
    }]
  })
  const ackRule = rules.find(item => item.fieldNumber === '313')
  const bgm = wire.segments.find(segment => segment.tag === 'BGM')
  const documentCodeRule = rules.find(item => item.fieldNumber === '202')
  const documentParts = bgm ? segmentComposite(bgm, 1, wire.una) : []
  const documentCode = documentParts[0]?.trim() ?? ''
  const documentQualifier = documentParts[1]?.trim() ?? ''
  const documentQualifierIssues = /^S0[1-7]$/.test(documentCode) && documentQualifier !== 'SVK'
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: documentQualifier ? 'UTILTS_DOCUMENT_QUALIFIER_INVALID' : 'UTILTS_DOCUMENT_QUALIFIER_MISSING',
      title: documentQualifier ? 'Ogiltig dokumentkodlistequalifierare' : 'Dokumentkodlistequalifierare saknas',
      description: documentQualifier ? `BGM/C002/1131 har otillåtet värde ${documentQualifier}.` : 'BGM/C002/1131 saknas.',
      aperakErcCode: documentQualifier ? '42' : '41',
      aperakFieldCode: '202',
      aperakText: documentQualifier ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const documentAgency = bgm ? segmentComposite(bgm, 1, wire.una)[2]?.trim() : null
  const documentAgencyIssues = bgm && documentCodeRule?.requirement === 'required' && documentAgency !== '260'
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: documentAgency ? 'UTILTS_DOCUMENT_AGENCY_INVALID' : 'UTILTS_DOCUMENT_AGENCY_MISSING',
      title: documentAgency ? 'Ogiltig byråkod för dokumenttyp' : 'Byråkod för dokumenttyp saknas',
      description: documentAgency ? `BGM/C002/3055 har otillåtet värde ${documentAgency}.` : 'BGM/C002/3055 saknas.',
      aperakErcCode: documentAgency ? '42' : '41',
      aperakFieldCode: '202',
      aperakText: documentAgency ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const documentRule = rules.find(item => item.fieldNumber === '203')
  const documentIdentifier = bgm ? segmentComposite(bgm, 2, wire.una)[0]?.trim() : null
  const documentIssues = documentRule?.requirement === 'required' && !documentIdentifier
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: documentRule.errorCodeIfMissing ?? 'UTILTS_DOCUMENT_IDENTIFIER_MISSING',
      title: 'Dokumentnummer saknas',
      description: 'BGM/C106/1004 saknas.',
      aperakErcCode: '41',
      aperakFieldCode: '203',
      aperakText: 'MANDATORY FIELD MISSING',
    }] : []
  const functionRule = rules.find(item => item.fieldNumber === '204')
  const functionCode = bgm ? segmentComposite(bgm, 3, wire.una)[0]?.trim() : null
  const functionIssues = functionRule?.allowedValues?.length && (!functionCode || !functionRule.allowedValues.includes(functionCode))
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: functionCode ? functionRule.errorCodeIfInvalid ?? 'UTILTS_MESSAGE_FUNCTION_INVALID' : functionRule.errorCodeIfMissing ?? 'UTILTS_MESSAGE_FUNCTION_MISSING',
      title: functionCode ? 'Ogiltig meddelandefunktion' : 'Meddelandefunktion saknas',
      description: functionCode ? `BGM/1225 har otillåtet värde ${functionCode}.` : 'BGM/1225 saknas.',
      aperakErcCode: functionCode ? '42' : '41',
      aperakFieldCode: '204',
      aperakText: functionCode ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const request = bgm ? segmentComposite(bgm, 4, wire.una)[0]?.trim() : null
  const ackIssues = ackRule?.allowedValues?.length && (!request || !ackRule.allowedValues.includes(request))
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: request ? ackRule.errorCodeIfInvalid ?? 'UTILTS_ACK_REQUEST_INVALID' : ackRule.errorCodeIfMissing ?? 'UTILTS_ACK_REQUEST_MISSING',
      title: request ? 'Ogiltig kvittensbegäran' : 'Kvittensbegäran saknas',
      description: request ? `BGM/4343 har otillåtet värde ${request}.` : 'BGM/4343 saknas.',
      aperakErcCode: request ? '42' : '41',
      aperakFieldCode: '313',
      aperakText: request ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const timezoneRule = rules.find(item => item.fieldNumber === '206')
  const timezoneSegment = wire.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === '735')
  const timezoneParts = timezoneSegment ? segmentComposite(timezoneSegment, 1, wire.una) : []
  const timezoneValue = timezoneParts[1]?.trim() ?? ''
  const timezone = parseEdifactTimezoneOffsetFromSegments(result.facts.rawSegments)
  const timezoneValid = Boolean(timezone)
  const timezoneIssues = timezoneRule?.requirement === 'required' && !timezoneValid
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: timezoneValue ? 'UTILTS_TIMEZONE_INVALID' : 'UTILTS_TIMEZONE_MISSING',
      title: timezoneValue ? 'Ogiltig tidzon' : 'Tidzon saknas',
      description: timezoneValue ? 'DTM+735 måste ha giltig UTC-offset och format 406.' : 'DTM+735/C507/2380 saknas.',
      aperakErcCode: timezoneValue ? '42' : '41',
      aperakFieldCode: '206',
      aperakText: timezoneValue ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
    }] : []
  const dateRule = rules.find(item => item.fieldNumber === '205')
  const dateSegment = wire.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === '137')
  const dateParts = dateSegment ? segmentComposite(dateSegment, 1, wire.una) : []
  const dateValue = dateParts[1]?.trim() ?? ''
  const dateFormat = dateParts[2]?.trim() ?? ''
  const localDate = /^\d{12}$/.test(dateValue)
    ? `${dateValue.slice(0, 4)}-${dateValue.slice(4, 6)}-${dateValue.slice(6, 8)}T${dateValue.slice(8, 10)}:${dateValue.slice(10, 12)}:00`
    : null
  const dateInstant = localDate ? localEdifactDateTimeToUtc(localDate, timezone ?? { raw: '+0000', offsetMinutes: 0, format: '406' }) : null
  const receivedAt = Date.parse(message.message_received_at ?? message.created_at ?? '')
  const futureDate = Boolean(dateInstant && timezone && Number.isFinite(receivedAt) && Date.parse(dateInstant) > receivedAt)
  const dateInvalid = Boolean(dateValue && (dateFormat !== '203' || !dateInstant || futureDate))
  const dateIssues = dateRule?.requirement === 'required' && (!dateValue || dateInvalid)
    ? [{
      severity: 'error' as const, kind: 'application' as const,
      code: !dateValue ? 'UTILTS_MESSAGE_DATE_MISSING' : 'UTILTS_MESSAGE_DATE_INVALID',
      title: !dateValue ? 'Meddelandedatum saknas' : 'Ogiltigt meddelandedatum',
      description: !dateValue ? 'DTM+137/C507/2380 saknas.' : 'DTM+137 måste vara ett giltigt, icke framtida datum i format 203.',
      aperakErcCode: !dateValue ? '41' : '42',
      aperakFieldCode: '205',
      aperakText: !dateValue ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
    }] : []
  const issues = [...nadIssues, ...mksIssues, ...documentQualifierIssues, ...documentAgencyIssues, ...documentIssues, ...functionIssues, ...ackIssues, ...timezoneIssues, ...dateIssues]
  if (issues.length === 0) return result
  // These fields are in the message header: every IDE fails the guide gate, even
  // when no transaction identity was parsed. No functional finding is eligible.
  const retained = result.validation.issues.filter(issue => issue.severity !== 'error' || issue.kind !== 'functional')
  return rebuildUtiltsRuntimeResult({ message, result, issues: [...retained, ...issues] })
}

function applyE66RegulatingObjectGuide(message: EdielMessageRow, result: UtiltsRuntimeResult): UtiltsRuntimeResult {
  if (result.facts.messageCode !== 'E66') return result
  const wire = tokenizeEdifact(message.raw_payload)
  const issues: UtiltsValidationIssue[] = []
  let reference: string | null = null
  let inHeader = false
  for (const segment of wire.segments) {
    if (segment.tag === 'IDE') {
      inHeader = segmentComposite(segment, 1, wire.una)[0] === '24'
      reference = inHeader ? segmentComposite(segment, 2, wire.una)[0]?.trim() || null : null
    } else if (segment.tag === 'SEQ' || segment.tag === 'UNT') {
      inHeader = false
    }
    if (!inHeader || segment.tag !== 'LOC' || segmentComposite(segment, 1, wire.una)[0] !== '175') continue
    const parts = segmentComposite(segment, 2, wire.una)
    const value = parts[0]?.trim() ?? ''
    const agency = parts[2]?.trim() ?? ''
    const invalid = value && agency && !['9', '89'].includes(agency)
    // Agency 9 identifies GS1. The 18-digit numeric form has a modulo-10
    // check digit, with weights 3 and 1 alternating from the right.
    const gs1CheckDigitInvalid = agency === '9' && /^\d{18}$/.test(value)
      && [...value].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 3 : 1), 0) % 10 !== 0
    if (value && agency && !invalid && !gs1CheckDigitInvalid) continue
    const missing = !value || !agency
    issues.push({
      severity: 'error', kind: 'application',
      code: !value ? 'UTILTS_REGULATING_OBJECT_ID_MISSING' : missing ? 'UTILTS_REGULATING_OBJECT_AGENCY_MISSING' : invalid ? 'UTILTS_REGULATING_OBJECT_AGENCY_INVALID' : 'UTILTS_REGULATING_OBJECT_GS1_CHECK_DIGIT_INVALID',
      title: !value ? 'Reglerobjektsid saknas' : missing ? 'Byråkod för reglerobjekt saknas' : invalid ? 'Ogiltig byråkod för reglerobjekt' : 'Ogiltig GS1-kontrollsiffra',
      description: !value ? 'LOC+175/C517/3225 saknas.' : missing ? 'LOC+175/C517/3055 saknas.' : invalid ? 'LOC+175/C517/3055 måste vara 9 eller 89.' : 'LOC+175/C517/3225 har ogiltig GS1-kontrollsiffra.',
      aperakErcCode: missing ? '41' : '42', aperakFieldCode: '533',
      aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
      referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
    })
  }
  return issues.length ? rebuildUtiltsRuntimeResult({ message, result, issues: [...result.validation.issues, ...issues] }) : result
}

function canonicalE66PersistenceTransactions(facts: UtiltsRuntimeFacts): Array<Record<string, unknown>> {
  const timezone = parseEdifactTimezoneOffsetFromSegments(facts.rawSegments)
  const transactions = facts.transactions.length > 0 ? facts.transactions : []

  return transactions.flatMap((transaction) => {
    const resolution = normalizeEdifactResolution({
      value: transaction.resolution,
      format: transaction.resolutionFormat,
    }) ?? transaction.resolution
    const energyQuantities = transaction.quantities.filter((quantity) => qualifier(quantity.qualifier) === '136')

    if (energyQuantities.length === 0) {
      return [{
        ...transaction,
        deliveryPeriodStart: localEdifactDateTimeToUtc(transaction.deliveryPeriodStart, timezone) ?? transaction.deliveryPeriodStart,
        deliveryPeriodEnd: localEdifactDateTimeToUtc(transaction.deliveryPeriodEnd, timezone) ?? transaction.deliveryPeriodEnd,
        registrationTime: localEdifactDateTimeToUtc(transaction.registrationTime, timezone) ?? transaction.registrationTime,
        resolution,
        quantities: [],
      }]
    }

    return energyQuantities.map((quantity, quantityIndex) => {
      const localStart = resolution && transaction.deliveryPeriodStart
        ? addNormalizedResolution(transaction.deliveryPeriodStart, resolution, quantityIndex)
        : transaction.deliveryPeriodStart
      const localEnd = localStart && resolution
        ? addNormalizedResolution(localStart, resolution)
        : transaction.deliveryPeriodEnd
      const declaredEnd = transaction.deliveryPeriodEnd ? Date.parse(transaction.deliveryPeriodEnd) : Number.NaN
      const computedEnd = localEnd ? Date.parse(localEnd) : Number.NaN
      const safeLocalStart = localStart ?? transaction.deliveryPeriodStart
      const safeLocalEnd = Number.isFinite(declaredEnd) && Number.isFinite(computedEnd) && computedEnd <= declaredEnd
        ? localEnd
        : transaction.deliveryPeriodEnd

      return {
        ...transaction,
        deliveryPeriodStart: localEdifactDateTimeToUtc(safeLocalStart, timezone) ?? safeLocalStart,
        deliveryPeriodEnd: localEdifactDateTimeToUtc(safeLocalEnd, timezone) ?? safeLocalEnd,
        registrationTime: localEdifactDateTimeToUtc(transaction.registrationTime, timezone) ?? transaction.registrationTime,
        resolution,
        quantities: [quantity],
      }
    })
  })
}

function applyCanonicalE66PersistencePayload(result: UtiltsRuntimeResult): UtiltsRuntimeResult {
  if (String(result.facts.messageCode ?? '').trim().toUpperCase() !== 'E66') return result

  const timezone = parseEdifactTimezoneOffsetFromSegments(result.facts.rawSegments)
  const transactions = canonicalE66PersistenceTransactions(result.facts)
  const topEnergyQuantities = result.facts.quantities.filter((quantity) => qualifier(quantity.qualifier) === '136')
  const firstTransaction = result.facts.transactions[0] ?? null
  const normalizedResolution = normalizeEdifactResolution({
    value: result.facts.resolution,
    format: firstTransaction?.resolutionFormat ?? null,
  }) ?? result.facts.resolution
  const periodStart = localEdifactDateTimeToUtc(result.facts.deliveryPeriodStart, timezone) ?? result.facts.deliveryPeriodStart
  const periodEnd = localEdifactDateTimeToUtc(result.facts.deliveryPeriodEnd, timezone) ?? result.facts.deliveryPeriodEnd
  const registrationTime = localEdifactDateTimeToUtc(result.facts.registrationTime, timezone) ?? result.facts.registrationTime

  return {
    ...result,
    normalizedPayload: {
      ...result.normalizedPayload,
      periodStart,
      periodEnd,
      registrationTime,
      readAt: registrationTime ?? periodEnd ?? result.normalizedPayload.readAt ?? null,
      resolution: normalizedResolution,
      quantities: topEnergyQuantities,
      quantity: topEnergyQuantities[0]?.value ?? null,
      transactions,
      edifactTimezoneOffset: timezone?.raw ?? null,
      edifactTimezoneFormat: timezone?.format ?? null,
    },
  }
}

export function runUtiltsRuntimeForMessage(
  message: EdielMessageRow,
  options?: UtiltsRuntimeReferenceOptions,
): UtiltsRuntimeResult {
  const canonicalPolicy = options?.canonicalPolicy
  if (canonicalPolicy && (
    canonicalPolicy.family !== 'UTILTS'
    || (Boolean(message.message_code) && canonicalPolicy.code !== message.message_code)
    || canonicalPolicy.direction !== message.direction
    || !canonicalPolicy.utiltsProcessability
  )) {
    throw new Error('utilts_runtime_policy_context_mismatch')
  }
  // The selected processability profile is part of the decision. Matching may
  // enrich tenant/object facts, but must not choose a new guide at receipt time.
  const referenceDate = canonicalPolicy?.referenceDate ?? normalizedReferenceDate(message, options)
  const validationMessage = runtimeValidationMessage(message)
  // Complete the syntax/application pass before invoking any functional
  // validator. Guide failures cannot enter the functional pass; valid siblings
  // retain their own transaction reference and checks.
  const noFunctionalTransactions = new Set<string>()
  const guideBase = runLegacyUtiltsRuntimeForMessage(validationMessage, { functionalEligible: noFunctionalTransactions })
  const guideCorrected = applyCanonicalE66QuantityPolicyToRuntimeResult({
    message,
    result: applyUtiltsResolutionFormatPolicyToRuntimeResult({ message, result: guideBase }),
    functionalEligible: noFunctionalTransactions,
  })
  const guideEffective = applyUtiltsEffectiveDatePolicyToRuntimeResult({
    message, result: guideCorrected, referenceDate, processabilityPolicy: canonicalPolicy?.utiltsProcessability,
  })
  const guided = applyE66RegulatingObjectGuide(message, applyUtiltsHeaderGuide(message, guideEffective))
  const eligible = new Set(guided.transactionDispositions
    .filter(item => item.disposition === 'accepted')
    .map(item => String(item.transactionId ?? '')))
  if (eligible.size === 0) return applyCanonicalE66PersistencePayload(guided)

  const functionalBase = runLegacyUtiltsRuntimeForMessage(validationMessage, { functionalEligible: eligible })
  const functionalCorrected = applyCanonicalE66QuantityPolicyToRuntimeResult({
    message,
    result: applyUtiltsResolutionFormatPolicyToRuntimeResult({ message, result: functionalBase }),
    functionalEligible: eligible,
  })
  const functionalEffective = applyUtiltsEffectiveDatePolicyToRuntimeResult({
    message, result: functionalCorrected, referenceDate, processabilityPolicy: canonicalPolicy?.utiltsProcessability,
  })
  const issues = [...guided.validation.issues, ...functionalEffective.validation.issues.filter(issue => issue.kind === 'functional')]
  return applyCanonicalE66PersistencePayload(rebuildUtiltsRuntimeResult({ message, result: guided, issues }))
}
