import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ selected: 'selected-company' as string | null, operational: 'selected-company', ledger: vi.fn(), graph: vi.fn(), params: vi.fn(), operationalScope: vi.fn(), parseImport: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => ({ userId: 'staff', companyId: io.selected, permissions: ['customers.write'] }), isPlatformAdminContext: () => true }))
vi.mock('@/lib/admin/accessModel', () => ({ hasPermissionRequirement: () => true }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: io.operationalScope }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: vi.fn() }))
vi.mock('@/lib/customers/importParser', () => ({ parseCustomerImportFormData: io.parseImport }))
vi.mock('@/lib/intakes/customerApplicationIntakes', () => ({ getOrCreateCustomerApplicationIntake: io.ledger, completeCustomerApplicationIntake: vi.fn(), failCustomerApplicationIntake: vi.fn() }))
vi.mock('@/app/admin/customers/actions.part-1', () => ({ getActorUserId: async () => 'staff', getString: (form: FormData, key: string) => String(form.get(key) ?? '').trim(), getFormValues: () => ({}), buildCreateCustomerParams: io.params }))
vi.mock('@/app/admin/customers/actions.part-2', () => ({ CustomerGraphCommittedReviewError: class extends Error {}, ADMIN_INTAKE_IN_PROGRESS_STALE_MS: 60000, ADMIN_INTAKE_ROUTE: 'admin-intake', createCustomerGraph: io.graph, mapUnknownErrorToIntakeState: (error: Error) => ({ status: 'error', message: error.message, fieldErrors: {}, values: {}, createdCustomerId: null }) }))
vi.mock('@/app/admin/customers/actions.part-4', () => ({ rowValue: vi.fn() }))
import { createCustomerAction } from '@/app/admin/customers/actions.part-3'
import { initialIntakeActionState } from '@/app/admin/customers/actionState'
function form(expected?: string) { const value = new FormData(); if (expected !== undefined) value.set('expected_company_id', expected); return value }
beforeEach(() => {
  vi.clearAllMocks(); io.parseImport.mockResolvedValue({ rows: [], warnings: [] }); io.selected = 'selected-company'; io.operational = 'selected-company'
  io.operationalScope.mockImplementation(async () => io.operational)
  io.params.mockImplementation((_form, _actor, companyId) => ({ companyId, customerType: 'private', optionalFeeLines: [] }))
  io.ledger.mockResolvedValue({ created: false, intake: { id: 'intake', status: 'received', updated_at: new Date().toISOString() } })
})
it.each([undefined, '', 'other-company'])('refuses absent or forged rendered company %s before any intake write', async expected => {
  const result = await createCustomerAction(initialIntakeActionState, form(expected))
  expect(result.status).toBe('error')
  expect(io.ledger).not.toHaveBeenCalled(); expect(io.graph).not.toHaveBeenCalled(); expect(io.params).not.toHaveBeenCalled()
})
it('refuses a stale selected company even if operational membership still resolves', async () => {
  io.selected = 'switched-company'
  await createCustomerAction(initialIntakeActionState, form('selected-company'))
  expect(io.ledger).not.toHaveBeenCalled(); expect(io.params).not.toHaveBeenCalled()
})
it('refuses platform selected-company to membership fallback mismatch', async () => {
  io.operational = 'old-preferred-company'
  await createCustomerAction(initialIntakeActionState, form('selected-company'))
  expect(io.ledger).not.toHaveBeenCalled(); expect(io.params).not.toHaveBeenCalled(); expect(io.graph).not.toHaveBeenCalled()
})
it('refuses missing canonical scope and admits only matching form, guard and operational company', async () => {
  io.selected = null
  await createCustomerAction(initialIntakeActionState, form('selected-company'))
  expect(io.ledger).not.toHaveBeenCalled()
  io.selected = 'selected-company'
  await createCustomerAction(initialIntakeActionState, form('selected-company'))
  expect(io.ledger).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'selected-company' }))
})

it.each(['bulk', 'preview', 'commit'])('%s refuses missing, stale and operational-fallback company before parsing or writes', async action => {
  const actual = await vi.importActual<typeof import('@/app/admin/customers/actions.part-4')>('@/app/admin/customers/actions.part-4')
  const invoke = async (input: FormData) => {
    if (action === 'bulk') return actual.bulkCreateCustomersAction(input)
    return action === 'preview' ? actual.previewCustomerImportAction({} as never, input) : actual.commitCustomerImportAction({} as never, input)
  }
  for (const expected of [undefined, 'forged-company']) {
    await invoke(form(expected)).catch(() => undefined)
    expect(io.parseImport).not.toHaveBeenCalled(); expect(io.ledger).not.toHaveBeenCalled()
  }
  io.operational = 'old-preferred-company'
  await invoke(form('selected-company')).catch(() => undefined)
  expect(io.parseImport).not.toHaveBeenCalled(); expect(io.graph).not.toHaveBeenCalled()
})

it.each(['bulk', 'preview', 'commit'])('%s admits matching rendered, canonical and operational company to the import parser', async action => {
  const actual = await vi.importActual<typeof import('@/app/admin/customers/actions.part-4')>('@/app/admin/customers/actions.part-4')
  const input = form('selected-company')
  const task = action === 'bulk' ? actual.bulkCreateCustomersAction(input) : action === 'preview' ? actual.previewCustomerImportAction({} as never, input) : actual.commitCustomerImportAction({} as never, input)
  await task.catch(() => undefined)
  expect(io.parseImport).toHaveBeenCalledWith(input)
})
