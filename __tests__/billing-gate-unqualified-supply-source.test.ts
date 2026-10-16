// The TS billing gate checks the supply period's status and coverage, the
// database additionally requires a qualified Ediel market basis for it
// (switch confirmation or received Z04 with regulated ground). When the
// database refused an "eligible" gate, ingestion of the whole UTILTS file
// aborted after its first value. The database stays the authority: such a
// value is recorded as blocked, visibly, and ingestion continues.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { name: string; args: Record<string, unknown> }
const io = vi.hoisted(() => ({ rpcCalls: [] as Call[], inserts: [] as Array<{ table: string; row: Record<string, unknown> }>, refusal: 'billing_gate_qualified_supply_source_required' }))

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/billing/sourceBasis', () => ({ loadQualifiedBillingValues: async (_company: string, ids: string[]) => new Map(ids.map(id => [id, { id, source_message_id: 'msg-1' }])) }))
vi.mock('@/lib/billing/billingGate', () => ({ evaluateBillingGate: () => ({ status: 'eligible', eligible: true, reasons: [], snapshot: { gate_version: 'test' } }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    io.rpcCalls.push({ name, args })
    const gate = args.p_gate as Record<string, unknown>
    if (gate.billing_gate_status === 'eligible') return { data: null, error: { code: '23514', message: io.refusal, details: null, hint: null } }
    return { data: null, error: null }
  },
  from: (table: string) => {
    const rows = table === 'normalized_metering_values' ? [{ id: 'nv-1' }]
      : table === 'customer_supply_periods' ? [{ id: 'sp-1', contract_id: 'ct-1', customer_id: 'cu-1' }]
        : table === 'customer_contracts' ? [{ id: 'ct-1' }] : []
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'lte', 'or', 'limit', 'contains']) query[method] = () => query
    query.insert = async (row: Record<string, unknown>) => { io.inserts.push({ table, row }); return { error: null } }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
    return query
  },
} }))

import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'

const meterValue = { id: 'mv-1', company_id: 'co-1', metering_point_id: 'mp-1', period_start: '2026-09-01T22:00:00Z', period_end: '2026-09-01T22:15:00Z' } as never

beforeEach(() => { io.rpcCalls = []; io.inserts = []; io.refusal = 'billing_gate_qualified_supply_source_required' })

describe('billing gate without a qualified supply source', () => {
  it('records the value as blocked with the reason instead of aborting', async () => {
    await expect(updateMeterValueBillingReadiness({ meterValue, sourceMessageId: 'msg-1' })).resolves.toBe('blocked')
    expect(io.rpcCalls).toHaveLength(2)
    const gate = io.rpcCalls[1].args.p_gate as { billing_gate_status: string; billing_status: string; billing_gate_reasons: Array<{ code: string }> }
    expect(gate).toMatchObject({ billing_gate_status: 'blocked', billing_status: 'blocked' })
    expect(gate.billing_gate_reasons.map(reason => reason.code)).toContain('supply_source_unqualified')
    expect(io.inserts).toContainEqual(expect.objectContaining({ table: 'ediel_unresolved_items', row: expect.objectContaining({ issue_type: 'billing_gate_blocked' }) }))
    // One open item per supply period, not one per quarter-hour value.
    const item = io.inserts.find(insert => insert.table === 'ediel_unresolved_items')!.row.extracted_identifiers
    expect(item).toEqual({ meteringPointId: 'mp-1', supplyPeriodIds: ['sp-1'], reasonCodes: ['supply_source_unqualified'] })
  })

  it('still fails on any other database refusal', async () => {
    io.refusal = 'billing_gate_qualified_final_source_required'
    await expect(updateMeterValueBillingReadiness({ meterValue, sourceMessageId: 'msg-1' })).rejects.toMatchObject({ message: 'billing_gate_qualified_final_source_required' })
  })
})
