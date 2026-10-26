// FINDINGS F46/F51: every path that prepares a Z03 first derives the requested method and the customer masterdata
// declaration from the signed agreement; the operator's "continue with Z03" path did not.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const chain = () => { const self: Record<string, unknown> = {}; for (const key of ['update', 'eq']) self[key] = () => self; self.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve); return self }
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => chain() } }))
vi.mock('@/lib/cis/db', () => ({ findOpenOutboundBySource: vi.fn() }))
// Declared port: the tenant's Z03 environment (FINDINGS I-B5); an explicit environment wins, otherwise production.
vi.mock('@/lib/operations/switchDispatchEnvironment', () => ({
  resolveSwitchDispatchEnvironment: async (input: { explicitEnvironment?: 'test' | 'production' | null }) => ({ ok: true, environment: input.explicitEnvironment ?? 'production' }),
}))
vi.mock('@/lib/operations/db', () => ({
  getSupplierSwitchRequestById: async () => ({ id: 'switch-1', company_id: 'company-a', site_id: null, metering_point_id: null, grid_owner_id: null, validation_snapshot: {} }),
  createSupplierSwitchEvent: async () => ({}),
}))
vi.mock('@/lib/masterdata/db', () => ({ getCustomerSiteById: async () => null, getMeteringPointById: async () => null, getGridOwnerById: async () => null }))
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({ evaluateSupplierSwitchSchedule: vi.fn() }))
vi.mock('@/lib/customer-operations/switchReadiness', () => ({ checkSupplierSwitchReadiness: vi.fn(), persistSwitchReadinessSnapshot: vi.fn() }))
vi.mock('@/lib/operations/switchRequestedMethodPreparation', () => ({
  deriveRequestedMethodBeforeSwitch: async (input: { switchRequestId: string }) => { calls.order.push(`derive:${input.switchRequestId}`) },
}))
vi.mock('@/lib/ediel/orchestrator', () => {
  const queue = (code: string) => async () => { calls.order.push(code); return { id: `msg-${code}`, message_code: code, outbound_request_id: null, communication_route_id: null } }
  return { prepareAndQueueEdielZ03: queue('Z03'), prepareAndQueueEdielZ05: queue('Z05'), prepareAndQueueEdielZ09: queue('Z09') }
})

import { continueSwitchEdielAutomation } from '@/lib/operations/edielAutomation'

beforeEach(() => { calls.order = [] })

describe('Z03 source derivation on every switch path (F46, F51)', () => {
  it('derives the sources before a continued Z03 is prepared', async () => {
    await continueSwitchEdielAutomation({ actorUserId: 'staff-1', switchRequestId: 'switch-1', step: 'Z03' })
    expect(calls.order).toEqual(['derive:switch-1', 'Z03'])
  })

  it('leaves Z05 and Z09 alone', async () => {
    await continueSwitchEdielAutomation({ actorUserId: 'staff-1', switchRequestId: 'switch-1', step: 'Z05' })
    await continueSwitchEdielAutomation({ actorUserId: 'staff-1', switchRequestId: 'switch-1', step: 'Z09' })
    expect(calls.order).toEqual(['Z05', 'Z09'])
  })
})
