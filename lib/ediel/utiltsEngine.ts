import {type PeriodicReasonAuthority} from '@/lib/ediel/utilts/periodicReasonAuthority'
import {applyPeriodicReasonGuide} from '@/lib/ediel/utilts/periodicReasonGuide'
import {utiltsIssuerIdentityFacts,type UtiltsIssuerIdentityAuthority,type UtiltsIssuerIdentityFacts} from '@/lib/ediel/utilts/issuerIdentityAuthority'
import { canonicalAdmissionDate, resolveCanonicalMessagePolicy, resolveEdielMessageTimeAnchors } from '@/lib/ediel/core/messagePolicy'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { segmentComposite,segmentUntrimmedRaw, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { utiltsQuantityUnitGuideIssues } from '@/lib/ediel/utilts/quantityUnitScope'
import {utiltsDecimalGuideIssues,utiltsPrecisionFunctionalIssues} from '@/lib/ediel/utilts/quantityPrecision'
import {takeQualifiedUtiltsRuntimeOwner} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import { utiltsPackagingGuideViolations } from '@/lib/ediel/utilts/packagingGuide'
import { utiltsObservationOrderGuideIssues } from '@/lib/ediel/utilts/observationOrderGuide'
import { resolveUtiltsHeaderGuideIssues } from '@/lib/ediel/utilts/headerGuide'
import { resolveAuthoritativeEdielGuide } from '@/lib/ediel/rulebook/guideRegistry'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
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
import { resolveUtiltsTransactionId } from '@/lib/ediel/utilts/transactionIdentity'
import {
  decideUtiltsRuntimeAckPlan,
  normalizeUtiltsRuntimePayload,
  parseUtiltsRuntimeFacts,
  utiltsRuntimeSegments,
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
  /** Internal whole-guide candidate selection; never authorizes effects/ACKs. */
  guideOnly?: boolean
  issuerIdentityAuthority?:UtiltsIssuerIdentityAuthority;periodicReasonAuthority?:PeriodicReasonAuthority
}

const PRE_TENANT_OBJECT_SENTINEL = '00000000-0000-0000-0000-000000000000'

const runtimeOwners=new WeakMap<UtiltsRuntimeResult,{sourceHash:string;resultHash:string;policy:CanonicalEdielPolicy;issuerIdentityAuthority?:UtiltsIssuerIdentityAuthority;periodicReasonAuthority?:PeriodicReasonAuthority}>()
export function utiltsRuntimeOwnerFingerprint(message:EdielMessageRow,runtime:UtiltsRuntimeResult):{sourceHash:string;resultHash:string} {
  return {sourceHash:evidenceHash(JSON.stringify(message)),resultHash:evidenceHash(JSON.stringify(runtime))}
}
/** One-use actual engine/structural-owner handoff. A copied or mutated runtime,
 * a different source context/policy, or a guide-only candidate has no owner. */
export function takeUtiltsRuntimeOwner(runtime:UtiltsRuntimeResult,message:EdielMessageRow,policy:CanonicalEdielPolicy,issuerIdentityAuthority?:UtiltsIssuerIdentityAuthority,periodicReasonAuthority?:PeriodicReasonAuthority):UtiltsRuntimeResult|null {
  const owner=runtimeOwners.get(runtime)
  runtimeOwners.delete(runtime)
  if(!owner) return takeQualifiedUtiltsRuntimeOwner(runtime,message,policy,issuerIdentityAuthority,periodicReasonAuthority)
  const scope=utiltsRuntimeOwnerFingerprint(message,runtime)
  return owner.policy===policy && owner.issuerIdentityAuthority===issuerIdentityAuthority && owner.periodicReasonAuthority===periodicReasonAuthority && owner.sourceHash===scope.sourceHash && owner.resultHash===scope.resultHash ? structuredClone(runtime) : null
}

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

  return canonicalAdmissionDate(message)
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
  if (validation.syntaxOk && input.result.ackPlan.utiltsHeaderRejection) {
    ackPlan.utiltsHeaderRejection = input.result.ackPlan.utiltsHeaderRejection
  }
  return { ...input.result, validation, transactionDispositions, ackPlan }
}

