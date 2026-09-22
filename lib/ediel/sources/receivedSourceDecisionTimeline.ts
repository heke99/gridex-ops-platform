import {isDeepStrictEqual} from 'node:util'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {evidenceHash, isEvidenceRecord, isEvidenceUuid, type ReceivedSourceScope} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'

type RecordValue = Record<string, unknown>
type ObjectScope = Omit<ProdatRegisterValidationEvidence['objects'][number], 'disposition' | 'reasons'>
type Disposition = 'accepted' | 'rejected' | 'unavailable'
type ObservedObject = {object: ObjectScope; disposition: Disposition; reasons: string[]}
export type RecordedSourceAssessment = {
  assessmentId: string; previousAssessmentId: string | null; canonicalAssessmentId: string; factsHash: string
  assessedAt: string; availableAt: string | null; availabilityWitnessId: string | null
  recordedDisposition: Disposition; objects: ObservedObject[]
}
type Revision = RecordedSourceAssessment & {availability: 'witnessed_by_cutoff' | 'not_witnessed_by_cutoff' | 'after_cutoff'}
export type SourceDecisionTimeline = {
  version: 1; owner: 'received-source-decision-timeline-v1'
  status: 'not_requested' | 'inspected' | 'incomplete' | 'read_failed'; reason: string | null
  authorityStatus: 'not_established'; selection: 'not_performed'; marketSupersession: 'not_performed'
  historyCoverage: 'before_ledger_unknown'; boundedReadComplete: boolean
  snapshotId: string | null; readsetHash: string | null; cutoffAt: string | null; ledgerStartedAt: string | null; sourceCount: number | null
  sources: {
    sourceMessageId: string; payloadHash: string | null; receivedAt: string | null; capturedAt: string; messageCode: string | null
    visibility: 'witnessed' | 'incomplete' | 'no_assessment' | 'not_available_at_cutoff'
    asOf: RecordedSourceAssessment | null; revisions: Revision[]
  }[]
}
const LIMIT = {sources: 1000, assessments: 128, wireBytes: 262144, factBytes: 262144, inputBytes: 6291456, readsetBytes: 8388608, segments: 32768}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const keys = (value: unknown, expected: readonly string[]): value is RecordValue => isEvidenceRecord(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))
const reasons = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 128
  && value.every(reason => typeof reason === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(reason)) && new Set(value).size === value.length
const sameInstant = (left: unknown, right: unknown) => parseSourceReceiptInstant(left) !== null && parseSourceReceiptInstant(left) === parseSourceReceiptInstant(right)

/** An inspected readset is not a transferable approval capability. This module
 * projects immutable decisions returned by the service-only snapshot RPC; it
 * neither re-runs owners from status JSON nor selects a market baseline. */
export function emptySourceDecisionTimeline(): SourceDecisionTimeline {
  return {version: 1, owner: 'received-source-decision-timeline-v1', status: 'not_requested', reason: null,
    authorityStatus: 'not_established', selection: 'not_performed', marketSupersession: 'not_performed', historyCoverage: 'before_ledger_unknown',
    boundedReadComplete: false, snapshotId: null, readsetHash: null, cutoffAt: null, ledgerStartedAt: null, sourceCount: null, sources: []}
}
function scopeOf(value: unknown): ReceivedSourceScope | null {
  if (!isEvidenceRecord(value) || !isEvidenceUuid(value.companyId) || (value.environment !== 'test' && value.environment !== 'production')
    || typeof value.cutoffAt !== 'string' || parseSourceReceiptInstant(value.cutoffAt) === null) return null
  return {companyId: value.companyId, environment: value.environment as ReceivedSourceScope['environment'], cutoffAt: value.cutoffAt}
}
class TimelineBoundaryError extends Error {
  readonly kind: 'incomplete' | 'read_failed'
  readonly reason: string
  constructor(kind: 'incomplete' | 'read_failed', reason: string) { super(reason); this.kind = kind; this.reason = reason }
}
function requireBoundary(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new TimelineBoundaryError('read_failed', reason)
}
function withinBudget(condition: boolean) {
  if (!condition) throw new TimelineBoundaryError('incomplete', 'timeline_read_budget_exceeded')
}
function instant(value: unknown): bigint {
  const parsed = parseSourceReceiptInstant(value)
  requireBoundary(parsed !== null, 'timeline_instant_invalid')
  return parsed
}
function sourceBinding(proof: RecordValue, source: RecordValue, scope: ReceivedSourceScope, receiptKey: string): boolean {
  return proof.sourceMessageId === source.sourceMessageId && proof.sourcePayloadHash === source.payloadHash
    && proof.companyId === scope.companyId && proof.environment === scope.environment && sameInstant(proof[receiptKey], source.receivedAt)
}

