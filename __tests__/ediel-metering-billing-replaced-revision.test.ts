import { beforeEach, expect, it, vi } from 'vitest'
import { ingestBoundUtiltsMetering } from '@/lib/ediel/utilts/consumptionSinks'
import { validateUtiltsPersistenceResults, type UtiltsBoundPersistenceInput } from '@/lib/ediel/utilts/transactionPersistence'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { boundFixtureContract, bindingRpcRows } from './helpers/utiltsBoundFixture'

type Row = Record<string, unknown>
type Phase = 'active' | 'before-matcher' | 'before-qualify' | 'before-cas' | 'still-current-refusal' | 'not-final'
  | 'supply-unqualified' | 'before-supply-retry' | 'no-lineage' | 'wrong-projection' | 'permission-denied'
const io = vi.hoisted(() => ({
  phase: 'active' as Phase, normalized: {} as Row, committed: [] as Row[], attempts: [] as Row[],
  unresolved: [] as Row[], refusals: [] as string[],
}))

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => {} }))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: async () => { if (io.phase === 'before-matcher') replace() } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Row) {
    if (name === 'gridex_consume_utilts_metering_v1') {
      expect(args).toMatchObject({ p_company_id: company, p_source_message_id: 'original', p_transaction_id: contract.transactionId })
      return { data: raw, error: null }
    }
    if (name === 'gridex_read_billing_source_values_v1') {
      expect(args).toEqual({ p_company_id: company, p_value_ids: ['nv-original'] })
      if (io.phase === 'before-qualify') replace()
      const quality = io.phase === 'not-final' ? '46' : null
      return { data: [{ ...io.normalized, quality_status: quality,
        billing_source_message: { id: 'original', company_id: company, message_family: 'UTILTS', status: 'validated' },
        billing_source_basis: { version: 1, normalizedValueId: 'nv-original', sourceMessageId: 'original',
          qualified: io.normalized.revision_status === 'current', quantityKwh: '12', quantityType: '136',
          quality, qualityEstablished: true, productCode: null },
      }], error: null }
    }
    if (name !== 'gridex_set_metering_billing_gate') throw new Error(`Unexpected RPC: ${name}`)
    expect(args).toMatchObject({ p_company_id: company, p_metering_value_id: raw.id, p_normalized_value_id: 'nv-original' })
    const gate = args.p_gate as Row
    io.attempts.push(gate)
    if (['before-cas', 'no-lineage', 'wrong-projection', 'permission-denied'].includes(io.phase)) replace()
    if (io.phase === 'no-lineage') io.normalized.replaced_by_value_id = 'unrelated-meter'
    if (io.phase === 'wrong-projection') io.normalized.id = 'nv-unrelated'
    if (io.phase === 'permission-denied') return { data: null, error: { code: '42501', message: 'permission denied' } }
    if (io.phase === 'supply-unqualified' || io.phase === 'before-supply-retry') {
      if (gate.billing_gate_status === 'eligible') {
        return { data: null, error: { code: '23514', message: 'billing_gate_qualified_supply_source_required' } }
      }
      if (io.phase === 'before-supply-retry') replace()
    }
    // Model the public qualification branch and its inner current-status CAS.
    const stale = io.normalized.revision_status === 'replaced'
    if (io.phase === 'still-current-refusal' || stale) {
      const message = gate.billing_gate_status === 'eligible'
        ? 'billing_gate_qualified_final_source_required'
        : 'normalized_metering_value_not_current_or_not_linked'
      io.refusals.push(message)
      return { data: null, error: { code: '23514', message } }
    }
    io.committed.push(gate)
    return { data: { status: gate.billing_status }, error: null }
  },
  from(table: string) {
    const filters: Array<[string, unknown]> = []
    const rows = () => {
      switch (table) {
        case 'metering_points': return [{ id: point, company_id: company, customer_id: customer, site_id: site, customer_site_id: site, grid_owner_id: owner }]
        case 'metering_values': return [raw, { ...raw, id: 'meter-correction', previous_value_id: raw.id }]
        case 'normalized_metering_values': return [io.normalized]
        case 'customer_supply_periods': return [{ id: 'supply', company_id: company, customer_id: customer, metering_point_id: point, status: 'active', start_date: '2026-01-01', end_date: null, contract_id: 'contract' }]
        case 'customer_contracts': return [{ id: 'contract', company_id: company, customer_id: customer, metering_point_id: point, status: 'active', starts_at: '2026-01-01', ends_at: null }]
        case 'ediel_unresolved_items': return io.unresolved
        default: throw new Error(`Unexpected table: ${table}`)
      }
    }
    const query = {
      select: () => query,
      eq(column: string, value: unknown) { filters.push([column, value]); return query },
      limit: () => query, lte: () => query, or: () => query, in: () => query, contains: () => query,
      async insert(row: Row) { expect(table).toBe('ediel_unresolved_items'); io.unresolved.push(row); return { error: null } },
      then: (done: (response: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows().filter(row => filters.every(([column, value]) => row[column] === value)), error: null }).then(done),
    }
    return query
  },
} }))

