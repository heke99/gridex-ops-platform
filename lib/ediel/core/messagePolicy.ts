import {assertDeathStatusContextMatches,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import { requestedEdielCapability } from '@/lib/ediel/core/futureCapabilityPolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { stockholmBusinessDate, type EdielMessageTimeAnchors } from '@/lib/ediel/core/executionContext'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseCanonicalMessageRow, type CanonicalEdielMessage } from '@/lib/ediel/core/canonicalMessage'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy, type CanonicalGuideSelection } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalAckGuide } from '@/lib/ediel/rulebook/ackGuidePolicy'
import {sourceQualifiedProdatBilateralCapability,type SourceQualifiedProdatBilateralCapability} from './prodatBilateralSourceCapability'

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

export type EdielMessageTimeOptions = Readonly<{ admissionAt?: string | Date; replayAt?: string | Date;prodatSourceCapability?:SourceQualifiedProdatBilateralCapability|null }>

function instant(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new Error(`ediel_${label}_invalid`)
  return date.toISOString()
}

function documentAndMeasurementTimes(canonical: CanonicalEdielMessage) {
  const una = canonical.una
  const tokens = tokenizeEdifact(`${una?.raw ?? ''}${canonical.rawSegments.join(una?.segmentTerminator ?? "'")}${una?.segmentTerminator ?? "'"}`)
  const values = tokens.segments.filter(segment => segment.tag === 'DTM')
    .map(segment => segmentComposite(segment, 1, tokens.una))
  const offset = values.find(parts => parts[0] === '735')?.[1] ?? null
  const fixedCetDeclared = offset === '+0100' || values.some(parts => parts[0] === 'ZZZ' && parts[1] === '1' && parts[2] === '805')
  const timeBasis = fixedCetDeclared ? 'fixed_UTC_plus_1' as const : 'source_declared' as const
  const document = values.find(parts => parts[0] === '137')
  const documentDate = normalizeDate(document?.[1])
  const documentTimestamp = document?.[1] ? Object.freeze({ value: document[1], format: document[2] ?? null, originalOffset: offset, timeBasis }) : null
  // Carry original period values independently. Conversion/validation belongs
  // to the family time codec, never to guide admission.
  const measurementPeriods = Object.freeze(values.filter(parts => ['163', '164', '194', '206', '324'].includes(parts[0] ?? '') && parts[1])
    .map(parts => Object.freeze({ qualifier: parts[0]!, value: parts[1]!, format: parts[2] ?? null, originalOffset: offset, timeBasis })))
  return { documentDate, documentTimestamp, measurementPeriods }
}

export function canonicalBusinessDate(message: EdielMessageRow, canonical: CanonicalEdielMessage = parseCanonicalMessageRow(message)): string {
  return documentAndMeasurementTimes(canonical).documentDate
    ?? normalizeDate(message.message_created_at)
    ?? normalizeDate(message.message_received_at)
    ?? normalizeDate(message.created_at)
    ?? (() => { throw new Error('ediel_business_time_missing') })()
}

export function resolveEdielMessageTimeAnchors(
  message: EdielMessageRow,
  canonical: CanonicalEdielMessage = parseCanonicalMessageRow(message),
  options: EdielMessageTimeOptions = {},
): EdielMessageTimeAnchors {
  const wireTimes = documentAndMeasurementTimes(canonical)
  const localIngressAt = instant(message.message_received_at, 'admission_time')
  const actualSendAt = instant(message.message_sent_at, 'actual_send_time')
  const explicit = instant(options.admissionAt, 'admission_time')
  const admissionSource = explicit ? 'explicit' : message.direction === 'outbound' ? 'pre_send' : localIngressAt ? 'local_ingress' : 'message_persisted'
  const admissionAt = explicit ?? (message.direction === 'outbound'
    ? new Date().toISOString()
    : localIngressAt ?? instant(message.created_at, 'admission_time'))
  if (!admissionAt) throw new Error('ediel_admission_time_missing')
  return Object.freeze({
    ...wireTimes,
    localIngressAt,
    actualSendAt,
    admissionAt,
    admissionDate: stockholmBusinessDate(new Date(admissionAt)),
    admissionSource,
    businessEffectiveDate: canonicalBusinessDate(message, canonical),
    replayAt: instant(options.replayAt, 'replay_time'),
  })
}

export function canonicalAdmissionDate(message: EdielMessageRow, options: EdielMessageTimeOptions = {}): string {
  return resolveEdielMessageTimeAnchors(message, undefined, options).admissionDate
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

export function resolveCanonicalMessagePolicy(message: EdielMessageRow, canonical: CanonicalEdielMessage = parseCanonicalMessageRow(message), options: EdielMessageTimeOptions & {deathStatusContext?:DeathStatusValidationContext} = {}): CanonicalEdielPolicy | null {
  if (canonical.family !== 'PRODAT' && canonical.family !== 'UTILTS' && canonical.family !== 'UTILTS_ERR' && canonical.family !== 'APERAK' && canonical.family !== 'CONTRL') return null
  if (!canonical.messageCode) throw new Error(`canonical_policy_message_code_missing:${canonical.family}`)

  const deathStatusContext=options.deathStatusContext
  if(deathStatusContext)assertDeathStatusContextMatches(message,deathStatusContext)
  const family = canonical.family
  const messageCode = canonical.messageCode
  const timeAnchors = resolveEdielMessageTimeAnchors(message, canonical, options)
  const candidate = (selectedGuideRevision?: string): CanonicalEdielPolicy => Object.freeze({ ...resolveCanonicalEdielPolicy({
    selectedGuideRevision,
    requestedCapability: requestedEdielCapability(message),
    family,
    messageCode,
    subtypeOrReasonCode: canonical.subtype,
    direction: message.direction,
    referenceDate: timeAnchors.admissionDate,
    associationAssignedCode: family === 'CONTRL' ? null : canonical.version,
    applicationReference: canonical.applicationReference,
    bilateralCapabilityVerified: family==='PRODAT' ? Boolean(sourceQualifiedProdatBilateralCapability(message,options.prodatSourceCapability)) || deathStatusContext?.bilateralCapabilityVerified===true : readBooleanFact(message, 'bilateralCapabilityVerified'),
    businessContext:deathStatusContext?.businessContext,
    prodatDependentFacts: family === 'PRODAT' ? {
      market: 'electricity',
      ...(deathStatusContext?{deathStatus:deathStatusContext.selection,businessContext:deathStatusContext.businessContext}:{}),
      customerKind: readStringFact(message, 'customerKind') as 'private' | 'business' | undefined,
      meterReadingsSentInUtilts: readBooleanFact(message, 'meterReadingsSentInUtilts'),
      multipleMeterRegisters: readBooleanFact(message, 'multipleMeterRegisters'),
      endUserAddressAvailable: readBooleanFact(message, 'endUserAddressAvailable'),
      invoiceeAddressDiffersFromEndUser: readBooleanFact(message, 'invoiceeAddressDiffersFromEndUser'),
      byCell: readObjectFact(message, 'byCell'),
    } : null,
    mode: 'parse',
  }), timeAnchors })
  const current = candidate()
  // GOV-05: every inbound family with a dated guide successor (UTILTS and its
  // UTILTS_ERR/APERAK companions on the shared E5SE5A code) may be tried
  // against the immediately preceding guide during the two-week grace window.
  const guideFamilyWithGrace = family === 'UTILTS' || family === 'UTILTS_ERR' || family === 'APERAK'
  if (!guideFamilyWithGrace || message.direction !== 'inbound' || !current.previousGuideGraceActive) return withGuideSelection(current, 'current_only', [])
  const passesGuide = (policy: CanonicalEdielPolicy) => {
    if (family !== 'UTILTS') {
      return !validateCanonicalAckGuide({ policy, rawPayload: message.raw_payload, rawSegments: canonical.rawSegments, una: canonical.una })
        .some(finding => finding.blocking || finding.severity === 'error')
    }
    const result = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy, guideOnly: true })
    return result.validation.syntaxOk && !result.validation.issues.some(issue => issue.severity === 'error' && issue.kind === 'application')
  }
  // Complete syntax/guide passes only. Functional rejection must never cause
  // a switch to older semantics, and candidates must never blend diagnostics.
  const evaluated: { guideRevision: string; passed: boolean }[] = []
  const currentPassed = passesGuide(current)
  evaluated.push({ guideRevision: current.guide.guideRevision, passed: currentPassed })
  if (currentPassed) return withGuideSelection(current, 'current_guide', evaluated)
  for (const guide of current.acceptedInboundGuides) {
    if (guide.guideRevision === current.guide.guideRevision) continue
    const previous = candidate(guide.guideRevision)
    const passed = passesGuide(previous)
    evaluated.push({ guideRevision: guide.guideRevision, passed })
    if (passed) return withGuideSelection(previous, 'previous_guide_grace', evaluated)
  }
  return withGuideSelection(current, 'current_guide_no_candidate_passed', evaluated)
}

/** GOV-05: the selected complete package and every whole-guide candidate tried
 * are carried (and thereby logged) with the decision. */
function withGuideSelection(policy: CanonicalEdielPolicy, basis: CanonicalGuideSelection['basis'], evaluated: readonly { guideRevision: string; passed: boolean }[]): CanonicalEdielPolicy {
  return Object.freeze({ ...policy, guideSelection: Object.freeze({
    selectedGuideRevision: policy.guide.guideRevision,
    basis,
    evaluated: Object.freeze(evaluated.map(entry => Object.freeze({ ...entry }))),
  }) })
}