function qualifier(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function issueReference(issue: UtiltsValidationIssue): string {
  return String(issue.referenceNumber ?? issue.lineItemReference ?? '')
}

function transactionReference(transaction: UtiltsRuntimeTransaction, index: number): string {
  return String(transaction.transactionId ?? '') || `TX-${index + 1}`
}

function issueBelongsToTransaction(
  issue: UtiltsValidationIssue,
  transaction: UtiltsRuntimeTransaction,
  index: number,
  transactionCount: number,
): boolean {
  const reference = issueReference(issue)
  const transactionId = String(transaction.transactionId ?? '')
  if (!reference) return transactionCount === 1
  if (transactionId && reference === transactionId) return true
  return reference === transactionReference(transaction, index)
}

function rawTransactionGroups(facts: UtiltsRuntimeFacts): string[][] {
  const groups: string[][] = []
  let current: string[] | null = null
  for (const segment of utiltsRuntimeSegments(facts)) {
    if (/^IDE\+/i.test(segment)) {
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
    const reference = String(issue.referenceNumber ?? issue.lineItemReference ?? '')
    const transaction = input.result.facts.transactions.find((entry) =>
      reference ? String(entry.transactionId ?? '') === reference : false,
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
    // U25-A-4 Appendix 2: E90/E97/E98 energy-value controls remain for
    // E30/aggregates. The E66 legacy branch represents individual point data;
    // its own LOC+172 scope must not inherit those retired national rejections.
    if (!policy.validateIndividualMeteringPointEnergyValuesBeyondE30
      && input.result.facts.messageCode === 'E66'
      && ['E90', 'E97', 'E98'].includes(utiltsErrCode)) {
      const reference = issueReference(issue)
      const transaction = input.result.facts.transactions.find((entry, index) => transactionReference(entry, index) === reference)
        ?? (input.result.facts.transactions.length === 1 ? input.result.facts.transactions[0] : null)
      if (transaction?.meterPointId && !transaction.regulatingObjectPresent) return false
    }
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

/** Both original guide packages require supplied UNH/0065=UTILTS and
 * field312=E5SE5A (A3 appendix1 pp126–127; U pp121–122). Diagnose these
 * source errors before trying to select a policy from the invalid header.
 * This does not retain a replacement policy or authorize any effects. */
function s02SourceGuideHeaderIssues(message: EdielMessageRow, policy?: CanonicalEdielPolicy, options?: UtiltsRuntimeReferenceOptions): UtiltsValidationIssue[] {
  const wire = tokenizeEdifact(message.raw_payload)
  if (segmentComposite(wire.segments.find(segment => segment.tag === 'BGM'), 1, wire.una)[0] !== 'S02') return []
  const parts = segmentComposite(wire.segments.find(segment => segment.tag === 'UNH'), 2, wire.una)
  const referenceDate = policy?.referenceDate ?? canonicalAdmissionDate(message, { admissionAt: options?.referenceDate ?? undefined })
  const expectedAssociation = (policy?.guide ?? resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate })).associationAssignedCode
  const issues: UtiltsValidationIssue[] = []
  const report = (code: string, field: string, value: string | undefined) => issues.push({
    severity: 'error', kind: 'application', code, title: 'Ogiltig UTILTS-header',
    description: `${field} följer inte den ursprungliga S02-anvisningen.`,
    aperakErcCode: value ? '42' : '41', aperakFieldCode: field,
    aperakText: value ? `INCORRECT DATA ${value}` : 'MANDATORY FIELD MISSING',
  })
  if (parts[0] && parts[0] !== 'UTILTS') report('UTILTS_MESSAGE_TYPE_INVALID', 'UNH/0065', parts[0])
  if (parts[4] !== expectedAssociation) report(parts[4] ? 'UTILTS_ASSOCIATION_INVALID' : 'UTILTS_ASSOCIATION_MISSING', '312', parts[4])
  return issues
}

function applyUtiltsHeaderGuide(message: EdielMessageRow, result: UtiltsRuntimeResult, sourceGuideIssues: UtiltsValidationIssue[] = []): UtiltsRuntimeResult {
  const issues = [...resolveUtiltsHeaderGuideIssues(message, result.facts.messageCode), ...sourceGuideIssues]
  if (issues.length === 0) return result
  // These fields are in the message header: every IDE fails the guide gate, even
  // when no transaction identity was parsed. No functional finding is eligible.
  const retained = result.validation.issues.filter(issue => issue.severity !== 'error' || issue.kind !== 'functional')
  const rejected = rebuildUtiltsRuntimeResult({ message, result, issues: [...retained, ...issues] })
  // Provenance is owned by this physical header guide, not inferred from an
  // unreferenced error or the generic message ACK scope.
  if (rejected.ackPlan.shouldSendAperak && rejected.ackPlan.aperakOutcome === 'negative') rejected.ackPlan.utiltsHeaderRejection = {
    applicationErrors: decideUtiltsRuntimeAckPlan({ message, facts: result.facts,
      validation: rebuildValidation(issues) }).aperakApplicationErrors,
  }
  return rejected
}

/** National duplicate findings come solely from an authenticated prior
 * observation in the same legal issuer namespace. Absence/history/retention
 * failures hold eligible IDEs locally and supply no national error code. */
function applyUtiltsIssuerIdentityGuide(message:EdielMessageRow,result:UtiltsRuntimeResult,facts:UtiltsIssuerIdentityFacts):UtiltsRuntimeResult {
 const wire=tokenizeEdifact(message.raw_payload),bgm=wire.segments.find(segment=>segment.tag==='BGM'),ides=wire.segments.filter(segment=>segment.tag==='IDE')
 const issues:UtiltsValidationIssue[]=[]
 if(facts.messageReferenceCollision){
  if(!bgm)throw new Error('ediel_utilts_issuer_identity_source_mismatch')
  issues.push({severity:'error',kind:'application',code:'UTILTS_ISSUER_MESSAGE_REFERENCE_DUPLICATE',title:'Meddelandeidentiteten har redan använts',
   description:'En tidigare autentisk källa i samma juridiska avsändares namespace har samma fält203. Identiteter gäller över tid och alla avsändarens applikationer.',
   aperakErcCode:'42',aperakFieldCode:'203',aperakText:'INCORRECT DATA',aperakInvalidOccurrence:{segmentIndex:bgm.index,elementIndex:2,componentIndex:0}})
 }
 // A rejected physical header stops own-transaction guide checks. Preserve
 // earlier header diagnostics rather than replacing them with issuer203.
 for(const collision of facts.messageReferenceCollision||result.ackPlan.utiltsHeaderRejection?[]:facts.transactionReferenceCollisions){
  const observed=result.facts.transactions[collision.transactionIndex],physical=ides[collision.transactionIndex]
  if(!observed||observed.transactionId!==collision.transactionId||!physical)throw new Error('ediel_utilts_issuer_identity_source_mismatch')
  issues.push({severity:'error',kind:'application',code:'UTILTS_ISSUER_TRANSACTION_REFERENCE_DUPLICATE',title:'Transaktionsidentiteten har redan använts',
   description:'En tidigare autentisk källa i samma juridiska avsändares namespace har samma fält505. Identiteter gäller över tid och alla avsändarens applikationer.',
   aperakErcCode:'42',aperakFieldCode:'505',aperakText:'INCORRECT DATA',aperakInvalidOccurrence:{segmentIndex:physical.index,elementIndex:2,componentIndex:0},
   referenceQualifier:'ACW',referenceNumber:collision.transactionId,lineItemReference:collision.transactionId})
 }
 let qualified=issues.length?rebuildUtiltsRuntimeResult({message,result,issues:[...result.validation.issues,...issues]}):result
 if(facts.messageReferenceCollision){
  const own=decideUtiltsRuntimeAckPlan({message,facts:result.facts,validation:rebuildValidation(issues.filter(item=>item.aperakFieldCode==='203'))})
  qualified={...qualified,ackPlan:{...qualified.ackPlan,utiltsHeaderRejection:{applicationErrors:[...(result.ackPlan.utiltsHeaderRejection?.applicationErrors??[]),...own.aperakApplicationErrors]}}}
 }
 if(facts.status!=='held')return qualified
 const held=new Set(qualified.transactionDispositions.filter(item=>item.disposition==='accepted').map(item=>item.transactionId))
 if(!held.size)return qualified
 const dispositions=qualified.transactionDispositions.map(item=>held.has(item.transactionId)?{...item,disposition:'internal_review' as const,responseType:'none' as const,
  issueCodes:[...item.issueCodes,'UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE']}:item)
 return {...qualified,transactionDispositions:dispositions,validation:{...qualified.validation,ok:false,
  classification:qualified.validation.classification==='accepted'?'internal_review':qualified.validation.classification,
  issues:[...qualified.validation.issues,...[...held].map(transactionId=>({severity:'warning' as const,kind:'application' as const,code:'UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE',
   title:'Avsändarens identitetsunderlag saknas',description:facts.holdReason??'Juridisk avsändare, transportmandat, historiktäckning och retention måste styrkas. Ingen nationell dubblett har fabricerats.',referenceNumber:transactionId,lineItemReference:transactionId}))]},
  ackPlan:{...qualified.ackPlan,...(qualified.ackPlan.aperakOutcome==='positive'?{shouldSendAperak:false,aperakOutcome:null}:{}),reason:'Ej styrkt identitetsauktoritet håller egna godkända transaktioner utan positiv APERAK eller affärseffekt.'}}
}

function applyUtiltsIdeGuide(message: EdielMessageRow, result: UtiltsRuntimeResult): UtiltsRuntimeResult {
  const issues: UtiltsValidationIssue[] = []
  for (const [index, observed] of (result.facts.utiltsObservedTransactions ?? []).entries()) {
    if (observed.identityQualifier === '24') continue
    const missing = !observed.identityQualifier
    const reference = resolveUtiltsTransactionId(observed.transactionId, index)
    issues.push({
      severity: 'error', kind: 'application',
      code: missing ? 'UTILTS_IDE_QUALIFIER_MISSING' : 'UTILTS_IDE_QUALIFIER_INVALID',
      title: missing ? 'Transaktionskod saknas' : 'Ogiltig transaktionskod',
      description: `IDE/7495 ${missing ? 'saknas' : 'måste vara 24'}.`,
      aperakErcCode: missing ? '41' : '42', aperakFieldCode: '505',
      aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
      aperakInvalidOccurrence:{segmentIndex:observed.segmentIndex,elementIndex:1,componentIndex:0},
      referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
    })
  }
  return issues.length ? rebuildUtiltsRuntimeResult({ message, result, issues: [...result.validation.issues, ...issues] }) : result
}

function applyUtiltsGridAreaGuide(message: EdielMessageRow, result: UtiltsRuntimeResult): UtiltsRuntimeResult {
  const wire = tokenizeEdifact(message.raw_payload)
  const fields: Record<string, string> = { '239': '260a', '232': '260b', '233': '260c' }
  // U pp.55/63 attaches the inseparable 260b/260c pair to these application
  // profiles. An ERR may echo a malformed original and is not a new request.
  const pairedAreaProfile = new Set(['E30', 'E31', 'E66', 'S01', 'S07', 'E72', 'E73', 'E74', 'S06'])
  const issues: UtiltsValidationIssue[] = []
  for (const [index, observed] of (result.facts.utiltsObservedTransactions ?? []).entries()) {
    const reference = resolveUtiltsTransactionId(observed.transactionId, index)
    const pairedAreas = new Set<string>()
    let areaPresent=false,areaContent:string | null=null,characteristic:string | null=null,exchange=false
    for (const segment of observed.segments) {
      if (segment.tag === 'SEQ') break
      if(segment.tag==='CCI') characteristic=segmentComposite(segment,3,wire.una)[0] ?? null
      if(segment.tag==='CAV' && characteristic==='E12' && segmentComposite(segment,1,wire.una)[0]==='E20') exchange=true
      if (segment.tag !== 'LOC') continue
      const location = segmentComposite(segment, 1, wire.una)[0]
      const fieldCode = fields[location ?? '']
      if (!fieldCode) continue
      if(location==='239') areaPresent=true
      if (location === '232' || location === '233') pairedAreas.add(location)
      const parts = segmentComposite(segment, 2, wire.una)
      const value = parts[0] ?? ''
      // An empty own identifier already has ERC41 below; ERC42 must carry
      // erroneous received content (A3 p123 / U p118), never a borrowed value.
      if(location==='239' && value.trim()) areaContent=parts.join(':')
      const codeList = parts[1] ?? ''
      const agency = parts[2] ?? ''
      const missing = !value.trim() || !codeList || !agency
      if (!missing && Array.from(value).length === 3 && codeList === 'SVK' && agency === '260') continue
      issues.push({
        severity: 'error', kind: 'application',
        code: missing ? 'UTILTS_GRID_AREA_COMPONENT_MISSING' : 'UTILTS_GRID_AREA_COMPONENT_INVALID',
        title: missing ? 'Nätområdesfält saknas' : 'Ogiltigt nätområdesfält',
        description: `LOC+${location}/C517 måste innehålla tre tecken, SVK och 260.`,
        aperakErcCode: missing ? '41' : '42', aperakFieldCode: fieldCode,
        aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
        aperakInvalidOccurrence:{segmentIndex:segment.index,elementIndex:2,componentIndex:codeList!=='SVK' ? 1 : agency!=='260' ? 2 : 0},
        referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
      })
    }
    const exchangeProfile=['E30','E31','E66','S07','E74'].includes(result.facts.messageCode ?? '')
    if(!result.facts.isUtiltsErr && exchangeProfile && areaPresent && areaContent !== null && (exchange || pairedAreas.size>0)) issues.push({severity:'error',kind:'application',
      code:'UTILTS_EXCHANGE_SINGLE_AREA_NOT_USED',title:'Felaktig nätområdesscope',description:'När eget Exchange använder nätområdesparet260b/260c ska260a inte anges enligt U s55/63.',
      aperakErcCode:'42',aperakFieldCode:'260a',aperakText:`INCORRECT DATA ${areaContent}`,referenceQualifier:'ACW',referenceNumber:reference,lineItemReference:reference})
    if(!result.facts.isUtiltsErr && exchange && ['E31','E66','S07','E74'].includes(result.facts.messageCode ?? '') && pairedAreas.size===0) {
      for(const field of ['260b','260c']) issues.push({severity:'error',kind:'application',code:'UTILTS_EXCHANGE_AREA_PAIR_REQUIRED',title:'Nätområdespar saknas',
        description:'Eget Exchange kräver260b och260c enligt U s55/63.',aperakErcCode:'41',aperakFieldCode:field,aperakText:'MANDATORY FIELD MISSING',referenceQualifier:'ACW',referenceNumber:reference,lineItemReference:reference})
    }
    if (!result.facts.isUtiltsErr && pairedAreaProfile.has(result.facts.messageCode ?? '') && pairedAreas.size === 1) {
      const missingField = pairedAreas.has('232') ? '260c' : '260b'
      issues.push({
        severity: 'error', kind: 'application',
        code: 'UTILTS_GRID_AREA_PAIR_MISSING',
        title: 'Nätområdespar saknas',
        description: `LOC+232 och LOC+233 måste förekomma tillsammans inom samma IDE; ${missingField} saknas.`,
        aperakErcCode: '41', aperakFieldCode: missingField,
        aperakText: 'MANDATORY FIELD MISSING',
        referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
      })
    }
  }
  return issues.length ? rebuildUtiltsRuntimeResult({ message, result, issues: [...result.validation.issues, ...issues] }) : result
}

function invalidGs1Gsrn(value: string): boolean {
  return !/^\d{18}$/.test(value)
    || [...value].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 3 : 1), 0) % 10 !== 0
}

function applyUtiltsSuppliedRegulatingObjectGuide(message: EdielMessageRow, result: UtiltsRuntimeResult, referenceDate: string, policy?: CanonicalEdielPolicy): UtiltsRuntimeResult {
  const messageCode = result.facts.messageCode
  if (!['E66', 'S01', 'E73', 'S06'].includes(messageCode ?? '')) return result
  // S01/E73/S06 conditional LOC+175 is sourced from October 25-A-4.
  // Retain the existing E66 behavior until its earlier-profile source is reviewed.
  if (messageCode !== 'E66' && (policy?.guide ?? resolveAuthoritativeEdielGuide({
    family: 'UTILTS', referenceDate, associationAssignedCode: message.message_version,
  })).guideRevision !== '25-A-4') return result
  const wire = tokenizeEdifact(message.raw_payload)
  const issues: UtiltsValidationIssue[] = []
  let reference: string | null = null
  let inHeader = false
  for (const segment of wire.segments) {
    if (segment.tag === 'IDE') {
      inHeader = segmentComposite(segment, 1, wire.una)[0] === '24'
      reference = inHeader ? segmentComposite({...segment,raw:segmentUntrimmedRaw(segment)}, 2, wire.una)[0] || null : null
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
    const gs1CheckDigitInvalid = agency === '9' && Boolean(value) && invalidGs1Gsrn(value)
    if (value && agency && !invalid && !gs1CheckDigitInvalid) continue
    const missing = !value || !agency
    issues.push({
      severity: 'error', kind: 'application',
      code: !value ? 'UTILTS_REGULATING_OBJECT_ID_MISSING' : missing ? 'UTILTS_REGULATING_OBJECT_AGENCY_MISSING' : invalid ? 'UTILTS_REGULATING_OBJECT_AGENCY_INVALID' : 'UTILTS_REGULATING_OBJECT_GS1_CHECK_DIGIT_INVALID',
      title: !value ? 'Reglerobjektsid saknas' : missing ? 'Byråkod för reglerobjekt saknas' : invalid ? 'Ogiltig byråkod för reglerobjekt' : 'Ogiltig GS1-kontrollsiffra',
      description: !value ? 'LOC+175/C517/3225 saknas.' : missing ? 'LOC+175/C517/3055 saknas.' : invalid ? 'LOC+175/C517/3055 måste vara 9 eller 89.' : 'LOC+175/C517/3225 har ogiltig GS1-kontrollsiffra.',
      aperakErcCode: missing ? '41' : '42', aperakFieldCode: '533',
      aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
      aperakInvalidOccurrence:{segmentIndex:segment.index,elementIndex:2,componentIndex:invalid ? 2 : 0},
      referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
    })
  }
  return issues.length ? rebuildUtiltsRuntimeResult({ message, result, issues: [...result.validation.issues, ...issues] }) : result
}

function applyUtiltsSuppliedMeteringPointGuide(message: EdielMessageRow, result: UtiltsRuntimeResult, referenceDate: string, policy?: CanonicalEdielPolicy): UtiltsRuntimeResult {
  // Validate supplied LOC+172 in the applicable data/request profiles in
  // U pp.51,54,63,123. E66/E73 absence depends on the 172/175 object domain.
  if (!['E30', 'E66', 'S07', 'E72', 'E73', 'S02'].includes(result.facts.messageCode ?? '')) return result
  // UG-123-11/12 here is sourced from 25-A-4. A bounded English 25-A-3
  // amendment covers E61/E62, but it has not qualified these identity rows;
  // the shared E5SE5A wire does not project this rule onto the prior guide.
  let selectedGuide = policy?.guide
  if (!selectedGuide) {
    if (result.facts.messageCode === 'S02') {
      try {
        selectedGuide = resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate, associationAssignedCode: result.facts.messageVersion })
      } catch { return result }
    } else {
      selectedGuide = resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate, associationAssignedCode: message.message_version })
    }
  }
  if (selectedGuide.guideRevision !== '25-A-4') return result
  const wire = tokenizeEdifact(message.raw_payload)
  const issues: UtiltsValidationIssue[] = []
  for (const [index, observed] of (result.facts.utiltsObservedTransactions ?? []).entries()) {
    const reference = resolveUtiltsTransactionId(observed.transactionId, index)
    let supplied = false
    for (const segment of observed.segments) {
      if (segment.tag === 'SEQ') break
      if (segment.tag !== 'LOC' || segmentComposite(segment, 1, wire.una)[0] !== '172') continue
      supplied = true
      const parts = segmentComposite(segment, 2, wire.una)
      const value = parts[0]?.trim() ?? ''
      const agency = parts[2]?.trim() ?? ''
      const missing = !value || !agency
      const invalidAgency = Boolean(agency && !['9', '89'].includes(agency))
      // The supplied agency-9 GSRN has an 18-digit modulo-10 control digit.
      // Agency 89 is a national identity and is outside this GS1 arithmetic.
      const invalidGs1 = agency === '9' && Boolean(value) && invalidGs1Gsrn(value)
      if (!missing && !invalidAgency && !invalidGs1) continue
      issues.push({
        severity: 'error', kind: 'application',
        code: !value ? 'UTILTS_METERING_POINT_ID_MISSING' : !agency ? 'UTILTS_METERING_POINT_AGENCY_MISSING'
          : invalidAgency ? 'UTILTS_METERING_POINT_AGENCY_INVALID' : 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID',
        title: missing ? 'Anläggningsidentitet saknas' : 'Ogiltig anläggningsidentitet',
        description: 'LOC+172/C517 kräver anläggningsid med byråkod 9 eller 89 och giltig GS1-kontrollsiffra när 9 används.',
        aperakErcCode: missing ? '41' : '42', aperakFieldCode: '209',
        aperakText: missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
        aperakInvalidOccurrence:{segmentIndex:segment.index,elementIndex:2,componentIndex:invalidAgency ? 2 : 0},
        referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
      })
    }
    if (!supplied && ['E30', 'S07', 'E72'].includes(result.facts.messageCode ?? '')) {
      issues.push({
        severity: 'error', kind: 'application', code: 'UTILTS_METERING_POINT_ID_MISSING',
        title: 'Anläggningsidentitet saknas', description: 'SG5/LOC+172 krävs för denna transaktion.',
        aperakErcCode: '41', aperakFieldCode: '209', aperakText: 'MANDATORY FIELD MISSING',
        referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
      })
    }
  }
  return issues.length ? rebuildUtiltsRuntimeResult({ message, result, issues: [...result.validation.issues, ...issues] }) : result
}

