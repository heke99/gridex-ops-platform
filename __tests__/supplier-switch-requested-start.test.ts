// FINDINGS F81: the website stores the customer's requested start on the contract, but the next-step engine
// created the supplier switch without it, so a normal switch always got today + 14 days (only a move-in date
// was carried). The signed contract's requested start now reaches the request creator, which still raises a
// date earlier than the market lead time to the earliest valid one.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ contract: null as Record<string, unknown> | null, ensured: [] as Array<Record<string, unknown>> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/operations/db', () => ({
  findOpenSupplierSwitchRequestForSite: vi.fn(async () => null),
  findCustomerSiteById: vi.fn(), listMeteringPointsForSite: vi.fn(), listPowersOfAttorneyByCustomerId: vi.fn(async () => []),
  syncOperationTasksFromReadiness: vi.fn(async () => undefined),
}))
vi.mock('@/lib/customer-operations/switchReadiness', () => ({
  checkSupplierSwitchReadiness: vi.fn(async () => ({ ready: true, blockers: [], siteReadiness: { candidateMeteringPointId: 'mp-1' }, readinessSnapshot: {} })),
  persistSwitchReadinessSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: vi.fn() }))
vi.mock('@/lib/customer-operations/customerProcessEvents', () => ({ emitCustomerProcessEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/operations/edielAutomation', () => ({ ensureInitialSwitchEdielAutomation: vi.fn(async () => ({ blocked: false, blockers: [] })) }))
vi.mock('@/lib/customer-operations/customerSiteProcessContext', () => ({
  isContractOperationallyReadyForSite: vi.fn(async () => state.contract),
}))
vi.mock('@/lib/customer-operations/supplierSwitchOrchestration', () => ({
  ensureSupplierSwitchRequestForReadySite: vi.fn(async (input: Record<string, unknown>) => {
    state.ensured.push(input)
    return { ok: true, request: { id: 'switch-1' }, blockers: [] }
  }),
}))

import { tryPrepareSupplierSwitch } from '@/lib/customer-operations/customerProcessNextStepEngine'

const input: Parameters<typeof tryPrepareSupplierSwitch>[0] = {
  companyId: '00000000-0000-4000-8000-000000000001', customerId: '00000000-0000-4000-8000-000000000002',
  site: { id: '00000000-0000-4000-8000-000000000003', move_in_date: null } as never,
  meteringPoint: { id: 'mp-1' } as never, actorUserId: '00000000-0000-4000-8000-000000000004',
}

beforeEach(() => { state.contract = null; state.ensured = [] })

describe('the customer\'s requested start reaches the supplier switch (F81)', () => {
  it('passes the signed contract\'s requested start to the request creator', async () => {
    state.contract = { ready: true, contractId: 'contract-1', requestedStartDate: '2026-11-12', blockers: [] }
    await expect(tryPrepareSupplierSwitch(input)).resolves.toEqual({ switchRequestId: 'switch-1', alreadyOpen: false })
    expect(state.ensured).toEqual([expect.objectContaining({ siteId: input.site.id, requestedStartDate: '2026-11-12' })])
  })

  it('without a contract date the creator decides as before (earliest valid start)', async () => {
    state.contract = { ready: false, contractId: null, requestedStartDate: null, blockers: [] }
    await tryPrepareSupplierSwitch(input)
    expect(state.ensured).toEqual([expect.objectContaining({ requestedStartDate: null })])
  })
})
