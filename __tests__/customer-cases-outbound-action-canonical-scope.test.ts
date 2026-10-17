import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null,
  platform: false,
  denied: false,
  rows: new Map<string, Record<string, unknown>>(),
  audit: [] as Array<Record<string, unknown>>,
  create: vi.fn(), update: vi.fn(), getCase: vi.fn(), note: vi.fn(),
  getOutbound: vi.fn(), listOutbound: vi.fn(), refresh: vi.fn(), retry: vi.fn(),
  revalidate: vi.fn(), legacy: vi.fn(),
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async () => {
    if (io.denied) throw new Error('permission_denied')
    return { userId: 'operator', email: 'operator@example.invalid', roles: [],
      permissions: ['cases.write', 'switching.write'], companyId: io.companyId, isPlatformAdmin: io.platform }
  },
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({
  TenantCompanyRequiredError: class extends Error { constructor() { super('canonical_company_required') } },
  getOperationalCompanyScope: io.legacy,
}))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('@/lib/customer-cases/support', () => ({ createTenantSupportCase: io.create }))
vi.mock('@/lib/customer-cases/db', () => ({ getCustomerCaseById: io.getCase, updateCustomerCaseStatus: io.update }))
vi.mock('@/lib/customer-service/supportConversation', () => ({
  PHONE_VERIFICATION_METHODS: { known_customer: 'Fixture verification' },
  addInternalNote: io.note, recordPhoneInteraction: vi.fn(), replyToCustomer: vi.fn(),
}))
vi.mock('@/lib/customer-service/supportAttachments', () => ({ SUPPORT_ATTACHMENT_OPS_MAX_BYTES: 4_000_000, addSupportAttachment: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({
  getOutboundRequestById: io.getOutbound, listUnresolvedOutboundRequests: io.listOutbound,
  resetOutboundRequestForRetry: io.retry, refreshOutboundRequestRouteResolution: io.refresh,
}))
vi.mock('@/lib/operations/db', () => ({ createSupplierSwitchEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) },
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => ({ insert: async (row: Record<string, unknown>) => {
    expect(table).toBe('audit_logs'); io.audit.push(row); return { error: null }
  } }),
} }))

import { addInternalNoteAction, createCustomerCaseFromFormAction, updateCustomerCaseStatusAction } from '@/app/admin/customer-cases/actions'
import { rerunAllUnresolvedRouteResolutionsAction, rerunUnresolvedRouteResolutionAction } from '@/app/admin/outbound/unresolved/actions'

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
const createForm = () => form({ customer_id: 'customer-A', title: 'Fixture support case', expected_company_id: 'guard-A' })
const outboundForm = (id = 'outbound-A') => form({ outbound_request_id: id, customer_id: `customer-${id.slice(-1)}` })

beforeEach(() => {
  io.companyId = 'guard-A'; io.platform = false; io.denied = false; io.audit = []
  for (const mock of [io.create, io.update, io.getCase, io.note, io.getOutbound, io.listOutbound, io.refresh, io.retry, io.revalidate, io.legacy]) mock.mockReset()
  io.legacy.mockResolvedValue({ companyId: 'legacy-B', companyName: 'Legacy B', message: null })
  io.create.mockImplementation(async input => {
    const owner = input.customerId === 'customer-A' ? 'guard-A' : 'legacy-B'
    // The production support graph checks customer ownership of the supplied
    // company; it cannot determine which company the permission guard chose.
    if (input.companyId !== owner) throw new Error('support_customer_not_found_in_company')
    return { case: { id: 'created-case', company_id: input.companyId }, reused: false }
  })
  io.update.mockImplementation(async input => {
    if (input.companyId !== 'guard-A') throw new Error('case_not_found_in_company')
  })
  io.getCase.mockImplementation(async (id, company) => company === 'guard-A'
    ? { id, company_id: company, customer_id: 'customer-A' } : null)
  io.rows = new Map(['A', 'B'].map(suffix => [`outbound-${suffix}`, {
    id: `outbound-${suffix}`, company_id: suffix === 'A' ? 'guard-A' : 'legacy-B', customer_id: `customer-${suffix}`,
    channel_type: 'unresolved', status: 'queued', request_type: 'meter_values', source_type: 'metering', source_id: null,
  }]))
  io.getOutbound.mockImplementation(async id => io.rows.get(id) ?? null)
  io.listOutbound.mockImplementation(async ({ companyId }) => [...io.rows.values()].filter(row => companyId === null || row.company_id === companyId))
  io.refresh.mockImplementation(async ({ outboundRequestId }) => ({ ...io.rows.get(outboundRequestId), channel_type: 'api' }))
})

