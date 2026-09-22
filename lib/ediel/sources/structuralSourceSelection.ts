import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'
import type { StructuralSourceWire } from './structuralSourceWire'

export type StructuralCoverage = {
  kind: 'post_ledger_supply'
  baselineSourceMessageId: string
  baselineAssessmentId: string
  baselineFactsHash: string
  supplyPeriodId: string
  switchRequestId: string
  switchCreatedAt: string
  outboundSourceMessageId: string
  outboundCreatedAt: string
  validFrom: string
  validTo: string | null
}
export type StructuralReplacement = {
  sourceMessageId: string
  assessmentId: string
  payloadHash: string
}
export type StructuralVersion = {
  sourceMessageId: string
  payloadHash: string
  assessmentId: string | null
  factsHash: string | null
  availableAt: string | null
  disposition: 'accepted' | 'rejected' | 'unavailable'
  wire: StructuralSourceWire
  coverage: StructuralCoverage | null
  replaces: StructuralReplacement | null
}
export type StructuralSelectionInput = {
  ledgerStartedAt: string
  cutoffAt: string
  readComplete: boolean
  versions: readonly StructuralVersion[]
  // An unbounded, malformed or physically unresolved source may affect any
  // object. The IO projection must not quietly drop it as unrelated.
  unresolvedSources: boolean
  objectId: string
  identityAgency: string
  legalSender: string
  legalReceiver: string
  periodStart: string
  periodEnd: string
  boundary: 'interval' | 'current_point' | 'closing_point'
}
export type SelectedStructure = {
  sourceMessageId: string
  assessmentId: string
  payloadHash: string
  effectiveFrom: string
  meterNumber: string | null
  registerIds: (string | null)[]
  meterSourceMessageId: string | null
  registerSourceMessageId: string | null
}
export type StructuralSelection =
  | { status: 'unavailable'; reason: string }
  | { status: 'selected'; coverage: StructuralCoverage; states: SelectedStructure[] }

const unavailable = (reason: string): StructuralSelection => ({ status: 'unavailable', reason })
const instant = parseSourceReceiptInstant
const idsEqual = (left: readonly (string | null)[], right: readonly (string | null)[]) =>
  left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index])

function sameBusiness(left: StructuralVersion, right: StructuralVersion): boolean {
  return left.wire.object.objectId === right.wire.object.objectId
    && left.wire.object.identityAgency === right.wire.object.identityAgency
    && left.wire.legalSender === right.wire.legalSender && left.wire.legalReceiver === right.wire.legalReceiver
    && left.wire.messageCode === right.wire.messageCode && left.wire.businessCase === right.wire.businessCase
    && left.wire.caseReference === right.wire.caseReference
    && left.coverage?.supplyPeriodId === right.coverage?.supplyPeriodId
}

function coverageValid(coverage: StructuralCoverage, epoch: bigint, cutoff: bigint): boolean {
  const start = instant(coverage.validFrom), end = coverage.validTo === null ? null : instant(coverage.validTo)
  const created = instant(coverage.switchCreatedAt), outbound = instant(coverage.outboundCreatedAt)
  return coverage.kind === 'post_ledger_supply' && start !== null && start >= epoch
    && created !== null && created >= epoch && created <= cutoff && created <= start
    && outbound !== null && outbound >= created && outbound <= cutoff
    && (coverage.validTo === null || end !== null && end > start)
}

/** Pure projection, not an approval capability. Only the service-owned read
 * boundary may use its result for a final runtime comparison. Valid-time order
 * is independent of receipt/assessment order. Explicit correction edges remove
 * the replaced market message; same-source revision order is handled upstream.
 * No inventory is obtained from the incoming meter/register identifiers. */
