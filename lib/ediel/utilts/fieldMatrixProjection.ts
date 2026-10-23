import { getUtiltsFieldRules, type UtiltsFieldRequirement, type UtiltsFieldRule } from '@/lib/ediel/rulebook/utiltsFieldMatrix'
import { UTILTS_25_A_5_SOURCE } from '@/lib/ediel/rulebook/utilts25A5'
import { hasUtiltsFieldReader, observeUtiltsFieldScopes, readUtiltsFieldOccurrences, type UtiltsFieldOccurrence } from './fieldMatrixOccurrences'

export type UtiltsFieldMatrixPolicy = {
  family: string
  code: string
  referenceDate: string
  guide: { guideRevision: string; effectiveFrom: string; effectiveTo: string | null; primarySource?: { sha256: string; language: string } }
  fieldRules: readonly unknown[]
}
export type SelectedUtiltsFieldRule = UtiltsFieldRule & {
  requirement: UtiltsFieldRequirement
  sourceEdition: string
  sourceSha256: string
}
export type UtiltsFieldFinding = {
  code: string
  fieldNo: string
  ruleKey: string
  semanticKey: string
  fieldPath: string
  requirement: UtiltsFieldRequirement
  kind: 'missing' | 'forbidden'
  title: string
  description: string
  sourceEdition: string
  sourceSha256: string
  messageIndex: number
  transactionIndex?: number
  observationIndex?: number
  referenceNumber: string | null
  occurrence?: Pick<UtiltsFieldOccurrence, 'segmentIndex' | 'elementIndex' | 'componentIndex'>
}
export type UtiltsFieldUnresolved = {
  ruleKey?: string
  fieldNo?: string
  reason: 'source_edition_unqualified' | 'policy_rows_unqualified' | 'dependent_condition'
    | 'branch_condition' | 'existing_semantic_owner' | 'unsupported_selector'
    | 'optional_value_validation' | 'physical_scope_unavailable'
}

/** Reviewed first slice: scope/reader identity only, never a copied R/D/O/X
 * matrix. The selected original row supplies every required/forbidden value. */
const requiredTransactionReaders = new Set([
  'transaction_id', 'product_id', 'time_series_product', 'delivery_period',
  'registration_date', 'latest_update_date', 'resolution', 'reason_for_transaction',
])
const forbiddenTransactionReaders = new Set([
  ...requiredTransactionReaders, 'metering_point_id', 'station_group_id',
  'grid_area_source_id', 'grid_area_sink_id', 'balance_responsible_id',
  'balance_supplier_id', 'buyer_id', 'seller_id', 'system_operator_id',
  'unit', 'prodat_transaction_reference', 'settlement_method',
  'default_metering_point_count', 'metering_point_type',
])

function sourceQualified(policy: UtiltsFieldMatrixPolicy): boolean {
  const source = policy.guide.primarySource
  const date = policy.referenceDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-')) return false
  const instant = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== date) return false
  return policy.family === 'UTILTS' && policy.guide.guideRevision === UTILTS_25_A_5_SOURCE.guideRevision
    && source?.sha256 === UTILTS_25_A_5_SOURCE.sha256 && source.language === UTILTS_25_A_5_SOURCE.language
    && policy.referenceDate >= UTILTS_25_A_5_SOURCE.effectiveFrom && policy.referenceDate >= policy.guide.effectiveFrom
    && (!policy.guide.effectiveTo || policy.referenceDate <= policy.guide.effectiveTo)
}
function sourceRow(value: unknown): value is UtiltsFieldRule {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<UtiltsFieldRule>
  return typeof candidate.ruleKey === 'string' && typeof candidate.fieldNo === 'string'
    && typeof candidate.semanticKey === 'string' && typeof candidate.segmentPath === 'string'
    && typeof candidate.requirements === 'object' && candidate.requirements !== null
}
/** Exact canonical source selection is retained. A legacy executable cast
 * cannot supply absent row metadata or change the published requirement. */
