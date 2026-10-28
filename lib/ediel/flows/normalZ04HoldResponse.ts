import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatErrorOccurrence, prodatFieldDiagnostic, type ProdatApplicationCode, type ProdatDiagnostic } from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { projectProdatDiagnostics } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import type { SupplyObjectPartition } from './supplyMarketTransition'

/**
 * The native normal-Z04 owner (gridex_received_sources.normal_switch_scope_effect_v1) holds an object it cannot apply.
 * These own hold reasons are prescribed refusals that the grid owner must be told about (FINDINGS J1, owner decisions
 * 35–37, P26.A §3.3 pp90–93). Every other hold reason (a technical or local evidence gap) keeps the existing
 * hold-for-review path without any APERAK. Z04A (Z26) never reaches this owner: it has its own assignment flow.
 */
export const NORMAL_Z04_HOLD_RESPONSES = Object.freeze({
  /** J1-01, decision 35: the start differs from our sent Z03 and the contracted start. ERC 42, field 210. */
  normal_z04_start_date_conflict: { kind: 'field', field: '210', followUp: 'start_date_conflict' },
  /** J1-02, decision 36: no own Z03 at all for this case reference. ERC 42, field 226 (not also 209). */
  normal_z04_own_z03_missing: { kind: 'field', field: '226', followUp: 'without_own_z03' },
  /** J1-02, decision 36: the facility cannot be identified uniquely together with its grid area. ERC 40/105. */
  normal_z04_object_not_identified: { kind: 'application', code: '105', followUp: 'without_own_z03' },
  /** J1-02, decision 36: the facility is known, but this supplier has no relation to it. ERC 40/107. */
  normal_z04_actor_not_related: { kind: 'application', code: '107', followUp: 'without_own_z03' },
  /** J1-03, decision 37 / ACK-09: the same case was already confirmed by another received Z04. ERC 40/104. */
  normal_z04_case_duplicate: { kind: 'application', code: '104', followUp: null },
} as const satisfies Record<string, { kind: 'field'; field: '210' | '226'; followUp: 'start_date_conflict' | 'without_own_z03' }
  | { kind: 'application'; code: Exclude<ProdatApplicationCode, '109'>; followUp: 'without_own_z03' | null }>)
export type NormalZ04HoldReason = keyof typeof NORMAL_Z04_HOLD_RESPONSES

export function isNormalZ04ResponseHold(reason: string): reason is NormalZ04HoldReason {
  return Object.hasOwn(NORMAL_Z04_HOLD_RESPONSES, reason)
}

export type NormalZ04HoldAnswer = {
  applicationErrors: EdielAperakApplicationError[]
  holds: Array<{ reason: NormalZ04HoldReason; objectId: string | null; lineItemReference: string | null
    followUp: 'start_date_conflict' | 'without_own_z03' | null }>
}

/**
 * The negative APERAK for a received normal Z04 whose every physical object the native owner held with one of the
 * prescribed own reasons above. Each error names its own object (RFF+Z07, RFF+LI) and carries the same source-qualified
 * diagnostic shape as the canonical owner's errors, so the existing P34 renderer and replay guards apply unchanged.
 * Returns null (keep the hold for review, no reply) when any object is applied or held for another reason, when an
 * object cannot be located exactly once in the original, or when the national text cannot be composed.
 */
export function normalZ04HoldAnswer(input: { rawPayload: string | null; messageCode: string | null; partition: readonly SupplyObjectPartition[] | null }): NormalZ04HoldAnswer | null {
  if (input.messageCode !== 'Z04' || !input.rawPayload || !input.partition?.length) return null
  if (!input.partition.every(entry => entry.disposition === 'held' && isNormalZ04ResponseHold(entry.reason))) return null
  let wire: ReturnType<typeof tokenizeEdifact>
  try { wire = tokenizeEdifact(input.rawPayload) } catch { return null }
  const rawSegments = wire.segments.map(token => token.raw)
  const message = prodatRegisterMessageSegments(wire.segments, wire.una)
  const bgm = message.find(token => token.tag === 'BGM')
  if (!bgm || segmentComposite(bgm, 1, wire.una)[0] !== 'Z04') return null
  const groups = prodatRegisterGroups(message, wire.una, 'Z04').groups
  const diagnostics: ProdatDiagnostic[] = []
  const holds: NormalZ04HoldAnswer['holds'] = []
  for (const entry of input.partition) {
    if (entry.disposition !== 'held' || !isNormalZ04ResponseHold(entry.reason)) return null
    const first = entry.object.registers[0]
    const own = groups.filter(group => group.registerPosition === 1 && group.lineIndex === first?.lineIndex
      && group.itemId === entry.object.objectId && group.identityAgency === entry.object.identityAgency)
    if (own.length !== 1) return null
    const rule = NORMAL_Z04_HOLD_RESPONSES[entry.reason]
    const source = { rawSegments, una: wire.una, code: 'Z04' }
    const sourceRule = `PRODAT26A:P90-93:J1:${entry.reason}`
    let diagnostic: ProdatDiagnostic
    if (rule.kind === 'field') diagnostic = prodatFieldDiagnostic(rule.field, 'invalid', source, [], sourceRule, own[0].lineIndex, 'object')
    else {
      const occurrence = prodatErrorOccurrence(source, [], 'object', own[0].lineIndex)
      if (!occurrence) return null
      diagnostic = { kind: 'application', ercCode: '40', applicationCode: rule.code, sourceRule, occurrence }
    }
    if (diagnostic.kind !== 'field' && diagnostic.kind !== 'application') return null
    diagnostics.push(diagnostic)
    holds.push({ reason: entry.reason, objectId: diagnostic.occurrence.objectId, lineItemReference: diagnostic.occurrence.lineItemReference, followUp: rule.followUp })
  }
  const projected = projectProdatDiagnostics(diagnostics.map(diagnostic => ({ prodatDiagnostic: diagnostic, severity: 'error' as const, blocking: true,
    code: 'PRODAT_NORMAL_Z04_OWNER_HOLD', title: 'Z04 hålls av leveransägaren', description: sourceRuleOf(diagnostic) })))
  if (projected.disposition.kind !== 'continue' || projected.applicationErrors.length !== diagnostics.length) return null
  return { applicationErrors: projected.applicationErrors, holds }
}

function sourceRuleOf(diagnostic: ProdatDiagnostic) { return diagnostic.sourceRule }
