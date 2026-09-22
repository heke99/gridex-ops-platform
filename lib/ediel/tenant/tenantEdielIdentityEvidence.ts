import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'

type Row = Record<string, unknown>
type Records = { profiles: Row[]; identifiers: Row[]; roles: Row[]; relations: Row[]; transportIdentifiers: Row[] }
export type TenantIdentityEvidence = {
  version: 1
  owner: 'canonical-tenant-ediel-identity-v1'
  evaluatedAt: string
  observedAt: string
  historicalKnowledge: 'not_established'
  sourceDisposition: 'not_established'
  consistency: 'independent_reads'
  records: Records
}
export type IdentityEvaluation = {
  explicit: boolean
  collect: boolean
  evidence: TenantIdentityEvidence
  active: (row: Row, dateBounds?: boolean) => boolean
}

/** One instant for every read. Half-open validity follows the existing tenant
 * identity and priorPermissionScope owners. No historical knowledge is inferred. */
export function createIdentityEvaluation(asOf: string | undefined, collect: boolean): IdentityEvaluation {
  const observedAt = new Date().toISOString()
  const evaluatedAt = asOf === undefined ? observedAt : asOf
  const instant = parseSourceReceiptInstant(evaluatedAt)
  if (instant === null) throw new Error('tenant_ediel_evaluation_instant_invalid')
  const evidence: TenantIdentityEvidence = {version:1,owner:'canonical-tenant-ediel-identity-v1',evaluatedAt,observedAt,
    historicalKnowledge:'not_established',sourceDisposition:'not_established',consistency:'independent_reads',
    records:{profiles:[],identifiers:[],roles:[],relations:[],transportIdentifiers:[]}}
  return {explicit:asOf !== undefined,collect,evidence,active(row, dateBounds = false) {
    // Default legacy calls retain Date.parse tolerance and nullable starts.
    if (asOf === undefined && !collect) {
      const from = row.valid_from ? Date.parse(String(row.valid_from)) : Number.NEGATIVE_INFINITY
      const to = row.valid_to ? Date.parse(String(row.valid_to)) : Number.POSITIVE_INFINITY
      return !Number.isNaN(from) && !Number.isNaN(to) && from <= Date.parse(evaluatedAt) && to > Date.parse(evaluatedAt)
    }
    const bound = (value: unknown) => parseSourceReceiptInstant(dateBounds && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
    const from = row.valid_from == null && dateBounds ? null : bound(row.valid_from)
    const to = row.valid_to == null ? null : bound(row.valid_to)
    if ((from === null && !(dateBounds && row.valid_from == null)) || (row.valid_to != null && to === null)
      || (from !== null && to !== null && to < from)) throw new Error('tenant_ediel_evidence_validity_invalid')
    return (from === null || from <= instant) && (to === null || instant < to)
  }}
}

/** Query predicates are rechecked before any evidence leaves this boundary. All
 * observed rows are retained, including inactive rows and empty delegation sets. */
export function identityRows(data: unknown, evaluation: IdentityEvaluation, key: keyof Records, scope: Row): Row[] {
  if (!evaluation.collect && !evaluation.explicit) return (data ?? []) as Row[]
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object' || Array.isArray(row)
    || typeof row.id !== 'string' || !row.id.trim() || Object.entries(scope).some(([field,value]) => row[field] !== value))) {
    throw new Error('tenant_ediel_evidence_scope_invalid')
  }
  const rows = structuredClone(data) as Row[]
  if (evaluation.collect) evaluation.evidence.records[key] = rows
  return rows
}
