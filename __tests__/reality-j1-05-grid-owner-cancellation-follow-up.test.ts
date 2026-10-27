// reality-defects: J1-05
// J1-05 (scenario J1, step J1-8; native proof scripts/inbound-prodat-j1-native.test.ts): the grid owner withdraws a
// start it had confirmed (Z04 with transaction reason Z24, "Z04C"). The native owner cancels the switch and the
// confirmed period correctly, but the business-state consumer opened no operator case and told the customer
// nothing, although the customer had already been told "switch.confirmed" by the Z04. Now the first committed
// cancellation opens one operator case and queues one customer notice; a replay (idempotent result), a held
// cancellation and a cancellation without a customer scope do neither (AT-Z04C-SUPPLIER component evidence).
// Rules exercised (specification only, not coverage tags): P-11, P-14, OPS-02.
//
// Unit proof: the real lifecycle decision, business-state consumer and lifecycle-notification queue run; only the
// native RPC (its committed result), storage (in memory) and the event/workflow writers are replaced. Synthetic data.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { characteristic, line, raw } from './fixtures/prodat-register'
import { source as identitySource } from './fixtures/prodat-identity'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, seq: 0, rpc: vi.fn(), event: vi.fn(), workflow: vi.fn() }))

vi.mock('@/lib/supabase/service', () => {
  const from = (table: string) => {
    let op: 'select' | 'insert' = 'select'
    let value: Row = {}
    const filters: Array<(row: Row) => boolean> = []
    const run = () => {
      const rows = (io.rows[table] ??= [])
      if (op === 'insert') { const row = { id: `${table}-${++io.seq}`, ...value }; rows.push(row); return [row] }
      return rows.filter((row) => filters.every((filter) => filter(row)))
    }
    const q: Row = {}
    Object.assign(q, {
      select: () => q,
      eq: (column: string, expected: unknown) => { filters.push((row) => row[column] === expected); return q },
      limit: () => q,
      insert: (row: Row) => { op = 'insert'; value = row; return q },
      single: async () => ({ data: structuredClone(run()[0] ?? null), error: null }),
      maybeSingle: async () => ({ data: structuredClone(run()[0] ?? null), error: null }),
    })
    return q
  }
  return { supabaseService: { from, rpc: io.rpc } }
})
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))

import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachineLegacy'

function z04c(overrides: Partial<EdielMessageRow> = {}): EdielMessageRow {
  const wire = raw([
    ['NAD', 'FR', ['GRID', '', '9']], ['NAD', 'DO', ['SUPPLIER', '', '9']],
    line('1', '735123456789012345', undefined, '9'), ...characteristic('Z13', 'Z24'),
    ['RFF', ['LI', 'EXACT-ORIGINAL']], ['DTM', ['92', '202701010000', '203']],
    ['NAD', 'UD', ['CUSTOMER', 'SE1', '260']],
  ])
  return {
    ...identitySource(wire, 'Z04'),
    id: 'received-C', company_id: 'own-company', customer_id: 'own-customer', site_id: 'own-site', metering_point_id: 'own-point',
    switch_request_id: 'own-switch', direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04', message_version: 'E2SE6A',
    application_reference: '23-DDQ-PRODAT', message_received_at: '2026-10-01T12:00:00Z', raw_payload: wire, parsed_payload: {},
    ...overrides,
  } as EdielMessageRow
}
const committed = (idempotent = false) => ({ data: { applied: true, idempotent, periods: [{ id: 'own-period', status: 'cancelled' }] }, error: null })
const cases = () => io.rows.customer_cases ?? []
const notices = () => (io.rows.customer_operation_jobs ?? []).filter((job) => job.job_type === 'dispatch_lifecycle_notification')

beforeEach(() => {
  vi.clearAllMocks()
  io.rows = {}; io.seq = 0
  io.event.mockResolvedValue(undefined)
  io.workflow.mockResolvedValue(undefined)
})

describe('J1-05 a grid-owner cancellation of a confirmed start reaches an operator and the customer', () => {
  it('the first committed Z04C opens one operator case for the withdrawn start', async () => {
    io.rpc.mockResolvedValue(committed())
    const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: z04c(), matchedSwitchRequestId: 'own-switch' })
    expect(result).toMatchObject({ outcome: 'supplier_switch_cancelled_before_start', reviewRequired: false })
    expect(result.updated).toContain('customer_cases')
    expect(cases()).toHaveLength(1)
    expect(cases()[0]).toMatchObject({ company_id: 'own-company', customer_id: 'own-customer', site_id: 'own-site', metering_point_id: 'own-point',
      supplier_switch_request_id: 'own-switch', case_type: 'other', status: 'open', source_ediel_message_id: 'received-C',
      reason_category: 'grid_owner_start_cancellation', source: 'ediel_inbound_state_machine' })
  })

  it('the customer, already told the start was confirmed, gets one notice that it is withdrawn', async () => {
    io.rpc.mockResolvedValue(committed())
    await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: z04c(), matchedSwitchRequestId: 'own-switch' })
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toMatchObject({ company_id: 'own-company', customer_id: 'own-customer', metering_point_id: 'own-point', status: 'queued',
      payload: { event_type: 'supplier_switch.cancelled_by_grid_owner' } })
    expect(String(notices()[0].idempotency_key)).toContain('switch.action_required')
    expect(JSON.stringify(notices()[0].payload)).toContain('case_message')
  })

  it('the same committed cancellation projected twice opens one case and one notice', async () => {
    io.rpc.mockResolvedValue(committed())
    await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: z04c(), matchedSwitchRequestId: 'own-switch' })
    await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: z04c(), matchedSwitchRequestId: 'own-switch' })
    expect(cases()).toHaveLength(1)
    expect(notices()).toHaveLength(1)
  })

  it('a replayed (idempotent) cancellation result opens nothing new', async () => {
    io.rpc.mockResolvedValue(committed(true))
    const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: z04c(), matchedSwitchRequestId: 'own-switch' })
    expect(result.outcome).toBe('supplier_switch_cancelled_before_start')
    expect(cases()).toEqual([])
    expect(notices()).toEqual([])
  })

  it('a held cancellation (native refusal) still goes to review only, with no case for a withdrawn start and no notice', async () => {
    io.rpc.mockResolvedValue({ data: { applied: false, reason: 'z04c_exact_original_unavailable' }, error: null })
    const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: z04c(), matchedSwitchRequestId: 'own-switch' })
    expect(result).toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] })
    expect(cases()).toEqual([])
    expect(notices()).toEqual([])
  })

  it('a committed cancellation without a customer scope writes no case or notice for a guessed customer', async () => {
    io.rpc.mockResolvedValue(committed())
    await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: z04c({ customer_id: null, site_id: null, metering_point_id: null, switch_request_id: null }) })
    expect(cases()).toEqual([])
    expect(notices()).toEqual([])
  })
})