function applyUtiltsS02PlanningGuide(message: EdielMessageRow, result: UtiltsRuntimeResult, referenceDate: string, retained?: CanonicalEdielPolicy): UtiltsRuntimeResult {
  if (result.facts.messageCode !== 'S02') return result
  const transactions = result.facts.utiltsObservedTransactions ?? []
  // Do not replace any blocking legacy issue unless the physical projection
  // accounts for every transaction. Metadata cannot supply absent ownership.
  if (!transactions.length || transactions.length !== result.facts.transactions.length || transactions.some((transaction, index) =>
    resolveUtiltsTransactionId(transaction.transactionId, index) !== resolveUtiltsTransactionId(result.facts.transactions[index]?.transactionId, index))) return result
  let policy = retained
  if (!policy) {
    try {
      policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'S02', direction: message.direction,
        referenceDate, associationAssignedCode: result.facts.messageVersion, applicationReference: result.facts.applicationReference, mode: 'parse' })
    } catch {
      // Raw validators return structured validation; keep its existing errors
      // when the physical envelope cannot select this canonical projection.
      return result
    }
  }
  // Both hash-qualified 25-A-3 (pp52/53/98) and 25-A-4 (pp51/52/95)
  // require own point209 and each observation's own planned quantity515.
  // Keep selection of the complete guide package and its identity rules.
  const required = (field: string) => policy.fieldRules.some(rule => 'fieldNo' in rule && rule.fieldNo === field && rule.requirements.S02 === 'R')
  if (!required('209') || !required('515')) return result
  const wire = tokenizeEdifact(message.raw_payload)
  // Replace only S02 legacy missing-field fallbacks with the canonical own
  // SG5/SEQ checks. Their global/wrong-field issues must not reject siblings.
  const legacy = new Set(['UTILTS_MISSING_METERING_POINT', 'UTILTS_PROFILE_METERING_POINT_MISSING', 'UTILTS_PROFILE_QUANTITY_MISSING'])
  const issues = result.validation.issues.filter(issue => !legacy.has(issue.code))
  for (const [index, observed] of transactions.entries()) {
    const reference = resolveUtiltsTransactionId(observed.transactionId, index)
    const boundary = observed.segments.findIndex(segment => segment.tag === 'SEQ')
    const header = observed.segments.slice(0, boundary < 0 ? observed.segments.length : boundary)
    const missingPoint = required('209') && !header.some(segment => segment.tag === 'LOC'
      && segmentComposite(segment, 1, wire.una)[0] === '172'
      && Boolean(segmentComposite(segment, 2, wire.una)[0]?.trim()))
    const missingQuantity = required('515') && (!observed.observations.length || observed.observations.some(observation =>
      !observation.quantities.some(quantity => quantity.qualifier === '135' && quantity.value !== null && quantity.value.trim() !== '')))
    for (const field of [...(missingPoint ? ['209'] : []), ...(missingQuantity ? ['515'] : [])]) issues.push({
      severity: 'error', kind: 'application', code: field === '209' ? 'UTILTS_METERING_POINT_ID_MISSING' : 'UTILTS_S02_PLANNED_QUANTITY_MISSING',
      title: field === '209' ? 'Anläggningsidentitet saknas' : 'Planerad kvantitet saknas',
      description: field === '209' ? 'S02 kräver egen SG5/LOC+172.' : 'Varje S02-observation kräver egen SG11/QTY+135.',
      aperakErcCode: '41', aperakFieldCode: field, aperakText: 'MANDATORY FIELD MISSING',
      referenceQualifier: 'ACW', referenceNumber: reference, lineItemReference: reference,
    })
  }
  return rebuildUtiltsRuntimeResult({ message, result, issues })
}