const company = 'tenant-a', point = 'point-a', customer = 'customer-a', site = 'site-a', owner = 'owner-a'
const contract = boundFixtureContract('T1', 12)
const observation = contract.observations[0]
observation.periodEnd = '2026-08-01T00:15:00.000Z'
observation.readAt = observation.periodEnd
const raw = {
  id: 'meter-original', company_id: company, customer_id: customer, metering_point_id: point,
  source_system: 'ediel_utilts', source_ediel_message_id: 'original', source_transaction_reference: contract.transactionId,
  canonical_dedupe_key: [company, point, observation.periodStart, observation.periodEnd, 'default-register', 'default-product', 'consumption', 'kWh'].join('|'),
  period_start: observation.periodStart, period_end: observation.periodEnd, revision_number: 1,
}
const message = { id: 'original', company_id: company, environment: 'test', message_code: 'E66' } as EdielMessageRow

function replace() {
  Object.assign(io.normalized, { revision_status: 'replaced', status: 'replaced', replaced_by_value_id: 'meter-correction' })
}

function ingest() {
  const input: UtiltsBoundPersistenceInput = {
    companyId: company, environment: 'test', sourceMessageId: 'original', messageCode: 'E66',
    rawPayload: 'synthetic-original', contracts: [contract],
    transactions: [{ transactionId: 'T1', disposition: 'accepted', responseType: 'positive_aperak', issueCodes: [],
      seriesKind: 'actual', meteringPointId: point, externalMeteringPointId: 'external-a', gridAreaId: null,
      periodStart: null, periodEnd: null, registrationDate: null, latestUpdateDate: null, resolution: null,
      unit: 'KWH', reasonForTransaction: null, quantities: [] }],
  }
  const boundOutcomes = validateUtiltsPersistenceResults(input, bindingRpcRows(input))
  return ingestBoundUtiltsMetering({ actorUserId: 'actor', message, boundOutcomes })
}

beforeEach(() => {
  io.normalized = { id: 'nv-original', company_id: company, customer_id: customer, metering_point_id: point,
    revision_status: 'current', status: 'stored', revision_number: 1, source_metering_value_id: raw.id,
    source_message_id: 'original', source_transaction_reference: contract.transactionId, quantity_kwh: '12',
    period_start: raw.period_start, period_end: raw.period_end, unit: 'kWh', direction: 'consumption', product_code: null }
  io.phase = 'active'; io.committed.length = 0; io.refusals.length = 0; io.attempts.length = 0; io.unresolved.length = 0
})

it.each(['before-matcher', 'before-qualify', 'before-cas'] as const)('completes the stored receipt when a correction commits %s without persisting a stale gate', async phase => {
  io.phase = phase
  await expect(ingest()).resolves.toEqual([raw])
  expect(io.committed).toEqual([])
  expect(io.unresolved).toEqual([])
  expect(io.attempts).toHaveLength(phase === 'before-cas' ? 1 : 0)
  expect(io.refusals).toEqual(phase === 'before-cas' ? ['billing_gate_qualified_final_source_required'] : [])
})

it('still commits an eligible current revision through the actual gate port', async () => {
  await expect(ingest()).resolves.toEqual([raw])
  expect(io.committed).toEqual([expect.objectContaining({ billing_status: 'billable' })])
})

it('still propagates the same 23514 for a current source', async () => {
  io.phase = 'still-current-refusal'
  await expect(ingest()).rejects.toMatchObject({ code: '23514', message: 'billing_gate_qualified_final_source_required' })
  expect(io.committed).toEqual([])
})

it('still records actual non-final quality as a visible block', async () => {
  io.phase = 'not-final'
  await expect(ingest()).resolves.toEqual([raw])
  expect(io.committed).toEqual([expect.objectContaining({ billing_status: 'blocked', billing_gate_reasons: expect.arrayContaining([expect.objectContaining({ code: 'quality_not_final' })]) })])
  expect(io.unresolved).toEqual([expect.objectContaining({ issue_type: 'billing_gate_blocked' })])
})

it('also avoids a stale gate when correction wins the allowed supply fallback retry', async () => {
  io.phase = 'before-supply-retry'
  await expect(ingest()).resolves.toEqual([raw])
  expect(io.attempts).toHaveLength(2)
  expect(io.refusals).toEqual(['normalized_metering_value_not_current_or_not_linked'])
  expect(io.committed).toEqual([])
  expect(io.unresolved).toEqual([])
})

it('still records an unqualified supply source as a visible current block', async () => {
  io.phase = 'supply-unqualified'
  await expect(ingest()).resolves.toEqual([raw])
  expect(io.attempts).toHaveLength(2)
  expect(io.committed).toEqual([expect.objectContaining({ billing_status: 'blocked', billing_gate_reasons: expect.arrayContaining([expect.objectContaining({ code: 'supply_source_unqualified' })]) })])
  expect(io.unresolved).toEqual([expect.objectContaining({ issue_type: 'billing_gate_blocked' })])
})

it.each(['no-lineage', 'wrong-projection'] as const)('retains the SQL failure for stale evidence with %s', async phase => {
  io.phase = phase
  await expect(ingest()).rejects.toMatchObject({ code: '23514', message: 'billing_gate_qualified_final_source_required' })
  expect(io.committed).toEqual([])
  expect(io.unresolved).toEqual([])
})

it('does not hide an unrelated authorization error even if the revision was replaced', async () => {
  io.phase = 'permission-denied'
  await expect(ingest()).rejects.toMatchObject({ code: '42501', message: 'permission denied' })
  expect(io.committed).toEqual([])
})