it('creates support under the canonical permission company and retains the rendered-form tenant fence', async () => {
  await createCustomerCaseFromFormAction(createForm())
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A', actorUserId: 'operator' }))
  expect(io.legacy).not.toHaveBeenCalled()
})

it('does not create a legacy-company customer case using permission granted for another company', async () => {
  await expect(createCustomerCaseFromFormAction(form({ customer_id: 'customer-B', title: 'Fixture case' })))
    .rejects.toThrow('support_customer_not_found_in_company')
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('refuses a stale company tab before invoking the support writer', async () => {
  await expect(createCustomerCaseFromFormAction(form({ customer_id: 'customer-B', title: 'Fixture case', expected_company_id: 'legacy-B' })))
    .rejects.toThrow('annan flik')
  expect(io.create).not.toHaveBeenCalled()
})

it('uses the canonical company for support status and conversation ownership', async () => {
  await updateCustomerCaseStatusAction(form({ case_id: 'case-A', status: 'resolved' }))
  await addInternalNoteAction(form({ case_id: 'case-A', message: 'Fixture internal note' }))
  expect(io.update).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A', caseId: 'case-A' }))
  expect(io.getCase).toHaveBeenCalledWith('case-A', 'guard-A')
  expect(io.note).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A', actorUserId: 'operator' }))
})

it('reruns the canonical company outbound row even when legacy selection differs', async () => {
  await rerunUnresolvedRouteResolutionAction(outboundForm())
  expect(io.refresh).toHaveBeenCalledWith({ actorUserId: 'operator', outboundRequestId: 'outbound-A' })
  expect(io.audit[0].company_id).toBe('guard-A')
  expect(io.legacy).not.toHaveBeenCalled()
})

it('refuses a foreign outbound row before any route or audit mutation', async () => {
  await expect(rerunUnresolvedRouteResolutionAction(outboundForm('outbound-B'))).rejects.toThrow('saknar åtkomst')
  expect(io.refresh).not.toHaveBeenCalled(); expect(io.retry).not.toHaveBeenCalled(); expect(io.audit).toEqual([])
})

it('bulk rerun selects only the company covered by the existing permission guard', async () => {
  await rerunAllUnresolvedRouteResolutionsAction()
  expect(io.listOutbound).toHaveBeenCalledWith({ companyId: 'guard-A' })
  expect(io.refresh.mock.calls.map(([input]) => input.outboundRequestId)).toEqual(['outbound-A'])
  expect(io.audit.every(row => row.company_id === 'guard-A')).toBe(true)
})

it.each([
  ['support', () => createCustomerCaseFromFormAction(createForm())],
  ['outbound row', () => rerunUnresolvedRouteResolutionAction(outboundForm())],
  ['outbound bulk', () => rerunAllUnresolvedRouteResolutionsAction()],
] as const)('%s rejects explicit null tenant before mutation and never borrows a legacy company', async (_name, action) => {
  io.companyId = null
  await expect(action()).rejects.toThrow()
  expect(io.create).not.toHaveBeenCalled(); expect(io.refresh).not.toHaveBeenCalled()
  expect(io.listOutbound).not.toHaveBeenCalled(); expect(io.audit).toEqual([])
})

it.each([
  ['support', () => createCustomerCaseFromFormAction(createForm())],
  ['outbound', () => rerunAllUnresolvedRouteResolutionsAction()],
] as const)('%s retains the existing permission refusal before reads or writes', async (_name, action) => {
  io.denied = true
  await expect(action()).rejects.toThrow('permission_denied')
  expect(io.getOutbound).not.toHaveBeenCalled(); expect(io.listOutbound).not.toHaveBeenCalled()
  expect(io.create).not.toHaveBeenCalled(); expect(io.refresh).not.toHaveBeenCalled(); expect(io.audit).toEqual([])
})

it('platform outbound keeps global bulk scope independently of a selected company', async () => {
  io.platform = true
  await rerunAllUnresolvedRouteResolutionsAction()
  expect(io.listOutbound).toHaveBeenCalledWith({ companyId: null })
  expect(io.refresh.mock.calls.map(([input]) => input.outboundRequestId)).toEqual(['outbound-A', 'outbound-B'])
  expect(io.audit.at(-1)?.company_id).toBeNull()
})

it('platform support retains the explicit selected company and cannot invent one', async () => {
  io.platform = true
  await createCustomerCaseFromFormAction(createForm())
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  io.create.mockClear(); io.companyId = null
  await expect(createCustomerCaseFromFormAction(createForm())).rejects.toThrow()
  expect(io.create).not.toHaveBeenCalled()
})