function policyRowsQualified(policy: UtiltsFieldMatrixPolicy): boolean {
  if (policy.code !== policy.code.trim().toUpperCase()) return false
  const expected = getUtiltsFieldRules(policy.code)
  if (!expected.length || expected.length !== policy.fieldRules.length) return false
  return expected.every(row => policy.fieldRules.filter(sourceRow).filter(selected =>
    selected.ruleKey === row.ruleKey && selected.fieldNo === row.fieldNo && selected.semanticKey === row.semanticKey
    // S01's bounded executable donor retains the original SG5 source path.
    && (selected.segmentPath === row.segmentPath || ('sourceSegmentPath' in selected && selected.sourceSegmentPath === row.segmentPath))
    && selected.requirements[policy.code as keyof typeof row.requirements] === row.requirements[policy.code as keyof typeof row.requirements]
  ).length === 1)
}
export function selectUtiltsFieldRules(policy: UtiltsFieldMatrixPolicy): readonly SelectedUtiltsFieldRule[] {
  if (!sourceQualified(policy) || !policyRowsQualified(policy)) return []
  return getUtiltsFieldRules(policy.code).map(row => ({
    ...row, requirement: row.requirements[policy.code as keyof typeof row.requirements]!,
    sourceEdition: policy.guide.guideRevision, sourceSha256: policy.guide.primarySource!.sha256,
  }))
}

function unresolvedReason(row: SelectedUtiltsFieldRule): UtiltsFieldUnresolved['reason'] | null {
  if (row.requirement === 'D') return 'dependent_condition'
  if (row.scope === 'observation') return 'branch_condition'
  if (row.requirement === 'O') return 'optional_value_validation'
  if (!hasUtiltsFieldReader(row)) return 'unsupported_selector'
  if (row.scope !== 'transaction') return 'existing_semantic_owner'
  if (row.requirement === 'R' && requiredTransactionReaders.has(row.semanticKey) && !row.condition) return null
  if (row.requirement === 'X' && forbiddenTransactionReaders.has(row.semanticKey)) return null
  return 'existing_semantic_owner'
}

/** Partial field authority only. complete:false is intentional until the
 * remaining typed condition/branch owners are qualified. unresolved is local
 * diagnostic work, never a national negative ACK or permission to consume.
 * Existing full header, observation, actor and business owners remain required. */
export function evaluateUtiltsFieldMatrix(input: { policy: UtiltsFieldMatrixPolicy; rawPayload: string }): {
  sourceQualified: boolean
  complete: false
  issues: UtiltsFieldFinding[]
  unresolved: UtiltsFieldUnresolved[]
} {
  const issues: UtiltsFieldFinding[] = [], unresolved: UtiltsFieldUnresolved[] = []
  if (!sourceQualified(input.policy)) return { sourceQualified: false, complete: false, issues,
    unresolved: [{ reason: 'source_edition_unqualified' }] }
  if (!policyRowsQualified(input.policy)) return { sourceQualified: false, complete: false, issues,
    unresolved: [{ reason: 'policy_rows_unqualified' }] }
  const rows = selectUtiltsFieldRules(input.policy), physical = observeUtiltsFieldScopes(input.rawPayload)
  const scopes = physical.transactions.filter(scope => scope.messageCode === input.policy.code)
  for (const row of rows) {
    const reason = unresolvedReason(row)
    if (reason) { unresolved.push({ ruleKey: row.ruleKey, fieldNo: row.fieldNo, reason }); continue }
    if (!scopes.length) { unresolved.push({ ruleKey: row.ruleKey, fieldNo: row.fieldNo, reason: 'physical_scope_unavailable' }); continue }
    for (const scope of scopes) {
      const observed = readUtiltsFieldOccurrences(row, scope, physical.una)
      const kind = row.requirement === 'X' && observed.length ? 'forbidden'
        : row.requirement === 'R' && !observed.some(value => value.value.trim()) ? 'missing' : null
      if (!kind) continue
      // One result per exact physical field occurrence for X, one per own
      // required field for R. Reused IDE text cannot collapse physical scopes.
      const occurrences = kind === 'forbidden' ? observed : [observed[0]]
      for (const occurrence of occurrences) issues.push({
        code: `UTILTS_FIELD_${row.fieldNo}_${kind === 'forbidden' ? 'FORBIDDEN' : 'MISSING'}`,
        fieldNo: row.fieldNo, ruleKey: row.ruleKey, semanticKey: row.semanticKey, fieldPath: row.segmentPath,
        requirement: row.requirement, kind, title: kind === 'forbidden' ? 'Otillåtet UTILTS-fält' : 'Obligatoriskt UTILTS-fält saknas',
        description: `${row.fieldLabel}: ${row.segmentPath}, svensk ${row.sourceEdition}.`,
        sourceEdition: row.sourceEdition, sourceSha256: row.sourceSha256,
        messageIndex: scope.messageIndex, transactionIndex: scope.transactionIndex,
        observationIndex: scope.observationIndex, referenceNumber: scope.referenceNumber,
        ...(occurrence ? { occurrence: { segmentIndex: occurrence.segmentIndex, elementIndex: occurrence.elementIndex, componentIndex: occurrence.componentIndex } } : {}),
      })
    }
  }
  return { sourceQualified: true, complete: false, issues, unresolved }
}