export function selectStructuralSources(input: StructuralSelectionInput): StructuralSelection {
  const epoch = instant(input.ledgerStartedAt), cutoff = instant(input.cutoffAt)
  const start = instant(input.periodStart), end = instant(input.periodEnd)
  if (!input.readComplete || input.unresolvedSources) return unavailable('structural_universe_incomplete')
  if (epoch === null || cutoff === null || start === null || end === null || epoch > cutoff
    || start > end || (input.boundary === 'interval' ? start === end : start !== end)) return unavailable('structural_period_invalid')
  if (input.versions.length > 1000) return unavailable('structural_selection_budget_exceeded')
  const versions = input.versions.filter(({wire}) => wire.object.objectId === input.objectId
    && wire.object.identityAgency === input.identityAgency && wire.legalSender === input.legalSender
    && wire.legalReceiver === input.legalReceiver)
  const byId = new Map(versions.map(version => [version.sourceMessageId, version]))
  if (byId.size !== versions.length) return unavailable('structural_source_identity_ambiguous')
  if (versions.some(version => instant(version.wire.effectiveFrom.utc) === null)) return unavailable('structural_effective_time_unknown')
  const witnessed = (version: StructuralVersion) => version.disposition === 'accepted' && version.assessmentId !== null
    && version.factsHash !== null && instant(version.availableAt) !== null && instant(version.availableAt)! <= cutoff
  const eligible = (version: StructuralVersion) => witnessed(version) && version.coverage !== null
    && coverageValid(version.coverage, epoch, cutoff)
  const replaced = new Set<string>(), parent = new Map<string, string>()
  for (const version of versions) {
    if (version.disposition === 'rejected' || !witnessed(version) || version.wire.businessCase === 'customer_only') continue
    if (version.wire.functionCode !== '5') {
      if (version.replaces !== null) return unavailable('structural_original_has_correction_edge')
      continue
    }
    const reference = version.replaces, prior = reference && byId.get(reference.sourceMessageId)
    if (!prior || !reference || prior.sourceMessageId === version.sourceMessageId || !witnessed(prior)
      || reference.assessmentId !== prior.assessmentId || reference.payloadHash !== prior.payloadHash
      || !sameBusiness(version, prior) || version.wire.documentReference === prior.wire.documentReference
      || replaced.has(prior.sourceMessageId)) return unavailable('structural_correction_unresolved')
    replaced.add(prior.sourceMessageId)
    parent.set(version.sourceMessageId, prior.sourceMessageId)
  }
  for (const version of versions) {
    const visited = new Set<string>()
    let cursor: string | undefined = version.sourceMessageId
    while (cursor !== undefined) {
      if (visited.has(cursor)) return unavailable('structural_correction_cycle')
      visited.add(cursor); cursor = parent.get(cursor)
    }
  }
  const active = versions.filter(version => !replaced.has(version.sourceMessageId) && version.disposition !== 'rejected')
  const beforeStart = (at: bigint) => input.boundary === 'closing_point' ? at < start : at <= start
  const isBaselineRoot = (version: StructuralVersion) => {
    let root = version.sourceMessageId
    while (parent.has(root)) root = parent.get(root)!
    return root === version.coverage?.baselineSourceMessageId
  }
  const baselines = active.filter(version => version.wire.businessCase === 'supply_baseline' && eligible(version)
    && isBaselineRoot(version)
    && instant(version.coverage!.validFrom) === instant(version.wire.effectiveFrom.utc)
    && beforeStart(instant(version.wire.effectiveFrom.utc)!))
    .sort((left, right) => Number(instant(left.wire.effectiveFrom.utc)! - instant(right.wire.effectiveFrom.utc)!))
  const baseline = baselines.at(-1)
  if (!baseline) return unavailable('structural_coverage_anchor_missing')
  const coverage = baseline.coverage!, baseTime = instant(coverage.validFrom)!
  if (baselines.filter(version => instant(version.wire.effectiveFrom.utc) === baseTime).length !== 1) return unavailable('structural_baseline_ambiguous')
  const coverEnd = coverage.validTo === null ? null : instant(coverage.validTo)
  if (start < baseTime || (coverEnd !== null && (end > coverEnd || input.boundary === 'current_point' && start === coverEnd))) return unavailable('structural_outside_coverage')
  const relevant = active.filter(version => instant(version.wire.effectiveFrom.utc)! >= baseTime
    && (input.boundary === 'current_point' ? instant(version.wire.effectiveFrom.utc)! <= end : instant(version.wire.effectiveFrom.utc)! < end)
    && version.wire.businessCase !== 'customer_only')
    .sort((left, right) => Number(instant(left.wire.effectiveFrom.utc)! - instant(right.wire.effectiveFrom.utc)!))
  if (!relevant.length || relevant[0] !== baseline) return unavailable('structural_baseline_unresolved')
  let state: SelectedStructure | null = null
  const states: SelectedStructure[] = []
  let previousTime: bigint | null = null
  for (const version of relevant) {
    const at = instant(version.wire.effectiveFrom.utc)!
    if (previousTime === at) return unavailable('structural_same_time_ambiguous')
    previousTime = at
    if (!eligible(version) || version.coverage!.supplyPeriodId !== coverage.supplyPeriodId
      || version.coverage!.baselineSourceMessageId !== coverage.baselineSourceMessageId
      || version.coverage!.baselineAssessmentId !== coverage.baselineAssessmentId
      || version.coverage!.baselineFactsHash !== coverage.baselineFactsHash) return unavailable('structural_approval_gap')
    const versionEnd = version.coverage!.validTo === null ? null : instant(version.coverage!.validTo)
    if (versionEnd !== null && (end > versionEnd || input.boundary === 'current_point' && start === versionEnd)) return unavailable('structural_outside_coverage')
    const wire = version.wire
    let registerIds = wire.registers.map(register => register.registerId)
    if (!registerIds.length || wire.registers.some((register,index) => register.position !== index + 1)) return unavailable('structural_register_membership_unknown')
    let meterNumber = wire.meterNumber, meterSource = version.sourceMessageId, registerSource = version.sourceMessageId
    if (state) {
      if (wire.businessCase === 'supply_baseline') return unavailable('structural_supply_boundary')
      if (wire.businessCase === 'meter_exchange') {
        if (!meterNumber || meterNumber === state.meterNumber || (wire.oldMeterNumber !== null && wire.oldMeterNumber !== state.meterNumber)) return unavailable('structural_meter_exchange_unresolved')
      } else {
        if (meterNumber !== null && state.meterNumber !== null && meterNumber !== state.meterNumber) return unavailable('structural_non_exchange_meter_changed')
        if (meterNumber === null) { meterNumber = state.meterNumber; meterSource = state.meterSourceMessageId ?? version.sourceMessageId }
        if (wire.businessCase === 'change_without_reading') {
          if (registerIds.every(id => id === null) && registerIds.length === state.registerIds.length) {
            registerIds = [...state.registerIds]; registerSource = state.registerSourceMessageId ?? version.sourceMessageId
          } else if (!idsEqual(registerIds, state.registerIds)) return unavailable('structural_noreading_register_changed')
        }
      }
    }
    state = { sourceMessageId: version.sourceMessageId, assessmentId: version.assessmentId!, payloadHash: version.payloadHash,
      effectiveFrom: wire.effectiveFrom.utc, meterNumber, registerIds,
      meterSourceMessageId: meterSource, registerSourceMessageId: registerSource }
    if (beforeStart(at)) { states.splice(0, states.length, state) }
    else states.push(state)
  }
  return states.length ? { status: 'selected', coverage: structuredClone(coverage), states } : unavailable('structural_state_missing')
}