/** Validate scope and the serialized owner's closed marker, not its authority.
 * The database already checks the actual owner rows in one MVCC statement.
 * Recreating those reads here would replace historical evidence with today's
 * mutable state, and a digest by itself would authenticate nothing. */
function observedObjects(facts: unknown, source: RecordValue, scope: ReceivedSourceScope, assessed: bigint): ObservedObject[] {
  requireBoundary(keys(facts, ['version', 'owner', 'ruleVersion', 'canonicalFactsHash', 'objects']) && facts.version === 1
    && facts.owner === 'received-source-object-decisions-v1' && facts.ruleVersion === '1' && hash(facts.canonicalFactsHash)
    && Array.isArray(facts.objects) && facts.objects.length > 0 && facts.objects.length <= 8192, 'timeline_facts_invalid')
  const objects: ObservedObject[] = []
  for (const entry of facts.objects) {
    requireBoundary(keys(entry, ['object', 'disposition', 'reasons', 'business', 'party']) && isEvidenceRecord(entry.object)
      && typeof entry.disposition === 'string' && ['accepted', 'rejected', 'unavailable'].includes(entry.disposition) && reasons(entry.reasons)
      && (entry.disposition === 'accepted' ? entry.reasons.length === 0 : entry.reasons.length > 0), 'timeline_object_invalid')
    const business = entry.business, party = entry.party
    if (business !== null) requireBoundary(isEvidenceRecord(business) && sourceBinding(business, source, scope, 'sourceReceivedAt')
      && isDeepStrictEqual(business.object, entry.object), 'timeline_business_scope_invalid')
    if (party !== null) requireBoundary(isEvidenceRecord(party) && isEvidenceRecord(party.source)
      && sourceBinding(party.source, source, scope, 'receivedAt') && isDeepStrictEqual(party.object, entry.object), 'timeline_party_scope_invalid')
    if (entry.disposition === 'accepted') {
      requireBoundary(source.messageCode === 'Z04' && entry.object.messageIndex === 0 && entry.object.identityAgency === '9'
        && isEvidenceRecord(business) && business.version === 1 && business.owner === 'inbound-z04-switch-confirmation-v1'
        && business.coverage === 'committed_switch_and_supply_only' && business.sourceDisposition === 'not_established'
        && business.businessDisposition === 'committed' && business.graphNamespace === 'legacy_unqualified'
        && [business.switchRequestId, business.supplyPeriodId, business.customerId, business.meteringPointId, business.siteId].every(isEvidenceUuid)
        && isEvidenceRecord(business.committedRecords) && isEvidenceRecord(business.committedRecords.switch) && isEvidenceRecord(business.committedRecords.supply)
        && isEvidenceRecord(party) && party.version === 1 && party.owner === 'received-source-party-binding-v1' && party.ruleVersion === '1'
        && party.disposition === 'accepted' && reasons(party.reasons) && party.reasons.length === 0
        && isEvidenceRecord(party.receiver) && isEvidenceRecord(party.receiver.evidence) && party.receiver.evidence.completeness === 'exact_count', 'timeline_accepted_owner_missing')
      const receipt = instant(source.receivedAt), businessAt = instant(business.assessedAt), partyAt = instant(party.assessedAt), complete = instant(party.completedAt)
      requireBoundary(businessAt >= receipt && businessAt <= assessed && partyAt >= receipt && partyAt <= complete && complete <= assessed, 'timeline_owner_time_invalid')
    }
    objects.push({object: entry.object as ObjectScope, disposition: entry.disposition as Disposition, reasons: entry.reasons})
  }
  // Source disposition is NOT the canonical-register disposition. Use neutral
  // unavailable facets solely for physical binding, including multi-message or
  // rejected sources whose actual canonical facets may have been unavailable.
  const physical = bindReceivedRegisterValidation({version: 1, owner: 'validateProdatRegisterPolicy', coverage: 'canonical_register_only',
    objects: objects.map(entry => ({...entry.object, disposition: 'unavailable', reasons: ['timeline_physical_binding_only']}))}, source.rawPayload as string)
  requireBoundary(physical !== null, 'timeline_physical_membership_invalid')
  return objects
}