function canonicalE66PersistenceTransactions(facts: UtiltsRuntimeFacts): Array<Record<string, unknown>> {
  const timezone = parseEdifactTimezoneOffsetFromSegments(utiltsRuntimeSegments(facts))
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

  const timezone = parseEdifactTimezoneOffsetFromSegments(utiltsRuntimeSegments(result.facts))
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

function runUtiltsRuntimeForMessageCore(
  message: EdielMessageRow,
  options?: UtiltsRuntimeReferenceOptions,
): UtiltsRuntimeResult {
  let canonicalPolicy = options?.canonicalPolicy
  if (canonicalPolicy && (
    canonicalPolicy.family !== 'UTILTS'
    || (Boolean(message.message_code) && canonicalPolicy.code !== message.message_code)
    || canonicalPolicy.direction !== message.direction
    || !canonicalPolicy.utiltsProcessability
  )) {
    throw new Error('utilts_runtime_policy_context_mismatch')
  }
  if (canonicalPolicy?.timeAnchors) {
    const retained = canonicalPolicy.timeAnchors
    // Recheck source/time coherence with the retained explicit instants. This
    // never selects a guide or substitutes the processing/replay clock.
    try {
      if (!retained.admissionAt) throw new Error('utilts_runtime_policy_time_context_mismatch')
      const expected = resolveEdielMessageTimeAnchors(message, undefined, { admissionAt: retained.admissionAt, replayAt: retained.replayAt ?? undefined })
      const fields = [...Object.keys(expected).filter(key => key !== 'admissionSource'), 'value', 'format', 'originalOffset', 'timeBasis', 'qualifier']
      if (canonicalPolicy.referenceDate !== expected.admissionDate
        || (retained.admissionSource === 'local_ingress' && retained.admissionAt !== expected.localIngressAt)
        || JSON.stringify(retained, fields) !== JSON.stringify(expected, fields)) {
        throw new Error('utilts_runtime_policy_time_context_mismatch')
      }
    } catch {
      // Our own incoherent decision has no national field-error authority.
      throw new Error('utilts_runtime_policy_time_context_mismatch')
    }
  }
  // The selected processability profile is part of the decision. Matching may
  // enrich tenant/object facts, but must not choose a new guide at receipt time.
  const validationMessage = runtimeValidationMessage(message)
  // Cached persistence status is not physical syntax evidence on replay. Use
  // the existing wire validator before either guide or functional execution.
  let syntaxIssues: UtiltsValidationIssue[]
  try {
    const syntax = validateEdifactSyntax(message)
    if (syntax.grammarQualification === 'unavailable') throw new Error('ediel_unsm_directory_source_unavailable')
    syntaxIssues = syntax.issues
      .filter(issue => issue.code !== 'syntax_check_failed' && issue.code !== 'message_failed')
      .map(issue => ({ ...issue, kind: 'syntax', edielErrorCode: '7' }))
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'edifact_dangling_release_character') throw error
    syntaxIssues = [{severity:'error',kind:'syntax',code:'edifact_dangling_release_character',title:'Ogiltig EDIFACT-release',
      description:'Den fysiska källan slutar med ett release-tecken utan efterföljande tecken.',edielErrorCode:'7'}]
  }
  if (syntaxIssues.some(issue => issue.severity === 'error')) {
    let facts: UtiltsRuntimeFacts
    try {
      facts = parseUtiltsRuntimeFacts(message.raw_payload ?? '')
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'edifact_dangling_release_character') throw error
      // Undecodable input has no AST, IDE, business identity or addressable
      // envelope evidence. It still has a typed syntax rejection; downstream
      // response admission must independently resolve the original envelope.
      facts = {messageFamily:'UTILTS',messageCode:null,transactionReference:null,externalReference:null,applicationReference:null,
        senderEdielId:null,receiverEdielId:null,rawSegments:[],parsedPayload:{},messageReference:null,messageVersion:null,
        documentReference:null,interchangeReference:null,market:null,stage:null,senderRole:null,receiverRole:null,subordinateRole:null,
        meterPointId:null,gridAreaId:null,transactionId:null,deliveryPeriodRaw:null,deliveryPeriodStart:null,deliveryPeriodEnd:null,
        registrationTime:null,resolution:null,transactionReason:null,unit:null,quantities:[],transactions:[],references:[],isUtiltsErr:false}
    }
    const validation = rebuildValidation(syntaxIssues)
    return {
      facts,
      normalizedPayload: normalizeUtiltsRuntimePayload(facts, message),
      validation,
      transactionDispositions: resolveUtiltsTransactionDispositions({
        syntaxOk: false, transactions: facts.transactions, issues: syntaxIssues,
      }),
      ackPlan: decideUtiltsRuntimeAckPlan({ message, facts, validation }),
    }
  }
  // Shared admission selects one complete source guide package. Candidate
  // passes always carry an explicit policy, so this default path cannot recurse.
  const sourceGuideIssues = s02SourceGuideHeaderIssues(message, canonicalPolicy, options)
  if (!canonicalPolicy) {
    try {
      canonicalPolicy = resolveCanonicalMessagePolicy(message,undefined,{admissionAt:options?.referenceDate ?? undefined}) ?? undefined
    } catch (error) {
      // The physical S02 header already proves this guide lookup unavailable.
      // Preserve its typed refusal; capability, time, ambiguous-guide and all
      // other internal failures still propagate without a replacement policy.
      if (!sourceGuideIssues.length || !(error instanceof Error) || !error.message.startsWith('ediel_guide_resolution_missing:')) throw error
    }
  }
  const referenceDate = canonicalPolicy?.referenceDate ?? normalizedReferenceDate(message, options)
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
  const packagingWire = tokenizeEdifact(message.raw_payload)
  const packagingIssues: UtiltsValidationIssue[] = utiltsPackagingGuideViolations(message.raw_payload ?? '').flatMap(violation => guideEffective.facts.transactions.map((transaction,index) => {
    const observed = guideEffective.facts.utiltsObservedTransactions?.[index]
    const ownHeader = observed?.segments.filter(segment => segment.index < (observed.observations[0]?.segmentIndex ?? Infinity)) ?? []
    const messageHeaderStart = observed ? packagingWire.segments.filter(segment => segment.tag === 'UNH' && segment.index < observed.segmentIndex).at(-1)?.index : undefined
    const messageHeaderEnd = messageHeaderStart === undefined ? undefined : packagingWire.segments.find(segment => segment.index > messageHeaderStart && ['IDE','UNT','UNH'].includes(segment.tag))?.index
    const messageHeader = messageHeaderStart === undefined ? [] : packagingWire.segments.filter(segment => segment.index >= messageHeaderStart && segment.index < (messageHeaderEnd ?? Infinity))
    // ERC42 retains this physical IDE/message's received field, never a
    // batch summary or another IDE's reason/resolution (U p118, prior p123).
    const received = violation.field === '223' ? segmentComposite(ownHeader.find(segment => segment.tag === 'STS' && segmentComposite(segment,1,packagingWire.una)[0] === '7'),3,packagingWire.una)[0]
      : violation.field === '508' ? segmentComposite(ownHeader.find(segment => segment.tag === 'DTM' && segmentComposite(segment,1,packagingWire.una)[0] === '354'),1,packagingWire.una)[1]
      : violation.field === 'UNH/0062' ? segmentComposite(messageHeader.find(segment => segment.tag === 'UNH'),1,packagingWire.una)[0]
      : violation.field === 'NAD/3039' ? segmentComposite(messageHeader.find(segment => segment.tag === 'NAD' && segmentComposite(segment,1,packagingWire.una)[0] === 'MR'),2,packagingWire.una)[0] : undefined
    return {
      severity:'error' as const,kind:'application' as const,code:violation.code,title:'Felaktig UTILTS-paketering',description:violation.description,
      aperakErcCode:received ? '42' : '41',aperakFieldCode:violation.field,aperakText:received ? `INCORRECT DATA ${received}` : 'MANDATORY FIELD MISSING',
      ...(received && ['223','508'].includes(violation.field) ? {aperakInvalidOccurrence:(()=>{const own=ownHeader.find(segment=>segment.tag===(violation.field==='223'?'STS':'DTM')&&segmentComposite(segment,1,packagingWire.una)[0]===(violation.field==='223'?'7':'354'));return own?{segmentIndex:own.index,elementIndex:violation.field==='223'?3:1,componentIndex:violation.field==='223'?0:1}:null})()} : {}),referenceQualifier:transaction.transactionId ? 'ACW' : null,
      referenceNumber:transaction.transactionId,lineItemReference:transaction.transactionId,
    }
  }))
  const ordered = rebuildUtiltsRuntimeResult({message,result:guideEffective,issues:[...guideEffective.validation.issues,...packagingIssues,...utiltsQuantityUnitGuideIssues(message.raw_payload ?? ''),...utiltsDecimalGuideIssues(message.raw_payload ?? ''),...utiltsObservationOrderGuideIssues(message.raw_payload ?? '')]})
  let guided = applyUtiltsS02PlanningGuide(message, applyUtiltsSuppliedMeteringPointGuide(message, applyUtiltsSuppliedRegulatingObjectGuide(message, applyUtiltsGridAreaGuide(message, applyUtiltsIdeGuide(message, applyUtiltsHeaderGuide(message, ordered, sourceGuideIssues))), referenceDate, canonicalPolicy), referenceDate, canonicalPolicy), referenceDate, canonicalPolicy)
  if (options?.guideOnly) return guided
  if(canonicalPolicy)guided=applyPeriodicReasonGuide({message,policy:canonicalPolicy,result:guided,authority:options?.periodicReasonAuthority,rebuild:rebuildUtiltsRuntimeResult})
  if(options?.issuerIdentityAuthority){
    if(!canonicalPolicy)throw new Error('ediel_utilts_issuer_identity_policy_required')
    guided=applyUtiltsIssuerIdentityGuide(message,guided,utiltsIssuerIdentityFacts({authority:options.issuerIdentityAuthority,message,policy:canonicalPolicy}))
  }
  const eligible = new Set(guided.transactionDispositions
    .filter(item => item.disposition === 'accepted')
    .map(item => String(item.transactionId ?? '')))
  if (eligible.size === 0) {
    const retained=applyCanonicalE66PersistencePayload(guided)
    if(options?.canonicalPolicy)runtimeOwners.set(retained,{...utiltsRuntimeOwnerFingerprint(message,retained),policy:options.canonicalPolicy,issuerIdentityAuthority:options.issuerIdentityAuthority,periodicReasonAuthority:options.periodicReasonAuthority})
    return retained
  }

  const functionalBase = runLegacyUtiltsRuntimeForMessage(validationMessage, { functionalEligible: eligible })
  const functionalCorrected = applyCanonicalE66QuantityPolicyToRuntimeResult({
    message,
    result: applyUtiltsResolutionFormatPolicyToRuntimeResult({ message, result: functionalBase }),
    functionalEligible: eligible,
  })
  const functionalEffective = applyUtiltsEffectiveDatePolicyToRuntimeResult({
    message, result: functionalCorrected, referenceDate, processabilityPolicy: canonicalPolicy?.utiltsProcessability,
  })
  const issues = [...guided.validation.issues, ...functionalEffective.validation.issues.filter(issue => issue.kind === 'functional'),...utiltsPrecisionFunctionalIssues(message.raw_payload ?? '',eligible)]
  return applyCanonicalE66PersistencePayload(rebuildUtiltsRuntimeResult({ message, result: guided, issues }))
}

export function runUtiltsRuntimeForMessage(message:EdielMessageRow,options?:UtiltsRuntimeReferenceOptions):UtiltsRuntimeResult {
  const runtime=runUtiltsRuntimeForMessageCore(message,options)
  // Final effect paths always provide their retained policy. Guide candidates
  // and diagnostic calls with no source-qualified retained policy cannot seal.
  if(options?.canonicalPolicy && !options.guideOnly) runtimeOwners.set(runtime,{...utiltsRuntimeOwnerFingerprint(message,runtime),policy:options.canonicalPolicy,issuerIdentityAuthority:options.issuerIdentityAuthority,periodicReasonAuthority:options.periodicReasonAuthority})
  return runtime
}
