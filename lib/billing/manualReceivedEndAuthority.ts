/** In-process capabilities populated only by the existing service RPC loaders.
 * JSON flags, spread copies and deserialized DTOs cannot carry this authority. */
type Row = Record<string, unknown>
type EndScope = {
  version: 1
  companyId: string
  periodId: string
  contractId: string
  customerId: string
  meteringPointId: string
  receiptId: string
  startAt: string
  endAt: string
  sourceEndMessageId: string
  marketStateVersion: number
  marketEndAt: string
  contractEndedAt: string
  contractStatus: 'terminated'
  terminationReason: 'move_out' | 'grid_contract_ended' | 'customer_termination'
}
declare const authorityBrand: unique symbol
export type ManualReceivedEndAuthority = Readonly<EndScope> & { readonly [authorityBrand]: true }
const records = new WeakMap<object, { snapshot: string; scopes: readonly Readonly<EndScope>[] }>()
const issued = new WeakSet<object>()
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const instant = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : Number.NaN
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const snapshot = (row: Row): string => JSON.stringify(['id', 'company_id', 'customer_id', 'metering_point_id', 'supply_period_id', 'contract_id', 'period_start', 'period_end', 'billing_period_start', 'billing_period_end'].map(key => row[key] ?? null))

/** Called only on rows returned by tenant-scoped service_role RPCs. No API accepts
 * an authority DTO and no billing predicate reads an authority field on a row. */
export function registerServerManualReceivedEnds(row: Row, companyId: string, payload: unknown): void {
  if (!Array.isArray(payload)) throw new Error('billing_manual_end_authority_result_invalid')
  const scopes: Readonly<EndScope>[] = []
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') throw new Error('billing_manual_end_authority_result_invalid')
    const s = raw as EndScope
    if (s.version !== 1 || s.companyId !== companyId || row.company_id !== companyId ||
      !['companyId', 'periodId', 'contractId', 'customerId', 'meteringPointId', 'receiptId', 'sourceEndMessageId'].every(key => uuid((s as unknown as Row)[key])) ||
      (text(row.customer_id) !== null && s.customerId !== row.customer_id) || s.meteringPointId !== row.metering_point_id ||
      (text(row.supply_period_id) !== null && s.periodId !== row.supply_period_id) ||
      (text(row.contract_id) !== null && s.contractId !== row.contract_id) ||
      s.contractStatus !== 'terminated' || !['move_out','grid_contract_ended','customer_termination'].includes(s.terminationReason) ||
      !Number.isSafeInteger(s.marketStateVersion) || s.marketStateVersion < 1 ||
      ![s.startAt, s.endAt, s.marketEndAt, s.contractEndedAt].every(x => Number.isFinite(instant(x))) || instant(s.endAt) <= instant(s.startAt)) {
      throw new Error('billing_manual_end_authority_result_invalid')
    }
    scopes.push(Object.freeze({ ...s }))
  }
  records.set(row, { snapshot: snapshot(row), scopes: Object.freeze(scopes) })
}

function scopeMatches(s: Readonly<EndScope>, contract: Row, period: Row): boolean {
  return s.companyId === contract.company_id && s.companyId === period.company_id &&
    s.contractId === contract.id && s.periodId === period.id &&
    s.customerId === contract.customer_id && s.customerId === period.customer_id &&
    s.meteringPointId === contract.metering_point_id && s.meteringPointId === period.metering_point_id &&
    s.contractId === (period.contract_id ?? period.customer_contract_id) &&
    s.sourceEndMessageId === period.source_end_message_id && s.marketStateVersion === Number(period.market_state_version) &&
    instant(s.marketEndAt) === instant(period.market_end_at) && instant(s.contractEndedAt) === instant(contract.ended_at) &&
    contract.status === s.contractStatus && contract.termination_reason === s.terminationReason
}

/** Every instant in a requested segment must be covered by server-qualified rows.
 * Missing/gapped data keeps the existing hold rather than creating authority. */
export function manualReceivedEndAuthority(
  rows: readonly Row[], contract: Row, period: Row, start?: number, end?: number,
): ManualReceivedEndAuthority | undefined {
  const scopes = rows.flatMap(row => {
    const registered = records.get(row)
    return registered && registered.snapshot === snapshot(row) ? registered.scopes.filter(s => scopeMatches(s, contract, period)) : []
  }).sort((a, b) => instant(a.startAt) - instant(b.startAt))
  if (!scopes.length) return undefined
  const first = scopes[0]
  const from = start ?? instant(first.startAt)
  const to = end ?? Math.max(...scopes.map(s => instant(s.endAt)))
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return undefined
  let cursor = from
  for (const scope of scopes) {
    if (scope.receiptId !== first.receiptId || instant(scope.startAt) > cursor) continue
    if (instant(scope.endAt) > cursor) cursor = instant(scope.endAt)
    if (cursor >= to) {
      const authority = Object.freeze({ ...first, startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString() }) as ManualReceivedEndAuthority
      issued.add(authority)
      return authority
    }
  }
  return undefined
}

export function isManualReceivedEndAuthority(
  authority: ManualReceivedEndAuthority | undefined, contract: Row, period: Row, start?: number, end?: number,
): boolean {
  return !!authority && issued.has(authority) && scopeMatches(authority, contract, period) &&
    (start === undefined || Number.isFinite(start) && instant(authority.startAt) <= start) &&
    (end === undefined || Number.isFinite(end) && end <= instant(authority.endAt))
}