type CheckedRevision = {record: RecordedSourceAssessment; at: bigint; available: bigint | null}
function orderChain(rows: CheckedRevision[]): CheckedRevision[] {
  if (!rows.length) return []
  const byId = new Map(rows.map(row => [row.record.assessmentId, row])), children = new Map<string | null, CheckedRevision>()
  for (const row of rows) {
    const parent = row.record.previousAssessmentId
    requireBoundary(!children.has(parent) && (parent === null || byId.has(parent)), 'timeline_predecessor_chain_invalid')
    children.set(parent, row)
  }
  const chain: CheckedRevision[] = [], visited = new Set<string>()
  let cursor = children.get(null)
  while (cursor) {
    requireBoundary(!visited.has(cursor.record.assessmentId) && (!chain.length || cursor.at >= chain[chain.length - 1].at), 'timeline_predecessor_chain_invalid')
    visited.add(cursor.record.assessmentId); chain.push(cursor); cursor = children.get(cursor.record.assessmentId)
  }
  requireBoundary(chain.length === rows.length, 'timeline_predecessor_chain_invalid')
  return chain
}

/** All-or-nothing validation before identifier disclosure. Exact microsecond
 * cutoff, source capture, assessment creation and committed visibility remain
 * different instants. Predecessor pointers, NEVER timestamp/UUID/arrival order,
 * define assessment replacement. That is NOT market-source supersession. */
