// reality-defects: F116
// A corrected E66 day re-sends all 96 quarters; only the changed ones get a new revision. For an unchanged
// quarter the database keeps the stored value (its own origin is the ORIGINAL message) and only links the
// correction as an extra source. The billing gate was nevertheless bound to the correction message: the gate
// compared the qualified basis (original) with the correction (source_message_missing, source_basis_unqualified)
// and the gate write rebound normalized_metering_values.source_message_id to the correction, so the value's
// basis stayed unqualified for good. Run 29: 72 of 96 quarters of the corrected day were never billable.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { name: string; args: Record<string, unknown> }
const io = vi.hoisted(() => ({ rpcCalls: [] as Call[], items: [] as Array<Record<string, unknown>>, gateInputs: [] as Array<Record<string, unknown>> }))

const ORIGINAL = 'msg-original-e66'
const CORRECTION = 'msg-correction-e66'

vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
// The database basis of the stored (unchanged) value: qualified on its own origin, the original message.
vi.mock('@/lib/billing/sourceBasis', () => ({ loadQualifiedBillingValues: async (_company: string, ids: string[]) => new Map(ids.map(id => [id, {
  id, company_id: 'co-1', metering_point_id: 'mp-1', source_metering_value_id: 'mv-1', source_message_id: ORIGINAL, quantity_kwh: '0.324',
  product_code: '8716867000030', revision_status: 'current', revision_number: 1, period_start: '2026-09-09T23:15:00Z', period_end: '2026-09-09T23:30:00Z',
  billing_source_basis: { version: 1, qualified: true, normalizedValueId: id, sourceMessageId: ORIGINAL, quantityType: '136', quantityKwh: '0.324', productCode: '8716867000030', qualityEstablished: true, quality: null },
  billing_source_message: { id: ORIGINAL, company_id: 'co-1', message_family: 'UTILTS', message_code: 'E66', status: 'validated' },
}])) }))
vi.mock('@/lib/billing/billingGate', async (load) => {
  const actual = await load<typeof import('@/lib/billing/billingGate')>()
  return { evaluateBillingGate: (input: Parameters<typeof actual.evaluateBillingGate>[0]) => {
    io.gateInputs.push(input as Record<string, unknown>)
    // Only the source binding is under test here; supply/contract are proven elsewhere (H1-H3, F108).
    const decision = actual.evaluateBillingGate(input)
    const sourceCodes = new Set(['source_message_missing', 'source_basis_unqualified', 'source_message_not_validated', 'source_message_family_not_metering', 'source_message_tenant_mismatch'])
    const reasons = decision.reasons.filter(reason => sourceCodes.has(reason.code))
    return { ...decision, reasons, status: reasons.length ? 'blocked' : 'eligible', eligible: reasons.length === 0, snapshot: { ...decision.snapshot, reason_codes: reasons.map(r => r.code) } }
  } }
})
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => { io.rpcCalls.push({ name, args }); return { data: null, error: null } },
  from: (table: string) => {
    const rows = table === 'normalized_metering_values' ? [{ id: 'nv-1' }]
      : table === 'customer_supply_periods' ? [{ id: 'sp-1', contract_id: 'ct-1', customer_id: 'cu-1', status: 'active', start_date: '2026-09-01', end_date: null }]
        : table === 'customer_contracts' ? [{ id: 'ct-1' }] : []
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'lte', 'or', 'limit', 'contains']) query[method] = () => query
    query.insert = async (row: Record<string, unknown>) => { io.items.push(row); return { error: null } }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
    return query
  },
} }))

import { updateMeterValueBillingReadiness } from '@/lib/billing/meterValueBillingMatcher'

// What gridex_consume_utilts_metering_v1 returns for an equal-value quarter of the correction: the existing row.
const storedOriginal = { id: 'mv-1', company_id: 'co-1', metering_point_id: 'mp-1', source_ediel_message_id: ORIGINAL,
  period_start: '2026-09-09T23:15:00Z', period_end: '2026-09-09T23:30:00Z' } as never

beforeEach(() => { io.rpcCalls = []; io.items = []; io.gateInputs = [] })

describe('F116: an unchanged quarter re-sent by a corrected E66 day', () => {
  it('is gated on its own origin (the original message) and stays billable', async () => {
    await expect(updateMeterValueBillingReadiness({ meterValue: storedOriginal, sourceMessageId: CORRECTION })).resolves.toBe('billable')
    const gate = io.rpcCalls.find(call => call.name === 'gridex_set_metering_billing_gate')!.args.p_gate as Record<string, unknown>
    expect(gate).toMatchObject({ billing_gate_status: 'eligible', billing_status: 'billable', source_message_id: ORIGINAL })
    expect((io.gateInputs[0].normalizedValue as Record<string, unknown>).source_message_id).toBe(ORIGINAL)
    expect(io.items).toEqual([])
  })

  it('never rebinds the value to the correction that only re-sent it', async () => {
    await updateMeterValueBillingReadiness({ meterValue: storedOriginal, sourceMessageId: CORRECTION })
    for (const call of io.rpcCalls) expect((call.args.p_gate as Record<string, unknown>).source_message_id).not.toBe(CORRECTION)
  })

  it('a changed quarter (new revision from the correction) is still gated on the correction', async () => {
    const newRevision = { id: 'mv-2', company_id: 'co-1', metering_point_id: 'mp-1', source_ediel_message_id: CORRECTION,
      period_start: '2026-09-09T23:00:00Z', period_end: '2026-09-09T23:15:00Z' } as never
    await updateMeterValueBillingReadiness({ meterValue: newRevision, sourceMessageId: CORRECTION })
    expect((io.rpcCalls[0].args.p_gate as Record<string, unknown>).source_message_id).toBe(CORRECTION)
  })
})
