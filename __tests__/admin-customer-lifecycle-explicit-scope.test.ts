import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  guard: vi.fn(),
  customerContext: vi.fn(),
  operational: vi.fn(),
  case: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  contract: vi.fn(),
  site: vi.fn(),
  point: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(path) } }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: io.guard }))
vi.mock('@/lib/tenant/entityGuards', () => ({
  loadCustomerTenantContext: io.customerContext,
  assertContractTenant: io.contract,
  assertCustomerSiteTenant: io.site,
  assertMeteringPointTenant: io.point,
}))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: io.operational }))
vi.mock('@/lib/tenant/adminScope', () => ({}))
vi.mock('@/lib/supabase/server', () => ({}))
vi.mock('@/lib/operations/db', () => ({}))
vi.mock('@/lib/cis/db', () => ({}))
vi.mock('@/lib/cis/edielAutomation', () => ({}))
vi.mock('@/lib/audit/actionLogger', () => ({ logUsageEvent: vi.fn() }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({}))
vi.mock('@/lib/customer-cases/db', () => ({ createCustomerCase: io.case }))
vi.mock('@/lib/customer-cases/engine', () => ({ assessWithdrawal: () => ({ scenario: 'before_prodat_sent' }) }))
vi.mock('@/app/admin/customers/[id]/actions.part-1', () => ({
  formValue: (form: FormData, key: string) => {
    const value = form.get(key)
    return typeof value === 'string' ? value : null
  },
  toBoolean: (form: FormData, key: string) => form.get(key) === 'true',
  normalizeDateOrNull: (value: string | null) => value,
  insertAuditLog: io.audit,
}))
vi.mock('@/app/admin/customers/[id]/actions.part-2', () => ({}))
vi.mock('@/app/admin/customers/[id]/actions.part-3', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: io.rpc,
    from: (table: string) => {
      const query = { select: () => query, eq: () => query, order: () => query,
        limit: () => query, maybeSingle: () => io.read(table) }
      return query
    },
  },
}))

import { registerCustomerLifecycleDecisionAction } from '@/app/admin/customers/[id]/actions'

const companyId = '00000000-0000-4000-8000-000000000001'
const customerId = '00000000-0000-4000-8000-000000000002'
const contractId = '00000000-0000-4000-8000-000000000003'
const siteId = '00000000-0000-4000-8000-000000000004'
const pointId = '00000000-0000-4000-8000-000000000005'
const intentId = '00000000-0000-4000-8000-000000000006'
const now = '2026-11-22T11:15:00.000Z'
const impactReceipt = 'a'.repeat(64)

function form(fields: Record<string, string | undefined>) {
  const request = new FormData()
  for (const [key, value] of Object.entries({
    customer_id: customerId, confirmed: 'true', decision_intent_id: intentId,
    received_at: now, reason: 'Syntetiskt beslut', ...fields,
  })) if (value !== undefined) request.set(key, value)
  return request
}

beforeEach(() => {
  vi.resetAllMocks()
  io.guard.mockResolvedValue({ userId: 'staff-a', isPlatformAdmin: false, permissions: ['masterdata.write'] })
  io.customerContext.mockResolvedValue({ companyId, customer: { company_id: companyId, id: customerId, status: 'active' } })
  io.operational.mockResolvedValue(undefined)
  io.case.mockResolvedValue({ id: 'synthetic-case' })
  io.contract.mockResolvedValue({ id: contractId })
  io.read.mockImplementation(async table => ({
    data: table === 'customer_contracts'
      ? { id: contractId, site_id: siteId, metering_point_id: pointId, signed_at: now, updated_at: now }
      : null,
    error: null,
  }))
  io.rpc.mockResolvedValue({ data: { caseId: intentId, heldUnderlays: 1, existing: false }, error: null })
})

it.each([
  ['missing decision', { scope_target: 'customer:' }, 'typ av beslut'],
  ['unknown decision', { decision_type: 'unknown', scope_target: 'customer:' }, 'typ av beslut'],
  ['missing scope', { decision_type: 'withdrawal' }, 'Välj uttryckligen'],
  ['unknown scope', { decision_type: 'withdrawal', scope_target: 'unknown:' }, 'Välj uttryckligen'],
  ['unparseable target', { decision_type: 'withdrawal', scope_target: 'customer' }, 'Välj uttryckligen'],
  ['inconsistent fields', { decision_type: 'withdrawal', scope_target: 'customer:', scope_type: 'contract', scope_id: contractId }, 'Välj uttryckligen'],
  ['extra target part', { decision_type: 'withdrawal', scope_target: `contract:${contractId}:extra` }, 'Välj uttryckligen'],
  ['missing selected contract', { decision_type: 'withdrawal', scope_target: 'contract:' }, 'Välj vilket avtal'],
] as const)('requires a precise lifecycle choice before touching a customer when %s', async (_, fields, message) => {
  await expect(registerCustomerLifecycleDecisionAction(form(fields))).rejects.toThrow(message)
  expect(io.customerContext).not.toHaveBeenCalled()
  expect(io.read).not.toHaveBeenCalled()
  expect(io.case).not.toHaveBeenCalled()
  expect(io.rpc).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it.each([
  { scope_target: `contract:${contractId}` },
  { scope_type: 'contract', scope_id: contractId },
  { scope_target: `contract:${contractId}`, scope_type: 'contract', scope_id: contractId },
])('keeps the given contract through the existing withdrawal command (%j)', async scope => {
  await registerCustomerLifecycleDecisionAction(form({ decision_type: 'withdrawal', withdrawal_impact_receipt: impactReceipt, ...scope }))
  expect(io.rpc).toHaveBeenCalledOnce()
  expect(io.rpc).toHaveBeenCalledWith('gridex_register_contract_withdrawal_case_v1', expect.objectContaining({
    p_company_id: companyId, p_customer_id: customerId, p_contract_id: contractId,
    p_site_id: siteId, p_meter_id: pointId, p_intent_id: intentId,
    p_assessment: expect.objectContaining({ impactReceipt, contractUpdatedAt: now }),
  }))
  expect(io.case).not.toHaveBeenCalled()
})

it('retains a deliberately selected whole-customer cancellation', async () => {
  await registerCustomerLifecycleDecisionAction(form({ decision_type: 'cancelled', scope_target: 'customer:' }))
  expect(io.rpc).toHaveBeenCalledWith('gridex_register_customer_lifecycle_decision_v1', expect.objectContaining({
    p_decision_type: 'cancelled', p_scope_type: 'customer', p_scope_id: null,
  }))
  expect(io.case).toHaveBeenCalledOnce()
})

it('requires an impact preview before sending a contract withdrawal to its writer', async () => {
  await expect(registerCustomerLifecycleDecisionAction(form({
    decision_type: 'withdrawal', scope_target: `contract:${contractId}`,
  }))).rejects.toThrow('Förhandsvisa avtalsstoppet')
  expect(io.rpc).not.toHaveBeenCalled()
  expect(io.case).not.toHaveBeenCalled()
})