export function inspectReceivedSourceDecisionTimeline(input: unknown, receipt: unknown): SourceDecisionTimeline {
  const scope = scopeOf(input), empty = emptySourceDecisionTimeline()
  if (!scope) return empty
  const cutoff = instant(scope.cutoffAt)
  try {
    requireBoundary(keys(receipt, ['snapshotId', 'readsetText', 'readsetHash']) && isEvidenceUuid(receipt.snapshotId)
      && typeof receipt.readsetText === 'string' && hash(receipt.readsetHash), 'timeline_snapshot_invalid')
    withinBudget(Buffer.byteLength(receipt.readsetText, 'utf8') <= LIMIT.readsetBytes)
    requireBoundary(evidenceHash(receipt.readsetText) === receipt.readsetHash, 'timeline_snapshot_hash_invalid')
    const body: unknown = JSON.parse(receipt.readsetText)
    requireBoundary(keys(body, ['version', 'companyId', 'environment', 'cutoffAt', 'capturedAt', 'complete', 'sourceCount', 'historyCoverage', 'ledgerStartedAt', 'sources'])
      && body.version === 1 && body.companyId === scope.companyId && body.environment === scope.environment && sameInstant(body.cutoffAt, scope.cutoffAt)
      && typeof body.capturedAt === 'string' && typeof body.ledgerStartedAt === 'string' && body.historyCoverage === 'before_ledger_unknown'
      && typeof body.complete === 'boolean' && Number.isSafeInteger(body.sourceCount) && (body.sourceCount as number) >= 0 && Array.isArray(body.sources), 'timeline_snapshot_scope_invalid')
    const captured = instant(body.capturedAt), epoch = instant(body.ledgerStartedAt)
    requireBoundary(captured >= cutoff && captured >= epoch, 'timeline_capture_invalid')
    if (!body.complete) {
      requireBoundary(body.sources.length === 0, 'timeline_incomplete_prefix_invalid')
      return {...empty, status: 'incomplete', reason: 'timeline_snapshot_incomplete', cutoffAt: scope.cutoffAt}
    }
    requireBoundary(body.sourceCount === body.sources.length, 'timeline_source_count_invalid')
    withinBudget(body.sources.length <= LIMIT.sources)
    if (epoch > cutoff) {
      requireBoundary(body.sources.length === 0, 'timeline_before_ledger_source_invalid')
      return {...empty, status: 'incomplete', reason: 'timeline_before_ledger_unknown', cutoffAt: scope.cutoffAt}
    }
    const sourceIds = new Set<string>(), assessmentIds = new Set<string>(), witnessIds = new Set<string>()
    const sources: SourceDecisionTimeline['sources'] = []
    let inputBytes = 0, inspectedSegments = 0
    for (const source of body.sources) {
      requireBoundary(keys(source, ['sourceMessageId', 'payloadHash', 'rawPayload', 'receivedAt', 'capturedAt', 'messageCode', 'assessments'])
        && isEvidenceUuid(source.sourceMessageId) && !sourceIds.has(source.sourceMessageId)
        && typeof source.capturedAt === 'string' && (source.receivedAt === null || typeof source.receivedAt === 'string')
        && (source.messageCode === null || typeof source.messageCode === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(source.messageCode))
        && Array.isArray(source.assessments), 'timeline_source_invalid')
      sourceIds.add(source.sourceMessageId)
      const sourceCaptured = instant(source.capturedAt), sourceReceived = source.receivedAt === null ? null : instant(source.receivedAt)
      requireBoundary(sourceCaptured >= epoch && sourceCaptured <= cutoff && (sourceReceived === null || sourceReceived <= cutoff), 'timeline_source_time_invalid')
      withinBudget(source.assessments.length <= LIMIT.assessments)
      let segmentCount = 0
      if (source.rawPayload === null) requireBoundary(source.payloadHash === null && !source.assessments.length, 'timeline_source_payload_missing')
      else {
        requireBoundary(typeof source.rawPayload === 'string', 'timeline_source_payload_invalid')
        const bytes = Buffer.byteLength(source.rawPayload, 'utf8'); inputBytes += bytes
        withinBudget(bytes <= LIMIT.wireBytes && inputBytes <= LIMIT.inputBytes)
        requireBoundary(hash(source.payloadHash) && evidenceHash(source.rawPayload) === source.payloadHash, 'timeline_source_hash_invalid')
        // Unassessed malformed input is still an observation, not an approval.
        if (source.assessments.length) {
          requireBoundary(sourceReceived !== null, 'timeline_source_receipt_missing')
          segmentCount = tokenizeEdifact(source.rawPayload).segments.length
          withinBudget(segmentCount <= 8192)
        }
      }
      const checked: CheckedRevision[] = []
      for (const row of source.assessments) {
        requireBoundary(keys(row, ['id', 'previousAssessmentId', 'canonicalAssessmentId', 'assessedAt', 'availableAt', 'availabilityWitnessId', 'factsText', 'factsHash'])
          && isEvidenceUuid(row.id) && !assessmentIds.has(row.id) && (row.previousAssessmentId === null || isEvidenceUuid(row.previousAssessmentId))
          && isEvidenceUuid(row.canonicalAssessmentId) && typeof row.assessedAt === 'string' && typeof row.factsText === 'string' && hash(row.factsHash)
          && (row.availableAt === null && row.availabilityWitnessId === null || typeof row.availableAt === 'string' && isEvidenceUuid(row.availabilityWitnessId)), 'timeline_assessment_invalid')
        assessmentIds.add(row.id)
        const bytes = Buffer.byteLength(row.factsText, 'utf8'); inputBytes += bytes; inspectedSegments += segmentCount
        withinBudget(bytes <= LIMIT.factBytes && inputBytes <= LIMIT.inputBytes && inspectedSegments <= LIMIT.segments)
        requireBoundary(evidenceHash(row.factsText) === row.factsHash, 'timeline_facts_hash_invalid')
        const at = instant(row.assessedAt), available = row.availableAt === null ? null : instant(row.availableAt)
        requireBoundary(at >= sourceCaptured && at >= sourceReceived! && at <= captured && (available === null || available >= at && available <= captured), 'timeline_assessment_time_invalid')
        if (row.availabilityWitnessId !== null) {
          requireBoundary(isEvidenceUuid(row.availabilityWitnessId) && !witnessIds.has(row.availabilityWitnessId), 'timeline_witness_invalid')
          witnessIds.add(row.availabilityWitnessId)
        }
        const objects = observedObjects(JSON.parse(row.factsText), source, scope, at)
        const recordedDisposition: Disposition = objects.every(entry => entry.disposition === 'accepted') ? 'accepted'
          : objects.some(entry => entry.disposition === 'rejected') ? 'rejected' : 'unavailable'
        checked.push({at, available, record: {assessmentId: row.id, previousAssessmentId: row.previousAssessmentId, canonicalAssessmentId: row.canonicalAssessmentId,
          factsHash: row.factsHash, assessedAt: row.assessedAt, availableAt: row.availableAt as string | null, availabilityWitnessId: row.availabilityWitnessId as string | null,
          recordedDisposition, objects}})
      }
      const chain = orderChain(checked)
      const beforeCutoff = chain.filter(row => row.at <= cutoff), last = beforeCutoff[beforeCutoff.length - 1]
      // A successor created by the cutoff with no timely witness has UNKNOWN
      // historical commit visibility. Do not silently revive its predecessor.
      const asOf = last && last.available !== null && last.available <= cutoff ? last.record : null
      sources.push({sourceMessageId: source.sourceMessageId, payloadHash: source.payloadHash as string | null, receivedAt: source.receivedAt as string | null,
        capturedAt: source.capturedAt, messageCode: source.messageCode as string | null, asOf,
        visibility: asOf ? 'witnessed' : last ? 'incomplete' : chain.length ? 'not_available_at_cutoff' : 'no_assessment',
        revisions: chain.map(row => ({...row.record, availability: row.at > cutoff ? 'after_cutoff'
          : row.available !== null && row.available <= cutoff ? 'witnessed_by_cutoff' : 'not_witnessed_by_cutoff'}))})
    }
    return {...empty, status: 'inspected', boundedReadComplete: true, snapshotId: receipt.snapshotId, readsetHash: receipt.readsetHash,
      cutoffAt: scope.cutoffAt, ledgerStartedAt: body.ledgerStartedAt, sourceCount: sources.length,
      sources: sources.sort((left, right) => left.sourceMessageId.localeCompare(right.sourceMessageId))}
  } catch (error) {
    return {...empty, status: error instanceof TimelineBoundaryError ? error.kind : 'read_failed',
      reason: error instanceof TimelineBoundaryError ? error.reason : 'timeline_readset_invalid', cutoffAt: scope.cutoffAt}
  }
}

/** IO owner supplies a deadline and the service-only RPC. No error strings,
 * partial identifiers or caller-provided approvals escape this boundary. */
export async function readReceivedSourceDecisionTimeline(input: unknown, io: {openSnapshot(scope: ReceivedSourceScope): Promise<unknown>}): Promise<SourceDecisionTimeline> {
  const scope = scopeOf(input)
  if (!scope) return emptySourceDecisionTimeline()
  try { return inspectReceivedSourceDecisionTimeline(scope, await io.openSnapshot(scope)) }
  catch { return {...emptySourceDecisionTimeline(), status: 'read_failed', reason: 'timeline_snapshot_unconfirmed', cutoffAt: scope.cutoffAt} }
}
